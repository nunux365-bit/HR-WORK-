"""
Tests for Admin Governance Rules:
1. Rule: When a user is logged in as Admin, auto-reply to incoming emails / cases is suppressed.
2. Admin can change user roles and assign another role.
3. Admin can switch their own active operating role.
4. Non-admin users are forbidden from changing or assigning roles.
"""

import json
import pytest
from backend.server import create_app
from backend.database.connection import get_connection, execute_query
from backend.services.cases.case_engine import (
    send_case_created_email_to_employee,
    is_admin_logged_in_or_suppressed,
)
from backend.api.auth_routes import _ACTIVE_SESSIONS


@pytest.fixture
def app():
    app = create_app()
    app.config["TESTING"] = True
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def test_auto_reply_suppressed_when_admin_logged_in(app):
    """Verify that auto-reply is suppressed when a user is logged in as ADMIN."""
    conn = get_connection()
    try:
        conn.execute("DELETE FROM cases WHERE case_number = 'TEST-CASE-ADMIN-001'")
        conn.execute("DELETE FROM emails WHERE provider_message_id = 'msg-admin-rule-test-01'")
        # Create a test case
        cur = conn.execute(
            """
            INSERT INTO cases (case_number, title, category, status, priority, sla_hours)
            VALUES ('TEST-CASE-ADMIN-001', 'Test Resignation Inquiry', 'RESIGNATION', 'NEW', 'HIGH', 24)
            """
        )
        case_id = cur.lastrowid
        # Seed an email
        cur_email = conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body)
            VALUES ('test', 'msg-admin-rule-test-01', 'John Doe', 'john.doe@example.com', 'Resignation Letter', 'I resign')
            """
        )
        email_id = cur_email.lastrowid
        conn.commit()
    finally:
        conn.close()

    # Case 1: In Flask request context with X-HR-Role: ADMIN
    with app.test_request_context("/api/cases", headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"}):
        suppressed, reason = is_admin_logged_in_or_suppressed()
        assert suppressed is True
        assert "ADMIN" in reason

        res = send_case_created_email_to_employee(
            case_identifier=case_id,
            email_row={"id": email_id, "sender_email": "john.doe@example.com", "subject": "Resignation Letter"},
            auto_triggered=True,
        )
        assert res["sent"] is False
        assert res["status"] == "SKIPPED_ADMIN_LOGGED_IN"
        assert "Auto-reply disabled" in res["message"]

    # Verify audit log was created
    audit = execute_query(
        "SELECT action, description FROM audit_logs WHERE entity_type = 'CASE' AND entity_id = ? AND action = 'AUTO_REPLY_SUPPRESSED_ADMIN' ORDER BY id DESC LIMIT 1",
        (str(case_id),),
        fetch_one=True,
    )
    assert audit is not None
    assert "AUTO_REPLY_SUPPRESSED_ADMIN" in audit["action"]

    # Cleanup test case & email
    c_clean = get_connection()
    c_clean.execute("DELETE FROM cases WHERE case_number = 'TEST-CASE-ADMIN-001'")
    c_clean.execute("DELETE FROM emails WHERE provider_message_id = 'msg-admin-rule-test-01'")
    c_clean.commit()
    c_clean.close()


def test_admin_can_assign_another_role(client):
    """Verify that an admin can assign another role to a user and all tables stay in sync."""
    conn = get_connection()
    try:
        # Ensure a test employee exists in users and hr_department_members
        conn.execute("DELETE FROM users WHERE email = 'test_agent_swap@example.com'")
        conn.execute("DELETE FROM hr_department_members WHERE email = 'test_agent_swap@example.com'")
        cur = conn.execute(
            "INSERT INTO users (email, name, role) VALUES ('test_agent_swap@example.com', 'Test Agent', 'HR_AGENT')"
        )
        user_id = cur.lastrowid
        dept_row = conn.execute("SELECT id, team_name FROM hr_departments LIMIT 1").fetchone()
        dept_id = int(dept_row["id"]) if dept_row else 1
        t_name = str(dept_row["team_name"]) if dept_row else "HR Operations"
        conn.execute(
            """
            INSERT INTO hr_department_members (dept_id, team_name, member_name, email, role, designation)
            VALUES (?, ?, 'Test Agent', 'test_agent_swap@example.com', 'HR_AGENT', 'HR Specialist')
            """,
            (dept_id, t_name),
        )
        conn.commit()
    finally:
        conn.close()

    try:
        # Admin updates role from HR_AGENT to HR_MANAGER
        resp = client.put(
            f"/api/users/{user_id}/role",
            headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"},
            json={"role": "HR_MANAGER"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "success"
        assert data["data"]["role"] == "HR_MANAGER"

        # Verify users table was updated
        u_row = execute_query("SELECT role FROM users WHERE id = ?", (user_id,), fetch_one=True)
        assert u_row["role"] == "HR_MANAGER"

        # Verify hr_department_members table was updated
        m_row = execute_query("SELECT role FROM hr_department_members WHERE email = 'test_agent_swap@example.com'", fetch_one=True)
        assert m_row["role"] == "HR_MANAGER"

        # Non-admin attempt should be forbidden
        resp_forbidden = client.put(
            f"/api/users/{user_id}/role",
            headers={"X-HR-Role": "HR_AGENT", "X-HR-User": "Test Agent"},
            json={"role": "ADMIN"},
        )
        assert resp_forbidden.status_code == 403
    finally:
        conn_clean = get_connection()
        try:
            conn_clean.execute("DELETE FROM hr_department_members WHERE email = 'test_agent_swap@example.com'")
            conn_clean.execute("DELETE FROM users WHERE email = 'test_agent_swap@example.com'")
            conn_clean.commit()
        finally:
            conn_clean.close()


def test_agent_workbench_identity_and_no_admin_hijack(client):
    """
    Verify that an HR_AGENT requesting their workbench is NEVER hijacked into Admin,
    even if ?agent_id=1 is passed or auto-refresh polls run.
    """
    from backend.api.agent_routes import _sync_users_and_members
    roster = _sync_users_and_members()

    # Verify no duplicate IDs in roster
    ids = [m["id"] for m in roster]
    assert len(ids) == len(set(ids)), f"Duplicate IDs detected in roster: {ids}"

    # Request workbench as HR_AGENT
    resp = client.get(
        "/api/agent/my-workbench?agent_id=1",
        headers={
            "X-HR-Role": "HR_AGENT",
            "X-HR-Email": "vaibhavx002@zohomail.in",
            "X-HR-User": "Vaibhav Yadav",
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    agent = data["agent"]
    assert agent["role"] == "HR_AGENT"
    assert agent["email"] == "vaibhavx002@zohomail.in"
    assert agent["name"] == "Vaibhav Yadav"



def test_admin_can_switch_own_role(client):
    """Verify that an admin can switch their own operating role to another role and back."""
    # Seed an admin user session
    token = "test-admin-token-12345"
    admin_email = "admin.switcher@company.com"

    conn = get_connection()
    try:
        conn.execute("DELETE FROM user_sessions WHERE token = ?", (token,))
        conn.execute("DELETE FROM users WHERE email = ?", (admin_email,))
        conn.execute(
            "INSERT INTO users (email, name, role) VALUES (?, 'Admin Switcher', 'ADMIN')",
            (admin_email,),
        )
        conn.execute(
            """
            INSERT INTO user_sessions (token, email, role, name, department)
            VALUES (?, ?, 'ADMIN', 'Admin Switcher', 'HR Administration')
            """,
            (token, admin_email),
        )
        conn.commit()
    finally:
        conn.close()

    try:
        # Switch role to HR_LEAD
        resp = client.post(
            "/api/auth/switch-role",
            headers={"Authorization": f"Bearer {token}", "X-HR-Role": "ADMIN", "X-HR-Email": admin_email},
            json={"role": "HR_LEAD"},
        )
        assert resp.status_code == 200
        d = resp.get_json()
        assert d["status"] == "success"
        assert d["data"]["role"] == "HR_LEAD"
        assert d["data"]["user"]["role"] == "HR_LEAD"

        # Verify session table updated
        s_row = execute_query("SELECT role FROM user_sessions WHERE token = ?", (token,), fetch_one=True)
        assert s_row["role"] == "HR_LEAD"

        # Switch back to ADMIN
        resp_back = client.post(
            "/api/auth/switch-role",
            headers={"Authorization": f"Bearer {token}", "X-HR-Role": "HR_LEAD", "X-HR-Email": admin_email},
            json={"role": "ADMIN"},
        )
        assert resp_back.status_code == 200
        d2 = resp_back.get_json()
        assert d2["data"]["role"] == "ADMIN"
    finally:
        conn_clean = get_connection()
        try:
            conn_clean.execute("DELETE FROM user_sessions WHERE token = ?", (token,))
            conn_clean.execute("DELETE FROM users WHERE email = ?", (admin_email,))
            conn_clean.commit()
        finally:
            conn_clean.close()


def test_agent_workbench_identity_and_no_admin_hijack(client):
    """
    Verify that an HR_AGENT requesting their workbench is NEVER hijacked into Admin,
    even if ?agent_id=1 is passed or auto-refresh polls run.
    """
    from backend.api.agent_routes import _sync_users_and_members
    roster = _sync_users_and_members()

    # Verify no duplicate IDs in roster
    ids = [m["id"] for m in roster]
    assert len(ids) == len(set(ids)), f"Duplicate IDs detected in roster: {ids}"

    # Request workbench as HR_AGENT
    resp = client.get(
        "/api/agent/my-workbench?agent_id=1",
        headers={
            "X-HR-Role": "HR_AGENT",
            "X-HR-Email": "vaibhavx002@zohomail.in",
            "X-HR-User": "Vaibhav Yadav",
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    agent = data["agent"]
    assert agent["role"] == "HR_AGENT"
    assert agent["email"] == "vaibhavx002@zohomail.in"
    assert agent["name"] == "Vaibhav Yadav"

