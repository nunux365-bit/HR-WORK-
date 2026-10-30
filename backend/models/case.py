"""
HR FLOW — Phase 6.9 & Phase 7.1/7.6/7.21 Case Repository (backend/models/case.py)
Controlled case statuses:
  NEW, REVIEW_REQUIRED, IN_PROGRESS, ON_HOLD, READY, RESOLVED, CLOSED
Controlled SLA states:
  ON_TRACK, DUE_SOON, OVERDUE, COMPLETED
"""

import json
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Union
from backend.database.connection import get_connection

VALID_CASE_STATUSES = {
    "NEW",
    "REVIEW_REQUIRED",
    "IN_PROGRESS",
    "ON_HOLD",
    "READY",
    "RESOLVED",
    "CLOSED",
}

VALID_PRIORITIES = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}


def compute_sla_metrics(
    created_at_str: Optional[str],
    due_at_str: Optional[str],
    sla_hours: int,
    case_status: str,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    due_dt = None
    if due_at_str:
        try:
            due_dt = datetime.fromisoformat(due_at_str.replace("Z", "+00:00"))
            if due_dt.tzinfo is None:
                due_dt = due_dt.replace(tzinfo=timezone.utc)
        except Exception:
            due_dt = None

    if not due_dt:
        due_dt = now + timedelta(hours=int(sla_hours or 48))

    ist_tz = timezone(timedelta(hours=5, minutes=30))
    due_fmt = due_dt.strftime("%Y-%m-%d %H:%M:%S")
    due_disp = due_dt.astimezone(ist_tz).strftime("%d %b %Y, %I:%M %p IST")

    if case_status in ("RESOLVED", "CLOSED", "REJECTED"):
        return {
            "sla_hours": int(sla_hours or 48),
            "created_at": created_at_str,
            "due_at": due_fmt,
            "due_display": due_disp,
            "sla_status": "COMPLETED",
            "remaining_seconds": 0,
            "remaining_display": "Completed" if case_status != "REJECTED" else "Rejected",
            "short_display": "REJECTED" if case_status == "REJECTED" else "COMPLETED",
            "progress_pct": 100,
            "breached": False,
            "due_today": False,
        }

    rem_sec = int((due_dt - now).total_seconds())
    breached = rem_sec < 0
    abs_sec = abs(rem_sec)
    hours_rem = abs_sec // 3600
    mins_rem = (abs_sec % 3600) // 60

    total_sla_sec = max(int(sla_hours or 48) * 3600, 3600)
    if breached:
        sla_status = "OVERDUE"
        disp = f"Overdue by {hours_rem}h {mins_rem}m"
        short_disp = "OVERDUE"
        progress_pct = 100
    elif rem_sec <= 12 * 3600:
        sla_status = "DUE_SOON"
        disp = f"{hours_rem}h {mins_rem}m remaining"
        short_disp = f"{hours_rem}h"
        progress_pct = max(15, min(95, int(((total_sla_sec - rem_sec) / total_sla_sec) * 100)))
    else:
        sla_status = "ON_TRACK"
        disp = f"{hours_rem}h {mins_rem}m remaining"
        short_disp = f"{hours_rem}h"
        progress_pct = max(8, min(85, int(((total_sla_sec - rem_sec) / total_sla_sec) * 100)))

    due_today = (not breached and rem_sec <= 24 * 3600) or (due_dt.date() == now.date())

    return {
        "sla_hours": int(sla_hours or 48),
        "created_at": created_at_str,
        "due_at": due_fmt,
        "due_display": due_disp,
        "sla_status": sla_status,
        "remaining_seconds": rem_sec,
        "remaining_display": disp,
        "short_display": short_disp,
        "progress_pct": progress_pct,
        "breached": breached,
        "due_today": due_today,
    }


def _extract_nested_fields(ext_fields: Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(ext_fields, dict) and isinstance(ext_fields.get("fields"), dict):
        return ext_fields["fields"]
    return ext_fields if isinstance(ext_fields, dict) else {}


def format_case_row(row) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    d = dict(row)
    sla_hours = int(d.get("sla_hours") or 48)
    sla_info = compute_sla_metrics(
        d.get("created_at"),
        d.get("due_at"),
        sla_hours,
        d.get("status", "NEW"),
    )

    try:
        ext_fields = json.loads(d.get("extracted_fields") or "{}")
    except Exception:
        ext_fields = {}

    flat_ext = _extract_nested_fields(ext_fields)

    try:
        val_res = json.loads(d.get("validation_result") or "{}")
    except Exception:
        val_res = {}

    sender_name = (d.get("email_sender_name") or "").strip()
    sender_email = (d.get("email_sender_email") or "").strip()

    # If employee is not linked in DB, extract identity attributes from the email body/subject
    extracted_identity: Dict[str, Any] = {}
    if not d.get("emp_name") and (d.get("email_body") or d.get("description")):
        try:
            from backend.services.employees.employee_extractor import extract_employee_identity
            extracted_identity = extract_employee_identity({
                "subject": d.get("email_subject") or d.get("title") or "",
                "body": d.get("email_body") or d.get("description") or "",
                "sender_name": sender_name,
                "sender_email": sender_email,
            })
        except Exception:
            extracted_identity = {}

    val_checks = (val_res.get("checks") or {}) if isinstance(val_res, dict) else {}
    has_identity_conflict = not bool(val_checks.get("no_identity_conflict", True))

    emp_code = (
        d.get("emp_code")
        or flat_ext.get("employee_id")
        or ext_fields.get("employee_id")
        or extracted_identity.get("employee_id")
    )
    emp_matched = bool(d.get("emp_code")) and not has_identity_conflict
    if emp_matched and isinstance(val_res, dict) and "conflict" in str(val_res.get("summary") or "").lower():
        missing_f = val_res.get("missing_fields") or []
        val_res["summary"] = (
            f"Missing required field(s): {', '.join(missing_f)}"
            if missing_f
            else "All required fields and employee identity verified"
        )

    emp_name = (
        d.get("emp_name")
        or flat_ext.get("employee_name")
        or extracted_identity.get("explicit_name")
        or extracted_identity.get("candidate_name")
        or sender_name
        or (sender_email.split("@")[0] if sender_email else None)
        or "Unverified Sender"
    )
    emp_email = (
        d.get("emp_email")
        or flat_ext.get("email")
        or extracted_identity.get("explicit_email")
        or sender_email
        or ""
    )
    emp_dept = (
        d.get("emp_department")
        or flat_ext.get("department")
        or extracted_identity.get("department")
        or ""
    )
    emp_desig = (
        d.get("emp_designation")
        or flat_ext.get("designation")
        or extracted_identity.get("designation")
        or ""
    )
    emp_loc = (
        d.get("emp_location")
        or flat_ext.get("location")
        or extracted_identity.get("location")
        or ""
    )
    emp_mgr = (
        d.get("emp_manager")
        or flat_ext.get("manager_name")
        or extracted_identity.get("manager_name")
        or ""
    )

    assigned_team = d.get("assigned_team") or d.get("assigned_to") or "HR Operations"
    return {
        "db_id": d["id"],
        "id": d["case_number"],
        "case_id": d["case_number"],
        "case_number": d["case_number"],
        "email_id": d.get("email_id"),
        "employee_db_id": d.get("employee_id"),
        "employee_id": emp_code,
        "employee_code": emp_code,
        "employee_matched": emp_matched,
        "employee_conflict": has_identity_conflict,
        "employee_name": emp_name,
        "employee_email": emp_email,
        "employee_department": emp_dept,
        "department": emp_dept,
        "employee_designation": emp_desig,
        "employee_location": emp_loc,
        "employee_manager": emp_mgr,
        "sender_name": sender_name,
        "sender_email": sender_email,
        "email_subject": d.get("email_subject") or d.get("title") or "",
        "category": d.get("category"),
        "intent": d.get("intent"),
        "title": d.get("title") or d.get("email_subject") or "HR Operational Case",
        "description": d.get("description"),
        "status": d.get("status", "NEW"),
        "priority": d.get("priority", "MEDIUM"),
        "assigned_team": assigned_team,
        "assigned_user": d.get("assigned_user"),
        "assigned_user_email": d.get("assigned_user_email"),
        "assigned_to": d.get("assigned_user") or assigned_team,
        "last_dispatch_status": d.get("last_dispatch_status"),
        "last_dispatched_at": d.get("last_dispatched_at"),
        "sla_hours": sla_hours,
        "due_at": sla_info["due_at"],
        "due_display": sla_info["due_display"],
        "sla_remaining": sla_info["remaining_display"],
        "sla_short": sla_info["short_display"],
        "sla_progress_pct": sla_info["progress_pct"],
        "sla_status": sla_info["sla_status"],
        "sla_state": sla_info["sla_status"],
        "sla_breached": sla_info["breached"],
        "sla_due_today": sla_info["due_today"],
        "workflow_id": d.get("workflow_id"),
        "workflow_state": d.get("workflow_state"),
        "workflow_stages": d.get("workflow_stages"),
        "current_step": d.get("current_step") or 1,
        "forensic_proof": d.get("forensic_proof"),
        "custom_fields": d.get("custom_fields"),
        "draft_reply": d.get("draft_reply"),
        "parent_case_id": d.get("parent_case_id"),
        "merged_into": d.get("merged_into"),
        "linked_cases": d.get("linked_cases"),
        "followers": d.get("followers"),
        "extracted_fields": ext_fields,
        "missing_fields": (val_res.get("missing_fields") if isinstance(val_res, dict) else None) or ext_fields.get("missing_fields") or [],
        "validation": val_res,
        "resolution_type": d.get("resolution_type"),
        "resolution_notes": d.get("resolution_notes"),
        "resolved_by": d.get("resolved_by"),
        "resolved_at": d.get("resolved_at"),
        "closed_by": d.get("closed_by"),
        "reopened_by": d.get("reopened_by"),
        "reopened_at": d.get("reopened_at"),
        "reopen_reason": d.get("reopen_reason"),
        "created_at": d.get("created_at"),
        "updated_at": d.get("updated_at"),
        "closed_at": d.get("closed_at"),
        "feedback_rating": int(d["feedback_rating"]) if d.get("feedback_rating") is not None else None,
        "feedback_comments": d.get("feedback_comments"),
        "feedback_tags": d.get("feedback_tags"),
        "feedback_label": {1: "Poor", 2: "Fair", 3: "Good", 4: "Great", 5: "Excellent"}.get(int(d["feedback_rating"])) if d.get("feedback_rating") is not None else None,
    }


_CASE_SELECT_SQL = """
    SELECT c.*,
           emp.employee_id AS emp_code,
           emp.name AS emp_name,
           emp.email AS emp_email,
           emp.department AS emp_department,
           emp.designation AS emp_designation,
           emp.manager_name AS emp_manager,
           emp.location AS emp_location,
           em.account_email AS account_email,
           em.sender_name AS email_sender_name,
           em.sender_email AS email_sender_email,
           em.subject AS email_subject,
           em.body AS email_body,
           fb.rating AS feedback_rating,
           fb.tags AS feedback_tags,
           fb.comments AS feedback_comments
    FROM cases c
    LEFT JOIN employees emp ON c.employee_id = emp.id
    LEFT JOIN emails em ON c.email_id = em.id
    LEFT JOIN case_feedback fb ON c.id = fb.case_id
"""


def get_case_by_id_or_number(identifier: Union[int, str]) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        if isinstance(identifier, int) or (isinstance(identifier, str) and identifier.isdigit()):
            row = conn.execute(
                f"{_CASE_SELECT_SQL} WHERE c.id = ?",
                (int(identifier),),
            ).fetchone()
            if row:
                return format_case_row(row)

        row = conn.execute(
            f"{_CASE_SELECT_SQL} WHERE UPPER(c.case_number) = UPPER(?)",
            (str(identifier).strip(),),
        ).fetchone()
        return format_case_row(row)
    finally:
        conn.close()


def get_case_by_email_id(email_id: int) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        row = conn.execute(
            f"""
            {_CASE_SELECT_SQL}
            WHERE c.email_id = ?
            ORDER BY c.id DESC
            LIMIT 1
            """,
            (int(email_id),),
        ).fetchone()
        return format_case_row(row)
    finally:
        conn.close()


def list_cases(
    status: Optional[str] = None,
    category: Optional[str] = None,
    intent: Optional[str] = None,
    priority: Optional[str] = None,
    team: Optional[str] = None,
    assigned_user: Optional[str] = None,
    workflow_state: Optional[str] = None,
    sla_filter: Optional[str] = None,
    date_prefix: Optional[str] = None,
    search: Optional[str] = None,
    queue: Optional[str] = None,
    current_user: Optional[str] = None,
    account_email: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    from backend.services.gmail.gmail_client import get_active_account_email
    active_account = None if account_email == "__ALL__" else get_active_account_email(account_email)

    conn = get_connection()
    try:
        clauses: List[str] = []
        params: List[Any] = []

        is_admin_account = False
        if active_account and not account_email:
            urow = conn.execute(
                "SELECT role FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1",
                (active_account,),
            ).fetchone()
            if urow and str(urow["role"] or "").upper() in ("ADMIN", "SUPER_ADMIN"):
                is_admin_account = True

        if active_account and not is_admin_account:
            clauses.append("(LOWER(em.account_email) = LOWER(?) OR em.account_email IS NULL OR c.email_id IS NULL)")
            params.append(active_account)

        if status and status.upper() != "ALL":
            if status.upper() == "OPEN":
                clauses.append("UPPER(c.status) NOT IN ('RESOLVED', 'CLOSED')")
            else:
                clauses.append("UPPER(c.status) = UPPER(?)")
                params.append(status.strip())
        if category and category.upper() != "ALL":
            clauses.append("UPPER(c.category) = UPPER(?)")
            params.append(category.strip())
        if intent and intent.upper() != "ALL":
            clauses.append("UPPER(c.intent) LIKE UPPER(?)")
            params.append(f"%{intent.strip()}%")
        if priority and priority.upper() != "ALL":
            clauses.append("UPPER(c.priority) = UPPER(?)")
            params.append(priority.strip())
        if team and team.upper() != "ALL":
            clauses.append("LOWER(c.assigned_team) = LOWER(?)")
            params.append(team.strip())
        if assigned_user and assigned_user.upper() != "ALL":
            if assigned_user.upper() == "UNASSIGNED":
                clauses.append("(c.assigned_user IS NULL OR c.assigned_user = '')")
            elif any(k in assigned_user.strip().lower() for k in ("admin", "vaibhav", "nunux365@gmail.com")):
                clauses.append("(LOWER(COALESCE(c.assigned_user, '')) LIKE '%vaibhav%' OR LOWER(COALESCE(c.assigned_user, '')) LIKE '%admin%' OR LOWER(COALESCE(c.assigned_user_email, '')) = 'nunux365@gmail.com')")
            else:
                clauses.append("(LOWER(COALESCE(c.assigned_user, '')) LIKE LOWER(?) OR LOWER(COALESCE(c.assigned_user_email, '')) LIKE LOWER(?))")
                params.append(f"%{assigned_user.strip()}%")
                params.append(f"%{assigned_user.strip()}%")
        if workflow_state and workflow_state.upper() != "ALL":
            clauses.append("UPPER(c.workflow_state) = UPPER(?)")
            params.append(workflow_state.strip())
        if date_prefix:
            clauses.append("c.created_at LIKE ?")
            params.append(f"{date_prefix.strip()}%")
        if search and search.strip():
            q = f"%{search.strip().lower()}%"
            clauses.append(
                "("
                "LOWER(c.case_number) LIKE ? OR "
                "LOWER(COALESCE(emp.name, '')) LIKE ? OR "
                "LOWER(COALESCE(emp.employee_id, '')) LIKE ? OR "
                "LOWER(COALESCE(emp.email, '')) LIKE ? OR "
                "LOWER(COALESCE(em.sender_name, '')) LIKE ? OR "
                "LOWER(COALESCE(em.sender_email, '')) LIKE ? OR "
                "LOWER(COALESCE(em.subject, '')) LIKE ? OR "
                "LOWER(COALESCE(c.title, '')) LIKE ? OR "
                "LOWER(COALESCE(c.category, '')) LIKE ? OR "
                "LOWER(COALESCE(c.intent, '')) LIKE ? OR "
                "LOWER(COALESCE(c.assigned_team, '')) LIKE ? OR "
                "LOWER(COALESCE(c.assigned_user, '')) LIKE ? OR "
                "LOWER(COALESCE(c.extracted_fields, '')) LIKE ?"
                ")"
            )
            params.extend([q, q, q, q, q, q, q, q, q, q, q, q, q])

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(int(limit))
        rows = conn.execute(
            f"""
            {_CASE_SELECT_SQL}
            {where_sql}
            ORDER BY c.id DESC
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()

        formatted = [format_case_row(r) for r in rows if r]

        # Queue filter (My Queue vs All Cases vs Team Queue)
        if queue and queue.lower() == "my" and current_user:
            u_low = current_user.strip().lower()
            is_admin_alias = u_low in ("admin", "vaibhav", "vaibhav (hr)")
            my_filtered = [
                c for c in formatted
                if (
                    c.get("assigned_user")
                    and (
                        u_low in c["assigned_user"].lower()
                        or (is_admin_alias and ("vaibhav" in c["assigned_user"].lower() or "admin" in c["assigned_user"].lower()))
                    )
                )
                or not c.get("assigned_user")
            ]
            formatted = my_filtered

        # SLA filter (All, Due Today, Due Soon, Overdue, Completed)
        if sla_filter and sla_filter.upper() != "ALL":
            sf = sla_filter.upper().replace(" ", "_")
            if sf == "DUE_TODAY":
                formatted = [c for c in formatted if c.get("sla_due_today") and c.get("sla_status") != "COMPLETED"]
            elif sf == "DUE_SOON":
                formatted = [c for c in formatted if c.get("sla_status") == "DUE_SOON"]
            elif sf in ("OVERDUE", "BREACHED"):
                formatted = [c for c in formatted if c.get("sla_status") == "OVERDUE" or c.get("sla_breached")]
            elif sf == "COMPLETED":
                formatted = [c for c in formatted if c.get("sla_status") == "COMPLETED"]
            elif sf == "ON_TRACK":
                formatted = [c for c in formatted if c.get("sla_status") == "ON_TRACK"]

        return formatted
    finally:
        conn.close()


def save_case_field_values(case_id: Optional[int], email_id: int, field_checks: List[Dict[str, Any]]) -> None:
    conn = get_connection()
    try:
        conn.execute("DELETE FROM case_field_values WHERE email_id = ?", (int(email_id),))
        for fc in field_checks or []:
            conn.execute(
                """
                INSERT INTO case_field_values (
                    case_id,
                    email_id,
                    field_name,
                    field_value,
                    is_valid
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    int(case_id) if case_id else None,
                    int(email_id),
                    str(fc.get("field")),
                    str(fc.get("value")) if fc.get("value") is not None else None,
                    1 if fc.get("valid") else 0,
                ),
            )
        conn.commit()
    finally:
        conn.close()
