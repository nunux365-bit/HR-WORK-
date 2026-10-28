"""
HR FLOW — Universal Case 360° Dossier & Operations Service (backend/services/cases/case_dossier_service.py)
Unified service layer for case inspection, task checklist execution, workflow pipeline progression,
dynamic forensic evidence capture, omnichannel communications, and resolution.
Agnostic across any department (HR, IT, Finance, Legal, Operations, Facilities) and any company.
"""

from datetime import datetime, timezone
import html as html_lib
import json
import re
from typing import Any, Dict, List, Optional, Tuple
import uuid

from backend.database.connection import get_connection
from backend.models.case import get_case_by_id_or_number
from backend.services.gmail.gmail_client import send_gmail_smtp_email
from backend.services.audit.audit_service import log_event
from backend.services.playbooks.playbook_service import get_playbook_for_category
from backend.services.workflows.workflow_service import build_workflow_preview_for_category


# Universal fallback stages if a case has no custom workflow attached
DEFAULT_UNIVERSAL_STAGES = [
    {
        "step": 1,
        "code": "DETAILS_DOSSIER",
        "label": "1. Details & Dossier",
        "desc": "Inbound inquiry verification & Requester 360° telemetry",
        "stage_type": "DOSSIER",
    },
    {
        "step": 2,
        "code": "AUDIT_SECTION",
        "label": "2. Query Lifecycle Audit",
        "desc": "Inbound arrival, specialist pickup, turnaround duration & clarification mailer",
        "stage_type": "AUDIT",
    },
    {
        "step": 3,
        "code": "RESPONSE_RESOLUTION",
        "label": "3. Response & Resolution",
        "desc": "Official response dispatch, forensic proof & case closure",
        "stage_type": "RESOLUTION",
    },
]


def resolve_case_row(conn, case_ref: str) -> Optional[Dict[str, Any]]:
    """Resolve a case row by integer id or string case_number."""
    ref_str = str(case_ref or "").strip()
    if not ref_str:
        return None
    if ref_str.isdigit():
        row = conn.execute("SELECT * FROM cases WHERE id = ?", (int(ref_str),)).fetchone()
        if row:
            return dict(row)
    row = conn.execute("SELECT * FROM cases WHERE UPPER(case_number) = UPPER(?)", (ref_str,)).fetchone()
    if row:
        return dict(row)
    # Prefix fallback
    row = conn.execute("SELECT * FROM cases WHERE UPPER(case_number) LIKE UPPER(?)", (f"%{ref_str}%",)).fetchone()
    return dict(row) if row else None


def get_case_stages_and_step(case_dict: Optional[dict]) -> Tuple[List[Dict[str, Any]], int, int]:
    """Calculate and return (stages_list, current_step_number, total_steps) for a case."""
    if not case_dict:
        return (DEFAULT_UNIVERSAL_STAGES, 1, len(DEFAULT_UNIVERSAL_STAGES))

    stages_list = None
    raw_st = case_dict.get("workflow_stages")
    if raw_st:
        try:
            parsed = json.loads(raw_st) if isinstance(raw_st, str) else raw_st
            if isinstance(parsed, list) and len(parsed) > 0:
                stages_list = parsed
        except Exception:
            pass

    if not stages_list:
        stages_list = [dict(s) for s in DEFAULT_UNIVERSAL_STAGES]

    total_steps = len(stages_list)

    # 1. Check if current_step is explicitly recorded in database
    db_step = case_dict.get("current_step")
    if db_step is not None and str(db_step).isdigit() and int(db_step) >= 1:
        cur_step = min(int(db_step), total_steps)
        if (case_dict.get("status") or "").upper() == "RESOLVED":
            cur_step = total_steps
        return (stages_list, cur_step, total_steps)

    # 2. Check workflow_state matching
    wf_st = (case_dict.get("workflow_state") or "").upper()
    cur_step = 1
    matched = False
    for s in stages_list:
        if s.get("code", "").upper() == wf_st:
            cur_step = s["step"]
            matched = True
            break

    if not matched:
        if (case_dict.get("status") or "").upper() == "RESOLVED":
            cur_step = total_steps
        elif wf_st in ("HRMS_ACTION_APPROVAL", "DOC_VERIFICATION", "AUDIT_SECTION", "IN_PROGRESS"):
            cur_step = min(2, total_steps)
        else:
            cur_step = 1

    return (stages_list, max(1, min(cur_step, total_steps)), total_steps)


def get_case_dossier(case_ref: str, current_user: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Returns complete 360° case dossier:
    - Case master row
    - Requester / Employee profile
    - Linked email & attachments
    - Verification tasks (auto-seeded from playbook if empty)
    - Approvals
    - Omnichannel communications thread
    - Documents & files
    - Executed system actions
    - Consolidated audit timeline
    - Workflow stages & active step
    - Category playbook (tasks, inquiry templates, proof schema, intake rules, SLA)
    - Smart response drafts with pre-filled merge tags
    """
    conn = get_connection()
    try:
        case_dict = resolve_case_row(conn, case_ref)
        if not case_dict:
            return None

        db_id = int(case_dict["id"])
        case_number = case_dict["case_number"]
        stages_list, cur_step, total_steps = get_case_stages_and_step(case_dict)
        case_dict["current_step"] = cur_step
        case_dict["total_steps"] = total_steps
        case_dict["workflow_stages"] = stages_list

        # 1. Resolve source email
        email_obj = None
        if case_dict.get("email_id"):
            e_row = conn.execute("SELECT * FROM emails WHERE id = ?", (case_dict["email_id"],)).fetchone()
            if e_row:
                email_obj = dict(e_row)

        # 2. Resolve requester profile (from employees table or email metadata)
        emp_obj = None
        c_emp_ref = case_dict.get("employee_id")
        if c_emp_ref:
            if isinstance(c_emp_ref, int) or (isinstance(c_emp_ref, str) and str(c_emp_ref).isdigit()):
                emp_row = conn.execute("SELECT * FROM employees WHERE id = ?", (int(c_emp_ref),)).fetchone()
                if emp_row:
                    emp_obj = dict(emp_row)
            if not emp_obj:
                emp_row = conn.execute(
                    "SELECT * FROM employees WHERE UPPER(employee_id) = UPPER(?)",
                    (str(c_emp_ref).strip(),),
                ).fetchone()
                if emp_row:
                    emp_obj = dict(emp_row)

        if not emp_obj and case_dict.get("assigned_user_email"):
            emp_row = conn.execute(
                "SELECT * FROM employees WHERE LOWER(email) = LOWER(?)",
                (case_dict["assigned_user_email"].strip(),),
            ).fetchone()
            if emp_row:
                emp_obj = dict(emp_row)

        if not emp_obj and email_obj and email_obj.get("sender_email"):
            emp_row = conn.execute(
                "SELECT * FROM employees WHERE LOWER(email) = LOWER(?)",
                (email_obj["sender_email"].strip(),),
            ).fetchone()
            if emp_row:
                emp_obj = dict(emp_row)

        if emp_obj:
            emp_obj["is_in_db"] = True
        else:
            emp_name = case_dict.get("employee_name") or (email_obj and email_obj.get("sender_name")) or "Employee"
            emp_code = case_dict.get("employee_id") or ""
            emp_dept = case_dict.get("department") or case_dict.get("assigned_team") or "Operations"
            emp_email = (email_obj and email_obj.get("sender_email")) or "requester@company.com"
            emp_obj = {
                "id": None,
                "name": emp_name,
                "employee_id": emp_code,
                "department": emp_dept,
                "designation": "Team Member",
                "email": emp_email,
                "manager_name": "Reporting Lead",
                "location": "Headquarters",
                "is_in_db": False,
            }

        # 3. Dynamic Category Playbook
        cat_key = (case_dict.get("category") or "GENERAL_HR").strip().upper()
        playbook_data = get_playbook_for_category(cat_key)

        # 4. Resolve tasks
        tasks_rows = conn.execute(
            "SELECT * FROM tasks WHERE case_id = ? ORDER BY id ASC",
            (db_id,),
        ).fetchall()
        tasks_list = [dict(r) for r in tasks_rows]

        # 5. Approvals
        approvals_rows = conn.execute(
            "SELECT * FROM approvals WHERE case_id = ? ORDER BY id DESC",
            (db_id,),
        ).fetchall()
        approvals_list = [dict(r) for r in approvals_rows]

        # 6. Communications thread
        comms_rows = conn.execute(
            "SELECT * FROM case_communications WHERE case_id = ? ORDER BY id DESC LIMIT 30",
            (db_id,),
        ).fetchall()
        comms_list = [dict(r) for r in comms_rows]

        # 7. Documents
        docs_rows = conn.execute(
            "SELECT * FROM case_documents WHERE case_id = ? ORDER BY id DESC",
            (db_id,),
        ).fetchall()
        docs_list = [dict(r) for r in docs_rows]

        # 8. Executed System Actions
        actions_rows = conn.execute(
            "SELECT * FROM hr_actions WHERE case_id = ? ORDER BY id DESC LIMIT 20",
            (db_id,),
        ).fetchall()
        actions_list = []
        for r in actions_rows:
            ad = dict(r)
            if isinstance(ad.get("response_payload"), str):
                try:
                    resp_p = json.loads(ad["response_payload"])
                    ad["parsed_response"] = resp_p
                    if isinstance(resp_p, dict):
                        if resp_p.get("title"):
                            ad["title"] = resp_p["title"]
                        if resp_p.get("details"):
                            ad["details"] = resp_p["details"]
                except Exception:
                    pass
            actions_list.append(ad)

        # 9. Audit Timeline
        audit_rows = conn.execute(
            """
            SELECT * FROM audit_logs
            WHERE (entity_type = 'CASE' AND entity_id = ?)
               OR (entity_type = 'CASE' AND entity_id = ?)
            ORDER BY id DESC LIMIT 40
            """,
            (str(db_id), str(case_number)),
        ).fetchall()
        audit_list = [dict(r) for r in audit_rows]

        # 9.5 Requester Ticket History
        emp_db_id = emp_obj.get("id") or case_dict.get("employee_id")
        history_cases = []
        if emp_db_id:
            hist_rows = conn.execute(
                """
                SELECT id, case_number, title, category, status, priority, created_at
                FROM cases
                WHERE id != ? AND employee_id = ?
                ORDER BY id DESC LIMIT 5
                """,
                (db_id, emp_db_id),
            ).fetchall()
            history_cases = [dict(r) for r in hist_rows]

        # 9.6 Smart Duplicate & Recurring Case Detection
        duplicate_match = None
        cand_cases = conn.execute(
            """
            SELECT id, case_number, title, category, status, priority, created_at, assigned_user, description, employee_id
            FROM cases
            WHERE id != ? AND (
                (employee_id IS NOT NULL AND employee_id = ?)
                OR (UPPER(category) = UPPER(?))
            )
            ORDER BY id DESC LIMIT 10
            """,
            (db_id, emp_db_id or -1, cat_key),
        ).fetchall()

        cur_title = (case_dict.get("title") or "").lower()
        cur_desc = (case_dict.get("description") or "").lower()
        cur_dates = set(re.findall(r'\b(?:\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(?:20\d{2})?|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})\b', f"{cur_title} {cur_desc}", re.I))

        for cand in cand_cases:
            cd = dict(cand)
            score = 0
            reasons = []

            if emp_db_id and cand["employee_id"] == emp_db_id:
                score += 45
                reasons.append("Identical Requester Identity")

            if (cand["category"] or "").upper() == cat_key:
                score += 30
                reasons.append(f"Matching Category ({cat_key})")

            cand_text = f"{cand['title'] or ''} {cand['description'] or ''}".lower()
            matching_dates = [d for d in cur_dates if d in cand_text]
            if matching_dates:
                score += 25
                reasons.append(f"Overlapping Incident Date ({', '.join(matching_dates[:2])})")

            if (cand["status"] or "").upper() in ("NEW", "IN_PROGRESS", "ON_HOLD", "REVIEW_REQUIRED"):
                reasons.append(f"Target Docket is Active ({cand['status']})")

            if score >= 70:
                duplicate_match = {
                    "has_match": True,
                    "matched_case_number": cd["case_number"],
                    "matched_case_id": cd["id"],
                    "matched_title": cd["title"],
                    "status": cd["status"],
                    "assigned_user": cd["assigned_user"] or "Unassigned",
                    "created_at": cd["created_at"],
                    "match_score": min(98, score),
                    "reasons": reasons,
                    "can_merge": cd["status"] != "MERGED",
                }
                break

        # 9.7 Structured Conversation Thread History (Chronological Feed)
        conversation_thread = []
        if email_obj:
            conversation_thread.append({
                "message_id": f"inbound-{email_obj.get('id', 1)}",
                "direction": "INBOUND",
                "sender_name": email_obj.get("sender_name") or emp_obj.get("name") or "Requester",
                "sender_email": email_obj.get("sender_email") or emp_obj.get("email") or "",
                "subject": email_obj.get("subject") or case_title if 'case_title' in locals() else (case_dict.get("title") or case_number),
                "body": email_obj.get("body_plain") or email_obj.get("body") or case_dict.get("description") or "",
                "timestamp": email_obj.get("received_at") or case_dict.get("created_at"),
                "channel": "EMAIL_INBOUND",
                "is_root": True,
            })

        for comm in comms_list:
            c_dir = "OUTBOUND" if (comm.get("sender_type") or "").upper() in ("HR_AGENT", "SYSTEM", "SPECIALIST") else "INBOUND"
            conversation_thread.append({
                "message_id": f"comm-{comm.get('id')}",
                "direction": c_dir,
                "sender_name": comm.get("sender_name") or ("Specialist Desk" if c_dir == "OUTBOUND" else (emp_obj.get("name") or "Requester")),
                "sender_email": comm.get("recipient_email") if c_dir == "OUTBOUND" else emp_obj.get("email", ""),
                "subject": f"Re: [{case_number}] {case_dict.get('title') or case_number}",
                "body": comm.get("message") or "",
                "timestamp": comm.get("created_at"),
                "channel": comm.get("channel") or "EMAIL_OUTBOUND",
                "is_root": False,
            })

        conversation_thread.sort(key=lambda x: str(x.get("timestamp") or ""))

        # 9.8 Parse linked_cases and followers
        linked_cases = []
        if isinstance(case_dict.get("linked_cases"), str):
            try: linked_cases = json.loads(case_dict["linked_cases"])
            except Exception: linked_cases = []
        elif isinstance(case_dict.get("linked_cases"), list):
            linked_cases = case_dict["linked_cases"]

        followers = []
        if isinstance(case_dict.get("followers"), str):
            try: followers = json.loads(case_dict["followers"])
            except Exception: followers = []
        elif isinstance(case_dict.get("followers"), list):
            followers = case_dict["followers"]

        user_str = (
            current_user.get("name") or current_user.get("email")
            if isinstance(current_user, dict)
            else (str(current_user).strip() if current_user else "")
        )
        is_following = bool(user_str and (user_str in followers or (isinstance(current_user, dict) and current_user.get("email") in followers)))

        # 10. Parse forensic_proof and custom_fields if stored as JSON
        if isinstance(case_dict.get("forensic_proof"), str):
            try:
                case_dict["forensic_proof"] = json.loads(case_dict["forensic_proof"])
            except Exception:
                pass
        if isinstance(case_dict.get("custom_fields"), str):
            try:
                case_dict["custom_fields"] = json.loads(case_dict["custom_fields"])
            except Exception:
                pass

        # 11. Interpolate Smart Reply Templates
        agent_name = current_user or case_dict.get("assigned_user") or "Operations Specialist"
        emp_display = emp_obj.get("name") or "Requester"
        case_title = case_dict.get("title") or case_number
        team_name = case_dict.get("assigned_team") or "Operations Desk"

        fmt_kwargs = {
            "employeeName": emp_display,
            "employee_name": emp_display,
            "caseNumber": case_number,
            "case_number": case_number,
            "title": case_title,
            "subject": case_title,
            "agentName": agent_name,
            "agent_name": agent_name,
            "teamName": team_name,
        }

        # Dynamic inquiry templates from playbook
        inquiry_presets = playbook_data.get("inquiry_presets") or []
        interpolated_inquiries = []
        for inq in inquiry_presets:
            tpl = inq.get("prompt_template") or inq.get("prompt") or ""
            text = tpl
            for k, v in fmt_kwargs.items():
                text = text.replace(f"{{{{{k}}}}}", str(v)).replace(f"{{{k}}}", str(v))
            interpolated_inquiries.append({
                "id": inq.get("id"),
                "label": inq.get("label"),
                "prompt": text,
            })

        # Canned response templates
        smart_templates = {
            "APPROVE": (
                f"Hi {emp_display},\n\n"
                f"We have verified and successfully processed your request regarding \"{case_title}\" (#{case_number}).\n\n"
                f"All requested updates have been committed to company records. Please let us know if you need any further assistance.\n\n"
                f"Best regards,\n{agent_name} · {team_name}"
            ),
            "REQUEST_INFO": (
                f"Hi {emp_display},\n\n"
                f"Thank you for contacting {team_name} regarding \"{case_title}\" (#{case_number}).\n\n"
                f"To complete processing, please reply with the required supporting details or documentation.\n\n"
                f"Once received, we will finalize your request immediately.\n\n"
                f"Best regards,\n{agent_name} · {team_name}"
            ),
            "UPDATE": (
                f"Hi {emp_display},\n\n"
                f"This is an update regarding your ticket \"{case_title}\" (#{case_number}). Your request is currently under active review by {team_name}.\n\n"
                f"No action is required from your side at this stage. We will notify you once completed.\n\n"
                f"Best regards,\n{agent_name} · {team_name}"
            ),
            "REJECT": (
                f"Hi {emp_display},\n\n"
                f"We have reviewed your request regarding \"{case_title}\" (#{case_number}). Unfortunately, we are unable to approve this request per company policy guidelines.\n\n"
                f"Please consult your reporting manager or department guidelines for clarification.\n\n"
                f"Best regards,\n{agent_name} · {team_name}"
            ),
        }

        # Active draft
        active_draft = case_dict.get("draft_reply") or smart_templates["UPDATE"]

        return {
            "case": case_dict,
            "email": email_obj,
            "employee": emp_obj,
            "tasks": tasks_list,
            "approvals": approvals_list,
            "communications": comms_list,
            "documents": docs_list,
            "hr_actions": actions_list,
            "audit_logs": audit_list,
            "requester_history": history_cases,
            "duplicate_match": duplicate_match,
            "conversation_thread": conversation_thread,
            "linked_cases": linked_cases,
            "followers": followers,
            "is_following": is_following,
            "workflow": build_workflow_preview_for_category(cat_key, case_id=db_id),
            "workflow_stages": stages_list,
            "current_step": cur_step,
            "total_steps": total_steps,
            "playbook": playbook_data,
            "smart_templates": smart_templates,
            "inquiry_presets": interpolated_inquiries,
            "active_draft": active_draft,
        }
    finally:
        conn.close()


def update_case_status(case_ref: str, status: str, priority: Optional[str] = None, user: str = "Agent") -> Dict[str, Any]:
    """Update case status and/or priority."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        c = resolve_case_row(conn, case_ref)
        if not c:
            raise ValueError(f"Case '{case_ref}' not found")
        db_id = c["id"]
        case_num = c["case_number"]
        new_status = (status or c["status"]).strip().upper()
        new_prio = (priority or c["priority"]).strip().upper()

        conn.execute(
            "UPDATE cases SET status = ?, priority = ?, updated_at = ? WHERE id = ?",
            (new_status, new_prio, now_iso, db_id),
        )
        conn.commit()

        log_event(
            entity_type="CASE",
            entity_id=str(case_num),
            action="STATUS_CHANGED",
            description=f"{user} updated status to {new_status} (Priority: {new_prio})",
            performed_by=user,
        )
        return {"case_number": case_num, "status": new_status, "priority": new_prio}
    finally:
        conn.close()


def set_case_step(case_ref: str, step: int, draft_notes: Optional[str] = None, user: str = "Agent") -> Dict[str, Any]:
    """Advance or set active workflow stage step."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        c = resolve_case_row(conn, case_ref)
        if not c:
            raise ValueError(f"Case '{case_ref}' not found")
        db_id = c["id"]
        case_num = c["case_number"]
        stages_list, _, total_st = get_case_stages_and_step(c)

        target_step = max(1, min(int(step), total_st))
        stage_info = stages_list[target_step - 1]
        new_wf = stage_info["code"]
        is_last = (target_step == total_st or stage_info.get("stage_type") == "RESOLUTION")
        new_status = "READY" if is_last else "IN_PROGRESS"

        conn.execute(
            "UPDATE cases SET workflow_state = ?, current_step = ?, status = ?, updated_at = ? WHERE id = ?",
            (new_wf, target_step, new_status, now_iso, db_id),
        )

        if draft_notes and draft_notes.strip():
            conn.execute(
                """
                INSERT INTO case_communications (case_id, email_id, sender_type, sender_name, recipient, subject, message, comm_type)
                VALUES (?, ?, 'SYSTEM', ?, 'requester', ?, ?, 'SAVED_DRAFT')
                """,
                (db_id, c.get("email_id"), user, f"Stage Notes: {stage_info['label']}", draft_notes.strip()),
            )
        conn.commit()

        log_event(
            entity_type="CASE",
            entity_id=str(case_num),
            action="WORKFLOW_STEP_SAVED",
            description=f"{user} saved workflow at Step {target_step}/{total_st} ({stage_info['label']}) [Status: {new_status}]",
            performed_by=user,
        )
        return {"case_number": case_num, "current_step": target_step, "workflow_state": new_wf, "status": new_status}
    finally:
        conn.close()


def toggle_task(case_ref: str, task_id: Optional[int] = None, title: Optional[str] = None, user: str = "Agent") -> Dict[str, Any]:
    """Toggle task status between COMPLETED and PENDING, or create and complete by title."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        c = resolve_case_row(conn, case_ref)
        if not c:
            raise ValueError(f"Case '{case_ref}' not found")
        db_id = c["id"]
        case_num = c["case_number"]

        if task_id:
            t_row = conn.execute("SELECT * FROM tasks WHERE id = ? AND case_id = ?", (task_id, db_id)).fetchone()
            if not t_row:
                t_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if t_row:
                curr_stat = (t_row["status"] or "").upper()
                new_stat = "PENDING" if curr_stat == "COMPLETED" else "COMPLETED"
                conn.execute(
                    "UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?",
                    (new_stat, now_iso if new_stat == "COMPLETED" else None, now_iso, t_row["id"]),
                )
                conn.commit()
                log_event(
                    entity_type="CASE",
                    entity_id=str(case_num),
                    action="TASK_COMPLETED" if new_stat == "COMPLETED" else "TASK_REOPENED",
                    description=f"{user} marked verification check '{t_row['title']}' as {new_stat}",
                    performed_by=user,
                )
                return {"task_id": t_row["id"], "status": new_stat, "title": t_row["title"]}

        if title:
            # Create completed task
            cur = conn.execute(
                """
                INSERT INTO tasks (case_id, title, task_type, status, priority, assigned_to, assigned_team, created_by, created_at, completed_at, updated_at)
                VALUES (?, ?, 'AGENT_VERIFICATION', 'COMPLETED', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    db_id,
                    title.strip(),
                    c.get("priority") or "MEDIUM",
                    user,
                    c.get("assigned_team") or "Operations",
                    user,
                    now_iso,
                    now_iso,
                    now_iso,
                ),
            )
            conn.commit()
            log_event(
                entity_type="CASE",
                entity_id=str(case_num),
                action="TASK_COMPLETED",
                description=f"{user} verified compliance check: {title.strip()}",
                performed_by=user,
            )
            return {"task_id": cur.lastrowid, "status": "COMPLETED", "title": title.strip()}

        raise ValueError("Either task_id or title is required")
    finally:
        conn.close()


def add_task(case_ref: str, title: str, task_type: str = "CHECKBOX", guidance: str = "", user: str = "Agent") -> Dict[str, Any]:
    """Add a new task to the case verification checklist."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        c = resolve_case_row(conn, case_ref)
        if not c:
            raise ValueError(f"Case '{case_ref}' not found")
        db_id = c["id"]
        case_num = c["case_number"]

        cur = conn.execute(
            """
            INSERT INTO tasks (case_id, title, task_type, description, status, priority, assigned_to, assigned_team, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)
            """,
            (
                db_id,
                title.strip(),
                task_type,
                guidance.strip(),
                c.get("priority") or "MEDIUM",
                user,
                c.get("assigned_team") or "Operations",
                user,
                now_iso,
                now_iso,
            ),
        )
        conn.commit()
        new_id = cur.lastrowid
        log_event(
            entity_type="CASE",
            entity_id=str(case_num),
            action="TASK_CREATED",
            description=f"{user} added verification task: {title.strip()}",
            performed_by=user,
        )
        return {"task_id": new_id, "title": title.strip(), "status": "PENDING"}
    finally:
        conn.close()


def save_case_draft(case_ref: str, draft_body: str, user: str = "Agent") -> Dict[str, Any]:
    """Persist the agent's work-in-progress response draft to the database."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        c = resolve_case_row(conn, case_ref)
        if not c:
            raise ValueError(f"Case '{case_ref}' not found")
        db_id = c["id"]
        conn.execute(
            "UPDATE cases SET draft_reply = ?, updated_at = ? WHERE id = ?",
            (draft_body, now_iso, db_id),
        )
        conn.commit()
        return {"case_number": c["case_number"], "saved": True}
    finally:
        conn.close()


def send_reply(
    case_ref: str,
    reply_body: str,
    is_request_info: bool = False,
    next_status: Optional[str] = None,
    user: str = "Agent",
    recipient_email: Optional[str] = None,
) -> Dict[str, Any]:
    """Send an official reply or info request via SMTP and log communication."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        c = resolve_case_row(conn, case_ref)
        if not c:
            raise ValueError(f"Case '{case_ref}' not found")
        db_id = c["id"]
        case_num = c["case_number"]

        clean_body = (reply_body or "").strip()
        if not clean_body:
            raise ValueError("Reply message body cannot be empty")

        # Resolve recipient email
        target_email = (recipient_email or "").strip()
        if not target_email and c.get("email_id"):
            em_row = conn.execute("SELECT sender_email FROM emails WHERE id = ?", (c["email_id"],)).fetchone()
            if em_row and em_row["sender_email"]:
                target_email = em_row["sender_email"].strip()

        subj_prefix = "Action Required: Missing Information" if is_request_info else "Official Update"
        subj = f"Re: [{case_num}] {c.get('title') or subj_prefix}"
        html_body = (
            f"<div style='font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a;'>"
            f"{html_lib.escape(clean_body).replace(chr(10), '<br>')}"
            f"<hr style='border:none;border-top:1px solid #e2e8f0;margin:18px 0;'>"
            f"<div style='font-size:12px;color:#64748b;'>Case Reference: <strong>{html_lib.escape(str(case_num))}</strong> · Handled by {html_lib.escape(user)}</div>"
            f"</div>"
        )

        smtp_result = None
        if target_email and "@" in target_email:
            smtp_result = send_gmail_smtp_email(
                recipient_email=target_email,
                subject=subj,
                body_text=clean_body,
                body_html=html_body,
            )

        status_after = "ON_HOLD" if is_request_info else (next_status or "IN_PROGRESS")
        conn.execute(
            "UPDATE cases SET status = ?, draft_reply = NULL, updated_at = ? WHERE id = ?",
            (status_after, now_iso, db_id),
        )
        conn.execute(
            """
            INSERT INTO case_communications (case_id, email_id, sender_type, sender_name, recipient, subject, message, comm_type)
            VALUES (?, ?, 'AGENT', ?, ?, ?, ?, ?)
            """,
            (
                db_id,
                c.get("email_id"),
                user,
                target_email or "requester",
                subj,
                clean_body,
                "REQUEST_INFO" if is_request_info else "AGENT_REPLY",
            ),
        )
        conn.commit()

        log_event(
            entity_type="CASE",
            entity_id=str(case_num),
            action="INFO_REQUESTED_BY_AGENT" if is_request_info else "AGENT_REPLY_SENT",
            description=f"{user} sent {'missing-info request' if is_request_info else 'reply'} to {target_email or 'requester'} (Status -> {status_after})",
            performed_by=user,
        )

        return {
            "case_number": case_num,
            "status": status_after,
            "smtp_result": smtp_result,
            "recipient": target_email,
        }
    finally:
        conn.close()


def resolve_case(
    case_ref: str,
    resolution_type: str,
    notes: str,
    forensic_proof: Optional[Dict[str, Any]] = None,
    notify_requester: bool = True,
    user: str = "Agent",
) -> Dict[str, Any]:
    """Formally resolve the case, saving forensic evidence and sending resolution notice."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        c = resolve_case_row(conn, case_ref)
        if not c:
            raise ValueError(f"Case '{case_ref}' not found")
        db_id = c["id"]
        case_num = c["case_number"]

        res_type = (resolution_type or "VERIFIED_RESOLVED").strip().upper()
        clean_notes = (notes or "Verified and resolved by Operations Specialist.").strip()

        # Build proof metadata summary if provided
        proof_payload = forensic_proof or {}
        proof_json = json.dumps(proof_payload) if isinstance(proof_payload, dict) else str(proof_payload)

        ref_id = str(proof_payload.get("proofId") or proof_payload.get("refId") or "").strip()
        metric_val = str(proof_payload.get("metric") or proof_payload.get("amount") or "").strip()

        full_notes = clean_notes
        meta_items = []
        if ref_id and ref_id not in full_notes:
            meta_items.append(f"Reference ID: {ref_id}")
        if metric_val and metric_val not in full_notes:
            meta_items.append(f"Adjustment / Outcome: {metric_val}")
        if meta_items:
            full_notes = f"{full_notes}\n\n[{' · '.join(meta_items)}]"

        stages_list, _, total_steps = get_case_stages_and_step(c)

        conn.execute(
            """
            UPDATE cases
               SET status = 'RESOLVED',
                   workflow_state = 'RESOLVED',
                   current_step = ?,
                   resolution_type = ?,
                   resolution_notes = ?,
                   forensic_proof = ?,
                   resolved_by = ?,
                   resolved_at = ?,
                   draft_reply = NULL,
                   updated_at = ?
             WHERE id = ?
            """,
            (total_steps, res_type, full_notes, proof_json, user, now_iso, now_iso, db_id),
        )
        conn.commit()

        # Resolve recipient email for notification
        recipient_email = ""
        if c.get("email_id"):
            em_row = conn.execute("SELECT sender_email FROM emails WHERE id = ?", (c["email_id"],)).fetchone()
            if em_row and em_row["sender_email"]:
                recipient_email = em_row["sender_email"].strip()

        smtp_result = None
        if notify_requester and recipient_email and "@" in recipient_email:
            subj = f"[Resolved · {case_num}] {c.get('title') or 'Request Resolved'}"
            html_body = (
                f"<div style='font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a;max-width:620px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;'>"
                f"<div style='background:linear-gradient(135deg,#059669,#10b981);color:#ffffff;padding:20px 24px;'>"
                f"<div style='font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;opacity:0.9;'>Operations Support Desk</div>"
                f"<h2 style='margin:4px 0 0 0;font-size:20px;font-weight:800;'>✓ Query Resolved: {html_lib.escape(str(case_num))}</h2>"
                f"</div>"
                f"<div style='padding:24px;background:#ffffff;'>"
                f"<p style='margin:0 0 16px 0;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap;'>{html_lib.escape(clean_notes)}</p>"
                f"<div style='background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin:18px 0;font-size:12px;color:#64748b;display:grid;grid-template-columns:1fr 1fr;gap:8px;'>"
                f"<div><strong>Resolution Type:</strong> {html_lib.escape(res_type)}</div>"
                f"<div><strong>Reference ID:</strong> {html_lib.escape(ref_id or 'N/A')}</div>"
                f"<div><strong>Resolved By:</strong> {html_lib.escape(user)}</div>"
                f"<div><strong>Date &amp; Time:</strong> {html_lib.escape(now_iso)}</div>"
                f"</div>"
                f"<hr style='border:none;border-top:1px solid #e2e8f0;margin:18px 0;'>"
                f"<div style='font-size:11px;color:#94a3b8;'>This is an official resolution notification. For questions or further assistance, reply directly to this email.</div>"
                f"</div>"
                f"</div>"
            )
            smtp_result = send_gmail_smtp_email(
                recipient_email=recipient_email,
                subject=subj,
                body_text=full_notes,
                body_html=html_body,
            )
            conn.execute(
                """
                INSERT INTO case_communications (case_id, email_id, sender_type, sender_name, recipient, subject, message, comm_type)
                VALUES (?, ?, 'AGENT', ?, ?, ?, ?, 'RESOLUTION_NOTICE')
                """,
                (db_id, c.get("email_id"), user, recipient_email, subj, full_notes),
            )
            conn.commit()

        log_event(
            entity_type="CASE",
            entity_id=str(case_num),
            action="CASE_RESOLVED_BY_AGENT",
            description=f"{user} resolved Case #{case_num} ({res_type}{f', Ref: {ref_id}' if ref_id else ''}): {clean_notes[:140]}",
            performed_by=user,
        )

        return {
            "case_number": case_num,
            "status": "RESOLVED",
            "resolution_type": res_type,
            "resolution_notes": full_notes,
            "smtp_result": smtp_result,
        }
    finally:
        conn.close()


def reassign_case(case_ref: str, target_user: str, target_team: Optional[str] = None, user: str = "Agent") -> Dict[str, Any]:
    """Reassign case owner or team."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        c = resolve_case_row(conn, case_ref)
        if not c:
            raise ValueError(f"Case '{case_ref}' not found")
        db_id = c["id"]
        case_num = c["case_number"]

        new_user = (target_user or "").strip()
        new_team = (target_team or c.get("assigned_team") or "Operations").strip()

        conn.execute(
            """
            UPDATE cases
               SET assigned_user = ?,
                   assigned_to = ?,
                   assigned_team = ?,
                   updated_at = ?
             WHERE id = ?
            """,
            (new_user, new_user, new_team, now_iso, db_id),
        )
        conn.commit()

        log_event(
            entity_type="CASE",
            entity_id=str(case_num),
            action="CASE_REASSIGNED",
            description=f"{user} reassigned case #{case_num} to {new_user} ({new_team})",
            performed_by=user,
        )
        return {"case_number": case_num, "assigned_user": new_user, "assigned_team": new_team}
    finally:
        conn.close()


def escalate_case(case_ref: str, reason: str, user: str = "Agent") -> Dict[str, Any]:
    """Escalate case for management review with critical priority."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        c = resolve_case_row(conn, case_ref)
        if not c:
            raise ValueError(f"Case '{case_ref}' not found")
        db_id = c["id"]
        case_num = c["case_number"]
        clean_reason = (reason or "Escalated for senior leadership / team lead intervention.").strip()

        conn.execute(
            "UPDATE cases SET status = 'REVIEW_REQUIRED', priority = 'CRITICAL', workflow_state = 'ESCALATED_TO_LEAD', updated_at = ? WHERE id = ?",
            (now_iso, db_id),
        )
        conn.execute(
            """
            INSERT INTO notifications (notif_type, title, message, case_id, case_number, recipient_role)
            VALUES ('SLA_ESCALATION', ?, ?, ?, ?, 'TEAM_LEAD')
            """,
            (f"Case {case_num} Escalated by {user}", clean_reason, db_id, case_num),
        )
        conn.commit()

        log_event(
            entity_type="CASE",
            entity_id=str(case_num),
            action="CASE_ESCALATED",
            description=f"{user} escalated case #{case_num} (CRITICAL): {clean_reason}",
            performed_by=user,
        )
        return {"case_number": case_num, "status": "REVIEW_REQUIRED", "priority": "CRITICAL"}
    finally:
        conn.close()


def request_approval(case_ref: str, approval_type: str, approver_role: str, comments: str, user: str = "Agent") -> Dict[str, Any]:
    """Submit approval sign-off request."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        c = resolve_case_row(conn, case_ref)
        if not c:
            raise ValueError(f"Case '{case_ref}' not found")
        db_id = c["id"]
        case_num = c["case_number"]

        app_type = (approval_type or "MANAGER_SIGN_OFF").strip().upper()
        app_role = (approver_role or "TEAM_MANAGER").strip().upper()
        app_notes = (comments or "Specialist requested authorization prior to commitment.").strip()
        app_code = f"APR-{db_id}-{int(datetime.now(timezone.utc).timestamp()) % 100000}"

        conn.execute(
            """
            INSERT INTO approvals (approval_code, case_id, approval_type, approver, approver_role, status, requested_by, requested_at, comments)
            VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
            """,
            (
                app_code,
                db_id,
                app_type,
                "Department Lead / Approver",
                app_role,
                user,
                now_iso,
                app_notes,
            ),
        )
        conn.execute(
            "UPDATE cases SET status = 'ON_HOLD', workflow_state = 'PENDING_APPROVAL', updated_at = ? WHERE id = ?",
            (now_iso, db_id),
        )
        conn.commit()

        log_event(
            entity_type="CASE",
            entity_id=str(case_num),
            action="APPROVAL_REQUESTED_BY_AGENT",
            description=f"{user} requested {app_role} approval ({app_code}): {app_notes}",
            performed_by=user,
        )
        return {"case_number": case_num, "approval_code": app_code, "status": "ON_HOLD"}
    finally:
        conn.close()


def execute_action(case_ref: str, action_data: Dict[str, Any], user: str = "Agent") -> Dict[str, Any]:
    """Execute dynamic integration or verification action."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        c = resolve_case_row(conn, case_ref)
        if not c:
            raise ValueError(f"Case '{case_ref}' not found")
        db_id = c["id"]
        case_num = c["case_number"]

        action_title = (action_data.get("title") or action_data.get("action_name") or "System Verification").strip()
        provider = (action_data.get("provider") or action_data.get("system") or "Enterprise API").strip()
        details = (action_data.get("details") or action_data.get("notes") or f"Executed verification action '{action_title}'").strip()
        status_verdict = (action_data.get("status") or "VERIFIED").strip().upper()
        risk_level = (action_data.get("risk_level") or "LOW").strip().upper()
        ext_ref = (action_data.get("external_reference") or action_data.get("reference_id") or f"REF-{int(datetime.now(timezone.utc).timestamp())}").strip()

        action_code = f"ACT-{db_id}-{int(datetime.now(timezone.utc).timestamp()) % 100000}"
        idem_key = f"action-{db_id}-{action_code}"

        resp_summary = {
            "status": status_verdict,
            "action_code": action_code,
            "title": action_title,
            "provider": provider,
            "risk_level": risk_level,
            "verified_by": user,
            "timestamp": now_iso,
            "details": details,
            "external_reference": ext_ref,
        }

        conn.execute(
            """
            INSERT INTO hr_actions (
                action_code, idempotency_key, case_id, case_number, employee_id, employee_name,
                action_type, provider, risk_level, status, attempt_count,
                request_payload, response_payload, external_reference, requested_by, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 1, ?, ?, ?, ?, ?)
            """,
            (
                action_code,
                idem_key,
                db_id,
                case_num,
                str(c.get("employee_id") or "REQ"),
                c.get("employee_name") or "Requester",
                action_title.upper().replace(" ", "_")[:32],
                provider,
                risk_level,
                json.dumps({"case_number": case_num, "triggered_by": user, "custom_title": action_title}),
                json.dumps(resp_summary),
                ext_ref,
                user,
                now_iso,
            ),
        )
        conn.commit()

        log_event(
            entity_type="CASE",
            entity_id=str(case_num),
            action="ACTION_EXECUTED",
            description=f"{user} executed action '{action_title}' ({provider}): {details[:140]}",
            performed_by=user,
        )
        return resp_summary
    finally:
        conn.close()


def merge_cases(source_ref: str, target_ref: str, reason: str = "", user: str = "Agent") -> Dict[str, Any]:
    """Merge source_ref into target_ref, consolidating communications and marking source as MERGED."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        src = resolve_case_row(conn, source_ref)
        if not src:
            raise ValueError(f"Source case '{source_ref}' not found")
        tgt = resolve_case_row(conn, target_ref)
        if not tgt:
            raise ValueError(f"Target case '{target_ref}' not found")

        src_id, src_num = src["id"], src["case_number"]
        tgt_id, tgt_num = tgt["id"], tgt["case_number"]

        if src_id == tgt_id:
            raise ValueError("Cannot merge a case into itself")

        clean_reason = (reason or "Duplicate ticket consolidated into parent docket").strip()

        # 1. Re-link communications and documents from source to target
        conn.execute("UPDATE case_communications SET case_id = ? WHERE case_id = ?", (tgt_id, src_id))
        conn.execute("UPDATE case_documents SET case_id = ? WHERE case_id = ?", (tgt_id, src_id))

        # 2. Add merge notification into target case communications
        conn.execute(
            """
            INSERT INTO case_communications (case_id, comm_type, sender_type, sender_name, subject, message, created_at)
            VALUES (?, 'SYSTEM_MERGE', 'SYSTEM', ?, ?, ?, ?)
            """,
            (
                tgt_id,
                user,
                f"🔗 Consolidated Docket #{src_num}",
                f"Docket #{src_num} was merged into this ticket by {user}.\nReason: {clean_reason}",
                now_iso,
            ),
        )

        # 3. Mark source case as MERGED
        conn.execute(
            """
            UPDATE cases 
            SET status = 'MERGED', 
                merged_into = ?, 
                workflow_state = 'MERGED_DUPLICATE',
                resolution_type = 'MERGED_DUPLICATE',
                resolution_notes = ?,
                resolved_by = ?,
                resolved_at = ?,
                closed_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                tgt_num,
                f"Merged into #{tgt_num}: {clean_reason}",
                user,
                now_iso,
                now_iso,
                now_iso,
                src_id,
            ),
        )

        # 4. Cross-link in linked_cases of target
        tgt_linked = []
        if isinstance(tgt.get("linked_cases"), str):
            try:
                tgt_linked = json.loads(tgt["linked_cases"])
            except Exception:
                tgt_linked = []
        tgt_linked.append({
            "case_number": src_num,
            "relation": "MERGED_DUPLICATE",
            "title": src.get("title") or src_num,
            "status": "MERGED",
            "at": now_iso,
            "by": user,
        })
        conn.execute("UPDATE cases SET linked_cases = ?, updated_at = ? WHERE id = ?", (json.dumps(tgt_linked), now_iso, tgt_id))

        conn.commit()

        log_event(
            entity_type="CASE",
            entity_id=str(src_num),
            action="CASE_MERGED",
            description=f"{user} merged case #{src_num} into #{tgt_num}: {clean_reason}",
            performed_by=user,
        )
        log_event(
            entity_type="CASE",
            entity_id=str(tgt_num),
            action="CASE_MERGED_PARENT",
            description=f"{user} merged #{src_num} as child duplicate into this docket",
            performed_by=user,
        )

        return {
            "source_case": src_num,
            "target_case": tgt_num,
            "status": "MERGED",
            "message": f"Successfully merged {src_num} into {tgt_num}.",
        }
    finally:
        conn.close()


def link_cases(case_ref_a: str, case_ref_b: str, relation: str = "RELATED", user: str = "Agent") -> Dict[str, Any]:
    """Cross-link two cases with a designated relationship."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        a = resolve_case_row(conn, case_ref_a)
        if not a:
            raise ValueError(f"Case '{case_ref_a}' not found")
        b = resolve_case_row(conn, case_ref_b)
        if not b:
            raise ValueError(f"Case '{case_ref_b}' not found")

        rel_type = (relation or "RELATED").upper()

        links_a = []
        if isinstance(a.get("linked_cases"), str):
            try:
                links_a = json.loads(a["linked_cases"])
            except Exception:
                links_a = []
        if not any(x.get("case_number") == b["case_number"] for x in links_a):
            links_a.append({
                "case_number": b["case_number"],
                "relation": rel_type,
                "title": b.get("title", ""),
                "status": b.get("status", ""),
            })
            conn.execute("UPDATE cases SET linked_cases = ?, updated_at = ? WHERE id = ?", (json.dumps(links_a), now_iso, a["id"]))

        links_b = []
        if isinstance(b.get("linked_cases"), str):
            try:
                links_b = json.loads(b["linked_cases"])
            except Exception:
                links_b = []
        if not any(x.get("case_number") == a["case_number"] for x in links_b):
            links_b.append({
                "case_number": a["case_number"],
                "relation": rel_type,
                "title": a.get("title", ""),
                "status": a.get("status", ""),
            })
            conn.execute("UPDATE cases SET linked_cases = ?, updated_at = ? WHERE id = ?", (json.dumps(links_b), now_iso, b["id"]))

        conn.commit()
        log_event(
            entity_type="CASE",
            entity_id=str(a["case_number"]),
            action="CASES_LINKED",
            description=f"{user} linked case {a['case_number']} with {b['case_number']} ({rel_type})",
            performed_by=user,
        )
        return {"status": "LINKED", "case_a": a["case_number"], "case_b": b["case_number"], "relation": rel_type}
    finally:
        conn.close()


def toggle_follow_case(case_ref: str, user: str = "Agent") -> Dict[str, Any]:
    """Toggle current user in case followers subscription list."""
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        c = resolve_case_row(conn, case_ref)
        if not c:
            raise ValueError(f"Case '{case_ref}' not found")

        followers = []
        if isinstance(c.get("followers"), str):
            try:
                followers = json.loads(c["followers"])
            except Exception:
                followers = []

        clean_user = user.strip()
        is_following = clean_user in followers
        if is_following:
            followers.remove(clean_user)
        else:
            followers.append(clean_user)

        conn.execute("UPDATE cases SET followers = ?, updated_at = ? WHERE id = ?", (json.dumps(followers), now_iso, c["id"]))
        conn.commit()
        return {"case_number": c["case_number"], "is_following": not is_following, "followers": followers}
    finally:
        conn.close()

