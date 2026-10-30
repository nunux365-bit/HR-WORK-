"""
HR FLOW — Phase 7.9 & 7.10 Task Management Service (backend/services/tasks/task_service.py)
Provides task creation, assignment, status transitions (PENDING, IN_PROGRESS, COMPLETED, CANCELLED),
and links tasks to parent cases and audit logs.
"""

from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Union
from backend.database.connection import get_connection
from backend.models.case import get_case_by_id_or_number
from backend.models.task import (
    VALID_TASK_STATUSES,
    get_task_by_id,
    list_tasks_query,
)
from backend.services.audit.audit_service import log_event


def create_task(
    case_identifier: Union[int, str],
    title: str,
    task_type: str = "HR_REVIEW",
    description: Optional[str] = None,
    assigned_to: Optional[str] = None,
    assigned_team: Optional[str] = None,
    priority: str = "MEDIUM",
    due_at: Optional[str] = None,
    performed_by: str = "hr_admin",
) -> Dict[str, Any]:
    case = get_case_by_id_or_number(case_identifier)
    if not case:
        raise ValueError(f"Case '{case_identifier}' not found.")

    clean_title = (title or "").strip()
    if not clean_title:
        raise ValueError("Task title is required.")

    norm_prio = (priority or case.get("priority") or "MEDIUM").strip().upper()
    team_val = (assigned_team or case.get("assigned_team") or "HR Operations").strip()
    assignee_val = (assigned_to or case.get("assigned_user") or "Vaibhav (HR)").strip()
    due_val = due_at or case.get("due_at") or (datetime.now(timezone.utc) + timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
    norm_type = (task_type or "HR_REVIEW").strip().upper()

    conn = get_connection()
    try:
        cur = conn.execute(
            """
            INSERT INTO tasks (
                case_id,
                title,
                task_type,
                description,
                status,
                priority,
                assigned_to,
                assigned_team,
                created_by,
                due_at
            ) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)
            """,
            (
                case["db_id"],
                clean_title,
                norm_type,
                description or f"{norm_type.replace('_', ' ').title()} for {case['case_number']}",
                norm_prio,
                assignee_val,
                team_val,
                performed_by,
                due_val,
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
                recipient_user
            ) VALUES ('TASK_ASSIGNED', ?, ?, ?, ?, ?)
            """,
            (
                f"Task Assigned: {clean_title}",
                f"Task TASK-{new_id:04d} ({clean_title}) created on {case['case_number']} and assigned to {assignee_val}.",
                case["db_id"],
                case["case_number"],
                assignee_val,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    task_obj = get_task_by_id(new_id)
    log_event(
        entity_type="CASE",
        entity_id=case["db_id"],
        action="TASK_CREATED",
        description=f"Task created → {task_obj['task_id']}: {clean_title} (Assigned to {assignee_val})",
        performed_by=performed_by,
        metadata={"task": task_obj},
    )
    return task_obj


def update_task(
    task_id: Union[int, str],
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    assigned_team: Optional[str] = None,
    priority: Optional[str] = None,
    due_at: Optional[str] = None,
    performed_by: str = "hr_admin",
    note: Optional[str] = None,
) -> Dict[str, Any]:
    task = get_task_by_id(task_id)
    if not task:
        raise ValueError(f"Task '{task_id}' not found.")

    new_status = (status or task["status"]).strip().upper()
    if new_status not in VALID_TASK_STATUSES:
        raise ValueError(f"Invalid task status '{status}'. Allowed: {sorted(VALID_TASK_STATUSES)}")

    new_assignee = assigned_to.strip() if assigned_to is not None else task["assigned_to"]
    new_team = assigned_team.strip() if assigned_team is not None else task["assigned_team"]
    new_prio = priority.strip().upper() if priority is not None else task["priority"]
    new_due = due_at if due_at is not None else task["due_at"]

    completed_at = task.get("completed_at")
    if new_status == "COMPLETED" and not completed_at:
        completed_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    elif new_status != "COMPLETED":
        completed_at = None

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE tasks
            SET status = ?,
                assigned_to = ?,
                assigned_team = ?,
                priority = ?,
                due_at = ?,
                completed_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                new_status,
                new_assignee,
                new_team,
                new_prio,
                new_due,
                completed_at,
                task["id"],
            ),
        )
        conn.commit()
    finally:
        conn.close()

    updated = get_task_by_id(task["id"])
    action_code = f"TASK_{new_status}" if status else "TASK_UPDATED"
    desc = f"Task {updated['task_id']} ({updated['title']}) → {new_status}"
    if note:
        desc += f" ({note})"

    log_event(
        entity_type="CASE",
        entity_id=task["case_db_id"],
        action=action_code,
        description=desc,
        performed_by=performed_by,
        metadata={
            "task_id": updated["task_id"],
            "from": task["status"],
            "to": new_status,
            "assigned_to": new_assignee,
            "reason": note,
        },
    )
    return updated


def complete_task(task_id: Union[int, str], performed_by: str = "hr_admin", note: Optional[str] = None) -> Dict[str, Any]:
    return update_task(task_id=task_id, status="COMPLETED", performed_by=performed_by, note=note)


def cancel_task(task_id: Union[int, str], performed_by: str = "hr_admin", reason: Optional[str] = None) -> Dict[str, Any]:
    return update_task(task_id=task_id, status="CANCELLED", performed_by=performed_by, note=reason or "Cancelled by HR")


def list_tasks(
    case_id: Optional[Union[int, str]] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    team: Optional[str] = None,
    assigned_to: Optional[str] = None,
    due_date: Optional[str] = None,
    view: Optional[str] = None,
    current_user: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    resolved_case_id = None
    if case_id is not None and str(case_id).strip() != "" and str(case_id).upper() != "ALL":
        c = get_case_by_id_or_number(case_id)
        if c:
            resolved_case_id = c["db_id"]
        elif str(case_id).isdigit():
            resolved_case_id = int(case_id)

    return list_tasks_query(
        case_id=resolved_case_id,
        status=status,
        priority=priority,
        team=team,
        assigned_to=assigned_to,
        due_date=due_date,
        view=view,
        current_user=current_user,
        limit=limit,
    )
