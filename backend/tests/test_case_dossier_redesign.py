"""
Tests for the redesigned universal case operations service and endpoints.
"""

import pytest
from backend.server import app
from backend.services.cases.case_dossier_service import (
    get_case_dossier,
    update_case_status,
    set_case_step,
    toggle_task,
    add_task,
    save_case_draft,
    resolve_case,
)
from backend.services.playbooks.playbook_service import get_playbook_for_category


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


@pytest.fixture(autouse=True)
def ensure_test_case():
    from backend.database.connection import get_connection
    conn = get_connection()
    c = conn.execute("SELECT id FROM cases WHERE case_number = 'CASE-000001'").fetchone()
    if not c:
        emp = conn.execute("SELECT id FROM employees WHERE employee_id = 'EMP1001'").fetchone()
        emp_id = emp["id"] if emp else None
        if not emp_id:
            cur = conn.execute(
                "INSERT INTO employees (employee_id, name, email, department, designation) VALUES ('EMP1001', 'Vaibhav', 'vaibhav@example.com', 'HR', 'Specialist')"
            )
            emp_id = cur.lastrowid
        conn.execute(
            """
            INSERT INTO cases (case_number, title, category, status, priority, employee_id, assigned_team, assigned_user)
            VALUES ('CASE-000001', 'Attendance Regularization Request', 'ATTENDANCE', 'NEW', 'HIGH', ?, 'Attendance HR', 'Vaibhav (HR)')
            """,
            (emp_id,)
        )
        conn.commit()
    conn.close()


def test_universal_playbook_generation():
    # 1. Standard known category
    pb_att = get_playbook_for_category("ATTENDANCE")
    assert pb_att["category"] == "ATTENDANCE"
    assert "default_tasks" in pb_att
    assert len(pb_att["default_tasks"]) > 0

    # 2. Universal arbitrary category
    pb_legal = get_playbook_for_category("LEGAL")
    assert pb_legal["category"] == "LEGAL"
    assert "Legal Operations" in pb_legal["display_name"]
    assert "default_tasks" in pb_legal
    assert len(pb_legal["default_tasks"]) >= 3
    assert "proof_config" in pb_legal
    assert "refLabel" in pb_legal["proof_config"]


def test_get_case_dossier():
    dossier = get_case_dossier("CASE-000001")
    assert dossier is not None
    assert dossier["case"]["case_number"] == "CASE-000001"
    assert "employee" in dossier
    assert "tasks" in dossier
    assert "playbook" in dossier
    assert "smart_templates" in dossier
    assert "workflow_stages" in dossier
    assert "requester_history" in dossier
    assert isinstance(dossier["requester_history"], list)
    assert dossier["current_step"] >= 1


def test_dossier_endpoints(client):
    # Test /api/cases/<case_ref>/dossier
    res = client.get("/api/cases/CASE-000001/dossier")
    assert res.status_code == 200
    data = res.json["data"]
    assert data["case"]["case_number"] == "CASE-000001"
    assert "playbook" in data

    # Test /api/agent/cases/<case_ref>/detail
    res2 = client.get("/api/agent/cases/CASE-000001/detail")
    assert res2.status_code == 200
    data2 = res2.json["data"]
    assert data2["case"]["case_number"] == "CASE-000001"
    assert "playbook" in data2


def test_task_operations_and_persistence():
    # Add custom task
    added = add_task("CASE-000001", "Automated E2E Verification Check", "CHECKBOX", "Test guidance", "Tester")
    assert added["task_id"] is not None
    assert added["status"] == "PENDING"

    # Toggle task
    toggled = toggle_task("CASE-000001", task_id=added["task_id"], user="Tester")
    assert toggled["status"] == "COMPLETED"

    # Toggle back
    toggled_back = toggle_task("CASE-000001", task_id=added["task_id"], user="Tester")
    assert toggled_back["status"] == "PENDING"


def test_draft_saving_and_retrieval(client):
    draft_content = "Specialist verified biometric turnstile access logs. Shift approved."
    res = client.post("/api/agent/cases/CASE-000001/action", json={
        "action_type": "SAVE_DRAFT",
        "draft": draft_content,
    })
    assert res.status_code == 200

    # Retrieve case dossier to ensure draft_reply is persisted in DB
    dossier = get_case_dossier("CASE-000001")
    assert dossier["case"]["draft_reply"] == draft_content


def test_audit_forensic_proof_and_diagnostics(client):
    # Test saving forensic proof
    proof_data = {
        "proofId": "DBX-REG-202610-1MG0023",
        "metric": "1.0 Day Regularized",
        "notes": "Verified biometric logs and VPN session hours.",
        "verdict": "ATTENDANCE_REGULARIZED"
    }
    res_proof = client.post("/api/agent/cases/CASE-000001/action", json={
        "action_type": "SAVE_FORENSIC_PROOF",
        "forensic_proof": proof_data,
        "reference_id": proof_data["proofId"],
        "resolution_notes": proof_data["notes"],
        "verdict": proof_data["verdict"]
    })
    assert res_proof.status_code == 200

    # Test executing diagnostic action
    res_diag = client.post("/api/agent/cases/CASE-000001/action", json={
        "action_type": "EXECUTE_HRMS_ACTION",
        "action_code": "BIOMETRIC_TELEMETRY",
        "title": "Audit Biometric Turnstile Logs",
        "provider": "Turnstile Cloud Gateway",
        "details": "Biometric turnstile logs inspected. Discrepancy confirmed: Hardware scanner offline at Gate B.",
        "risk_level": "LOW"
    })
    assert res_diag.status_code == 200

    # Verify dossier reflects forensic proof and executed diagnostic in hr_actions
    dossier = get_case_dossier("CASE-000001")
    assert dossier["case"]["forensic_proof"]["proofId"] == proof_data["proofId"]
    assert any(act.get("action_type") == "BIOMETRIC_TELEMETRY" or "BIOMETRIC" in (act.get("action_code") or "") for act in dossier["hr_actions"])


def test_follow_link_and_merge_intelligence(client):
    from backend.services.cases.case_dossier_service import toggle_follow_case, link_cases, merge_cases
    import sqlite3

    # Reset followers for clean test
    conn = sqlite3.connect("data/hrflow.db")
    conn.execute("UPDATE cases SET followers = '[]' WHERE case_number = 'CASE-000001'")
    conn.commit()
    conn.close()

    # 1. Test Toggle Follow
    follow_res = toggle_follow_case("CASE-000001", "Test Specialist")
    assert follow_res["is_following"] is True
    dossier_f = get_case_dossier("CASE-000001", current_user={"name": "Test Specialist"})
    assert dossier_f["is_following"] is True

    # Toggle unfollow
    unfollow_res = toggle_follow_case("CASE-000001", "Test Specialist")
    assert unfollow_res["is_following"] is False

    # 2. Test Link Cases
    # Insert temporary case for testing linking
    conn = sqlite3.connect("data/hrflow.db")
    conn.execute("""
        INSERT OR REPLACE INTO cases (
            id, case_number, employee_id, category, title, description, status, priority, created_at, updated_at
        ) VALUES (
            8888, 'CASE-TEST-LINK', 318, 'ATTENDANCE', 'Test linked ticket', 'Desc', 'NEW', 'LOW', datetime('now'), datetime('now')
        )
    """)
    conn.commit()
    conn.close()

    try:
        link_res = link_cases("CASE-000001", "CASE-TEST-LINK", "RELATED", "Test Agent")
        assert link_res["status"] == "LINKED"
        d1 = get_case_dossier("CASE-000001")
        assert any(c["case_number"] == "CASE-TEST-LINK" for c in d1["linked_cases"])

        # 3. Test Merge Cases
        merge_res = merge_cases("CASE-TEST-LINK", "CASE-000001", "Unit test duplicate merge", "Test Agent")
        assert merge_res["status"] == "MERGED"
        d_merged = get_case_dossier("CASE-TEST-LINK")
        assert d_merged["case"]["status"] == "MERGED"
        assert d_merged["case"]["merged_into"] == "CASE-000001"
    finally:
        # Cleanup test row
        conn = sqlite3.connect("data/hrflow.db")
        conn.execute("DELETE FROM cases WHERE id = 8888")
        conn.execute("UPDATE cases SET linked_cases = NULL WHERE case_number = 'CASE-000001'")
        conn.commit()
        conn.close()



