"""
HR FLOW — Phase 6.9–6.12 & Phase 7 Case & Routing Engine (backend/services/cases/case_engine.py)
Handles:
  - Routing rules lookup (`backend/data/routing.json`)
  - SLA calculation (`created_at + sla_hours`)
  - Case deduplication (`get_case_by_email_id`)
  - Automatic case creation and status assignment
  - Initial case documents, communication thread, and operational notifications
"""

import json
import logging
import os
import re
from datetime import datetime, timezone, timedelta
from email.utils import parseaddr
from typing import Dict, Any, Optional, List, Tuple
from backend.config import Config
from backend.database.connection import get_connection

logger = logging.getLogger("hrflow.cases.engine")
from backend.models.case import (
    get_case_by_email_id,
    get_case_by_id_or_number,
    save_case_field_values,
)
from backend.services.cases.case_number import generate_next_case_number
from backend.services.workflows.workflow_engine import (
    get_or_create_workflow_instance,
    transition_workflow_state,
)
from backend.services.audit.audit_service import log_event

_ROUTING_CACHE: Dict[str, Dict[str, Any]] = {}

_CATEGORY_REQUIRED_DOCUMENTS: Dict[str, List[str]] = {
    "RESIGNATION": ["Resignation Letter", "Handover Checklist", "No Dues Declaration"],
    "BGV": ["Experience Letter", "Relieving Letter", "Salary Slip", "ID Proof"],
}


def load_routing_rules(force_reload: bool = False) -> Dict[str, Dict[str, Any]]:
    global _ROUTING_CACHE
    if _ROUTING_CACHE and not force_reload:
        return _ROUTING_CACHE

    path = os.path.join(Config.BACKEND_DIR, "data", "routing.json")
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
            _ROUTING_CACHE = raw.get("routing_rules", {})
    return _ROUTING_CACHE


def save_or_update_routing_rule(category: str, rule_payload: Dict[str, Any]) -> Dict[str, Any]:
    global _ROUTING_CACHE
    norm = (category or "").strip().upper().replace(" ", "_")
    if not norm:
        raise ValueError("Category code is required for routing rule.")

    path = os.path.join(Config.BACKEND_DIR, "data", "routing.json")
    raw_doc: Dict[str, Any] = {"routing_rules": {}}
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            raw_doc = json.load(f) or {"routing_rules": {}}

    rules = raw_doc.setdefault("routing_rules", {})
    existing = rules.get(norm, {})
    merged = {
        "team": rule_payload.get("team") or existing.get("team") or "HR Operations",
        "priority": (rule_payload.get("priority") or existing.get("priority") or "MEDIUM").upper(),
        "sla_hours": int(rule_payload.get("sla_hours") or existing.get("sla_hours") or 48),
        "auto_create_case": bool(rule_payload.get("auto_create_case", existing.get("auto_create_case", True))),
    }
    rules[norm] = merged

    with open(path, "w", encoding="utf-8") as f:
        json.dump(raw_doc, f, indent=2, ensure_ascii=False)

    _ROUTING_CACHE = rules
    return merged


def get_routing_for_category(category: str) -> Dict[str, Any]:
    rules = load_routing_rules()
    norm = (category or "UNKNOWN").strip().upper()
    if norm in rules and norm != "UNKNOWN":
        return rules[norm]

    # Dynamically check hr_departments table for any custom department handling this category
    if norm != "UNKNOWN":
        conn = get_connection()
        try:
            dept_rows = conn.execute(
                "SELECT team_name, category_scope, sla_hours, default_priority FROM hr_departments ORDER BY id ASC"
            ).fetchall()
            for r in dept_rows:
                scopes = [s.strip().upper() for s in (r["category_scope"] or "").split(",") if s.strip()]
                if norm in scopes:
                    return {
                        "team": r["team_name"],
                        "priority": (r["default_priority"] or "MEDIUM").upper(),
                        "sla_hours": int(r["sla_hours"] or 48),
                        "auto_create_case": True,
                    }
        except Exception:
            pass
        finally:
            conn.close()

    return rules.get("UNKNOWN") or {
        "team": "HR Triage Team",
        "priority": "MEDIUM",
        "sla_hours": 48,
        "auto_create_case": False,
    }


def is_department_intake_mailbox(account_email: Optional[str]) -> bool:
    """
    Check if the account_email corresponds to a designated HR department intake mailbox.
    Mailboxes explicitly registered as ADMIN in connected_mailboxes or users (such as
    corporate personal admin accounts) are strictly excluded from generating automatic HR cases.
    """
    if not account_email or not str(account_email).strip():
        return True  # Fallback for synthetic test data where no account_email was specified

    clean_acct = str(account_email).strip().lower()
    conn = get_connection()
    try:
        # 1. Check if explicitly registered as a dept_gmail in hr_departments -> ALWAYS ALLOW
        d_row = conn.execute(
            "SELECT id, team_name FROM hr_departments WHERE LOWER(dept_gmail) = ? LIMIT 1",
            (clean_acct,),
        ).fetchone()
        if d_row:
            return True

        # 2. Check if this mailbox is marked as an ADMIN / SUPER_ADMIN in connected_mailboxes -> STRICTLY BLOCK
        mbox = conn.execute(
            "SELECT role FROM connected_mailboxes WHERE LOWER(email) = ? LIMIT 1",
            (clean_acct,),
        ).fetchone()
        if mbox and str(mbox["role"]).strip().upper() in ("ADMIN", "SUPER_ADMIN"):
            return False

        # 3. Check if registered as an ADMIN user in users table -> STRICTLY BLOCK
        u_row = conn.execute(
            "SELECT role FROM users WHERE LOWER(email) = ? AND role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1",
            (clean_acct,),
        ).fetchone()
        if u_row:
            return False

        # 4. If connected_mailboxes has this account with role != HR_AGENT -> BLOCK
        if mbox and str(mbox["role"]).strip().upper() != "HR_AGENT":
            return False

        return True
    except Exception as exc:
        logger.warning(f"Error checking department intake mailbox for '{account_email}': {exc}")
        return True
    finally:
        conn.close()



def _seed_case_documents_and_comms(
    case_id: int,
    case_number: str,
    email_row: Dict[str, Any],
    category: str,
    assigned_team: str,
) -> None:
    email_id = int(email_row["id"])
    attachments = email_row.get("attachments") or []
    sender_name = email_row.get("sender_name") or email_row.get("sender_email") or "Employee"

    conn = get_connection()
    try:
        # 1. Seed initial inbound employee email in case_communications if not already present
        existing_comm = conn.execute(
            "SELECT id FROM case_communications WHERE case_id = ? AND comm_type = 'ORIGINAL_EMAIL' LIMIT 1",
            (case_id,),
        ).fetchone()
        if not existing_comm:
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
                ) VALUES (?, ?, 'EMPLOYEE', ?, 'HR Operations', ?, ?, 'ORIGINAL_EMAIL')
                """,
                (
                    case_id,
                    email_id,
                    f"{sender_name} <{email_row.get('sender_email') or ''}>".strip(),
                    email_row.get("subject") or "HR Request",
                    (email_row.get("body") or "").strip(),
                ),
            )

        # 2. Seed email attachments into case_documents
        existing_docs = conn.execute(
            "SELECT name FROM case_documents WHERE case_id = ?",
            (case_id,),
        ).fetchall()
        existing_doc_names = {r["name"] for r in existing_docs}

        for att in attachments:
            if isinstance(att, dict):
                raw_size = att.get("size")
                fname = att.get("filename") or att.get("name") or "Attachment"
                file_path = att.get("storage_path") or att.get("file_path")
                content_type = att.get("content_type") or "application/octet-stream"
                size_bytes = int(att.get("size_bytes") or 0)
                att_id = att.get("id") or att.get("attachment_id")
                if isinstance(raw_size, str):
                    size_str = raw_size if any(u in raw_size.upper() for u in ("KB", "MB", "GB", "BYTES", "B")) else f"{raw_size} B"
                elif isinstance(raw_size, (int, float)):
                    size_str = f"{max(1, int(raw_size) // 1024)} KB" if raw_size else "120 KB"
                else:
                    size_str = "120 KB"
            else:
                fname = str(att)
                size_str = "120 KB"
                file_path = None
                content_type = "application/octet-stream"
                size_bytes = 0
                att_id = None

            if fname not in existing_doc_names:
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
                        attachment_id
                    ) VALUES (?, ?, ?, 'EMAIL_ATTACHMENT', ?, ?, 'RECEIVED', ?, ?, ?, ?)
                    """,
                    (case_id, email_id, fname, sender_name, size_str, file_path, content_type, size_bytes, att_id),
                )
                existing_doc_names.add(fname)

        # 3. For document-intensive categories (RESIGNATION, BGV), register checklist documents if missing
        for req_doc in _CATEGORY_REQUIRED_DOCUMENTS.get(category, []):
            if req_doc not in existing_doc_names:
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
                    ) VALUES (?, ?, ?, 'MANDATORY_CHECKLIST', 'Pending Employee', '—', 'REQUIRED')
                    """,
                    (case_id, email_id, req_doc),
                )
                existing_doc_names.add(req_doc)

        # 4. Create operational notification for new case assignment
        existing_notif = conn.execute(
            "SELECT id FROM notifications WHERE case_id = ? AND notif_type = 'NEW_CASE_ASSIGNED' LIMIT 1",
            (case_id,),
        ).fetchone()
        if not existing_notif:
            conn.execute(
                """
                INSERT INTO notifications (
                    notif_type,
                    title,
                    message,
                    case_id,
                    case_number,
                    recipient_user
                ) VALUES ('NEW_CASE_ASSIGNED', ?, ?, ?, ?, ?)
                """,
                (
                    f"New Case Assigned: {case_number}",
                    f"{case_number} ({category}) routed to {assigned_team}: {email_row.get('subject') or ''}",
                    case_id,
                    case_number,
                    assigned_team,
                ),
            )
        conn.commit()
    finally:
        conn.close()


def is_internal_company_domain(email_str: Optional[str]) -> bool:
    """
    Check if sender email belongs to trusted corporate domain (@1mg.com, @company.com, or corporate subdomains).
    """
    if not email_str:
        return False
    _, addr = parseaddr(str(email_str).strip().lower())
    addr = addr or str(email_str).strip().lower()
    return (
        addr.endswith("@1mg.com")
        or addr.endswith(".1mg.com")
        or addr.endswith("@company.com")
        or addr.endswith(".company.com")
    )


def _extract_unquoted_text(body: Optional[str]) -> str:
    """Extract only the new reply text from an email body, excluding quoted history."""
    if not body:
        return ""
    lines = []
    for line in str(body).splitlines():
        trimmed = line.strip()
        if trimmed.startswith(">"):
            continue
        if re.search(r"^On\s+.*wrote:\s*$", trimmed, re.IGNORECASE):
            break
        if re.search(r"-+\s*Original Message\s*-+", trimmed, re.IGNORECASE):
            break
        lines.append(line)
    return "\n".join(lines).strip()


def find_existing_case_for_reply(email_row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Match an inbound reply email to an existing case via:
      1. Matching thread_id from email headers
      2. Case number regex in email subject or body (e.g. CASE-000021, CASE-2026-0001)
    """
    # 1. Match by thread_id
    thread_id = email_row.get("thread_id")
    if thread_id:
        conn = get_connection()
        try:
            r = conn.execute(
                """
                SELECT c.id FROM cases c
                JOIN emails e ON c.email_id = e.id
                WHERE e.thread_id = ? AND e.thread_id IS NOT NULL AND e.thread_id != ''
                ORDER BY c.id DESC LIMIT 1
                """,
                (thread_id,),
            ).fetchone()
            if r:
                return get_case_by_id_or_number(r["id"])
        finally:
            conn.close()

    # 2. Match by Case Number in subject or body
    subj = email_row.get("subject") or ""
    body = email_row.get("body") or ""
    text_corpus = f"{subj} {body}"
    m = re.search(r"\bCASE-?\d{4,8}\b", text_corpus, re.IGNORECASE)
    if m:
        c_num = m.group(0).upper()
        found = get_case_by_id_or_number(c_num)
        if found:
            return found

    return None


def create_or_update_case_for_email(
    email_row: Dict[str, Any],
    employee_match: Dict[str, Any],
    category_result: Dict[str, Any],
    intent_result: Dict[str, Any],
    extracted_fields: Dict[str, Any],
    validation_result: Dict[str, Any],
    force_create: bool = False,
    performed_by: str = "case_engine",
) -> Optional[Dict[str, Any]]:
    email_id = int(email_row["id"])
    category = (category_result.get("category") or "UNKNOWN").upper()
    routing = get_routing_for_category(category)

    emp_status = employee_match.get("status", "NOT_FOUND")
    emp_obj = employee_match.get("employee") or {}
    emp_db_id = emp_obj.get("db_id") or email_row.get("employee_id")
    extracted_emp_id = (employee_match.get("extracted") or {}).get("employee_id")

    # Inbound Domain and Employee ID Policy Analysis
    sender_email = (email_row.get("sender_email") or "").strip().lower()
    is_internal = is_internal_company_domain(sender_email)

    text_corpus = f"{email_row.get('subject', '')} {email_row.get('body', '')}"
    body_raw = email_row.get("body") or ""
    clean_body = _extract_unquoted_text(body_raw)

    from backend.services.employees.employee_extractor import extract_employee_id
    body_emp_id = (
        extract_employee_id(clean_body)
        or extract_employee_id(email_row.get("subject", ""))
        or extract_employee_id(body_raw)
    )
    effective_emp_id = extracted_emp_id or body_emp_id or emp_obj.get("employee_id")

    # Policy Rule: If external domain (e.g. @gmail.com) AND no Employee ID provided AND not matched in DB
    is_external_missing_emp_id = (not is_internal) and (not effective_emp_id) and (emp_status != "MATCHED")

    existing_case = get_case_by_email_id(email_id)
    if not existing_case:
        existing_case = find_existing_case_for_reply(email_row)

    # Department Mailbox Filtering: Restrict case creation strictly to designated department mailboxes
    account_email = (email_row.get("account_email") or "").strip().lower()
    if account_email and not force_create and not existing_case and not is_department_intake_mailbox(account_email):
        logger.info(
            f"[IntakeBlocked] Case creation suppressed for email {email_id}: "
            f"mailbox '{account_email}' is an admin/non-department mailbox."
        )
        save_case_field_values(None, email_id, validation_result.get("field_checks", []))
        return None

    is_act = bool(email_row.get("is_actionable", 1) not in (0, "0", False))
    if not is_act and not force_create and not existing_case:
        save_case_field_values(None, email_id, validation_result.get("field_checks", []))
        return None

    is_actionable_hr_email = bool(
        force_create
        or existing_case
        or (routing.get("auto_create_case", False) and is_act)
        or (emp_status == "REVIEW_REQUIRED" and category != "UNKNOWN" and is_act)
        or extracted_emp_id
        or (is_internal and is_act)
    )

    if not is_actionable_hr_email:
        save_case_field_values(None, email_id, validation_result.get("field_checks", []))
        return None

    if is_external_missing_emp_id:
        target_status = "ON_HOLD"
    else:
        val_status = validation_result.get("status", "REVIEW_REQUIRED")
        is_confirmed = bool(email_row.get("decision_status") in ("ADMIN_CONFIRMED", "HR_CONFIRMED"))
        if not is_confirmed and (emp_status == "REVIEW_REQUIRED" or category == "UNKNOWN" or category_result.get("requires_review")):
            target_status = "REVIEW_REQUIRED"
        elif val_status == "ON_HOLD":
            target_status = "ON_HOLD"
        elif val_status == "READY" or is_confirmed or category_result.get("requires_review") is False or is_internal:
            target_status = "READY"
        else:
            target_status = "READY" if is_confirmed else "REVIEW_REQUIRED"

    intent_str = (
        f"{intent_result['id']} — {intent_result['name']}"
        if intent_result.get("status") == "CLASSIFIED" and intent_result.get("id")
        else (intent_result.get("name") or intent_result.get("id") or None)
    )
    priority = routing.get("priority", "MEDIUM").upper()
    if target_status == "REVIEW_REQUIRED" and emp_status == "REVIEW_REQUIRED":
        priority = "HIGH"

    assigned_team = routing.get("team", "HR Operations")
    sla_hours = int(routing.get("sla_hours", 48))
    now_utc = datetime.now(timezone.utc)
    due_at_str = (now_utc + timedelta(hours=sla_hours)).strftime("%Y-%m-%d %H:%M:%S")

    if existing_case:
        preserved_status = existing_case["status"]
        now_utc = datetime.now(timezone.utc)

        # 1. First Priority: 24-Hour Policy Engine if case was RESOLVED or CLOSED
        if preserved_status == "RESOLVED":
            res_str = str(existing_case.get("resolved_at") or "").strip().replace("Z", "+00:00")
            elapsed_hours = 0.0
            if res_str:
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

            if elapsed_hours <= 24.0:
                # Requester replied within 24h grace window! Reopen to IN_PROGRESS at Step 2 (AUDIT_SECTION)
                reopened_str = now_utc.strftime("%Y-%m-%d %H:%M:%S")
                conn = get_connection()
                try:
                    conn.execute(
                        """
                        UPDATE cases
                        SET status = 'IN_PROGRESS',
                            workflow_state = 'AUDIT_SECTION',
                            reopened_at = ?,
                            reopened_by = ?,
                            reopen_reason = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                        """,
                        (
                            reopened_str,
                            email_row.get("sender_email") or "Requester (Email Reply)",
                            f"Replied within 24h grace window ({elapsed_hours:.1f}h elapsed)",
                            existing_case["db_id"],
                        ),
                    )
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
                        ) VALUES (?, ?, 'EMPLOYEE', ?, ?, ?, ?, 'THREAD_REPLY')
                        """,
                        (
                            existing_case["db_id"],
                            email_id,
                            email_row.get("sender_name") or "Requester",
                            email_row.get("account_email") or "PeopleDesk",
                            email_row.get("subject") or "",
                            email_row.get("body") or "",
                        ),
                    )
                    conn.commit()
                finally:
                    conn.close()

                log_event(
                    entity_type="CASE",
                    entity_id=existing_case["db_id"],
                    action="CASE_AUTO_REOPENED_24H",
                    description=f"Case #{existing_case['case_number']} auto-reopened: Requester replied within 24-hour grace window ({elapsed_hours:.1f}h elapsed). Returned to Step 2 (Audit & Execution).",
                    performed_by=email_row.get("sender_email") or "Requester",
                )
                return get_case_by_id_or_number(existing_case["db_id"])
            else:
                # Over 24 hours elapsed! Lock permanently in CLOSED state
                closed_str = now_utc.strftime("%Y-%m-%d %H:%M:%S")
                conn = get_connection()
                try:
                    conn.execute(
                        """
                        UPDATE cases
                        SET status = 'CLOSED',
                            workflow_state = 'CLOSED',
                            closed_at = COALESCE(closed_at, ?),
                            closed_by = COALESCE(closed_by, 'System Policy (24h Inactivity)'),
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                        """,
                        (closed_str, existing_case["db_id"]),
                    )
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
                        ) VALUES (?, ?, 'EMPLOYEE', ?, ?, ?, ?, 'THREAD_REPLY')
                        """,
                        (
                            existing_case["db_id"],
                            email_id,
                            email_row.get("sender_name") or "Requester",
                            email_row.get("account_email") or "PeopleDesk",
                            email_row.get("subject") or "",
                            email_row.get("body") or "",
                        ),
                    )
                    conn.commit()
                finally:
                    conn.close()

                log_event(
                    entity_type="CASE",
                    entity_id=existing_case["db_id"],
                    action="CASE_AUTO_CLOSED_24H",
                    description=f"Case #{existing_case['case_number']} locked in CLOSED state: Inbound reply arrived after 24h grace period ({elapsed_hours:.1f}h elapsed). Docket is sealed.",
                    performed_by="HR Flow Policy Engine",
                )
                return get_case_by_id_or_number(existing_case["db_id"])

        elif preserved_status == "CLOSED":
            # Case is permanently sealed; record message in communications but keep CLOSED
            conn = get_connection()
            try:
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
                    ) VALUES (?, ?, 'EMPLOYEE', ?, ?, ?, ?, 'THREAD_REPLY')
                    """,
                    (
                        existing_case["db_id"],
                        email_id,
                        email_row.get("sender_name") or "Requester",
                        email_row.get("account_email") or "PeopleDesk",
                        email_row.get("subject") or "",
                        email_row.get("body") or "",
                    ),
                )
                conn.commit()
            finally:
                conn.close()

            log_event(
                entity_type="CASE",
                entity_id=existing_case["db_id"],
                action="COMMUNICATION_ON_CLOSED_CASE",
                description=f"Inbound reply received on permanently CLOSED case #{existing_case['case_number']}. Docket remains sealed.",
                performed_by=email_row.get("sender_email") or "Requester",
            )
            return get_case_by_id_or_number(existing_case["db_id"])

        # Check if incoming message on existing open case contains the verified Employee ID!
        if effective_emp_id:
            from backend.models.employee import get_employee_by_employee_id, create_employee
            emp_rec = get_employee_by_employee_id(effective_emp_id)
            if not emp_rec:
                emp_name = (
                    (employee_match.get("extracted") or {}).get("candidate_name")
                    or email_row.get("sender_name")
                    or existing_case.get("employee_name")
                    or "Employee"
                )
                try:
                    emp_rec = create_employee({
                        "employee_id": effective_emp_id,
                        "name": emp_name,
                        "email": sender_email,
                        "department": existing_case.get("category"),
                        "source": "verified_reply",
                    })
                except Exception as e:
                    logger.warning(f"Failed to register verified employee {effective_emp_id}: {e}")

            matched_emp_db_id = None
            if emp_rec and isinstance(emp_rec, dict) and emp_rec.get("db_id"):
                matched_emp_db_id = int(emp_rec["db_id"])
            elif isinstance(emp_db_id, int):
                matched_emp_db_id = emp_db_id

            merged_fields = {}
            try:
                if existing_case.get("extracted_fields"):
                    merged_fields = json.loads(existing_case["extracted_fields"]) if isinstance(existing_case["extracted_fields"], str) else dict(existing_case["extracted_fields"])
            except Exception:
                pass
            merged_fields["employee_id"] = effective_emp_id
            for k, v in (extracted_fields.get("fields") or {}).items():
                if v and str(v).strip():
                    merged_fields[k] = v

            prev_stat = existing_case.get("status")
            new_stat = "READY" if prev_stat in ("ON_HOLD", "REVIEW_REQUIRED", "NEW") else prev_stat

            conn = get_connection()
            try:
                conn.execute(
                    """
                    UPDATE cases
                    SET status = ?,
                        employee_id = COALESCE(?, employee_id),
                        extracted_fields = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (new_stat, matched_emp_db_id, json.dumps(merged_fields), existing_case["db_id"]),
                )
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
                    ) VALUES (?, ?, 'EMPLOYEE', ?, ?, ?, ?, 'THREAD_REPLY')
                    """,
                    (
                        existing_case["db_id"],
                        email_id,
                        email_row.get("sender_name") or "Employee",
                        email_row.get("account_email") or "PeopleDesk",
                        email_row.get("subject") or "",
                        email_row.get("body") or "",
                    ),
                )
                if matched_emp_db_id:
                    conn.execute(
                        "UPDATE emails SET employee_id = ?, requires_review = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN (?, ?)",
                        (matched_emp_db_id, email_id, existing_case.get("email_id")),
                    )
                conn.commit()
            finally:
                conn.close()

            log_event(
                entity_type="CASE",
                entity_id=existing_case["db_id"],
                action="CASE_UNLOCKED_EMP_ID_VERIFIED",
                description=f"Case {existing_case['case_number']} unlocked! Employee ID '{effective_emp_id}' received and verified on reply thread. Status transitioned to {new_stat}.",
                performed_by=performed_by,
                metadata={
                    "case_number": existing_case["case_number"],
                    "employee_id": effective_emp_id,
                    "previous_status": prev_stat,
                    "new_status": new_stat,
                },
            )
            return get_case_by_id_or_number(existing_case["db_id"])

        preserved_status = existing_case["status"]
        if preserved_status not in ("IN_PROGRESS", "CLOSED"):
            preserved_status = target_status

        conn = get_connection()
        try:
            conn.execute(
                """
                UPDATE cases
                SET employee_id = COALESCE(?, employee_id),
                    status = ?,
                    priority = ?,
                    assigned_team = COALESCE(assigned_team, ?),
                    assigned_to = COALESCE(assigned_to, ?),
                    extracted_fields = ?,
                    validation_result = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    emp_db_id,
                    preserved_status,
                    priority,
                    assigned_team,
                    assigned_team,
                    json.dumps(extracted_fields.get("fields", {})),
                    json.dumps(validation_result),
                    existing_case["db_id"],
                ),
            )
            conn.commit()
        finally:
            conn.close()

        save_case_field_values(existing_case["db_id"], email_id, validation_result.get("field_checks", []))
        _seed_case_documents_and_comms(
            existing_case["db_id"],
            existing_case["case_number"],
            email_row,
            existing_case.get("category") or category,
            assigned_team,
        )
        return get_case_by_id_or_number(existing_case["db_id"])

    case_number = generate_next_case_number()
    title = email_row.get("subject") or f"{category} Request"
    description = (email_row.get("body") or "")[:1000]

    conn = get_connection()
    try:
        cur = conn.execute(
            """
            INSERT INTO cases (
                case_number,
                email_id,
                employee_id,
                category,
                intent,
                title,
                description,
                status,
                priority,
                assigned_team,
                assigned_user,
                assigned_to,
                sla_hours,
                due_at,
                extracted_fields,
                validation_result
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Vaibhav (HR)', ?, ?, ?, ?, ?)
            """,
            (
                case_number,
                email_id,
                emp_db_id,
                category,
                intent_str,
                title,
                description,
                target_status,
                priority,
                assigned_team,
                assigned_team,
                sla_hours,
                due_at_str,
                json.dumps(extracted_fields.get("fields", {})),
                json.dumps(validation_result),
            ),
        )
        new_case_db_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    save_case_field_values(new_case_db_id, email_id, validation_result.get("field_checks", []))
    _seed_case_documents_and_comms(new_case_db_id, case_number, email_row, category, assigned_team)

    log_event(
        entity_type="CASE",
        entity_id=new_case_db_id,
        action="CASE_CREATED",
        description=f"Case created → {case_number} (Status: {target_status})",
        performed_by=performed_by,
        metadata={
            "case_number": case_number,
            "email_id": email_id,
            "category": category,
            "status": target_status,
        },
    )

    log_event(
        entity_type="CASE",
        entity_id=new_case_db_id,
        action="CASE_ROUTED",
        description=f"Assigned → {assigned_team} (Priority: {priority}, SLA: {sla_hours}h)",
        performed_by=performed_by,
        metadata={
            "assigned_team": assigned_team,
            "priority": priority,
            "sla_hours": sla_hours,
        },
    )

    if emp_status != "REVIEW_REQUIRED" and category != "UNKNOWN":
        wf_inst = get_or_create_workflow_instance(
            case_id=new_case_db_id,
            category=category,
            performed_by=performed_by,
        )
        if wf_inst and category == "RESIGNATION" and target_status == "ON_HOLD":
            try:
                transition_workflow_state(
                    case_id=new_case_db_id,
                    trigger="REQUEST_DOCUMENTS",
                    performed_by="workflow_engine",
                )
            except Exception:
                pass

    if is_external_missing_emp_id:
        try:
            send_employee_id_clarification_email(
                case_identifier=new_case_db_id,
                email_row=email_row,
                performed_by=performed_by,
            )
        except Exception as e:
            logger.warning(f"Failed to send clarification email for case {case_number}: {e}")
    else:
        # Automatically send beautiful Case Registration & Tracking Details email to the employee/client who sent the mail
        try:
            subj_lower = (email_row.get("subject") or "").strip().lower()
            if not subj_lower.startswith("[hr flow") and not subj_lower.startswith("[case dispatch]"):
                send_case_created_email_to_employee(
                    case_identifier=new_case_db_id,
                    email_row=email_row,
                    performed_by=performed_by,
                    auto_triggered=True,
                )
        except Exception:
            pass

    return get_case_by_id_or_number(new_case_db_id)


def build_employee_case_email_payload(
    case_obj: Dict[str, Any],
    email_row: Optional[Dict[str, Any]] = None,
    recipient_override: Optional[str] = None,
    custom_note: Optional[str] = None,
    portal_base_url: str = "",
) -> Dict[str, Any]:
    """
    Build a rich, enterprise-styled HTML and plain-text email payload for the Employee / Client
    containing their newly generated Case Number, routing details, SLA window, extracted fields,
    and instructions/link to track their case progress online.
    """
    import html as html_lib

    resolved_base_url = Config.get_portal_base_url(portal_base_url)

    case_number = case_obj.get("case_number") or case_obj.get("id") or "CASE-2026-0001"
    title = case_obj.get("title") or (email_row.get("subject") if email_row else None) or "HR Support Request"
    category = (case_obj.get("category") or "GENERAL_HR").replace("_", " ").title()
    intent_raw = case_obj.get("intent") or "Standard Request"
    intent = intent_raw if "NOT_CONFIGURED" not in str(intent_raw) else f"{category} Inquiry"
    status_raw = (case_obj.get("status") or "NEW").upper()
    status_display = status_raw.replace("_", " ").title()
    priority = (case_obj.get("priority") or "MEDIUM").upper()
    assigned_team = case_obj.get("assigned_team") or "HR Operations"
    assigned_user = case_obj.get("assigned_user") or "Vaibhav (HR)"
    sla_hours = int(case_obj.get("sla_hours") or 48)
    due_display = case_obj.get("due_display") or case_obj.get("due_at") or f"Within {sla_hours} hours"
    created_at_str = case_obj.get("created_at") or datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")

    sender_email = (
        (recipient_override or "").strip()
        or (email_row.get("sender_email") if email_row else "")
        or case_obj.get("sender_email")
        or case_obj.get("employee_email")
        or ""
    ).strip()

    recipient_name = (
        case_obj.get("employee_name")
        or (email_row.get("sender_name") if email_row else "")
        or case_obj.get("sender_name")
        or (sender_email.split("@")[0] if sender_email else "Valued Employee / Client")
    ).strip()
    if recipient_name.lower() == "unverified sender" and sender_email:
        recipient_name = sender_email.split("@")[0].replace(".", " ").title()

    emp_code = case_obj.get("employee_id") or case_obj.get("employee_code") or "Pending Verification"
    emp_dept = case_obj.get("employee_department") or case_obj.get("department") or "—"

    ext_fields = case_obj.get("extracted_fields") or {}
    if isinstance(ext_fields, dict) and isinstance(ext_fields.get("fields"), dict):
        ext_fields = ext_fields["fields"]

    clean_ext_items = []
    if isinstance(ext_fields, dict):
        for k, v in ext_fields.items():
            if v is not None and not isinstance(v, (dict, list)) and str(v).strip() != "":
                clean_ext_items.append((k.replace("_", " ").title(), str(v).strip()))

    val_obj = case_obj.get("validation") or {}
    missing_fields = val_obj.get("missing_fields") or []

    tracking_url = f"{resolved_base_url.rstrip('/')}/track.html?case={html_lib.escape(case_number)}"
    subject = f"[HR Flow Case Created] {case_number} — {title}"

    # Status badge colors
    if status_raw in ("RESOLVED", "CLOSED", "READY"):
        status_bg, status_fg, status_border = "#ecfdf5", "#047857", "#a7f3d0"
    elif status_raw in ("ON_HOLD", "REVIEW_REQUIRED"):
        status_bg, status_fg, status_border = "#fffbeb", "#b45309", "#fde68a"
    else:
        status_bg, status_fg, status_border = "#eff6ff", "#1d4ed8", "#bfdbfe"

    # Priority badge colors
    if priority in ("HIGH", "CRITICAL"):
        prio_bg, prio_fg = "#fef2f2", "#dc2626"
    elif priority == "LOW":
        prio_bg, prio_fg = "#f8fafc", "#475569"
    else:
        prio_bg, prio_fg = "#eef2ff", "#4338ca"

    # Extracted fields rows HTML
    if clean_ext_items:
        ext_rows_html = "".join(
            f"""
            <tr>
                <td style="padding:10px 14px; border-bottom:1px solid #f1f5f9; font-size:13px; color:#64748b; font-weight:600; width:42%;">{html_lib.escape(k)}</td>
                <td style="padding:10px 14px; border-bottom:1px solid #f1f5f9; font-size:13px; color:#0f172a; font-weight:600;">{html_lib.escape(v)}</td>
            </tr>
            """
            for k, v in clean_ext_items
        )
        extracted_section_html = f"""
        <div style="margin-top:24px;">
            <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#475569; margin-bottom:10px;">
                📋 Captured Details From Your Email
            </div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; background:#ffffff;">
                {ext_rows_html}
            </table>
        </div>
        """
    else:
        extracted_section_html = ""

    # Missing fields alert HTML if any
    if missing_fields:
        missing_list_str = ", ".join(m.replace("_", " ").title() for m in missing_fields)
        missing_alert_html = f"""
        <div style="margin-top:20px; background:#fffbeb; border:1px solid #fde68a; border-left:4px solid #f59e0b; border-radius:10px; padding:14px 16px;">
            <div style="font-size:13px; font-weight:700; color:#92400e; margin-bottom:4px;">
                ⚠ Additional Information Needed to Process Faster
            </div>
            <div style="font-size:13px; color:#78350f; line-height:1.5;">
                Our automated check noticed the following detail(s) may be needed: <strong>{html_lib.escape(missing_list_str)}</strong>.
                You can reply to this email or upload details using your Case Number <strong>{html_lib.escape(case_number)}</strong>.
            </div>
        </div>
        """
    else:
        missing_alert_html = ""

    # Custom HR note if provided
    if custom_note and custom_note.strip():
        custom_note_html = f"""
        <div style="margin-top:20px; background:#f0f9ff; border:1px solid #bae6fd; border-left:4px solid #0284c7; border-radius:10px; padding:14px 16px;">
            <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#0369a1; margin-bottom:4px;">
                💬 Message from HR Operations
            </div>
            <div style="font-size:13.5px; color:#0c4a6e; line-height:1.55;">
                {html_lib.escape(custom_note.strip())}
            </div>
        </div>
        """
    else:
        custom_note_html = ""

    body_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{html_lib.escape(subject)}</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9; padding:32px 16px;">
        <tr>
            <td align="center">
                <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px; width:100%; background-color:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 12px 36px rgba(15, 23, 42, 0.08); border:1px solid #e2e8f0;">
                    
                    <!-- TOP GRADIENT HERO BANNER -->
                    <tr>
                        <td style="background:linear-gradient(135deg, #0f172a 0%, #1e3a8a 52%, #2563eb 100%); padding:34px 36px 30px 36px; color:#ffffff;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td>
                                        <span style="display:inline-block; background:rgba(255,255,255,0.16); color:#e0f2fe; font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; padding:5px 12px; border-radius:999px; border:1px solid rgba(255,255,255,0.22);">
                                            ✦ HR FLOW · CASE MANAGEMENT PORTAL
                                        </span>
                                    </td>
                                    <td align="right" style="font-size:12px; color:#cbd5e1; font-weight:500;">
                                        Ref: {html_lib.escape(case_number)}
                                    </td>
                                </tr>
                            </table>
                            <h1 style="margin:18px 0 8px 0; font-size:24px; font-weight:800; letter-spacing:-0.02em; color:#ffffff;">
                                Your Request Has Been Registered
                            </h1>
                            <p style="margin:0; font-size:14px; color:#dbeafe; line-height:1.55;">
                                We have received your email and created an official HR Case so you can track every step of your resolution in real time.
                            </p>
                        </td>
                    </tr>

                    <!-- MAIN CONTENT BODY -->
                    <tr>
                        <td style="padding:32px 36px;">
                            <p style="margin:0 0 14px 0; font-size:15px; color:#1e293b; font-weight:600;">
                                Hello {html_lib.escape(recipient_name)},
                            </p>
                            <p style="margin:0 0 24px 0; font-size:14px; color:#475569; line-height:1.65;">
                                Thank you for contacting HR Operations regarding <strong>&ldquo;{html_lib.escape(title)}&rdquo;</strong>.
                                Your request has been classified under <strong>{html_lib.escape(category)}</strong> and assigned to our <strong>{html_lib.escape(assigned_team)}</strong> specialist desk.
                            </p>

                            <!-- CASE NUMBER TRACKING HERO CARD -->
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(180deg, #f8fafc 0%, #eff6ff 100%); border:2px dashed #93c5fd; border-radius:16px; padding:22px 24px; text-align:center;">
                                <tr>
                                    <td>
                                        <div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.14em; color:#2563eb; margin-bottom:8px;">
                                            YOUR OFFICIAL CASE TRACKING NUMBER
                                        </div>
                                        <div style="display:inline-block; background:#0f172a; color:#ffffff; font-family:'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size:24px; font-weight:800; letter-spacing:0.06em; padding:10px 24px; border-radius:12px; box-shadow:0 4px 12px rgba(15,23,42,0.18);">
                                            {html_lib.escape(case_number)}
                                        </div>
                                        <div style="margin-top:12px; font-size:12.5px; color:#475569;">
                                            Save this Case Number — enter it on the <strong>Employee &amp; Client Tracking Website</strong> to view live progress.
                                        </div>
                                        <div style="margin-top:14px;">
                                            <span style="display:inline-block; background:{status_bg}; color:{status_fg}; border:1px solid {status_border}; font-size:11.5px; font-weight:700; padding:4px 12px; border-radius:999px; margin:0 4px;">
                                                ● Status: {html_lib.escape(status_display)}
                                            </span>
                                            <span style="display:inline-block; background:{prio_bg}; color:{prio_fg}; font-size:11.5px; font-weight:700; padding:4px 12px; border-radius:999px; margin:0 4px;">
                                                Priority: {html_lib.escape(priority)}
                                            </span>
                                            <span style="display:inline-block; background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; font-size:11.5px; font-weight:700; padding:4px 12px; border-radius:999px; margin:0 4px;">
                                                ⏱ SLA: {sla_hours} Hours
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            </table>

                            <!-- LIVE PROGRESS STEPPER BAR -->
                            <div style="margin-top:24px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:16px 18px;">
                                <div style="font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#64748b; margin-bottom:12px;">
                                    🔄 Case Resolution Lifecycle
                                </div>
                                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                    <tr>
                                        <td width="25%" align="center" style="padding:4px;">
                                            <div style="width:26px; height:26px; line-height:26px; border-radius:50%; background:#10b981; color:#ffffff; font-size:12px; font-weight:800; margin:0 auto;">✓</div>
                                            <div style="font-size:11px; font-weight:700; color:#0f172a; margin-top:6px;">1. Email Received</div>
                                        </td>
                                        <td width="25%" align="center" style="padding:4px;">
                                            <div style="width:26px; height:26px; line-height:26px; border-radius:50%; background:#2563eb; color:#ffffff; font-size:12px; font-weight:800; margin:0 auto;">2</div>
                                            <div style="font-size:11px; font-weight:700; color:#2563eb; margin-top:6px;">2. Case Routed</div>
                                        </td>
                                        <td width="25%" align="center" style="padding:4px;">
                                            <div style="width:26px; height:26px; line-height:26px; border-radius:50%; background:#e2e8f0; color:#64748b; font-size:12px; font-weight:700; margin:0 auto;">3</div>
                                            <div style="font-size:11px; font-weight:600; color:#64748b; margin-top:6px;">3. HR Processing</div>
                                        </td>
                                        <td width="25%" align="center" style="padding:4px;">
                                            <div style="width:26px; height:26px; line-height:26px; border-radius:50%; background:#e2e8f0; color:#64748b; font-size:12px; font-weight:700; margin:0 auto;">4</div>
                                            <div style="font-size:11px; font-weight:600; color:#64748b; margin-top:6px;">4. Resolved</div>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            {custom_note_html}
                            {missing_alert_html}

                            <!-- COMPLETE CASE DETAILS TABLE -->
                            <div style="margin-top:24px;">
                                <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#475569; margin-bottom:10px;">
                                    📌 Complete Case &amp; Routing Summary
                                </div>
                                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; background:#ffffff;">
                                    <tr style="background:#f8fafc;">
                                        <td style="padding:11px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#64748b; font-weight:600; width:42%;">Case Number</td>
                                        <td style="padding:11px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#0f172a; font-weight:800;">{html_lib.escape(case_number)}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:11px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#64748b; font-weight:600;">Request Subject</td>
                                        <td style="padding:11px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#0f172a; font-weight:600;">{html_lib.escape(title)}</td>
                                    </tr>
                                    <tr style="background:#f8fafc;">
                                        <td style="padding:11px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#64748b; font-weight:600;">Category &amp; Intent</td>
                                        <td style="padding:11px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#0f172a; font-weight:600;">{html_lib.escape(category)} · {html_lib.escape(intent)}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:11px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#64748b; font-weight:600;">Assigned Department</td>
                                        <td style="padding:11px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#0f172a; font-weight:700;">{html_lib.escape(assigned_team)}</td>
                                    </tr>
                                    <tr style="background:#f8fafc;">
                                        <td style="padding:11px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#64748b; font-weight:600;">Assigned HR Specialist</td>
                                        <td style="padding:11px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#0f172a; font-weight:600;">{html_lib.escape(assigned_user)}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:11px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#64748b; font-weight:600;">Employee / Client Profile</td>
                                        <td style="padding:11px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#0f172a; font-weight:600;">{html_lib.escape(recipient_name)} ({html_lib.escape(emp_code)}) · {html_lib.escape(emp_dept)}</td>
                                    </tr>
                                    <tr style="background:#f8fafc;">
                                        <td style="padding:11px 14px; font-size:13px; color:#64748b; font-weight:600;">Expected Resolution (SLA)</td>
                                        <td style="padding:11px 14px; font-size:13px; color:#059669; font-weight:700;">Within {sla_hours} Hours (Target: {html_lib.escape(str(due_display))})</td>
                                    </tr>
                                </table>
                            </div>

                            {extracted_section_html}

                            <!-- TRACKING PORTAL CTA CARD -->
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px; background:#0f172a; border-radius:16px; padding:24px; color:#ffffff;">
                                <tr>
                                    <td>
                                        <div style="font-size:15px; font-weight:800; color:#ffffff; margin-bottom:6px;">
                                            🔍 How to Track Your Case Progress Online
                                        </div>
                                        <p style="margin:0 0 18px 0; font-size:13px; color:#cbd5e1; line-height:1.55;">
                                            Open the <strong>HR Flow Employee &amp; Client Tracking Portal</strong> and enter your Case Number <strong style="color:#ffffff;">{html_lib.escape(case_number)}</strong> to view real-time workflow steps, specialist updates, and resolution status.
                                        </p>
                                        <a href="{tracking_url}" style="display:inline-block; background:#2563eb; color:#ffffff; text-decoration:none; font-size:13.5px; font-weight:700; padding:12px 22px; border-radius:10px; box-shadow:0 4px 12px rgba(37, 99, 235, 0.35);">
                                            Track Case {html_lib.escape(case_number)} Online &rarr;
                                        </a>
                                    </td>
                                </tr>
                            </table>

                        </td>
                    </tr>

                    <!-- FOOTER -->
                    <tr>
                        <td style="background:#f8fafc; border-top:1px solid #e2e8f0; padding:20px 36px; text-align:center;">
                            <div style="font-size:12px; font-weight:700; color:#475569;">
                                HR FLOW — Automated Case &amp; Workflow Operations
                            </div>
                            <div style="font-size:11.5px; color:#94a3b8; margin-top:4px;">
                                Registered on {html_lib.escape(str(created_at_str))} · Please keep <strong>[{html_lib.escape(case_number)}]</strong> in the subject line if replying to this email.
                            </div>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>"""

    ext_text_block = (
        "\n".join(f"  • {k}: {v}" for k, v in clean_ext_items)
        if clean_ext_items
        else "  • Standard HR request details logged."
    )

    body_text = (
        f"Hello {recipient_name},\n\n"
        f"Your email regarding \"{title}\" has been received by HR Flow Operations and an official HR Case has been registered.\n\n"
        f"==================================================\n"
        f"  OFFICIAL CASE NUMBER : {case_number}\n"
        f"  CURRENT STATUS       : {status_display}\n"
        f"  PRIORITY & SLA       : {priority} ({sla_hours} Hours · Target: {due_display})\n"
        f"==================================================\n\n"
        f"CASE & ROUTING DETAILS:\n"
        f"  • Case Number         : {case_number}\n"
        f"  • Request Subject     : {title}\n"
        f"  • Category / Intent   : {category} ({intent})\n"
        f"  • Assigned Department : {assigned_team}\n"
        f"  • Assigned Specialist : {assigned_user}\n"
        f"  • Employee / Client   : {recipient_name} ({emp_code})\n\n"
        f"CAPTURED REQUEST DETAILS:\n"
        f"{ext_text_block}\n\n"
        + (f"NOTE FROM HR:\n  {custom_note.strip()}\n\n" if custom_note and custom_note.strip() else "")
        + f"HOW TO TRACK YOUR CASE PROGRESS:\n"
        f"  1. Copy your Case Number: {case_number}\n"
        f"  2. Visit the Employee & Client Tracking Portal: {tracking_url}\n"
        f"  3. Enter your Case Number to view live workflow stages and HR updates.\n\n"
        f"— HR Flow Operations Portal\n"
    )

    return {
        "case_id": case_obj.get("db_id"),
        "case_number": case_number,
        "recipient_email": sender_email,
        "recipient_name": recipient_name,
        "subject": subject,
        "body_text": body_text,
        "body_html": body_html,
        "tracking_url": tracking_url,
    }


def is_admin_logged_in_or_suppressed(
    email_row: Optional[Dict[str, Any]] = None,
    performed_by: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    Check if auto-reply should be suppressed because a user is logged in as ADMIN
    (or because the active actor / sender is an Admin).
    Rule: When a user is logged in as Admin, automated email replies / acknowledgements are disabled.
    """
    # 1. Check Flask request context (active browser session making the request)
    try:
        from flask import has_request_context, request
        if has_request_context():
            hdr_role = (request.headers.get("X-HR-Role") or "").strip().upper()
            if hdr_role in ("ADMIN", "SUPER_ADMIN"):
                return True, "User is logged in as ADMIN (Request Header)"

            from backend.api.auth_routes import get_session_user_from_request
            session_user = get_session_user_from_request()
            if session_user:
                sess_role = str(session_user.get("role") or "").strip().upper()
                if sess_role in ("ADMIN", "SUPER_ADMIN"):
                    return True, f"User is logged in as ADMIN ({session_user.get('email') or 'Admin'})"
    except Exception:
        pass

    # 2. Check active in-memory sessions
    try:
        from backend.api.auth_routes import _ACTIVE_SESSIONS
        for tok, prof in list(_ACTIVE_SESSIONS.items()):
            if isinstance(prof, dict):
                r = str(prof.get("role") or "").strip().upper()
                if r in ("ADMIN", "SUPER_ADMIN"):
                    return True, f"Admin session active ({prof.get('email') or 'Admin'})"
    except Exception:
        pass

    # 3. Check SQLite user_sessions (persisted sessions logged in recently)
    conn = get_connection()
    try:
        latest_session = conn.execute(
            """
            SELECT email, role, last_seen_at FROM user_sessions
            ORDER BY last_seen_at DESC LIMIT 1
            """
        ).fetchone()
        if latest_session and str(latest_session["role"]).strip().upper() in ("ADMIN", "SUPER_ADMIN"):
            try:
                dt = datetime.strptime(str(latest_session["last_seen_at"])[:19], "%Y-%m-%d %H:%M:%S")
                # Active if seen within last 2 hours
                if (datetime.utcnow() - dt).total_seconds() < 7200:
                    return True, f"Admin session active ({latest_session['email']})"
            except Exception:
                return True, f"Admin session logged in ({latest_session['email']})"

        # 4. Check if performed_by indicates Admin
        if performed_by:
            p_upper = str(performed_by).strip().upper()
            if "ADMIN" in p_upper:
                return True, f"Performed by Admin ({performed_by})"

        # 5. Check if the email sender is an Admin user
        if email_row and email_row.get("sender_email"):
            s_email = email_row["sender_email"].strip().lower()
            sender_user = conn.execute(
                "SELECT role FROM users WHERE LOWER(email) = LOWER(?)",
                (s_email,),
            ).fetchone()
            if sender_user and str(sender_user["role"]).strip().upper() in ("ADMIN", "SUPER_ADMIN"):
                return True, f"Email sender is an Admin user ({s_email})"

            sender_member = conn.execute(
                "SELECT role FROM hr_department_members WHERE LOWER(email) = LOWER(?) AND active = 1",
                (s_email,),
            ).fetchone()
            if sender_member and str(sender_member["role"]).strip().upper() in ("ADMIN", "SUPER_ADMIN"):
                return True, f"Email sender is an Admin member ({s_email})"

        # 6. Check if the connected intake mailbox has role 'ADMIN'
        if email_row and email_row.get("account_email"):
            acct_email = email_row["account_email"].strip().lower()
            mbox = conn.execute(
                "SELECT role FROM connected_mailboxes WHERE LOWER(email) = LOWER(?) AND connected = 1",
                (acct_email,),
            ).fetchone()
            if mbox and str(mbox["role"]).strip().upper() in ("ADMIN", "SUPER_ADMIN"):
                return True, f"Intake mailbox operated by Admin ({acct_email})"
    except Exception:
        pass
    finally:
        conn.close()

    return False, ""


def send_case_created_email_to_employee(
    case_identifier: Any,
    email_row: Optional[Dict[str, Any]] = None,
    recipient_override: Optional[str] = None,
    custom_note: Optional[str] = None,
    performed_by: str = "HR Flow System",
    auto_triggered: bool = False,
) -> Dict[str, Any]:
    """
    Send the beautifully formatted Case Creation & Tracking Details email to the employee/client
    via Gmail SMTP, record it in `case_communications`, and log an audit trail event.
    When `auto_triggered=True`, deduplicates so the same case never sends duplicate auto-acknowledgements,
    and enforces the rule that if a user is logged in as ADMIN, no auto-reply is sent.
    """
    from backend.services.gmail.gmail_client import send_gmail_smtp_email

    case_obj = get_case_by_id_or_number(case_identifier)
    if not case_obj:
        raise ValueError(f"Case '{case_identifier}' not found.")

    case_db_id = int(case_obj["db_id"])

    if auto_triggered:
        conn = get_connection()
        try:
            already_sent = conn.execute(
                "SELECT id FROM case_communications WHERE case_id = ? AND comm_type = 'CASE_ACK_EMAIL' LIMIT 1",
                (case_db_id,),
            ).fetchone()
            if already_sent:
                return {
                    "sent": False,
                    "status": "SKIPPED_ALREADY_SENT",
                    "case_number": case_obj["case_number"],
                    "message": "Employee case acknowledgement email was already sent for this case.",
                }
        finally:
            conn.close()

        # Enforce Rule: If user is logged in as Admin, no auto reply
        suppressed, reason = is_admin_logged_in_or_suppressed(
            email_row=email_row, performed_by=performed_by
        )
        if suppressed:
            dispatch_status_str = f"AUTO_REPLY_SUPPRESSED ({reason})"
            now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            conn = get_connection()
            try:
                conn.execute(
                    """
                    UPDATE cases
                    SET last_dispatch_status = ?,
                        last_dispatched_at = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (dispatch_status_str, now_str, case_db_id),
                )
                conn.commit()
            finally:
                conn.close()

            log_event(
                entity_type="CASE",
                entity_id=case_db_id,
                action="AUTO_REPLY_SUPPRESSED_ADMIN",
                description=f"Auto reply skipped for Case {case_obj['case_number']}: {reason} (Rule: Admin login disables auto reply)",
                performed_by=performed_by or "HR Flow System (Admin Rule)",
                metadata={
                    "case_number": case_obj["case_number"],
                    "reason": reason,
                    "recipient": (email_row or {}).get("sender_email"),
                },
            )
            return {
                "sent": False,
                "status": "SKIPPED_ADMIN_LOGGED_IN",
                "case_number": case_obj["case_number"],
                "message": f"Auto-reply disabled: {reason} (Admin login auto-reply suppression rule enforced).",
            }

    if not email_row and case_obj.get("email_id"):
        conn = get_connection()
        try:
            r = conn.execute("SELECT * FROM emails WHERE id = ?", (int(case_obj["email_id"]),)).fetchone()
            if r:
                email_row = dict(r)
        finally:
            conn.close()

    mail_payload = build_employee_case_email_payload(
        case_obj=case_obj,
        email_row=email_row,
        recipient_override=recipient_override,
        custom_note=custom_note,
    )
    to_addr = mail_payload["recipient_email"]
    if not to_addr or "@" not in to_addr:
        return {
            "sent": False,
            "status": "SKIPPED_NO_RECIPIENT",
            "case_number": case_obj["case_number"],
            "message": "No valid employee/client email address found for this case.",
        }

    smtp_res = send_gmail_smtp_email(
        recipient_email=to_addr,
        subject=mail_payload["subject"],
        body_text=mail_payload["body_text"],
        body_html=mail_payload["body_html"],
    )

    dispatch_status_str = f"EMPLOYEE_ACK ({smtp_res['status']}) → {to_addr}"
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE cases
            SET last_dispatch_status = ?,
                last_dispatched_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (dispatch_status_str, now_str, case_db_id),
        )
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
            ) VALUES (?, ?, 'HR_SYSTEM', ?, ?, ?, ?, 'CASE_ACK_EMAIL')
            """,
            (
                case_db_id,
                case_obj.get("email_id"),
                performed_by,
                f"{mail_payload['recipient_name']} <{to_addr}>",
                mail_payload["subject"],
                mail_payload["body_text"],
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
            ) VALUES ('EMPLOYEE_ACK_SENT', ?, ?, ?, ?, ?)
            """,
            (
                f"Case Confirmation Sent: {case_obj['case_number']}",
                f"Beautiful HTML Case Details & Tracking Number sent to {to_addr} ({smtp_res['status']})",
                case_db_id,
                case_obj["case_number"],
                case_obj.get("assigned_user") or case_obj.get("assigned_team") or "HR Operations",
            ),
        )
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case_db_id,
        action="EMPLOYEE_ACK_EMAIL_SENT",
        description=f"Case details & tracking number ({case_obj['case_number']}) emailed to {to_addr} ({smtp_res['status']})",
        performed_by=performed_by,
        metadata={
            "case_number": case_obj["case_number"],
            "recipient": to_addr,
            "subject": mail_payload["subject"],
            "smtp_status": smtp_res["status"],
            "sent": smtp_res["sent"],
            "tracking_url": mail_payload["tracking_url"],
        },
    )

    return {
        **smtp_res,
        "case_number": case_obj["case_number"],
        "recipient_email": to_addr,
        "recipient_name": mail_payload["recipient_name"],
        "subject": mail_payload["subject"],
        "tracking_url": mail_payload["tracking_url"],
        "body_html": mail_payload["body_html"],
    }


def send_employee_id_clarification_email(
    case_identifier: Any,
    email_row: Optional[Dict[str, Any]] = None,
    performed_by: str = "HR Flow Security Policy",
) -> Dict[str, Any]:
    """
    Auto-dispatches clarification email to external senders missing an Employee ID.
    Enforces 1MG Data Security Policy, records communication, and sets status ON_HOLD.
    """
    from backend.services.gmail.gmail_client import send_gmail_smtp_email

    case_obj = get_case_by_id_or_number(case_identifier)
    if not case_obj:
        raise ValueError(f"Case '{case_identifier}' not found.")

    case_db_id = int(case_obj["db_id"])
    case_number = case_obj["case_number"]

    if not email_row and case_obj.get("email_id"):
        conn = get_connection()
        try:
            r = conn.execute("SELECT * FROM emails WHERE id = ?", (int(case_obj["email_id"]),)).fetchone()
            if r:
                email_row = dict(r)
        finally:
            conn.close()

    sender_email = (email_row or {}).get("sender_email") or case_obj.get("email_sender_email") or ""
    sender_name = (email_row or {}).get("sender_name") or case_obj.get("email_sender_name") or "Employee"

    if not sender_email or "@" not in sender_email:
        return {"sent": False, "status": "SKIPPED_NO_RECIPIENT", "case_number": case_number}

    # Deduplicate: Check if clarification was already sent for this case
    conn = get_connection()
    try:
        already_sent = conn.execute(
            "SELECT id FROM case_communications WHERE case_id = ? AND comm_type = 'AWAITING_EMP_ID_CLARIFICATION' LIMIT 1",
            (case_db_id,),
        ).fetchone()
        if already_sent:
            return {"sent": False, "status": "SKIPPED_ALREADY_SENT", "case_number": case_number}
    finally:
        conn.close()

    orig_subject = (email_row or {}).get("subject") or case_obj.get("title") or "HR Inquiry"
    clean_subj = orig_subject.strip()
    if clean_subj.lower().startswith("re:"):
        clean_subj = clean_subj[3:].strip()
    subject = f"Re: {clean_subj} — Action Required: Please confirm your Employee ID [#{case_number}]"

    orig_msg_id = (email_row or {}).get("provider_message_id")

    body_text = f"""Dear {sender_name},

We received your HR inquiry from a personal email address ({sender_email}). Under 1MG Data Security Policy, employee verification is required before case processing can begin.

Please reply directly to this email with:
1. Official 1MG Employee ID (e.g. your official Employee Code)
2. Full Name & Department

Your case ({case_number}) is currently on hold and will unlock automatically upon your reply.

Best regards,
1MG People Operations Desk
Tata 1mg Healthcare Solutions
"""

    body_html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 10px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
    <div style="background: #d97706; padding: 20px 24px; color: #ffffff;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.01em;">Action Required: Employee Verification</h2>
      <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.95;">Case #{case_number} · Tata 1mg People Operations</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin-top: 0; font-size: 14px;">Dear <strong>{sender_name}</strong>,</p>
      <p style="font-size: 14px; color: #334155;">We received your HR inquiry from an external email address (<code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">{sender_email}</code>).</p>
      <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 14px 16px; margin: 18px 0; border-radius: 0 6px 6px 0;">
        <strong style="color: #92400e; font-size: 13px;">Security & Privacy Compliance Gate:</strong>
        <p style="margin: 4px 0 0 0; font-size: 13px; color: #b45309;">Under 1MG Data Security Policy, employee identity verification is mandatory before confidential payroll or HR records can be accessed.</p>
      </div>
      <p style="font-size: 14px; font-weight: 600; color: #0f172a;">Please reply directly to this email with:</p>
      <ul style="font-size: 13.5px; color: #1e293b; padding-left: 20px;">
        <li><strong>Official 1MG Employee ID</strong> (e.g., your official Employee Code)</li>
        <li><strong>Full Name & Department</strong></li>
      </ul>
      <p style="font-size: 13px; color: #64748b; margin-top: 20px;">Once you reply, your case will unlock automatically and our People Operations team will begin processing your inquiry immediately.</p>
    </div>
    <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 14px 24px; font-size: 11.5px; color: #64748b;">
      Tata 1mg Healthcare Solutions Private Limited · People Operations & Compliance
    </div>
  </div>
</body>
</html>"""

    target_acct_email = (email_row or {}).get("account_email") or case_obj.get("account_email")

    smtp_res = send_gmail_smtp_email(
        recipient_email=sender_email,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        in_reply_to=orig_msg_id,
        references=orig_msg_id,
        account_email=target_acct_email,
    )

    dispatch_status_str = f"CLARIFICATION_SENT ({smtp_res['status']}) -> {sender_email}"
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE cases
            SET last_dispatch_status = ?,
                last_dispatched_at = ?,
                status = 'ON_HOLD',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (dispatch_status_str, now_str, case_db_id),
        )
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
            ) VALUES (?, ?, 'HR_SYSTEM', ?, ?, ?, ?, 'AWAITING_EMP_ID_CLARIFICATION')
            """,
            (
                case_db_id,
                case_obj.get("email_id"),
                performed_by,
                f"{sender_name} <{sender_email}>",
                subject,
                body_text,
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
                recipient_role,
                is_read
            ) VALUES ('CLARIFICATION_DISPATCHED', ?, ?, ?, ?, 'HR_SPECIALIST', 0)
            """,
            (
                f"Clarification Sent: {case_number}",
                f"Automated Employee ID verification requested from external sender {sender_email}. Case placed ON_HOLD.",
                case_db_id,
                case_number,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case_db_id,
        action="EMP_ID_CLARIFICATION_DISPATCHED",
        description=f"Auto-clarification sent to {sender_email} for Case {case_number}. Status set to ON_HOLD awaiting Employee ID.",
        performed_by=performed_by,
        metadata={
            "case_number": case_number,
            "sender_email": sender_email,
            "status": "ON_HOLD",
            "dispatch_status": dispatch_status_str,
        },
    )

    return {
        "sent": True,
        "status": smtp_res["status"],
        "case_number": case_number,
        "recipient": sender_email,
    }


