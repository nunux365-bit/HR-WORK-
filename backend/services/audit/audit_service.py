"""
HR FLOW — Phase 6.16 & Phase 7.17 / 7.25 Audit Trail Service (backend/services/audit/audit_service.py)
Records and retrieves immutable audit events for Emails, Cases, Workflows, Tasks, Approvals, and Employees.
"""

from typing import Dict, Any, List, Optional, Union
from backend.models.audit_log import create_audit_log, list_audit_logs, _format_audit_row
from backend.database.connection import get_connection


def log_event(
    entity_type: str,
    entity_id: Union[str, int],
    action: str,
    description: str,
    performed_by: str = "system",
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return create_audit_log(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        description=description,
        performed_by=performed_by,
        metadata=metadata,
    )


def get_email_and_case_activity(
    email_id: Optional[int] = None,
    case_id: Optional[int] = None,
    case_number: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Return chronological audit trail combining EMAIL events and linked CASE / WORKFLOW / TASK / APPROVAL events.
    Filters out orphaned history from previously deleted cases that reused the same case_number,
    and deduplicates consecutive identical (action, description) events.
    """
    conn = get_connection()
    try:
        conditions: List[str] = []
        params: List[Any] = []

        if email_id is not None:
            conditions.append("(entity_type = 'EMAIL' AND entity_id = ?)")
            params.append(str(email_id))

        case_min_created_at: Optional[str] = None
        if case_id is not None:
            crow = conn.execute(
                "SELECT created_at, case_number FROM cases WHERE id = ?",
                (int(case_id),),
            ).fetchone()
            if crow:
                case_min_created_at = crow["created_at"]
                if not case_number and crow["case_number"]:
                    case_number = crow["case_number"]

            conditions.append("(entity_type IN ('CASE', 'WORKFLOW', 'TASK', 'APPROVAL') AND entity_id = ?)")
            params.append(str(case_id))

            # Also include TASK and APPROVAL audit events whose entity_id is a task.id or approval.id belonging to case_id
            conditions.append(
                "(entity_type = 'TASK' AND entity_id IN (SELECT CAST(id AS TEXT) FROM tasks WHERE case_id = ?))"
            )
            params.append(int(case_id))
            conditions.append(
                "(entity_type = 'APPROVAL' AND entity_id IN (SELECT CAST(id AS TEXT) FROM approvals WHERE case_id = ?))"
            )
            params.append(int(case_id))

        if case_number:
            if case_min_created_at:
                conditions.append(
                    "(entity_type IN ('CASE', 'WORKFLOW', 'TASK', 'APPROVAL') AND entity_id = ? AND created_at >= ?)"
                )
                params.extend([str(case_number), case_min_created_at])
            else:
                conditions.append("(entity_type IN ('CASE', 'WORKFLOW', 'TASK', 'APPROVAL') AND entity_id = ?)")
                params.append(str(case_number))

        if not conditions:
            return list_audit_logs(limit=50)

        where_sql = " OR ".join(conditions)
        rows = conn.execute(
            f"""
            SELECT * FROM audit_logs
            WHERE {where_sql}
            ORDER BY id ASC
            """,
            tuple(params),
        ).fetchall()

        formatted_list: List[Dict[str, Any]] = []
        seen_emp_match_key: Optional[tuple] = None
        prev_sig: Optional[tuple] = None

        for r in rows:
            item = _format_audit_row(r)
            action = item.get("action") or ""
            desc = item.get("description") or ""
            ent_type = item.get("entity_type") or ""
            ent_id = item.get("entity_id") or ""

            # Collapse repeated identical employee identification logs on the same email
            if action in ("EMPLOYEE_MATCHED", "EMPLOYEE_NOT_FOUND", "EMPLOYEE_REVIEW_REQUIRED"):
                emp_key = (ent_type, ent_id, action, desc)
                if seen_emp_match_key == emp_key:
                    continue
                seen_emp_match_key = emp_key

            # Collapse consecutive identical events
            sig = (ent_type, ent_id, action, desc, item.get("from_value"), item.get("to_value"))
            if prev_sig == sig:
                continue
            prev_sig = sig

            formatted_list.append(item)

        return formatted_list
    finally:
        conn.close()

