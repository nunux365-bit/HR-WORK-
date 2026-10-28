"""
HR FLOW — Phase 7.11 Approval Repository (backend/models/approval.py)
Approval states:
  PENDING, APPROVED, REJECTED, CANCELLED
"""

import re
from typing import Dict, Any, List, Optional, Union
from backend.database.connection import get_connection

VALID_APPROVAL_STATUSES = {"PENDING", "APPROVED", "REJECTED", "CANCELLED"}


def generate_next_approval_code() -> str:
    conn = get_connection()
    try:
        rows = conn.execute("SELECT approval_code FROM approvals ORDER BY id DESC LIMIT 50").fetchall()
        max_num = 0
        for r in rows:
            code = r["approval_code"] or ""
            m = re.search(r"(\d+)$", code)
            if m:
                val = int(m.group(1))
                if val > max_num:
                    max_num = val
        return f"APR-{max_num + 1:04d}"
    finally:
        conn.close()


def format_approval_row(row) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    d = dict(row)
    return {
        "id": d["id"],
        "approval_id": d["approval_code"],
        "approval_code": d["approval_code"],
        "case_db_id": d["case_id"],
        "case_id": d.get("case_number") or f"CASE-{int(d['case_id']):06d}",
        "case_number": d.get("case_number") or f"CASE-{int(d['case_id']):06d}",
        "case_title": d.get("case_title"),
        "case_category": d.get("case_category"),
        "employee_name": d.get("emp_name"),
        "employee_id": d.get("emp_code"),
        "task_id": d.get("task_id"),
        "approval_type": d.get("approval_type", "MANAGER_APPROVAL"),
        "approver": d.get("approver"),
        "approver_role": d.get("approver_role", "HR_MANAGER"),
        "status": d.get("status", "PENDING"),
        "workflow_trigger_approve": d.get("workflow_trigger_approve"),
        "workflow_trigger_reject": d.get("workflow_trigger_reject"),
        "requested_by": d.get("requested_by", "hr_admin"),
        "requested_at": d.get("requested_at"),
        "decision_at": d.get("decision_at"),
        "decision_by": d.get("decision_by"),
        "comments": d.get("comments"),
    }


_APPROVAL_SELECT_SQL = """
    SELECT a.*,
           c.case_number AS case_number,
           c.title AS case_title,
           c.category AS case_category,
           emp.name AS emp_name,
           emp.employee_id AS emp_code
    FROM approvals a
    LEFT JOIN cases c ON a.case_id = c.id
    LEFT JOIN employees emp ON c.employee_id = emp.id
"""


def get_approval_by_id_or_code(identifier: Union[int, str]) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        if isinstance(identifier, int) or (isinstance(identifier, str) and identifier.isdigit()):
            row = conn.execute(
                f"{_APPROVAL_SELECT_SQL} WHERE a.id = ?",
                (int(identifier),),
            ).fetchone()
            if row:
                return format_approval_row(row)

        row = conn.execute(
            f"{_APPROVAL_SELECT_SQL} WHERE UPPER(a.approval_code) = UPPER(?)",
            (str(identifier).strip(),),
        ).fetchone()
        return format_approval_row(row)
    finally:
        conn.close()


def list_approvals_query(
    case_id: Optional[int] = None,
    status: Optional[str] = None,
    approver: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        clauses: List[str] = []
        params: List[Any] = []
        if case_id is not None:
            clauses.append("a.case_id = ?")
            params.append(int(case_id))
        if status and status.upper() != "ALL":
            clauses.append("UPPER(a.status) = UPPER(?)")
            params.append(status.strip())
        if approver and approver.upper() != "ALL":
            clauses.append("LOWER(a.approver) LIKE LOWER(?)")
            params.append(f"%{approver.strip()}%")

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(int(limit))
        rows = conn.execute(
            f"""
            {_APPROVAL_SELECT_SQL}
            {where_sql}
            ORDER BY a.id DESC
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()
        return [format_approval_row(r) for r in rows if r]
    finally:
        conn.close()
