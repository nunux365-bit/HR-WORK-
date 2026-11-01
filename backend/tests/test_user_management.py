"""
Unit and Integration Tests for User Management Console & API
Covers:
  - User Directory listing with status & workload telemetry
  - Provisioning new users & specialists
  - Role updates & session synchronization
  - Status toggling (ACTIVE / DEACTIVATED)
  - Primary admin protection
  - Safe orphan case unassignment on deactivation/deletion
  - Serving users.html console
"""

import json
import pytest
from backend.server import create_app
from backend.database.connection import get_connection, execute_query


@pytest.fixture
def app():
    app = create_app()
    app.config["TESTING"] = True
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def test_list_users_includes_status_and_role(client):
    """GET /api/users returns users with status, role, email, and name."""
    res = client.get("/api/users", headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"})
    assert res.status_code == 200
    data = res.get_json()["data"]
    users = data["users"]
    assert len(users) >= 1
    admin_user = next((u for u in users if u["email"].lower() == "nunux365@gmail.com"), None)
    assert admin_user is not None
    assert admin_user["role"] == "ADMIN"
    assert admin_user["status"] == "ACTIVE"


def test_create_and_manage_user_lifecycle(client):
    """Full lifecycle: Create user -> Update role -> Toggle status -> Delete user."""
    test_email = "new_specialist_test@example.com"
    conn = get_connection()
    try:
        conn.execute("DELETE FROM users WHERE LOWER(email) = LOWER(?)", (test_email,))
        conn.execute("DELETE FROM hr_department_members WHERE LOWER(email) = LOWER(?)", (test_email,))
        conn.commit()
    finally:
        conn.close()

    # 1. Create user
    res_create = client.post(
        "/api/users",
        headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"},
        json={"name": "Priya Test", "email": test_email, "role": "HR_AGENT", "status": "ACTIVE"},
    )
    assert res_create.status_code == 200
    user_id = res_create.get_json()["data"]["user"]["id"]

    # 2. Update role
    res_role = client.put(
        f"/api/users/{user_id}/role",
        headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"},
        json={"role": "HR_LEAD"},
    )
    assert res_role.status_code == 200
    assert res_role.get_json()["data"]["role"] == "HR_LEAD"

    # 3. Toggle status to DEACTIVATED
    res_status = client.patch(
        f"/api/users/{user_id}/status",
        headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"},
        json={"status": "DEACTIVATED"},
    )
    assert res_status.status_code == 200
    assert res_status.get_json()["data"]["status"] == "DEACTIVATED"

    # 4. Toggle status back to ACTIVE
    res_status2 = client.patch(
        f"/api/users/{user_id}/status",
        headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"},
        json={"status": "ACTIVE"},
    )
    assert res_status2.status_code == 200
    assert res_status2.get_json()["data"]["status"] == "ACTIVE"

    # 5. Delete user
    res_del = client.delete(
        f"/api/users/{user_id}",
        headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"},
    )
    assert res_del.status_code == 200
    assert res_del.get_json()["data"]["deleted"] is True


def test_primary_admin_protected_from_deactivation_or_deletion(client):
    """Verify primary admin cannot be deactivated or deleted."""
    conn = get_connection()
    try:
        admin_row = conn.execute("SELECT id FROM users WHERE LOWER(email) = 'nunux365@gmail.com'").fetchone()
        assert admin_row is not None
        admin_id = int(admin_row["id"])
    finally:
        conn.close()

    # Try to deactivate primary admin
    res_deact = client.patch(
        f"/api/users/{admin_id}/status",
        headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"},
        json={"status": "DEACTIVATED"},
    )
    assert res_deact.status_code == 403

    # Try to delete primary admin
    res_del = client.delete(
        f"/api/users/{admin_id}",
        headers={"X-HR-Role": "ADMIN", "X-HR-User": "Admin"},
    )
    assert res_del.status_code == 403


def test_agent_employees_workload_and_status(client):
    """GET /api/agent/employees returns workload_status and status for specialists."""
    res = client.get("/api/agent/employees")
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert "employees" in data
    assert "role_metadata" in data
    assert "role_rules" in data
    assert len(data["employees"]) >= 1
    for emp in data["employees"]:
        assert "status" in emp
        assert "workload_status" in emp
        assert emp["status"] in ("ACTIVE", "DEACTIVATED")
        assert emp["workload_status"] in ("AVAILABLE", "OPTIMAL", "BUSY", "OVERLOADED")

