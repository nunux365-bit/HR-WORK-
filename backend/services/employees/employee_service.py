"""
HR FLOW — Phase 5.5 Employee Service (backend/services/employees/employee_service.py)
Orchestrates:
  1. Employee repository operations (create, update, get, search, list)
  2. Email identity extraction (employee_extractor)
  3. Employee matching, conflict & ambiguity detection (employee_matcher)
  4. Email-derived employee attribute enrichment
  5. Persistence of employee match results onto `emails` and `audit_logs`
"""

import json
from typing import Dict, Any, List, Optional, Union

from backend.database.connection import get_connection
from backend.models.employee import (
    create_employee as repo_create_employee,
    update_employee as repo_update_employee,
    get_employee_by_db_id,
    get_employee_by_employee_id,
    get_employees_by_email,
    search_employees_by_name,
    list_employees as repo_list_employees,
)
from backend.services.employees.employee_extractor import extract_employee_identity
from backend.services.employees.employee_matcher import match_employee_identity


def _log_employee_audit(
    entity_type: str,
    entity_id: Union[str, int],
    action: str,
    description: str,
    metadata: Optional[Dict[str, Any]] = None,
    performed_by: str = "employee_service",
) -> None:
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO audit_logs (
                entity_type,
                entity_id,
                action,
                description,
                performed_by,
                metadata
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                entity_type,
                str(entity_id),
                action,
                description,
                performed_by,
                json.dumps(metadata or {}),
            ),
        )
        conn.commit()
    finally:
        conn.close()


# ----------------------------------------------------------------------
# 5.1 Employee CRUD & Search Service Operations
# ----------------------------------------------------------------------

def create_employee_record(data: Dict[str, Any], performed_by: str = "hr_admin") -> Dict[str, Any]:
    """Create a new employee record and write an audit log entry."""
    emp = repo_create_employee(data)
    _log_employee_audit(
        entity_type="EMPLOYEE",
        entity_id=emp["id"],
        action="EMPLOYEE_CREATED",
        description=f"Employee {emp['name']} ({emp['id']}) created",
        metadata={"employee": emp},
        performed_by=performed_by,
    )
    return emp


def update_employee_record(
    identifier: Union[int, str],
    updates: Dict[str, Any],
    performed_by: str = "hr_admin",
) -> Optional[Dict[str, Any]]:
    """Update an existing employee record and write an audit log entry."""
    emp = repo_update_employee(identifier, updates)
    if emp:
        _log_employee_audit(
            entity_type="EMPLOYEE",
            entity_id=emp["id"],
            action="EMPLOYEE_UPDATED",
            description=f"Employee {emp['name']} ({emp['id']}) updated",
            metadata={"updates": updates, "employee": emp},
            performed_by=performed_by,
        )
    return emp


def get_employee(identifier: Union[int, str]) -> Optional[Dict[str, Any]]:
    """Fetch employee by either database integer ID or EMPxxxx employee_id."""
    if isinstance(identifier, int) or (isinstance(identifier, str) and identifier.isdigit()):
        emp = get_employee_by_db_id(int(identifier))
        if emp:
            return emp
    return get_employee_by_employee_id(str(identifier))


def search_employees(
    query: Optional[str] = None,
    email: Optional[str] = None,
    employee_id: Optional[str] = None,
    name: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Search employees by explicit filter (employee_id, email, name) or general query."""
    if employee_id:
        emp = get_employee_by_employee_id(employee_id)
        return [emp] if emp else []
    if email:
        return get_employees_by_email(email)
    if name:
        return search_employees_by_name(name)
    return repo_list_employees(limit=limit, offset=offset, search=query)


# ----------------------------------------------------------------------
# 5.2 - 5.5 Email Identity Extraction, Matching & Enrichment
# ----------------------------------------------------------------------

def _enrich_employee_from_extracted(
    emp: Dict[str, Any],
    extracted: Dict[str, Any],
) -> Dict[str, Any]:
    """
    If a matched employee record is missing optional organizational attributes
    (department, designation, manager_name, location) that were present in the email,
    enrich the employee record in SQLite. Also replace any placeholder @company.com email
    with the real email from the message.
    """
    updates = {}
    for field in ("department", "designation", "manager_name", "location"):
        if not emp.get(field) and extracted.get(field):
            updates[field] = extracted[field]

    real_email = extracted.get("explicit_email") or extracted.get("sender_email")
    cur_email = (emp.get("email") or "").strip().lower()
    if real_email and not real_email.endswith("@company.com"):
        if not cur_email or cur_email.endswith("@company.com"):
            updates["email"] = real_email

    if updates:
        updated_emp = repo_update_employee(emp["db_id"], updates)
        if updated_emp:
            return {
                "db_id": updated_emp["db_id"],
                "id": updated_emp["employee_id"],
                "employee_id": updated_emp["employee_id"],
                "name": updated_emp["name"],
                "email": updated_emp["email"],
                "department": updated_emp["department"],
                "designation": updated_emp["designation"],
                "manager_name": updated_emp["manager_name"],
                "location": updated_emp["location"],
            }
    return emp


def resolve_employee_identity_with_external_hrms(
    local_match: Dict[str, Any],
    extracted: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Phase 8.5 Employee Identity Resolution Upgrade:
      Email -> Local Employee Matcher -> If uncertain OR external verification enabled ->
      External HRMS Lookup (Darwinbox) -> Compare -> MATCHED | CONFLICT / REVIEW_REQUIRED.
    External systems assist identity resolution and never blindly overwrite conflicting local records.
    """
    try:
        from backend.services.integrations.integration_registry import get_integration, get_adapter_for_integration
        from backend.services.employees.employee_matcher import _names_conflict, _format_employee_payload

        dbx_int = get_integration("darwinbox")
        if not dbx_int:
            return local_match

        # Only query external HRMS when Darwinbox is explicitly CONNECTED
        is_dbx_connected = dbx_int.get("status") == "CONNECTED"
        if not is_dbx_connected:
            return local_match

        adapter = get_adapter_for_integration("darwinbox")
        lookup_res = adapter.execute_action(
            "EMPLOYEE_LOOKUP",
            {
                "employee_id": extracted.get("employee_id"),
                "email": extracted.get("explicit_email") or extracted.get("sender_email"),
                "name": extracted.get("explicit_name") or extracted.get("candidate_name"),
            },
        )
        if not lookup_res.get("success") or not lookup_res.get("data"):
            return local_match

        ext_emp = lookup_res["data"]
        ext_emp_id = ext_emp.get("employee_id")
        ext_name = ext_emp.get("name")

        # Case A: Local matcher already found an employee -> verify no conflict with Darwinbox
        if local_match.get("status") == "MATCHED" and local_match.get("employee"):
            loc_emp = local_match["employee"]
            if ext_emp_id and loc_emp.get("employee_id") and ext_emp_id != loc_emp["employee_id"]:
                return {
                    "status": "REVIEW_REQUIRED",
                    "resolution_state": "CONFLICT",
                    "employee": None,
                    "confidence": 0.45,
                    "match_method": "EXTERNAL_HRMS_CONFLICT",
                    "reason": f"Local employee ID ({loc_emp['employee_id']}) conflicts with External HRMS ({ext_emp_id})",
                    "extracted": extracted,
                    "external_hrms": ext_emp,
                    "candidates": [loc_emp, ext_emp],
                }
            if ext_name and loc_emp.get("name") and _names_conflict(ext_name, loc_emp["name"]):
                return {
                    "status": "REVIEW_REQUIRED",
                    "resolution_state": "CONFLICT",
                    "employee": None,
                    "confidence": 0.45,
                    "match_method": "EXTERNAL_HRMS_CONFLICT",
                    "reason": f"Local employee name ({loc_emp['name']}) conflicts with External HRMS ({ext_name})",
                    "extracted": extracted,
                    "external_hrms": ext_emp,
                    "candidates": [loc_emp, ext_emp],
                }
            local_match["external_verified"] = True
            local_match["external_provider"] = "darwinbox"
            local_match["external_reference"] = ext_emp_id
            return local_match

        # Case B: Local matcher had REVIEW_REQUIRED (conflict) -> keep REVIEW_REQUIRED and attach Darwinbox record
        if local_match.get("status") == "REVIEW_REQUIRED":
            local_match["external_hrms"] = ext_emp
            return local_match

        # Case C: Local matcher returned NOT_FOUND, but Darwinbox found the employee!
        # Check if extracted email text conflicts with the Darwinbox employee name
        explicit_name = extracted.get("explicit_name") or extracted.get("candidate_name")
        if explicit_name and ext_name and _names_conflict(explicit_name, ext_name):
            return {
                "status": "REVIEW_REQUIRED",
                "resolution_state": "CONFLICT",
                "employee": None,
                "confidence": 0.45,
                "match_method": "EXTERNAL_HRMS",
                "reason": f"Extracted name '{explicit_name}' conflicts with External HRMS record '{ext_name}' ({ext_emp_id})",
                "extracted": extracted,
                "external_hrms": ext_emp,
                "candidates": [ext_emp],
            }

        # Sync the verified Darwinbox employee into local SQLite if not present
        existing_local = get_employee_by_employee_id(ext_emp_id) if ext_emp_id else None
        if not existing_local and ext_emp_id and ext_name:
            existing_local = repo_create_employee({
                "employee_id": ext_emp_id,
                "name": ext_name,
                "email": extracted.get("explicit_email") or extracted.get("sender_email") or ext_emp.get("email"),
                "department": ext_emp.get("department"),
                "designation": ext_emp.get("designation"),
                "manager_name": ext_emp.get("manager") or ext_emp.get("manager_name"),
                "location": ext_emp.get("location"),
                "source": "darwinbox",
            })

        if existing_local:
            return {
                "status": "MATCHED",
                "employee": _format_employee_payload(existing_local),
                "confidence": 0.98,
                "match_method": "HRMS_CORE",
                "external_verified": True,
                "external_provider": "darwinbox",
                "external_reference": ext_emp_id,
                "extracted": extracted,
            }
    except Exception:
        pass

    return local_match


def identify_employee_from_email(email_payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run extraction + local matching + Phase 8.5 External HRMS verification on an email payload.
    Returns the standardized matching structure:
      - MATCHED: {status, employee, confidence, match_method, extracted}
      - REVIEW_REQUIRED: {status, confidence, match_method, reason, candidates, extracted}
      - NOT_FOUND: {status, confidence, match_method, extracted}
    """
    extracted = extract_employee_identity(email_payload)
    match_result = match_employee_identity(extracted)
    match_result = resolve_employee_identity_with_external_hrms(match_result, extracted)

    if match_result["status"] == "MATCHED" and match_result.get("employee"):
        enriched_emp = _enrich_employee_from_extracted(match_result["employee"], extracted)
        match_result["employee"] = enriched_emp

    return match_result


def process_email_employee_identification(email_id: int) -> Dict[str, Any]:
    """
    Identify the employee for a stored email in SQLite (`emails.id = email_id`),
    update `emails.employee_id` and `emails.requires_review`, and write an audit log entry.
    """
    conn = get_connection()
    try:
        email_row = conn.execute(
            "SELECT * FROM emails WHERE id = ?",
            (int(email_id),),
        ).fetchone()
        if not email_row:
            raise ValueError(f"Email with id {email_id} not found.")
        email_data = dict(email_row)
    finally:
        conn.close()

    extracted = extract_employee_identity(email_data)

    # First run local + external HRMS resolution before falling back to email-derived auto-registration
    match_result = identify_employee_from_email(email_data)

    # Phase 5 & 6.3 Email-Derived Auto-Registration fallback when employee is not in local DB or Darwinbox
    # Data Security Policy:
    # 1. External senders (e.g. @gmail.com) without an official employee_id MUST NOT be auto-registered.
    #    They must pass through the security gate (ON_HOLD status + clarification email) to provide their real Employee ID.
    # 2. Never invent/generate a random sequential EMP ID for an incoming email if no employee_id was provided.
    has_explicit_emp_id = bool((extracted.get("employee_id") or "").strip())
    has_id_and_name = bool(
        has_explicit_emp_id
        and extracted.get("candidate_name")
        and not get_employee_by_employee_id(extracted["employee_id"])
    )
    has_explicit_org_profile = bool(
        has_explicit_emp_id
        and extracted.get("explicit_name")
        and (extracted.get("department") or extracted.get("designation") or extracted.get("location"))
    )

    allow_auto_registration = has_explicit_emp_id and (has_id_and_name or has_explicit_org_profile)

    if match_result["status"] == "NOT_FOUND" and allow_auto_registration:
        # Always use the real email from the message (explicit_email or sender_email) — never invent @company.com
        emp_email = extracted.get("explicit_email") or extracted.get("sender_email")
        create_employee_record(
            {
                "employee_id": extracted["employee_id"],
                "name": extracted.get("explicit_name") or extracted["candidate_name"],
                "email": emp_email,
                "department": extracted.get("department"),
                "designation": extracted.get("designation"),
                "manager_name": extracted.get("manager_name"),
                "location": extracted.get("location"),
                "source": "email",
            },
            performed_by="employee_service_auto",
        )
        match_result = identify_employee_from_email(email_data)
    status = match_result["status"]

    conn = get_connection()
    try:
        if status == "MATCHED" and match_result.get("employee"):
            emp = match_result["employee"]
            emp_db_id = emp["db_id"]
            conn.execute(
                """
                UPDATE emails
                SET employee_id = ?,
                    requires_review = 0,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (emp_db_id, int(email_id)),
            )
            audit_action = "EMPLOYEE_MATCHED"
            audit_desc = (
                f"Employee matched: {emp['name']} ({emp['id']}) "
                f"via {match_result['match_method']} (confidence {match_result['confidence']})"
            )
        elif status == "REVIEW_REQUIRED":
            conn.execute(
                """
                UPDATE emails
                SET employee_id = NULL,
                    requires_review = 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (int(email_id),),
            )
            audit_action = "EMPLOYEE_REVIEW_REQUIRED"
            audit_desc = f"Employee review required: {match_result.get('reason', 'Ambiguous or conflicting identity')}"
        else:
            conn.execute(
                """
                UPDATE emails
                SET employee_id = NULL,
                    requires_review = 0,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (int(email_id),),
            )
            audit_action = "EMPLOYEE_NOT_FOUND"
            audit_desc = "No matching employee record found for email"

        prev_emp_audit = conn.execute(
            """
            SELECT id, action, description FROM audit_logs
            WHERE entity_type = 'EMAIL'
              AND entity_id = ?
              AND action IN ('EMPLOYEE_MATCHED', 'EMPLOYEE_REVIEW_REQUIRED', 'EMPLOYEE_NOT_FOUND')
            ORDER BY id DESC LIMIT 1
            """,
            (str(email_id),),
        ).fetchone()

        if prev_emp_audit and prev_emp_audit["action"] == audit_action and prev_emp_audit["description"] == audit_desc:
            conn.execute(
                "UPDATE audit_logs SET metadata = ? WHERE id = ?",
                (json.dumps(match_result), int(prev_emp_audit["id"])),
            )
        else:
            conn.execute(
                """
                INSERT INTO audit_logs (
                    entity_type,
                    entity_id,
                    action,
                    description,
                    performed_by,
                    metadata
                ) VALUES ('EMAIL', ?, ?, ?, 'employee_service', ?)
                """,
                (
                    str(email_id),
                    audit_action,
                    audit_desc,
                    json.dumps(match_result),
                ),
            )
        conn.commit()
    finally:
        conn.close()

    return match_result


def link_employee_to_email(
    email_id: int,
    employee_identifier: Union[int, str],
    performed_by: str = "hr_admin",
) -> Dict[str, Any]:
    """
    Explicitly link an employee record to an email (and its associated case, if any),
    clearing any identity conflict and recording anEMPLOYEE_MATCHED audit event.
    """
    emp = get_employee(employee_identifier)
    if not emp:
        raise ValueError(f"Employee '{employee_identifier}' not found.")

    conn = get_connection()
    try:
        email_row = conn.execute("SELECT * FROM emails WHERE id = ?", (int(email_id),)).fetchone()
        if not email_row:
            raise ValueError(f"Email with id {email_id} not found.")
        email_data = dict(email_row)
    finally:
        conn.close()

    extracted = extract_employee_identity(email_data)
    match_result = {
        "status": "MATCHED",
        "employee": {
            "db_id": emp["db_id"],
            "id": emp["employee_id"],
            "employee_id": emp["employee_id"],
            "name": emp["name"],
            "email": emp["email"],
            "department": emp["department"],
            "designation": emp["designation"],
            "manager_name": emp["manager_name"],
            "location": emp["location"],
        },
        "confidence": 1.0,
        "match_method": "HR_VERIFIED",
        "extracted": extracted,
    }

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE emails
            SET employee_id = ?,
                requires_review = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (emp["db_id"], int(email_id)),
        )
        conn.execute(
            """
            UPDATE cases
            SET employee_id = ?,
                status = CASE WHEN status = 'REVIEW_REQUIRED' THEN 'READY' ELSE status END,
                updated_at = CURRENT_TIMESTAMP
            WHERE email_id = ?
            """,
            (emp["db_id"], int(email_id)),
        )
        conn.execute(
            """
            INSERT INTO audit_logs (
                entity_type,
                entity_id,
                action,
                description,
                performed_by,
                metadata
            ) VALUES ('EMAIL', ?, 'EMPLOYEE_MATCHED', ?, ?, ?)
            """,
            (
                str(email_id),
                f"HR manually linked employee {emp['name']} ({emp['employee_id']})",
                performed_by,
                json.dumps(match_result),
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return match_result


def process_all_unmatched_emails() -> Dict[str, Any]:
    """Run employee identification across all stored emails in SQLite."""
    conn = get_connection()
    try:
        rows = conn.execute("SELECT id FROM emails ORDER BY id DESC").fetchall()
        email_ids = [int(r["id"]) for r in rows]
    finally:
        conn.close()

    counts = {
        "total_processed": len(email_ids),
        "matched": 0,
        "review_required": 0,
        "not_found": 0,
        "results": [],
    }

    for eid in email_ids:
        res = process_email_employee_identification(eid)
        if res["status"] == "MATCHED":
            counts["matched"] += 1
        elif res["status"] == "REVIEW_REQUIRED":
            counts["review_required"] += 1
        else:
            counts["not_found"] += 1
        counts["results"].append({
            "email_id": eid,
            "status": res["status"],
            "confidence": res["confidence"],
            "match_method": res["match_method"],
            "employee": res.get("employee"),
            "reason": res.get("reason"),
        })

    return counts
