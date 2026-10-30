"""
HR FLOW — Phase 8.4 & 8.11 Darwinbox Employee API Module
(backend/services/integrations/darwinbox/employee_api.py)
"""

from typing import Dict, Any, Optional
from backend.services.integrations.base_adapter import BaseIntegrationAdapter, IntegrationError
from backend.services.integrations.darwinbox.client import DarwinboxClient, MOCK_DARWINBOX_EMPLOYEES


def lookup_employee_in_darwinbox(
    client: DarwinboxClient,
    employee_id: Optional[str] = None,
    email: Optional[str] = None,
    name: Optional[str] = None,
    extra_payload: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Query Darwinbox for employee master details and return normalized HR Flow Standard Employee dict:
      employee_id, name, email, department, designation, location, status, manager
    """
    payload = dict(extra_payload or {})
    if employee_id:
        payload["employee_id"] = str(employee_id).strip().upper()
    if email:
        payload["email"] = str(email).strip().lower()
    if name:
        payload["name"] = str(name).strip()

    # Allow test-induced failure/timeout via client.request
    client.request("POST", "/employee/lookup", payload)

    if client.mode == "MOCK":
        emp_code = payload.get("employee_id")
        if emp_code and emp_code in MOCK_DARWINBOX_EMPLOYEES:
            return BaseIntegrationAdapter.normalize_employee_response(
                MOCK_DARWINBOX_EMPLOYEES[emp_code], source_provider="darwinbox"
            )

        q_email = payload.get("email")
        if q_email:
            for rec in MOCK_DARWINBOX_EMPLOYEES.values():
                if (rec.get("work_email") or "").lower() == q_email:
                    return BaseIntegrationAdapter.normalize_employee_response(rec, source_provider="darwinbox")

        q_name = (payload.get("name") or "").lower()
        if q_name:
            for rec in MOCK_DARWINBOX_EMPLOYEES.values():
                if (rec.get("full_name") or "").lower() == q_name:
                    return BaseIntegrationAdapter.normalize_employee_response(rec, source_provider="darwinbox")

        return None

    resp = client.request("POST", "/employee/details", payload)
    emp_raw = resp.get("employee") or resp.get("data") or resp
    if not emp_raw or not (emp_raw.get("employee_code") or emp_raw.get("employee_id")):
        return None
    return BaseIntegrationAdapter.normalize_employee_response(emp_raw, source_provider="darwinbox")


def update_employee_in_darwinbox(
    client: DarwinboxClient,
    employee_id: str,
    updates: Dict[str, Any],
) -> Dict[str, Any]:
    emp_code = str(employee_id or "").strip().upper()
    if not emp_code:
        raise IntegrationError("employee_id is required for UPDATE_EMPLOYEE.", retryable=False, status_code=400)

    payload = {"employee_code": emp_code, "updates": updates, **updates}
    client.request("POST", "/employee/update", payload)

    if client.mode == "MOCK":
        base = dict(MOCK_DARWINBOX_EMPLOYEES.get(emp_code) or {"employee_code": emp_code, "full_name": updates.get("name", "Employee")})
        if "department" in updates:
            base["dept_name"] = updates["department"]
        if "designation" in updates:
            base["job_title"] = updates["designation"]
        if "location" in updates:
            base["work_location"] = updates["location"]
        if "manager" in updates or "manager_name" in updates:
            base["reporting_manager"] = updates.get("manager") or updates.get("manager_name")
        MOCK_DARWINBOX_EMPLOYEES[emp_code] = base
        normalized = BaseIntegrationAdapter.normalize_employee_response(base, source_provider="darwinbox")
        return {
            "external_reference": f"DBX-EMP-UPD-{emp_code}",
            "employee": normalized,
        }

    resp = client.request("POST", "/employee/update", payload)
    return {
        "external_reference": resp.get("reference_id") or f"DBX-EMP-UPD-{emp_code}",
        "employee": BaseIntegrationAdapter.normalize_employee_response(resp.get("employee") or payload, source_provider="darwinbox"),
    }
