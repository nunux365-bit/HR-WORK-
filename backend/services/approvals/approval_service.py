"""
HR FLOW — Phase 7.11 Approvals Service (backend/services/approvals/approval_service.py)
Implements:
  Approval -> Decision -> Workflow Trigger -> Next State
Approvals do not bypass the workflow engine; they trigger the workflow state machine.
"""

from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Union
from backend.database.connection import get_connection
from backend.models.case import get_case_by_id_or_number
from backend.models.approval import (
    generate_next_approval_code,
    get_approval_by_id_or_code,
    list_approvals_query,
)
from backend.services.workflows.workflow_service import get_case_workflow
from backend.services.workflows.workflow_engine import (
    get_or_create_workflow_instance,
    transition_workflow_state,
)
from backend.services.audit.audit_service import log_event


_CATEGORY_APPROVAL_TRIGGERS = {
    "LEAVE": "APPROVE_LEAVE",
    "ATTENDANCE": "APPROVE_CORRECTION",
    "RESIGNATION": "VALIDATE_DOCUMENTS",
    "BGV": "RECEIVE_BGV_REPORT",
    "PAYROLL": "PROCESS_ADJUSTMENT",
    "ASSET_IT": "APPROVE_ASSET",
}


def request_approval(
    case_identifier: Union[int, str],
    approver: Optional[str] = None,
    approver_role: str = "HR_MANAGER",
    approval_type: str = "MANAGER_APPROVAL",
    task_id: Optional[int] = None,
    comments: Optional[str] = None,
    workflow_trigger_approve: Optional[str] = None,
    performed_by: str = "hr_admin",
) -> Dict[str, Any]:
    case = get_case_by_id_or_number(case_identifier)
    if not case:
        raise ValueError(f"Case '{case_identifier}' not found.")

    category = (case.get("category") or "GENERAL_HR").upper()
    default_trigger = workflow_trigger_approve or _CATEGORY_APPROVAL_TRIGGERS.get(category)
    approver_name = (approver or "Amit Kumar (Reporting Manager)").strip()
    code = generate_next_approval_code()

    # Ensure workflow instance exists and advance to approval-waiting state if applicable (e.g. LEAVE: POLICY_CHECK -> MANAGER_APPROVAL)
    wf = get_case_workflow(case["db_id"])
    if not wf:
        wf = get_or_create_workflow_instance(case["db_id"], category, performed_by=performed_by)
    if wf:
        cur_state = wf.get("current_state")
        if category == "LEAVE" and cur_state == "LEAVE_REQUEST_RECEIVED":
            try:
                wf = transition_workflow_state(case["db_id"], trigger="VERIFY_BALANCE", performed_by=performed_by)
                cur_state = wf.get("current_state")
            except Exception:
                pass
        if category == "LEAVE" and cur_state == "POLICY_CHECK":
            try:
                wf = transition_workflow_state(case["db_id"], trigger="ROUTE_MANAGER", performed_by=performed_by)
            except Exception:
                pass
        elif category == "ATTENDANCE" and cur_state == "ATTENDANCE_RECEIVED":
            try:
                wf = transition_workflow_state(case["db_id"], trigger="START_VERIFICATION", performed_by=performed_by)
            except Exception:
                pass

    conn = get_connection()
    try:
        cur = conn.execute(
            """
            INSERT INTO approvals (
                approval_code,
                case_id,
                task_id,
                approval_type,
                approver,
                approver_role,
                status,
                workflow_trigger_approve,
                requested_by,
                comments
            ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
            """,
            (
                code,
                case["db_id"],
                int(task_id) if task_id else None,
                approval_type,
                approver_name,
                approver_role,
                default_trigger,
                performed_by,
                comments or f"Approval requested for {case['case_number']}",
            ),
        )
        new_id = cur.lastrowid
        conn.execute(
            """
            INSERT INTO notifications (
                notif_type,
                title,
                message,
                case_id,
                case_number,
                recipient_user,
                recipient_role
            ) VALUES ('APPROVAL_REQUIRED', ?, ?, ?, ?, ?, ?)
            """,
            (
                f"Approval Required: {case['case_number']}",
                f"{approval_type.replace('_', ' ').title()} ({code}) requested from {approver_name} for {case['case_number']}.",
                case["db_id"],
                case["case_number"],
                approver_name,
                approver_role,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    approval_obj = get_approval_by_id_or_code(new_id)
    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="APPROVAL_REQUESTED",
        description=f"Approval {code} requested from {approver_name} ({approval_type})",
        performed_by=performed_by,
        metadata={"approval": approval_obj},
    )
    return approval_obj


def decide_approval(
    identifier: Union[int, str],
    decision: str,
    comments: Optional[str] = None,
    performed_by: str = "hr_manager",
) -> Dict[str, Any]:
    """
    Phase 7.11:
      Approval -> Decision -> Workflow Trigger -> Next State
    """
    approval = get_approval_by_id_or_code(identifier)
    if not approval:
        raise ValueError(f"Approval '{identifier}' not found.")

    if approval["status"] != "PENDING":
        raise ValueError(
            f"Invalid approval decision: approval '{approval['approval_code']}' is already {approval['status']}."
        )

    norm_dec = (decision or "").strip().upper()
    if norm_dec not in ("APPROVED", "REJECTED", "CANCELLED"):
        raise ValueError(f"Invalid approval decision '{decision}'. Allowed: APPROVED, REJECTED, CANCELLED.")

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    case_id = approval["case_db_id"]

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE approvals
            SET status = ?,
                decision_at = ?,
                decision_by = ?,
                comments = COALESCE(?, comments)
            WHERE id = ?
            """,
            (norm_dec, now_str, performed_by, comments, approval["id"]),
        )
        if approval.get("task_id") and norm_dec == "APPROVED":
            conn.execute(
                """
                UPDATE tasks
                SET status = 'COMPLETED',
                    completed_at = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (now_str, int(approval["task_id"])),
            )
        conn.commit()
    finally:
        conn.close()

    # Interact with the workflow engine: trigger workflow state transition on approval decision
    wf_result = None
    if norm_dec == "APPROVED":
        trigger_to_fire = approval.get("workflow_trigger_approve")
        wf = get_case_workflow(case_id)
        if wf and wf.get("status") != "COMPLETED":
            avail = wf.get("available_transitions") or []
            matched_trig = None
            if trigger_to_fire and any(t["trigger"].upper() == trigger_to_fire.upper() for t in avail):
                matched_trig = trigger_to_fire
            elif avail:
                matched_trig = avail[0]["trigger"]

            if matched_trig:
                try:
                    wf_result = transition_workflow_state(
                        case_id=case_id,
                        trigger=matched_trig,
                        performed_by=performed_by,
                    )
                except Exception:
                    wf_result = wf
    elif norm_dec == "REJECTED":
        # Place case in REVIEW_REQUIRED when an approval is rejected so HR can intervene
        conn = get_connection()
        try:
            conn.execute(
                """
                UPDATE cases
                SET status = 'REVIEW_REQUIRED',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (case_id,),
            )
            conn.commit()
        finally:
            conn.close()

    updated_approval = get_approval_by_id_or_code(approval["id"])
    log_event(
        entity_type="CASE",
        entity_id=case_id,
        action=f"APPROVAL_{norm_dec}",
        description=f"Approval {updated_approval['approval_code']} {norm_dec} by {performed_by}"
        + (f" — Workflow moved to {wf_result['current_state']}" if wf_result else "")
        + (f" ({comments})" if comments else ""),
        performed_by=performed_by,
        metadata={
            "approval_code": updated_approval["approval_code"],
            "from": "PENDING",
            "to": norm_dec,
            "reason": comments,
            "workflow_state": wf_result.get("current_state") if wf_result else None,
        },
    )
    return {
        "approval": updated_approval,
        "workflow": wf_result or get_case_workflow(case_id),
    }


def list_approvals(
    case_id: Optional[Union[int, str]] = None,
    status: Optional[str] = None,
    approver: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    resolved_case_id = None
    if case_id is not None and str(case_id).strip() != "" and str(case_id).upper() != "ALL":
        c = get_case_by_id_or_number(case_id)
        if c:
            resolved_case_id = c["db_id"]
        elif str(case_id).isdigit():
            resolved_case_id = int(case_id)

    return list_approvals_query(
        case_id=resolved_case_id,
        status=status,
        approver=approver,
        limit=limit,
    )
