"""
HR FLOW — Phase 7.9 & 7.10 Task Repository (backend/models/task.py)
Task states:
  PENDING, IN_PROGRESS, COMPLETED, CANCELLED
"""

from typing import Dict, Any, List, Optional, Union
from backend.database.connection import get_connection

VALID_TASK_STATUSES = {"OPEN", "PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"}
VALID_TASK_TYPES = {
    "HR_REVIEW",
    "DOCUMENT_COLLECTION",
    "BGV_VERIFICATION",
    "EXIT_PROCESSING",
    "PAYROLL_CHECK",
    "ATTENDANCE_VERIFICATION",
    "LEAVE_VERIFICATION",
    "IT_ASSET_CHECK",
    "GENERAL",
}


def format_task_row(row) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    d = dict(row)
    tid = int(d["id"])
    return {
        "id": tid,
        "task_id": f"TASK-{tid:04d}",
        "case_db_id": d["case_id"],
        "case_id": d.get("case_number") or str(d["case_id"]),
        "case_number": d.get("case_number") or f"CASE-{int(d['case_id']):06d}",
        "case_title": d.get("case_title"),
        "case_category": d.get("case_category"),
        "employee_name": d.get("emp_name"),
        "employee_id": d.get("emp_code"),
        "title": d["title"],
        "task_type": d.get("task_type") or "HR_REVIEW",
        "description": d.get("description"),
        "status": d.get("status", "PENDING"),
        "priority": d.get("priority", "MEDIUM"),
        "assigned_to": d.get("assigned_to"),
        "assigned_team": d.get("assigned_team") or d.get("case_team") or "HR Operations",
        "created_by": d.get("created_by") or "hr_admin",
        "due_at": d.get("due_at"),
        "completed_at": d.get("completed_at"),
        "created_at": d.get("created_at"),
        "updated_at": d.get("updated_at"),
    }


_TASK_SELECT_SQL = """
    SELECT t.*,
           c.case_number AS case_number,
           c.title AS case_title,
           c.category AS case_category,
           c.assigned_team AS case_team,
           emp.name AS emp_name,
           emp.employee_id AS emp_code
    FROM tasks t
    LEFT JOIN cases c ON t.case_id = c.id
    LEFT JOIN employees emp ON c.employee_id = emp.id
"""


def get_task_by_id(task_id: Union[int, str]) -> Optional[Dict[str, Any]]:
    raw = str(task_id).strip().upper()
    if raw.startswith("TASK-"):
        raw = raw.replace("TASK-", "")
    if not raw.isdigit():
        return None
    conn = get_connection()
    try:
        row = conn.execute(
            f"{_TASK_SELECT_SQL} WHERE t.id = ?",
            (int(raw),),
        ).fetchone()
        return format_task_row(row)
    finally:
        conn.close()


def list_tasks_query(
    case_id: Optional[int] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    team: Optional[str] = None,
    assigned_to: Optional[str] = None,
    due_date: Optional[str] = None,
    view: Optional[str] = None,
    current_user: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        clauses: List[str] = []
        params: List[Any] = []

        if case_id is not None:
            clauses.append("t.case_id = ?")
            params.append(int(case_id))
        if status and status.upper() != "ALL":
            if status.strip().upper() == "OPEN":
                clauses.append("UPPER(t.status) IN ('OPEN', 'PENDING', 'IN_PROGRESS')")
            elif status.strip().upper() == "PENDING":
                clauses.append("UPPER(t.status) IN ('OPEN', 'PENDING')")
            else:
                clauses.append("UPPER(t.status) = UPPER(?)")
                params.append(status.strip())
        if priority and priority.upper() != "ALL":
            clauses.append("UPPER(t.priority) = UPPER(?)")
            params.append(priority.strip())
        if team and team.upper() != "ALL":
            clauses.append("LOWER(COALESCE(t.assigned_team, c.assigned_team, '')) = LOWER(?)")
            params.append(team.strip())
        if assigned_to and assigned_to.upper() != "ALL":
            clauses.append(
                "(LOWER(COALESCE(t.assigned_to, '')) LIKE LOWER(?) "
                "OR LOWER(COALESCE(c.assigned_user, '')) LIKE LOWER(?) "
                "OR LOWER(COALESCE(c.assigned_user_email, '')) LIKE LOWER(?))"
            )
            q_assignee = f"%{assigned_to.strip()}%"
            params.extend([q_assignee, q_assignee, q_assignee])
        if due_date:
            clauses.append("t.due_at LIKE ?")
            params.append(f"{due_date.strip()}%")

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(int(limit))
        rows = conn.execute(
            f"""
            {_TASK_SELECT_SQL}
            {where_sql}
            ORDER BY t.id DESC
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()

        tasks = [format_task_row(r) for r in rows if r]
        if view and view.lower() == "my" and current_user:
            u_low = current_user.strip().lower()
            tasks = [
                t for t in tasks
                if (t.get("assigned_to") and u_low in t["assigned_to"].lower())
                or not t.get("assigned_to")
            ]
        return tasks
    finally:
        conn.close()
