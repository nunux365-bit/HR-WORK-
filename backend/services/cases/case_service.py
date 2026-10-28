"""
HR FLOW — Phase 6.13 & Phase 7 Complete Operational Case Service (backend/services/cases/case_service.py)
Provides backend operations for the Operational HR Workspace:
  - Case Detail Workspace (7.2, 7.3, 7.4)
  - Assignment & Priority (7.5)
  - SLA Management & Queues (7.6, 7.7, 7.8)
  - Contextual HR Action Center (7.13)
  - Documents & Attachments (7.14)
  - Request Missing Information & Case Communication (7.15, 7.16)
  - Case Timeline (7.17)
  - Controlled Case Resolution (7.18)
  - Separate Case Closure (7.19)
  - Reopen Case with Reason & Permission Enforcement (7.20)
  - Operational Metrics (7.22)
  - Role / Permission Foundation (7.23: HR_AGENT, HR_LEAD, HR_MANAGER, ADMIN)
  - Operational Notifications (7.24)
"""

import json
import os
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Union
from backend.database.connection import get_connection
from backend.models.case import (
    VALID_CASE_STATUSES,
    VALID_PRIORITIES,
    get_case_by_id_or_number,
    list_cases,
)
from backend.models.employee import get_employee_by_employee_id, get_employee_by_db_id
from backend.models.task import list_tasks_query
from backend.models.approval import list_approvals_query
from backend.services.cases.case_engine import get_routing_for_category
from backend.services.workflows.workflow_service import (
    get_case_workflow,
    build_workflow_preview_for_category,
)
from backend.services.workflows.workflow_engine import (
    get_or_create_workflow_instance,
    transition_workflow_state,
    reopen_workflow_instance,
)
from backend.services.audit.audit_service import log_event, get_email_and_case_activity

# Phase 7.23 Role / Permission Foundation
VALID_ROLES = {"HR_AGENT", "HR_LEAD", "HR_MANAGER", "ADMIN", "SUPER_ADMIN"}

ROLE_PERMISSIONS: Dict[str, List[str]] = {
    "HR_AGENT": [
        "view_my_queue",
        "view_team_queue",
        "view_all_cases",
        "work_assigned_case",
        "claim_case",
        "assign_case",
        "create_task",
        "complete_task",
        "request_info",
        "mark_ready",
        "move_workflow",
        "resolve_case",
        "close_case",
        "request_approval",
        "accept_ai",
        "view_integration_results",
        "execute_low_risk_action",
        "execute_medium_risk_action",
    ],
    "HR_LEAD": [
        "view_my_queue",
        "view_team_queue",
        "view_all_cases",
        "work_assigned_case",
        "assign_case",
        "reassign_case",
        "change_priority",
        "override_category",
        "create_task",
        "complete_task",
        "request_info",
        "mark_ready",
        "move_workflow",
        "request_approval",
        "approve_request",
        "reject_request",
        "resolve_case",
        "close_case",
        "reopen_case",
        "accept_ai",
        "view_audit",
        "view_integration_results",
        "execute_low_risk_action",
        "execute_medium_risk_action",
        "approve_selected_action",
    ],
    "HR_MANAGER": [
        "view_my_queue",
        "view_team_queue",
        "view_all_cases",
        "work_assigned_case",
        "assign_case",
        "reassign_case",
        "change_priority",
        "override_category",
        "create_task",
        "complete_task",
        "request_info",
        "mark_ready",
        "move_workflow",
        "request_approval",
        "approve_request",
        "reject_request",
        "resolve_case",
        "close_case",
        "reopen_case",
        "escalate_case",
        "accept_ai",
        "view_audit",
        "view_integration_results",
        "execute_low_risk_action",
        "execute_medium_risk_action",
        "approve_selected_action",
        "approve_high_risk_action",
    ],
    "ADMIN": [
        "view_my_queue",
        "view_team_queue",
        "view_all_cases",
        "work_assigned_case",
        "assign_case",
        "reassign_case",
        "change_priority",
        "override_category",
        "create_task",
        "complete_task",
        "request_info",
        "mark_ready",
        "move_workflow",
        "request_approval",
        "approve_request",
        "reject_request",
        "resolve_case",
        "close_case",
        "reopen_case",
        "escalate_case",
        "accept_ai",
        "view_audit",
        "manage_system",
        "view_integration_results",
        "execute_low_risk_action",
        "execute_medium_risk_action",
        "approve_selected_action",
        "approve_high_risk_action",
        "configure_integrations",
        "manage_credentials",
        "manage_user_roles",
        "change_user_role",
    ],
    "SUPER_ADMIN": [
        "view_my_queue",
        "view_team_queue",
        "view_all_cases",
        "work_assigned_case",
        "assign_case",
        "reassign_case",
        "change_priority",
        "override_category",
        "create_task",
        "complete_task",
        "request_info",
        "mark_ready",
        "move_workflow",
        "request_approval",
        "approve_request",
        "reject_request",
        "resolve_case",
        "close_case",
        "reopen_case",
        "escalate_case",
        "accept_ai",
        "view_audit",
        "manage_system",
        "view_integration_results",
        "execute_low_risk_action",
        "execute_medium_risk_action",
        "approve_selected_action",
        "approve_high_risk_action",
        "configure_integrations",
        "manage_credentials",
        "manage_user_roles",
        "change_user_role",
    ],
}

HR_TEAMS = [
    "Attendance HR",
    "Leave Operations HR",
    "Payroll HR",
    "BGV Team",
    "HR Operations",
    "IT Asset Desk",
    "Onboarding HR",
    "Benefits & Comp HR",
    "Talent & Performance HR",
    "HR Helpdesk",
]

HR_USERS = [
    {"name": "Admin", "role": "ADMIN", "team": "HR Operations"},
]


def check_role_permission(role: str, permission: str) -> bool:
    norm_role = (role or "ADMIN").strip().upper()
    if norm_role in ("ADMIN", "SUPER_ADMIN"):
        return True
    if norm_role not in VALID_ROLES:
        norm_role = "HR_AGENT"
    allowed = ROLE_PERMISSIONS.get(norm_role, [])
    return permission in allowed


def require_permission(role: str, permission: str) -> None:
    norm_role = (role or "ADMIN").strip().upper()
    if norm_role == "SUPER_ADMIN":
        norm_role = "ADMIN"
    if not check_role_permission(norm_role, permission):
        raise PermissionError(
            f"Role '{norm_role}' does not have permission '{permission}'."
        )


def _require_case(identifier: Union[int, str]) -> Dict[str, Any]:
    case = get_case_by_id_or_number(identifier)
    if not case:
        raise ValueError(f"Case '{identifier}' not found.")
    return case


def assign_case(
    identifier: Union[int, str],
    team: Optional[str] = None,
    user: Optional[str] = None,
    user_email: Optional[str] = None,
    priority: Optional[str] = None,
    send_email: bool = False,
    dispatch_note: Optional[str] = None,
    performed_by: str = "Vaibhav (HR)",
    role: str = "ADMIN",
) -> Dict[str, Any]:
    from backend.services.cases.department_service import resolve_member_email
    from backend.services.gmail.gmail_client import send_gmail_smtp_email

    case = _require_case(identifier)
    old_team = case.get("assigned_team")
    old_user = case.get("assigned_user")
    old_prio = case.get("priority")

    if old_user and user and user != old_user:
        actor_clean = str(performed_by or "").strip().lower()
        old_user_clean = str(old_user or "").strip().lower()
        old_email_clean = str(case.get("assigned_user_email") or "").strip().lower()
        is_self_reassign = bool(actor_clean and (actor_clean == old_user_clean or actor_clean == old_email_clean or actor_clean in old_user_clean or old_user_clean in actor_clean))
        if not is_self_reassign:
            require_permission(role, "reassign_case")

    new_team = (team or old_team or "HR Operations").strip()
    new_user = user.strip() if user is not None and user.strip() != "" else old_user
    new_prio = (priority or old_prio or "MEDIUM").strip().upper()
    if new_prio not in VALID_PRIORITIES:
        raise ValueError(f"Invalid priority '{priority}'. Allowed: {sorted(VALID_PRIORITIES)}")

    resolved_email = resolve_member_email(new_team, new_user, explicit_email=user_email) or case.get("assigned_user_email")
    assigned_display = f"{new_user} ({new_team})" if new_user else new_team

    dispatch_info: Optional[Dict[str, Any]] = None
    dispatch_status_str = case.get("last_dispatch_status")
    dispatch_time_str = case.get("last_dispatched_at")

    if send_email and resolved_email:
        emp_label = f"{case.get('employee_name') or 'Employee'} ({case.get('employee_id') or 'Unverified'})"
        ext_fields = (case.get("extracted_fields") or {}).get("fields") or case.get("extracted_fields") or {}
        kv_lines = [
            f"  • {k.replace('_', ' ').title()}: {v}"
            for k, v in ext_fields.items()
            if v is not None and not isinstance(v, (dict, list)) and str(v).strip() != ""
        ]
        fields_block = "\n".join(kv_lines) if kv_lines else "  • See attached case details in HR Flow."
        is_transfer = bool(old_user and user and user != old_user)
        action_label = "Case Reassignment / Transfer" if is_transfer else "Case Assignment"
        subj = f"[HR Flow {action_label}] {case['case_number']} ({case.get('category') or 'HR'}) — {case.get('title') or 'Action Required'}"
        intro_line = (
            f"HR Case {case['case_number']} has been transferred to you from {old_user} for specialized handling.\n\n"
            if is_transfer
            else f"You have been assigned HR Case {case['case_number']} in HR Flow Operations Portal.\n\n"
        )
        body_txt = (
            f"Hello {new_user or new_team},\n\n"
            f"{intro_line}"
            f"Case Summary:\n"
            f"  • Case ID: {case['case_number']}\n"
            f"  • Category / Intent: {case.get('category')} / {case.get('intent') or '—'}\n"
            f"  • Employee: {emp_label}\n"
            f"  • Priority / SLA: {new_prio} ({case.get('sla_hours') or 48}h SLA · Due {case.get('due_display') or case.get('due_at')})\n"
            f"  • Department / Desk: {new_team}\n"
            f"  • Assigned Specialist: {new_user or 'Department Queue'} <{resolved_email}>\n\n"
            f"Extracted Request Details:\n{fields_block}\n\n"
            + (f"Handover Note from {performed_by}:\n  {dispatch_note}\n\n" if dispatch_note else "")
            + f"Please review and take action in the HR Flow Workspace.\n"
            f"— Dispatched by {performed_by} via HR Flow\n"
        )
        dispatch_info = send_gmail_smtp_email(
            recipient_email=resolved_email,
            subject=subj,
            body_text=body_txt,
        )
        dispatch_status_str = f"{dispatch_info['status']} → {resolved_email}"
        dispatch_time_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE cases
            SET assigned_team = ?,
                assigned_user = ?,
                assigned_user_email = ?,
                assigned_to = ?,
                priority = ?,
                last_dispatch_status = ?,
                last_dispatched_at = ?,
                status = CASE WHEN status = 'NEW' THEN 'IN_PROGRESS' ELSE status END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                new_team,
                new_user,
                resolved_email,
                assigned_display,
                new_prio,
                dispatch_status_str,
                dispatch_time_str,
                case["db_id"],
            ),
        )
        if dispatch_info:
            conn.execute(
                """
                INSERT INTO case_communications (
                    case_id,
                    email_id,
                    sender_type,
                    sender_name,
                    recipient,
                    subject,
                    message,
                    comm_type
                ) VALUES (?, ?, 'HR_DISPATCH', ?, ?, ?, ?, 'DEPARTMENT_DISPATCH')
                """,
                (
                    case["db_id"],
                    case.get("email_id"),
                    performed_by,
                    f"{new_user or new_team} <{resolved_email}>",
                    f"[Case Dispatch] {case['case_number']} assigned to {new_user or new_team}",
                    dispatch_info.get("message") or f"Dispatched assignment notification to {resolved_email}",
                ),
            )
            conn.execute(
                """
                INSERT INTO notifications (
                    notif_type,
                    title,
                    message,
                    case_id,
                    case_number,
                    recipient_user
                ) VALUES ('CASE_DISPATCHED', ?, ?, ?, ?, ?)
                """,
                (
                    f"Case {case['case_number']} Dispatched to {new_user or new_team}",
                    f"Assigned to {new_user or new_team} ({resolved_email}) · Priority {new_prio}",
                    case["db_id"],
                    case["case_number"],
                    new_user or new_team,
                ),
            )
        conn.commit()
    finally:
        conn.close()

    desc_suffix = f" · Mail dispatched to {resolved_email} ({dispatch_info['status']})" if dispatch_info else (f" ({resolved_email})" if resolved_email else "")
    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="CASE_ASSIGNED",
        description=f"Assigned → Team: {new_team}, HR: {new_user or 'Unassigned'}{desc_suffix}, Priority: {new_prio}",
        performed_by=performed_by,
        metadata={
            "from": f"{old_user or 'Unassigned'} ({old_team})",
            "to": assigned_display,
            "team": new_team,
            "user": new_user,
            "user_email": resolved_email,
            "priority": new_prio,
            "dispatch": dispatch_info,
        },
    )
    updated_case = _require_case(case["db_id"])
    if dispatch_info:
        updated_case["dispatch_result"] = dispatch_info
    return updated_case


def update_case_status(
    identifier: Union[int, str],
    status: str,
    note: Optional[str] = None,
    performed_by: str = "Vaibhav (HR)",
) -> Dict[str, Any]:
    case = _require_case(identifier)
    norm_status = (status or "").strip().upper()
    if norm_status not in VALID_CASE_STATUSES:
        raise ValueError(f"Invalid case status '{status}'. Allowed: {sorted(VALID_CASE_STATUSES)}")

    conn = get_connection()
    try:
        if norm_status in ("RESOLVED", "CLOSED"):
            conn.execute(
                """
                UPDATE cases
                SET status = ?,
                    closed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (norm_status, case["db_id"]),
            )
        else:
            conn.execute(
                """
                UPDATE cases
                SET status = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (norm_status, case["db_id"]),
            )

        if case.get("email_id"):
            req_rev = 1 if norm_status == "REVIEW_REQUIRED" else 0
            conn.execute(
                """
                UPDATE emails
                SET requires_review = ?,
                    processing_status = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (req_rev, norm_status, int(case["email_id"])),
            )
        conn.commit()
    finally:
        conn.close()

    desc = f"Status → {norm_status}" + (f" ({note})" if note else "")
    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="STATUS_UPDATED",
        description=desc,
        performed_by=performed_by,
        metadata={"from": case["status"], "to": norm_status, "reason": note},
    )
    return _require_case(case["db_id"])


def update_case_priority(
    identifier: Union[int, str],
    priority: str,
    performed_by: str = "Vaibhav (HR)",
) -> Dict[str, Any]:
    case = _require_case(identifier)
    norm_prio = (priority or "").strip().upper()
    if norm_prio not in VALID_PRIORITIES:
        raise ValueError(f"Invalid priority '{priority}'. Allowed: {sorted(VALID_PRIORITIES)}")

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE cases
            SET priority = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (norm_prio, case["db_id"]),
        )
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="PRIORITY_CHANGED",
        description=f"Priority changed → {norm_prio}",
        performed_by=performed_by,
        metadata={"from": case["priority"], "to": norm_prio},
    )
    return _require_case(case["db_id"])


def update_case_category(
    identifier: Union[int, str],
    category: str,
    intent: Optional[str] = None,
    reason: Optional[str] = None,
    performed_by: str = "Vaibhav (HR)",
) -> Dict[str, Any]:
    case = _require_case(identifier)
    old_cat = case.get("category")
    norm_cat = (category or "").strip().upper()
    routing = get_routing_for_category(norm_cat)
    new_team = routing.get("team", case["assigned_team"])
    new_prio = routing.get("priority", case["priority"]).upper()
    new_sla = int(routing.get("sla_hours", case["sla_hours"]))

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE cases
            SET category = ?,
                intent = COALESCE(?, intent),
                assigned_team = ?,
                assigned_to = ?,
                priority = ?,
                sla_hours = ?,
                status = CASE WHEN status = 'REVIEW_REQUIRED' THEN 'READY' ELSE status END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (norm_cat, intent, new_team, new_team, new_prio, new_sla, case["db_id"]),
        )
        if case.get("email_id"):
            conn.execute(
                """
                UPDATE emails
                SET category = ?,
                    intent = COALESCE(?, intent),
                    category_confidence = 1.0,
                    requires_review = 0,
                    decision_status = 'HR_CONFIRMED',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (norm_cat, intent, int(case["email_id"])),
            )
        conn.commit()
    finally:
        conn.close()

    get_or_create_workflow_instance(case["db_id"], norm_cat, performed_by=performed_by)

    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="CATEGORY_OVERRIDDEN",
        description=f"Override Category: {old_cat} → {norm_cat} (Routed to {new_team})",
        performed_by=performed_by,
        metadata={
            "from": old_cat,
            "to": norm_cat,
            "intent": intent,
            "assigned_team": new_team,
            "reason": reason or "HR manual category override",
        },
    )
    return _require_case(case["db_id"])


def update_case_employee(
    identifier: Union[int, str],
    employee_identifier: Union[int, str],
    performed_by: str = "Vaibhav (HR)",
) -> Dict[str, Any]:
    case = _require_case(identifier)
    emp = None
    if isinstance(employee_identifier, int) or str(employee_identifier).isdigit():
        emp = get_employee_by_db_id(int(employee_identifier))
    if not emp:
        emp = get_employee_by_employee_id(str(employee_identifier))
    if not emp:
        raise ValueError(f"Employee '{employee_identifier}' not found.")

    # Update validation_result so employee_verified and no_identity_conflict become True
    val_res = case.get("validation") or {}
    checks = val_res.get("checks") or {}
    checks["employee_verified"] = True
    checks["no_identity_conflict"] = True
    val_res["checks"] = checks
    if not val_res.get("missing_fields"):
        val_res["status"] = "READY"
        val_res["is_valid"] = True
        val_res["summary"] = "All required fields and employee identity verified"

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE cases
            SET employee_id = ?,
                validation_result = ?,
                status = CASE WHEN status = 'REVIEW_REQUIRED' THEN 'READY' ELSE status END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (emp["db_id"], json.dumps(val_res), case["db_id"]),
        )
        if case.get("email_id"):
            conn.execute(
                """
                UPDATE emails
                SET employee_id = ?,
                    validation_result = ?,
                    requires_review = 0,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (emp["db_id"], json.dumps(val_res), int(case["email_id"])),
            )
        conn.commit()
    finally:
        conn.close()

    get_or_create_workflow_instance(case["db_id"], case.get("category") or "GENERAL_HR", performed_by=performed_by)

    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="EMPLOYEE_LINKED",
        description=f"Employee verified & linked → {emp['name']} ({emp['id']})",
        performed_by=performed_by,
        metadata={"employee": emp},
    )
    return _require_case(case["db_id"])


def update_case_extracted_fields(
    identifier: Union[int, str],
    fields_patch: Dict[str, Any],
    performed_by: str = "Vaibhav (HR)",
) -> Dict[str, Any]:
    case = _require_case(identifier)
    current_fields = dict(case.get("extracted_fields") or {})
    for k, v in (fields_patch or {}).items():
        current_fields[k] = v

    val_res = dict(case.get("validation") or {})
    field_checks = val_res.get("field_checks") or []
    missing_fields: List[str] = []
    for fc in field_checks:
        fname = fc.get("field")
        if fname in current_fields:
            fc["value"] = current_fields[fname]
        val = fc.get("value")
        present = bool(val is not None and str(val).strip() != "")
        if fc.get("required"):
            fc["valid"] = present
            fc["badge"] = "✓" if present else "✗"
            if not present:
                missing_fields.append(fname)
        else:
            fc["badge"] = "✓" if present else "Optional"

    val_res["missing_fields"] = missing_fields
    checks = val_res.get("checks") or {}
    checks["required_fields_present"] = len(missing_fields) == 0
    val_res["checks"] = checks
    if len(missing_fields) == 0 and checks.get("employee_verified", True) and checks.get("no_identity_conflict", True):
        val_res["status"] = "READY"
        val_res["is_valid"] = True
        val_res["summary"] = "All required fields and employee identity verified"

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE cases
            SET extracted_fields = ?,
                validation_result = ?,
                status = CASE WHEN status = 'ON_HOLD' AND ? = 0 THEN 'READY' ELSE status END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (json.dumps(current_fields), json.dumps(val_res), len(missing_fields), case["db_id"]),
        )
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="FIELDS_UPDATED",
        description=f"Extracted case fields updated ({', '.join(fields_patch.keys())})",
        performed_by=performed_by,
        metadata={"updated_fields": fields_patch},
    )
    return _require_case(case["db_id"])


# ============================================================
# Phase 7.14 — Case Documents & Attachments
# ============================================================
def get_case_documents(case_id: int) -> Dict[str, Any]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM case_documents WHERE case_id = ? ORDER BY id ASC",
            (int(case_id),),
        ).fetchall()
        docs = [dict(r) for r in rows]
        for d in docs:
            fp = d.get("file_path")
            has_file = bool(fp and os.path.isfile(fp))
            if has_file:
                d["has_file"] = True
                d["view_url"] = f"/api/cases/{case_id}/documents/{d['id']}/view"
                d["download_url"] = f"/api/cases/{case_id}/documents/{d['id']}/download"
            elif d.get("attachment_id"):
                d["has_file"] = True
                d["view_url"] = f"/api/attachments/{d['attachment_id']}/view"
                d["download_url"] = f"/api/attachments/{d['attachment_id']}/download"
            else:
                d["has_file"] = False
                d["view_url"] = None
                d["download_url"] = None

        missing_count = sum(1 for d in docs if d.get("status") in ("REQUIRED", "REJECTED"))
        return {
            "documents": docs,
            "total": len(docs),
            "missing_count": missing_count,
            "all_complete": missing_count == 0,
        }
    finally:
        conn.close()


def add_or_update_case_document(
    identifier: Union[int, str],
    name: str,
    status: str = "RECEIVED",
    doc_type: str = "SUPPORTING_DOCUMENT",
    uploaded_by: str = "Vaibhav (HR)",
    size: str = "145 KB",
    doc_id: Optional[int] = None,
) -> Dict[str, Any]:
    case = _require_case(identifier)
    norm_status = (status or "RECEIVED").strip().upper()
    if norm_status not in ("RECEIVED", "REQUIRED", "VERIFIED", "REJECTED"):
        raise ValueError(f"Invalid document status '{status}'.")

    conn = get_connection()
    try:
        if doc_id:
            conn.execute(
                """
                UPDATE case_documents
                SET status = ?,
                    uploaded_by = COALESCE(?, uploaded_by),
                    uploaded_at = CURRENT_TIMESTAMP
                WHERE id = ? AND case_id = ?
                """,
                (norm_status, uploaded_by, int(doc_id), case["db_id"]),
            )
        else:
            existing = conn.execute(
                "SELECT id FROM case_documents WHERE case_id = ? AND LOWER(name) = LOWER(?)",
                (case["db_id"], name.strip()),
            ).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE case_documents
                    SET status = ?,
                        uploaded_by = ?,
                        size = COALESCE(?, size),
                        uploaded_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (norm_status, uploaded_by, size, existing["id"]),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO case_documents (
                        case_id,
                        email_id,
                        name,
                        doc_type,
                        uploaded_by,
                        size,
                        status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        case["db_id"],
                        case.get("email_id"),
                        name.strip(),
                        doc_type,
                        uploaded_by,
                        size,
                        norm_status,
                    ),
                )
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action=f"DOCUMENT_{norm_status}",
        description=f"Document '{name}' marked {norm_status}",
        performed_by=uploaded_by,
        metadata={"document": name, "status": norm_status},
    )
    return get_case_documents(case["db_id"])


def upload_case_document(
    identifier: Union[int, str],
    filename: str,
    payload: bytes,
    content_type: str = "application/octet-stream",
    doc_type: str = "SUPPORTING_DOCUMENT",
    uploaded_by: str = "Vaibhav (HR)",
    target_doc_id: Optional[int] = None,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Save uploaded binary file to local disk and record in case_documents table.
    """
    case = _require_case(identifier)
    from backend.services.gmail.attachment_parser import save_case_document_file
    saved = save_case_document_file(
        case_id=case["db_id"],
        filename=filename,
        payload=payload,
        content_type=content_type,
    )
    conn = get_connection()
    try:
        if target_doc_id:
            conn.execute(
                """
                UPDATE case_documents
                SET status = 'RECEIVED',
                    uploaded_by = ?,
                    uploaded_at = CURRENT_TIMESTAMP,
                    size = ?,
                    file_path = ?,
                    content_type = ?,
                    file_size_bytes = ?,
                    notes = COALESCE(?, notes)
                WHERE id = ? AND case_id = ?
                """,
                (
                    uploaded_by,
                    saved["size"],
                    saved["storage_path"],
                    saved["content_type"],
                    saved["size_bytes"],
                    notes,
                    int(target_doc_id),
                    case["db_id"],
                ),
            )
        else:
            clean_stem = filename.rsplit(".", 1)[0].strip().lower()
            existing = conn.execute(
                """
                SELECT id FROM case_documents
                WHERE case_id = ? AND (LOWER(name) = LOWER(?) OR (status IN ('REQUIRED', 'REJECTED') AND LOWER(name) LIKE ?))
                ORDER BY id ASC LIMIT 1
                """,
                (case["db_id"], filename.strip(), f"%{clean_stem}%"),
            ).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE case_documents
                    SET status = 'RECEIVED',
                        name = ?,
                        uploaded_by = ?,
                        uploaded_at = CURRENT_TIMESTAMP,
                        size = ?,
                        file_path = ?,
                        content_type = ?,
                        file_size_bytes = ?,
                        notes = COALESCE(?, notes)
                    WHERE id = ?
                    """,
                    (
                        filename.strip(),
                        uploaded_by,
                        saved["size"],
                        saved["storage_path"],
                        saved["content_type"],
                        saved["size_bytes"],
                        notes,
                        existing["id"],
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO case_documents (
                        case_id,
                        email_id,
                        name,
                        doc_type,
                        uploaded_by,
                        size,
                        status,
                        file_path,
                        content_type,
                        file_size_bytes,
                        notes
                    ) VALUES (?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?)
                    """,
                    (
                        case["db_id"],
                        case.get("email_id"),
                        filename.strip(),
                        doc_type,
                        uploaded_by,
                        saved["size"],
                        saved["storage_path"],
                        saved["content_type"],
                        saved["size_bytes"],
                        notes,
                    ),
                )
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="DOCUMENT_UPLOADED",
        description=f"Document '{filename}' uploaded ({saved['size']})",
        performed_by=uploaded_by,
        metadata={"filename": filename, "size": saved["size"], "doc_type": doc_type},
    )
    return get_case_documents(case["db_id"])


def update_case_document_status(
    identifier: Union[int, str],
    doc_id: int,
    status: str,
    notes: Optional[str] = None,
    performed_by: str = "Vaibhav (HR)",
) -> Dict[str, Any]:
    """
    Update document verification status (e.g. VERIFIED, REJECTED, REQUIRED) with optional review notes.
    """
    case = _require_case(identifier)
    norm_status = (status or "VERIFIED").strip().upper()
    if norm_status not in ("RECEIVED", "REQUIRED", "VERIFIED", "REJECTED"):
        raise ValueError(f"Invalid document status '{status}'. Must be RECEIVED, REQUIRED, VERIFIED, or REJECTED.")

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id, name FROM case_documents WHERE id = ? AND case_id = ?",
            (int(doc_id), case["db_id"]),
        ).fetchone()
        if not row:
            raise ValueError(f"Document #{doc_id} not found on Case #{identifier}.")

        doc_name = row["name"]
        conn.execute(
            """
            UPDATE case_documents
            SET status = ?,
                notes = COALESCE(?, notes),
                uploaded_at = CURRENT_TIMESTAMP
            WHERE id = ? AND case_id = ?
            """,
            (norm_status, notes, int(doc_id), case["db_id"]),
        )
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action=f"DOCUMENT_{norm_status}",
        description=f"Document '{doc_name}' marked {norm_status}{': ' + notes if notes else ''}",
        performed_by=performed_by,
        metadata={"doc_id": doc_id, "document": doc_name, "status": norm_status, "notes": notes},
    )
    return get_case_documents(case["db_id"])


# ============================================================
# Phase 7.15 & 7.16 — Request Missing Information & Communication
# ============================================================
def get_case_communications(case_id: int) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM case_communications WHERE case_id = ? ORDER BY id ASC",
            (int(case_id),),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def add_case_communication(
    identifier: Union[int, str],
    message: str,
    sender_type: str = "HR",
    sender_name: str = "Vaibhav (HR)",
    recipient: Optional[str] = None,
    subject: Optional[str] = None,
    comm_type: str = "OUTBOUND_HR",
    missing_items: Optional[str] = None,
) -> Dict[str, Any]:
    case = _require_case(identifier)
    clean_msg = (message or "").strip()
    if not clean_msg:
        raise ValueError("Communication message cannot be empty.")

    norm_sender_type = (sender_type or "HR").strip().upper()
    recip = recipient or case.get("employee_email") or case.get("employee_name") or "Employee"
    subj = subject or f"Re: {case.get('title') or case['case_number']}"

    conn = get_connection()
    try:
        cur = conn.execute(
            """
            INSERT INTO case_communications (
                case_id,
                email_id,
                sender_type,
                sender_name,
                recipient,
                subject,
                message,
                comm_type,
                missing_items
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                case["db_id"],
                case.get("email_id"),
                norm_sender_type,
                sender_name,
                recip,
                subj,
                clean_msg,
                comm_type,
                missing_items,
            ),
        )
        new_id = cur.lastrowid
        if norm_sender_type == "EMPLOYEE":
            conn.execute(
                """
                INSERT INTO notifications (
                    notif_type,
                    title,
                    message,
                    case_id,
                    case_number,
                    recipient_user
                ) VALUES ('EMPLOYEE_RESPONDED', ?, ?, ?, ?, ?)
                """,
                (
                    f"Employee Responded: {case['case_number']}",
                    f"{sender_name} replied on {case['case_number']}: {clean_msg[:100]}",
                    case["db_id"],
                    case["case_number"],
                    case.get("assigned_user") or case.get("assigned_team"),
                ),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM case_communications WHERE id = ?", (new_id,)).fetchone()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="COMMUNICATION_SENT" if norm_sender_type == "HR" else "COMMUNICATION_RECEIVED",
        description=f"{norm_sender_type} message ({sender_name} → {recip}): {clean_msg[:120]}",
        performed_by=sender_name,
        metadata={"comm_type": comm_type, "missing_items": missing_items},
    )
    return dict(row)


def request_missing_information(
    identifier: Union[int, str],
    missing_items: str,
    message: str,
    to_recipient: Optional[str] = None,
    performed_by: str = "Vaibhav (HR)",
) -> Dict[str, Any]:
    case = _require_case(identifier)
    clean_missing = (missing_items or "Required Information").strip()
    clean_msg = (message or f"Please provide the following missing information: {clean_missing}").strip()
    recip = to_recipient or case.get("employee_email") or case.get("employee_name") or "Employee"

    comm = add_case_communication(
        identifier=case["db_id"],
        message=clean_msg,
        sender_type="HR",
        sender_name=performed_by,
        recipient=recip,
        subject=f"Action Required [{case['case_number']}]: Missing {clean_missing}",
        comm_type="MISSING_INFO_REQUEST",
        missing_items=clean_missing,
    )

    # Register missing item in case_documents if it looks like a document/letter/slip/proof/certificate
    if any(w in clean_missing.lower() for w in ("letter", "slip", "proof", "certificate", "document", "id", "form")):
        add_or_update_case_document(
            identifier=case["db_id"],
            name=clean_missing,
            status="REQUIRED",
            doc_type="REQUESTED_DOCUMENT",
            uploaded_by=performed_by,
            size="—",
        )

    updated_case = update_case_status(
        identifier=case["db_id"],
        status="ON_HOLD",
        note=f"Requested missing info ({clean_missing}) from {recip}",
        performed_by=performed_by,
    )

    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="MISSING_INFO_REQUESTED",
        description=f"Requested missing information from {recip}: {clean_missing}",
        performed_by=performed_by,
        metadata={"to": recip, "missing": clean_missing, "message": clean_msg},
    )
    return {
        "case": updated_case,
        "communication": comm,
    }


# ============================================================
# Phase 7.18, 7.19, 7.20 — Resolution, Closure, Reopen
# ============================================================
def evaluate_resolution_readiness(case: Dict[str, Any]) -> Dict[str, Any]:
    """
    Phase 7.18 Controlled Resolution Pre-Checks:
      ✓ Required fields complete
      ✓ Required documents complete
      ✓ Required tasks complete
      ✓ Required approvals complete
      ✓ Workflow allows resolution
    """
    case_db_id = case["db_id"]
    val = case.get("validation") or {}
    missing_fields = val.get("missing_fields") or []
    req_fields_ok = len(missing_fields) == 0

    docs_info = get_case_documents(case_db_id)
    req_docs_ok = docs_info["missing_count"] == 0

    tasks = list_tasks_query(case_id=case_db_id)
    open_tasks = [t for t in tasks if t["status"] in ("PENDING", "IN_PROGRESS")]
    req_tasks_ok = len(open_tasks) == 0

    approvals = list_approvals_query(case_id=case_db_id)
    pending_approvals = [a for a in approvals if a["status"] == "PENDING"]
    rejected_approvals = [a for a in approvals if a["status"] == "REJECTED"]
    req_approvals_ok = len(pending_approvals) == 0 and len(rejected_approvals) == 0

    wf = get_case_workflow(case_db_id)
    wf_allows = True
    if wf:
        cur_st = wf.get("current_state")
        if cur_st in ("DOCUMENTS_REQUIRED", "AWAITING_CLASSIFICATION"):
            wf_allows = False

    val_checks = (val.get("checks") or {}) if isinstance(val, dict) else {}
    emp_verified = bool(val_checks.get("employee_verified", bool(case.get("employee_matched"))))
    no_conflict = bool(val_checks.get("no_identity_conflict", not bool(case.get("employee_conflict"))))

    blocking_reasons: List[str] = []
    if not no_conflict:
        blocking_reasons.append(val.get("summary") or "Employee identity conflict requires HR verification")
    if not req_fields_ok:
        blocking_reasons.append(f"Missing required fields: {', '.join(missing_fields)}")
    if not req_docs_ok:
        blocking_reasons.append(f"{docs_info['missing_count']} required document(s) missing or rejected")
    if not req_tasks_ok:
        blocking_reasons.append(f"{len(open_tasks)} task(s) still open ({', '.join(t['task_id'] for t in open_tasks)})")
    if not req_approvals_ok:
        if pending_approvals:
            blocking_reasons.append(f"{len(pending_approvals)} approval(s) still PENDING")
        if rejected_approvals:
            blocking_reasons.append(f"{len(rejected_approvals)} approval(s) REJECTED")
    if not wf_allows:
        blocking_reasons.append(f"Workflow state '{wf.get('current_state')}' blocks resolution")
    if case.get("status") == "REVIEW_REQUIRED":
        blocking_reasons.append("Case is in REVIEW_REQUIRED state (resolve identity/classification review first)")

    can_resolve = len(blocking_reasons) == 0 and case.get("status") not in ("RESOLVED", "CLOSED")
    can_close = case.get("status") == "RESOLVED" and len(blocking_reasons) == 0

    return {
        "checks": {
            "required_fields_complete": req_fields_ok,
            "required_documents_complete": req_docs_ok,
            "required_tasks_complete": req_tasks_ok,
            "required_approvals_complete": req_approvals_ok,
            "workflow_allows_resolution": wf_allows,
            "employee_verified": emp_verified,
            "no_identity_conflict": no_conflict,
        },
        "required_fields_present": req_fields_ok,
        "missing_fields": missing_fields,
        "employee_verified": emp_verified,
        "no_identity_conflict": no_conflict,
        "ready": can_resolve,
        "open_tasks_count": len(open_tasks),
        "pending_approvals_count": len(pending_approvals),
        "missing_documents_count": docs_info["missing_count"],
        "blocking_reasons": blocking_reasons,
        "can_resolve": can_resolve,
        "can_close": can_close,
    }


def resolve_case(
    identifier: Union[int, str],
    resolution_note: Optional[str] = None,
    resolution_type: str = "STANDARD_RESOLUTION",
    performed_by: str = "Vaibhav (HR)",
    enforce_checks: bool = False,
) -> Dict[str, Any]:
    case = _require_case(identifier)
    readiness = evaluate_resolution_readiness(case)

    if enforce_checks and not readiness["can_resolve"]:
        raise ValueError(
            "Cannot resolve case yet: " + "; ".join(readiness["blocking_reasons"])
        )

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    notes_val = (resolution_note or "Resolved by HR").strip()

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE cases
            SET status = 'RESOLVED',
                resolution_type = ?,
                resolution_notes = ?,
                resolved_by = ?,
                resolved_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (resolution_type, notes_val, performed_by, now_str, case["db_id"]),
        )
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="CASE_RESOLVED",
        description=f"Case resolved ({resolution_type}): {notes_val}",
        performed_by=performed_by,
        metadata={
            "from": case["status"],
            "to": "RESOLVED",
            "resolution_type": resolution_type,
            "notes": notes_val,
            "reason": notes_val,
        },
    )
    return _require_case(case["db_id"])


def close_case(
    identifier: Union[int, str],
    close_note: Optional[str] = None,
    performed_by: str = "Vaibhav (HR)",
) -> Dict[str, Any]:
    """
    Phase 7.19 Separate Resolve and Close:
      OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED
    Closing is blocked if mandatory workflow/task/approval requirements aren't satisfied
    or if the case is still in REVIEW_REQUIRED / ON_HOLD.
    """
    case = _require_case(identifier)
    readiness = evaluate_resolution_readiness(case)

    if case["status"] in ("REVIEW_REQUIRED", "ON_HOLD"):
        raise ValueError(
            f"Cannot close case while in '{case['status']}' state. Resolve blocking items first."
        )
    if readiness["blocking_reasons"]:
        raise ValueError(
            "Cannot close case — mandatory requirements not satisfied: "
            + "; ".join(readiness["blocking_reasons"])
        )
    if case["status"] != "RESOLVED":
        # Require case to be RESOLVED before CLOSED (Phase 7.19)
        raise ValueError(
            f"Case must be in 'RESOLVED' status before closing (current status: '{case['status']}')."
        )

    # Advance workflow to CLOSED if an active transition to CLOSED exists
    wf = get_case_workflow(case["db_id"])
    if wf and wf.get("current_state") != "CLOSED":
        avail = wf.get("available_transitions") or []
        close_trig = next((t["trigger"] for t in avail if t["to_state"] == "CLOSED"), None)
        if close_trig:
            try:
                transition_workflow_state(case["db_id"], trigger=close_trig, performed_by=performed_by)
            except Exception:
                pass

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE cases
            SET status = 'CLOSED',
                closed_by = ?,
                closed_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (performed_by, now_str, case["db_id"]),
        )
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="CASE_CLOSED",
        description=f"Case closed by {performed_by}" + (f" ({close_note})" if close_note else ""),
        performed_by=performed_by,
        metadata={
            "from": case["status"],
            "to": "CLOSED",
            "reason": close_note or "Mandatory checks completed; case closed",
        },
    )
    return _require_case(case["db_id"])


def check_and_auto_close_resolved_cases() -> int:
    """
    Evaluate cases in 'RESOLVED' status. If 24 hours have elapsed since resolved_at
    without a requester reply reopening the ticket, permanently close the case (status -> CLOSED).
    """
    now_utc = datetime.now(timezone.utc)
    now_str = now_utc.strftime("%Y-%m-%d %H:%M:%S")
    closed_cases = []

    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, case_number, resolved_at, resolved_by, title
            FROM cases
            WHERE status = 'RESOLVED'
              AND resolved_at IS NOT NULL
            """
        ).fetchall()
        for r in rows:
            res_str = str(r["resolved_at"]).strip().replace("Z", "+00:00")
            try:
                if "T" in res_str:
                    res_dt = datetime.fromisoformat(res_str)
                else:
                    res_dt = datetime.strptime(res_str[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
                if res_dt.tzinfo is None:
                    res_dt = res_dt.replace(tzinfo=timezone.utc)
                elapsed_hours = (now_utc - res_dt).total_seconds() / 3600.0
            except Exception:
                elapsed_hours = 0.0

            if elapsed_hours >= 24.0:
                conn.execute(
                    """
                    UPDATE cases
                    SET status = 'CLOSED',
                        workflow_state = 'CLOSED',
                        closed_at = ?,
                        closed_by = 'System Policy (24h Inactivity)',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (now_str, r["id"]),
                )
                closed_cases.append(r["case_number"])

        if closed_cases:
            conn.commit()
    except Exception as exc:
        logger.warning(f"Error checking 24h auto-close cases: {exc}")
    finally:
        conn.close()

    for c_num in closed_cases:
        try:
            log_event(
                entity_type="CASE",
                entity_id=c_num,
                action="CASE_AUTO_CLOSED_24H",
                description=f"Case #{c_num} permanently closed: 24 hours elapsed since resolution with no requester reply.",
                performed_by="HR Flow Policy Engine",
            )
        except Exception:
            pass

    return len(closed_cases)


def reopen_case(
    identifier: Union[int, str],
    reopen_reason: str,
    performed_by: str = "Vaibhav (HR)",
    role: str = "ADMIN",
) -> Dict[str, Any]:
    """
    Phase 7.20 Reopen Case:
      CLOSED / RESOLVED -> REOPEN -> IN_PROGRESS
    Requires authorized role (HR_LEAD, HR_MANAGER, ADMIN) and a non-empty Reopen Reason.
    """
    require_permission(role, "reopen_case")
    case = _require_case(identifier)

    clean_reason = (reopen_reason or "").strip()
    if not clean_reason:
        raise ValueError("Reopen reason is required to reopen a case.")

    if case["status"] not in ("RESOLVED", "CLOSED"):
        raise ValueError(
            f"Only RESOLVED or CLOSED cases can be reopened (current status: '{case['status']}')."
        )

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE cases
            SET status = 'IN_PROGRESS',
                reopened_by = ?,
                reopened_at = ?,
                reopen_reason = ?,
                closed_at = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (performed_by, now_str, clean_reason, case["db_id"]),
        )
        conn.commit()
    finally:
        conn.close()

    reopen_workflow_instance(case["db_id"], performed_by=performed_by, reason=clean_reason)

    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="CASE_REOPENED",
        description=f"Case reopened ({case['status']} → IN_PROGRESS): {clean_reason}",
        performed_by=performed_by,
        metadata={
            "from": case["status"],
            "to": "IN_PROGRESS",
            "reason": clean_reason,
        },
    )
    return _require_case(case["db_id"])


# ============================================================
# Phase 7.13 — Contextual HR Action Center Computation
# ============================================================
def compute_contextual_actions(
    case: Dict[str, Any],
    workflow: Optional[Dict[str, Any]],
    readiness: Dict[str, Any],
    role: str = "ADMIN",
) -> List[Dict[str, Any]]:
    status = (case.get("status") or "NEW").upper()
    val_status = (case.get("validation") or {}).get("status", "READY")
    actions: List[Dict[str, Any]] = []

    if status in ("REVIEW_REQUIRED", "NEW") and check_role_permission(role, "accept_ai"):
        actions.append({
            "id": "ACCEPT_AI",
            "label": "Accept AI Classification",
            "variant": "primary",
        })
    if status != "CLOSED" and check_role_permission(role, "override_category"):
        actions.append({
            "id": "OVERRIDE_CATEGORY",
            "label": "Override Category",
            "variant": "secondary",
        })
    if status != "CLOSED" and check_role_permission(role, "assign_case"):
        actions.append({
            "id": "ASSIGN_TEAM",
            "label": "Assign Team / HR",
            "variant": "secondary",
        })
    if status not in ("RESOLVED", "CLOSED") and check_role_permission(role, "request_info"):
        actions.append({
            "id": "REQUEST_MISSING_INFO",
            "label": "Request Missing Information",
            "variant": "warning" if val_status != "READY" else "secondary",
        })
    if status in ("REVIEW_REQUIRED", "ON_HOLD", "NEW") and check_role_permission(role, "mark_ready"):
        actions.append({
            "id": "MARK_READY",
            "label": "Mark Ready",
            "variant": "primary",
        })
    if status not in ("RESOLVED", "CLOSED") and check_role_permission(role, "create_task"):
        actions.append({
            "id": "CREATE_TASK",
            "label": "Create Task",
            "variant": "secondary",
        })
    if status not in ("RESOLVED", "CLOSED") and check_role_permission(role, "request_approval"):
        actions.append({
            "id": "REQUEST_APPROVAL",
            "label": "Request Approval",
            "variant": "secondary",
        })
    if readiness["pending_approvals_count"] > 0 and check_role_permission(role, "approve_request"):
        actions.append({
            "id": "APPROVE_PENDING",
            "label": "Approve",
            "variant": "success",
        })
        actions.append({
            "id": "REJECT_PENDING",
            "label": "Reject",
            "variant": "danger",
        })
    if workflow and (workflow.get("available_transitions") or []) and status != "CLOSED":
        for tr in workflow.get("available_transitions") or []:
            actions.append({
                "id": f"WF_TRIGGER:{tr['trigger']}",
                "trigger": tr["trigger"],
                "to_state": tr["to_state"],
                "label": tr.get("label") or tr["trigger"].replace("_", " ").title(),
                "variant": "workflow",
            })
    if status not in ("RESOLVED", "CLOSED") and check_role_permission(role, "resolve_case"):
        actions.append({
            "id": "RESOLVE_CASE",
            "label": "Resolve Case",
            "variant": "success",
            "enabled": readiness["can_resolve"],
            "blocking_reasons": readiness["blocking_reasons"],
        })
    if status == "RESOLVED" and check_role_permission(role, "close_case"):
        actions.append({
            "id": "CLOSE_CASE",
            "label": "Close Case",
            "variant": "primary",
            "enabled": readiness["can_close"],
        })
    if status in ("RESOLVED", "CLOSED") and check_role_permission(role, "reopen_case"):
        actions.append({
            "id": "REOPEN_CASE",
            "label": "Reopen Case",
            "variant": "warning",
        })
    return actions


# ============================================================
# Phase 7.2 — Full Case Detail Workspace Loader
# ============================================================
def get_full_case_detail(identifier: Union[int, str], role: str = "ADMIN") -> Dict[str, Any]:
    case = _require_case(identifier)
    case_db_id = case["db_id"]
    email_id = case.get("email_id")

    # 1. Employee section
    emp_obj = None
    if case.get("employee_db_id"):
        emp_obj = get_employee_by_db_id(int(case["employee_db_id"]))
    if not emp_obj and case.get("employee_id"):
        emp_obj = get_employee_by_employee_id(str(case["employee_id"]))

    # 2. Original Email + AI Classification
    original_email = None
    ai_classification = {
        "category": case.get("category") or "UNKNOWN",
        "intent": case.get("intent") or "NOT_CONFIGURED",
        "intent_id": None,
        "intent_name": case.get("intent"),
        "category_confidence": 0.95,
        "intent_score": None,
        "intent_margin": None,
        "model": None,
        "requires_review": case.get("status") == "REVIEW_REQUIRED",
        "decision_status": "AUTO PROCESSED",
    }

    if email_id:
        conn = get_connection()
        try:
            erow = conn.execute("SELECT * FROM emails WHERE id = ?", (int(email_id),)).fetchone()
            if erow:
                ed = dict(erow)
                att_row = conn.execute(
                    """
                    SELECT metadata FROM audit_logs
                    WHERE entity_type = 'EMAIL' AND entity_id = ? AND action = 'EMAIL_INGESTED'
                    ORDER BY id DESC LIMIT 1
                    """,
                    (str(email_id),),
                ).fetchone()
                atts = []
                if att_row and att_row["metadata"]:
                    try:
                        atts = json.loads(att_row["metadata"]).get("attachments", [])
                    except Exception:
                        atts = []

                original_email = {
                    "id": ed["id"],
                    "from_name": ed.get("sender_name") or "Employee",
                    "from_email": ed.get("sender_email") or "",
                    "sender_name": ed.get("sender_name") or "Employee",
                    "sender_email": ed.get("sender_email") or "",
                    "from_display": f"{ed.get('sender_name') or ''} <{ed.get('sender_email') or ''}>".strip(),
                    "to": "HR Operations <hr@company.com>",
                    "subject": ed.get("subject") or case.get("title"),
                    "received_at": ed.get("received_at") or ed.get("created_at"),
                    "attachments": atts,
                    "body": ed.get("body") or case.get("description") or "",
                }

                # Look up INTENT_CLASSIFIED audit metadata for score, margin, and model version
                intent_audit = conn.execute(
                    """
                    SELECT metadata FROM audit_logs
                    WHERE entity_type = 'EMAIL' AND entity_id = ? AND action = 'INTENT_CLASSIFIED'
                    ORDER BY id DESC LIMIT 1
                    """,
                    (str(email_id),),
                ).fetchone()
                intent_meta = {}
                if intent_audit and intent_audit["metadata"]:
                    try:
                        intent_meta = json.loads(intent_audit["metadata"])
                    except Exception:
                        intent_meta = {}

                # Or run live intent model check if not cached in audit
                if not intent_meta and ed.get("category") in ("ATTENDANCE", "LEAVE"):
                    from backend.classification.intent_model_service import predict_specialized_intent
                    intent_meta = predict_specialized_intent(ed["category"], ed.get("subject") or "", ed.get("body") or "")

                ai_classification = {
                    "category": ed.get("category") or case.get("category") or "UNKNOWN",
                    "intent": ed.get("intent") or case.get("intent") or "NOT_CONFIGURED",
                    "intent_id": intent_meta.get("id"),
                    "intent_name": intent_meta.get("name") or case.get("intent"),
                    "category_confidence": float(ed.get("category_confidence") or 0.95),
                    "intent_score": intent_meta.get("score") if intent_meta.get("score") is not None else ed.get("intent_score"),
                    "intent_margin": intent_meta.get("margin"),
                    "model": intent_meta.get("model"),
                    "model_version": intent_meta.get("model"),
                    "requires_review": bool(ed.get("requires_review")),
                    "decision_status": ed.get("decision_status") or "AUTO PROCESSED",
                    "reason": ed.get("category_reason") or intent_meta.get("reason"),
                }
        finally:
            conn.close()

    # 3. Tasks, Approvals, Workflow, Documents, Communications, Timeline, Readiness
    tasks = list_tasks_query(case_id=case_db_id)
    approvals = list_approvals_query(case_id=case_db_id)
    workflow = build_workflow_preview_for_category(case.get("category") or "GENERAL_HR", case_id=case_db_id)
    documents_info = get_case_documents(case_db_id)
    communications = get_case_communications(case_db_id)
    timeline = get_email_and_case_activity(
        email_id=email_id,
        case_id=case_db_id,
        case_number=case["case_number"],
    )
    readiness = evaluate_resolution_readiness(case)
    available_actions = compute_contextual_actions(case, workflow, readiness, role=role)

    try:
        from backend.services.actions.action_engine import list_hr_actions, list_external_api_audits
        case_hr_actions = list_hr_actions(case_id=case_db_id)
        case_ext_audits = list_external_api_audits(case_id=case_db_id)
    except Exception:
        case_hr_actions = []
        case_ext_audits = []

    emp_payload = emp_obj or {
        "id": case.get("employee_id") or "UNVERIFIED",
        "employee_code": case.get("employee_id") or "UNVERIFIED",
        "name": case.get("employee_name") or (original_email["from_name"] if original_email else "Unverified Sender"),
        "email": case.get("employee_email") or (original_email["from_email"] if original_email else "—"),
        "department": case.get("employee_department") or "—",
        "designation": case.get("employee_designation") or "—",
        "manager": case.get("employee_manager") or "—",
        "location": case.get("employee_location") or "—",
        "matched": False,
        "conflict": bool(case.get("employee_conflict")),
    }
    if "employee_code" not in emp_payload:
        emp_payload["employee_code"] = emp_payload.get("id") or "UNVERIFIED"
    if "manager" not in emp_payload:
        emp_payload["manager"] = emp_payload.get("manager_name") or "—"
    if "matched" not in emp_payload:
        emp_payload["matched"] = bool(case.get("employee_matched", True))
    if "conflict" not in emp_payload:
        emp_payload["conflict"] = bool(case.get("employee_conflict"))

    assignment_obj = {
        "assigned_team": case.get("assigned_team"),
        "assigned_user": case.get("assigned_user"),
        "assigned_to": case.get("assigned_to"),
        "priority": case.get("priority"),
    }
    sla_obj = {
        "priority": case.get("priority"),
        "sla_hours": case.get("sla_hours"),
        "due_at": case.get("due_at"),
        "due_display": case.get("due_display"),
        "sla_remaining": case.get("sla_remaining"),
        "sla_status": case.get("sla_status"),
        "sla_state": case.get("sla_state") or case.get("sla_status"),
        "breached": bool(case.get("sla_breached")),
    }

    return {
        "case": case,
        "employee": emp_payload,
        "original_email": original_email,
        "ai_classification": ai_classification,
        "classification": ai_classification,
        "intent": {
            "id": ai_classification.get("intent_id"),
            "name": ai_classification.get("intent_name") or case.get("intent"),
            "score": ai_classification.get("intent_score"),
            "margin": ai_classification.get("intent_margin"),
            "model": ai_classification.get("model"),
        },
        "extracted_fields": case.get("extracted_fields") or {},
        "validation": case.get("validation") or {},
        "assignment": assignment_obj,
        "sla": sla_obj,
        "tasks": tasks,
        "approvals": approvals,
        "workflow": workflow,
        "hr_actions": case_hr_actions,
        "external_api_audits": case_ext_audits,
        "documents": documents_info,
        "communications": communications,
        "timeline": timeline,
        "audit": timeline,
        "resolution_readiness": readiness,
        "pre_resolution_checklist": readiness,
        "available_actions": available_actions,
        "contextual_actions": available_actions,
        "feedback": (lambda: (__import__("backend.services.cases.feedback_service", fromlist=["get_case_feedback"]).get_case_feedback(case["case_number"])))() if case.get("case_number") else None,
    }


# ============================================================
# Phase 7.7, 7.8, 7.22 — Operational Metrics & Queue Summaries
# ============================================================
def get_operational_metrics(current_user: str = "Vaibhav (HR)") -> Dict[str, Any]:
    all_cases = list_cases(limit=500)
    all_tasks = list_tasks_query(limit=500)
    all_approvals = list_approvals_query(limit=500)

    open_cases = [c for c in all_cases if c["status"] not in ("RESOLVED", "CLOSED")]
    high_prio = [c for c in open_cases if c["priority"] in ("HIGH", "CRITICAL")]
    due_today = [c for c in open_cases if c.get("sla_due_today")]
    due_soon = [c for c in open_cases if c.get("sla_status") == "DUE_SOON"]
    overdue = [c for c in open_cases if c.get("sla_status") == "OVERDUE" or c.get("sla_breached")]
    completed_cases = [c for c in all_cases if c["status"] in ("RESOLVED", "CLOSED")]
    needs_review_cases = [
        c for c in open_cases
        if (
            c.get("status") in ("REVIEW_REQUIRED", "ON_HOLD")
            or bool(c.get("employee_conflict"))
            or bool((c.get("validation") or {}).get("missing_fields"))
        )
    ]

    pending_approvals = [a for a in all_approvals if a["status"] == "PENDING"]
    pending_tasks = [t for t in all_tasks if t["status"] in ("OPEN", "PENDING", "IN_PROGRESS")]

    status_counts: Dict[str, int] = {}
    category_counts: Dict[str, int] = {}
    sla_counts: Dict[str, int] = {"ON_TRACK": 0, "DUE_SOON": 0, "OVERDUE": 0, "COMPLETED": 0}
    team_counts: Dict[str, int] = {}

    # Team Queue Breakdown (Phase 7.8 & 7.22)
    team_map: Dict[str, Dict[str, Any]] = {}
    for tname in HR_TEAMS:
        team_map[tname] = {
            "team": tname,
            "total": 0,
            "open": 0,
            "in_progress": 0,
            "due_soon": 0,
            "overdue": 0,
            "completed": 0,
        }

    for c in all_cases:
        st = c.get("status") or "NEW"
        status_counts[st] = status_counts.get(st, 0) + 1

        cat = c.get("category") or "UNKNOWN"
        category_counts[cat] = category_counts.get(cat, 0) + 1

        sla_st = c.get("sla_status") or "ON_TRACK"
        sla_counts[sla_st] = sla_counts.get(sla_st, 0) + 1

        tname = c.get("assigned_team") or "HR Operations"
        team_counts[tname] = team_counts.get(tname, 0) + 1
        if tname not in team_map:
            team_map[tname] = {
                "team": tname,
                "total": 0,
                "open": 0,
                "in_progress": 0,
                "due_soon": 0,
                "overdue": 0,
                "completed": 0,
            }
        entry = team_map[tname]
        entry["total"] += 1
        if c["status"] in ("RESOLVED", "CLOSED"):
            entry["completed"] += 1
        else:
            entry["open"] += 1
            if c["status"] == "IN_PROGRESS":
                entry["in_progress"] += 1
            if c.get("sla_status") == "DUE_SOON":
                entry["due_soon"] += 1
            if c.get("sla_status") == "OVERDUE" or c.get("sla_breached"):
                entry["overdue"] += 1

    u_low = (current_user or "Vaibhav (HR)").strip().lower()
    is_admin_alias = u_low in ("admin", "vaibhav", "vaibhav (hr)")
    my_queue_cases = [
        c for c in open_cases
        if (
            (c.get("assigned_user") or "").strip().lower() == u_low
            or (is_admin_alias and any(alias in (c.get("assigned_user") or "").strip().lower() for alias in ("vaibhav", "admin")))
        )
    ]

    my_work_summary = {
        "total_cases": len(all_cases),
        "open_cases": len(open_cases),
        "my_queue": len(my_queue_cases),
        "high_priority": len(high_prio),
        "due_today": len(due_today),
        "due_soon": len(due_soon),
        "overdue": len(overdue),
        "completed": len(completed_cases),
        "resolved_today": len(completed_cases),
        "needs_review": len(needs_review_cases),
        "pending_approval": len(pending_approvals),
        "waiting_approval": len(pending_approvals),
        "pending_tasks": len(pending_tasks),
        "status_counts": status_counts,
        "category_counts": category_counts,
        "sla_counts": sla_counts,
        "team_counts": team_counts,
    }

    return {
        "total_cases": len(all_cases),
        "open_cases": len(open_cases),
        "needs_review": len(needs_review_cases),
        "status_counts": status_counts,
        "category_counts": category_counts,
        "sla_counts": sla_counts,
        "team_counts": team_counts,
        "my_work": my_work_summary,
        "team_workload": list(team_map.values()),
        "hr_teams": HR_TEAMS,
        "hr_users": HR_USERS,
    }


# ============================================================
# Phase 7.24 — Operational Notifications
# ============================================================
def list_notifications(unread_only: bool = False, limit: int = 50) -> Dict[str, Any]:
    from backend.models.audit_log import _parse_sqlite_utc_to_local

    conn = get_connection()
    try:
        where_sql = "WHERE is_read = 0" if unread_only else ""
        rows = conn.execute(
            f"SELECT * FROM notifications {where_sql} ORDER BY id DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
        notifs = []
        for r in rows:
            item = dict(r)
            t_info = _parse_sqlite_utc_to_local(item.get("created_at") or "")
            item["date_time_local"] = t_info["date_time_local"]
            item["time_hm"] = t_info["time_hm"]
            item["timestamp_iso"] = t_info["timestamp_iso"]
            notifs.append(item)
        unread_count = sum(1 for n in notifs if not n.get("is_read"))
    finally:
        conn.close()

    metrics = get_operational_metrics()["my_work"]
    return {
        "notifications": notifs,
        "unread_count": unread_count,
        "summary": {
            "new_cases": metrics["open_cases"],
            "approvals_required": metrics["pending_approval"],
            "sla_overdue": metrics["overdue"],
            "pending_tasks": metrics["pending_tasks"],
        },
    }


def mark_notification_read(notif_id: Optional[int] = None, mark_all: bool = False) -> Dict[str, Any]:
    conn = get_connection()
    try:
        if mark_all:
            conn.execute("UPDATE notifications SET is_read = 1")
        elif notif_id is not None:
            conn.execute("UPDATE notifications SET is_read = 1 WHERE id = ?", (int(notif_id),))
        conn.commit()
    finally:
        conn.close()
    return list_notifications()
