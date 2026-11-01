import pytest
from backend.server import create_app

def test_neon_status_route():
    app = create_app()
    client = app.test_client()
    resp = client.get("/api/cases/neon/status")
    assert resp.status_code == 200
    json_data = resp.get_json()
    assert json_data["success"] is True
    assert "data" in json_data
    data = json_data["data"]
    assert data["provider"] == "Neon PostgreSQL"
    assert "connected" in data


def test_docket_code_update_and_lookup():
    app = create_app()
    client = app.test_client()

    # 1. Update docket code
    post_res = client.post("/api/cases/CASE-000001/docket-code", json={
        "docket_code": "PAY-AGT1-2610-001",
        "agent_code": "AGT-1",
        "agent_type": "AI_AUTONOMOUS"
    })
    assert post_res.status_code == 200
    assert post_res.get_json()["data"]["docket_code"] == "PAY-AGT1-2610-001"

    # 2. Look up case by new docket code
    get_res = client.get("/api/cases/PAY-AGT1-2610-001")
    assert get_res.status_code == 200
    assert get_res.get_json()["data"]["case"]["case_number"] == "CASE-000001"

    # 3. Look up case by original case_number (backwards compatibility)
    get_res_orig = client.get("/api/cases/CASE-000001")
    assert get_res_orig.status_code == 200
    assert get_res_orig.get_json()["data"]["case"]["docket_code"] == "PAY-AGT1-2610-001"


