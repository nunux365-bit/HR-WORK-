"""
HR FLOW — Phase 4 & 5 Gmail Inbox Fetcher, Deduplicator & SQLite Persistence
(backend/services/gmail/gmail_fetcher.py)

Clean Architecture Flow:
  gmail_fetcher
       ↓
  stores email in SQLite (`emails` + `audit_logs`)
       ↓
  employee_service (`process_email_employee_identification`)
       ↓
  matches employee & updates `emails.employee_id` / `emails.requires_review`

Does NOT call AI category/intent models (reserved for Phases 6-10).
"""

import json
import logging
import os
from typing import Dict, Any, List, Optional

from backend.config import Config
from backend.database.connection import get_connection
from backend.services.gmail.gmail_client import (
    open_imap_session,
    update_last_sync,
    get_active_account_email,
)
from backend.services.gmail.email_parser import parse_raw_email
from backend.services.gmail.attachment_parser import save_attachment_file
from backend.services.employees.employee_service import process_email_employee_identification

logger = logging.getLogger("hrflow.gmail.fetcher")


def store_parsed_email(parsed: Dict[str, Any], account_email: Optional[str] = None) -> Dict[str, Any]:
    """
    Persist a single parsed email dictionary into SQLite `emails` table if not already present
    for the target `account_email`, then invoke `employee_service.process_email_employee_identification`.
    Returns {"inserted": bool, "email_id": int, "provider_message_id": str, "employee_match": dict}.
    """
    acct = (account_email or parsed.get("account_email") or "").strip().lower() or None
    raw_msg_id = parsed["provider_message_id"]
    scoped_msg_id = f"{acct}::{raw_msg_id}" if acct else raw_msg_id

    conn = get_connection()
    new_email_id: Optional[int] = None
    effective_msg_id = raw_msg_id
    try:
        if acct:
            existing_for_acct = conn.execute(
                """
                SELECT id, provider_message_id FROM emails
                WHERE provider = ?
                  AND provider_message_id IN (?, ?)
                  AND LOWER(account_email) = LOWER(?)
                LIMIT 1
                """,
                (parsed["provider"], raw_msg_id, scoped_msg_id, acct),
            ).fetchone()
            if existing_for_acct:
                return {
                    "inserted": False,
                    "email_id": int(existing_for_acct["id"]),
                    "provider_message_id": existing_for_acct["provider_message_id"],
                }

        existing = conn.execute(
            "SELECT id, account_email, provider_message_id FROM emails WHERE provider = ? AND provider_message_id = ?",
            (parsed["provider"], raw_msg_id)
        ).fetchone()

        if existing:
            if not acct or not existing["account_email"] or existing["account_email"].strip().lower() == acct:
                if acct and not existing["account_email"]:
                    conn.execute(
                        "UPDATE emails SET account_email = ? WHERE id = ?",
                        (acct, int(existing["id"])),
                    )
                    conn.commit()
                return {
                    "inserted": False,
                    "email_id": int(existing["id"]),
                    "provider_message_id": existing["provider_message_id"],
                }
            else:
                # Another Gmail account already stored a copy of this Message-ID (e.g. sent between accounts)
                effective_msg_id = scoped_msg_id

        cursor = conn.execute(
            """
            INSERT INTO emails (
                provider,
                provider_message_id,
                account_email,
                thread_id,
                sender_name,
                sender_email,
                subject,
                body,
                received_at,
                employee_id,
                processing_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'RECEIVED')
            """,
            (
                parsed["provider"],
                effective_msg_id,
                acct,
                parsed["thread_id"],
                parsed["sender_name"],
                parsed["sender_email"],
                parsed["subject"],
                parsed["body"],
                parsed["received_at"],
            )
        )
        new_email_id = int(cursor.lastrowid)

        # Persist binary attachments to disk and record in email_attachments
        for att in parsed.get("attachments", []):
            payload = att.get("_payload_bytes")
            if payload:
                try:
                    saved = save_attachment_file(
                        email_id=new_email_id,
                        filename=att.get("filename") or "attachment.bin",
                        payload=payload,
                        content_type=att.get("content_type") or "application/octet-stream"
                    )
                    att_cur = conn.execute(
                        """
                        INSERT INTO email_attachments (
                            email_id, filename, storage_path, content_type, size_bytes, file_hash
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            new_email_id,
                            saved["filename"],
                            saved["storage_path"],
                            saved["content_type"],
                            saved["size_bytes"],
                            saved["file_hash"],
                        )
                    )
                    att_id = int(att_cur.lastrowid)
                    att["id"] = att_id
                    att["attachment_id"] = att_id
                    att["storage_path"] = saved["storage_path"]
                    att["has_file"] = True
                except Exception as save_err:
                    logger.warning(f"Failed to persist attachment for email {new_email_id}: {save_err}")

        # Record ingestion audit log (including attachment metadata, stripping raw byte buffers)
        clean_attachments = [
            {k: v for k, v in a.items() if not k.startswith("_")}
            for a in parsed.get("attachments", [])
        ]
        metadata_json = json.dumps({
            "provider_message_id": effective_msg_id,
            "account_email": acct,
            "sender_email": parsed["sender_email"],
            "attachments": clean_attachments,
        })
        conn.execute(
            """
            INSERT INTO audit_logs (
                entity_type,
                entity_id,
                action,
                description,
                performed_by,
                metadata
            ) VALUES ('EMAIL', ?, 'EMAIL_INGESTED', ?, 'gmail_sync', ?)
            """,
            (
                str(new_email_id),
                f"Email ingested from {parsed['sender_email']}: {parsed['subject']}",
                metadata_json,
            )
        )

        conn.commit()
    finally:
        conn.close()

    # Delegate employee intelligence strictly to Employee Service
    employee_match = process_email_employee_identification(new_email_id)

    return {
        "inserted": True,
        "email_id": new_email_id,
        "provider_message_id": effective_msg_id,
        "employee_match": employee_match,
    }


def _reconcile_deleted_inbox_emails(active_account: Optional[str], current_email_ids: List[int]) -> int:
    """
    Safely retain historic emails and cases. Avoid purging records when IMAP syncs a sliding window.
    """
    return 0


def _find_existing_email_id_by_header(active_account: Optional[str], raw_header_bytes: bytes, uid_str: str) -> Optional[int]:
    """Check if an email with the given Message-ID header already exists in SQLite for `active_account`."""
    from email import message_from_bytes
    try:
        msg = message_from_bytes(raw_header_bytes)
        msg_id = (msg.get("Message-ID") or msg.get("Message-Id") or "").strip()
    except Exception:
        msg_id = ""
    if not msg_id:
        msg_id = f"gmail-uid-{uid_str}"

    scoped_msg_id = f"{active_account}::{msg_id}" if active_account else msg_id
    conn = get_connection()
    try:
        if active_account:
            row = conn.execute(
                """
                SELECT id FROM emails
                WHERE provider_message_id IN (?, ?)
                  AND LOWER(account_email) = LOWER(?)
                LIMIT 1
                """,
                (msg_id, scoped_msg_id, active_account),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM emails WHERE provider_message_id = ? LIMIT 1",
                (msg_id,),
            ).fetchone()
        return int(row["id"]) if row else None
    finally:
        conn.close()


def sync_gmail_inbox(limit: Optional[int] = None, account_email: Optional[str] = None) -> Dict[str, Any]:
    """
    Connect to Gmail IMAP, fetch the most recent `limit` messages from INBOX,
    check Message-ID headers first to skip re-downloading existing emails,
    parse & store new records in SQLite, reconcile deleted messages,
    and run Employee Service + Phase 6 AI pipeline on new emails.
    """
    fetch_limit = int(limit or Config.GMAIL_SYNC_LIMIT)
    active_account = get_active_account_email(account_email)
    imap = open_imap_session(account_email=active_account)

    fetched_count = 0
    new_stored_count = 0
    skipped_duplicates = 0
    stored_ids: List[int] = []

    try:
        status, messages = imap.select("INBOX", readonly=True)
        inbox_total = int(messages[0]) if status == "OK" and messages and messages[0] else 0

        typ, data = imap.uid("search", None, "ALL")
        if typ != "OK" or not data or not data[0]:
            removed_count = _reconcile_deleted_inbox_emails(active_account, [])
            sync_time = update_last_sync(inbox_total=inbox_total, account_email=active_account)
            return {
                "inbox_total": inbox_total,
                "fetched_count": 0,
                "new_stored_count": 0,
                "skipped_duplicates": 0,
                "removed_deleted_count": removed_count,
                "last_sync_at": sync_time,
            }

        all_uids = data[0].split()
        recent_uids = all_uids[-fetch_limit:]
        had_fetch_error = False
        # Process newest first
        for uid_bytes in reversed(recent_uids):
            uid_str = uid_bytes.decode("utf-8", errors="ignore")

            # Fast path: check Message-ID header first so we don't re-download full RFC822 for existing emails
            existing_id: Optional[int] = None
            try:
                typ_hdr, hdr_data = imap.uid("fetch", uid_bytes, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
                if typ_hdr == "OK" and hdr_data:
                    for h_item in hdr_data:
                        if isinstance(h_item, tuple) and len(h_item) >= 2 and isinstance(h_item[1], (bytes, bytearray)):
                            existing_id = _find_existing_email_id_by_header(active_account, bytes(h_item[1]), uid_str)
                            break
            except Exception:
                existing_id = None

            if existing_id is not None:
                fetched_count += 1
                skipped_duplicates += 1
                stored_ids.append(existing_id)
                continue

            try:
                typ_fetch, msg_data = imap.uid("fetch", uid_bytes, "(RFC822)")
            except Exception as fetch_err:
                logger.warning(f"Transient IMAP fetch error on UID {uid_str}, reconnecting: {fetch_err}")
                try:
                    imap = open_imap_session(account_email=active_account)
                    imap.select("INBOX", readonly=True)
                    typ_fetch, msg_data = imap.uid("fetch", uid_bytes, "(RFC822)")
                except Exception as retry_err:
                    logger.warning(f"Skipping UID {uid_str} after retry failure: {retry_err}")
                    had_fetch_error = True
                    continue

            if typ_fetch != "OK" or not msg_data:
                had_fetch_error = True
                continue

            raw_bytes = None
            for item in msg_data:
                if isinstance(item, tuple) and len(item) >= 2 and isinstance(item[1], (bytes, bytearray)):
                    raw_bytes = bytes(item[1])
                    break

            if not raw_bytes:
                had_fetch_error = True
                continue

            fetched_count += 1
            parsed = parse_raw_email(raw_bytes, fallback_uid=uid_str)
            sender_lower = (parsed.get("sender_email") or "").strip().lower()
            subj_lower = (parsed.get("subject") or "").strip().lower()
            if "mailer-daemon" in sender_lower or "postmaster" in sender_lower:
                continue

            # Filter out non-actionable bots, newsletters, promotional SaaS digests & spam
            import re
            from backend.classification.category_classifier import (
                _NON_ACTIONABLE_SENDER_PATTERNS,
                _NON_ACTIONABLE_SUBJECT_PATTERNS,
            )
            is_case_reply = bool(
                re.search(r"\bCASE-?\d{4,8}\b", f"{subj_lower} {parsed.get('body', '')}", re.IGNORECASE)
                or subj_lower.startswith("re:")
            )
            if not is_case_reply:
                if any(re.search(pat, sender_lower, re.IGNORECASE) for pat in _NON_ACTIONABLE_SENDER_PATTERNS):
                    continue
                if any(re.search(pat, subj_lower, re.IGNORECASE) for pat in _NON_ACTIONABLE_SUBJECT_PATTERNS):
                    continue

            # Skip test / fake demo emails (per user request to remove fake mails for now)
            if (
                "vaibhav.yadav9050@gmail.com" in sender_lower
                or "medical leave request for three days" in subj_lower
                or "salary not credited for october 2026" in subj_lower
                or "joining bonus demo" in subj_lower
                or "john.doe@example.com" in sender_lower
            ):
                continue
            result = store_parsed_email(parsed, account_email=active_account)
            stored_ids.append(result["email_id"])

            if result["inserted"]:
                new_stored_count += 1
                try:
                    from backend.classification.ai_pipeline import process_email
                    from backend.services.cases.case_engine import is_department_intake_mailbox
                    if is_department_intake_mailbox(active_account):
                        process_email(result["email_id"])
                    else:
                        logger.info(
                            f"[IntakeBlocked] Inbound email {result['email_id']} stored for mailbox '{active_account}', "
                            f"but case creation was skipped because '{active_account}' is not a designated department mailbox."
                        )
                except Exception as pipe_err:
                    logger.warning(f"Phase 6 pipeline warning for email {result['email_id']}: {pipe_err}")
            else:
                skipped_duplicates += 1

        removed_count = 0 if had_fetch_error else _reconcile_deleted_inbox_emails(active_account, stored_ids)
        sync_time = update_last_sync(inbox_total=inbox_total, account_email=active_account)
        logger.info(
            f"Gmail sync complete: fetched={fetched_count}, new={new_stored_count}, "
            f"duplicates={skipped_duplicates}, removed_deleted={removed_count}"
        )

        return {
            "inbox_total": inbox_total,
            "fetched_count": fetched_count,
            "new_stored_count": new_stored_count,
            "skipped_duplicates": skipped_duplicates,
            "removed_deleted_count": removed_count,
            "stored_email_ids": stored_ids,
            "last_sync_at": sync_time,
        }
    finally:
        try:
            imap.logout()
        except Exception:
            pass


def _get_attachments_for_email(conn, email_id: int) -> List[Dict[str, Any]]:
    """Retrieve attachment records & preview/download links for a given email_id."""
    rows = conn.execute(
        """
        SELECT id, email_id, filename, storage_path, content_type, size_bytes, file_hash, created_at
        FROM email_attachments
        WHERE email_id = ?
        ORDER BY id ASC
        """,
        (int(email_id),)
    ).fetchall()
    if rows:
        results = []
        for r in rows:
            filename = r["filename"]
            ext = filename.rsplit(".", 1)[-1].upper() if "." in filename else "FILE"
            size_bytes = int(r["size_bytes"] or 0)
            if size_bytes < 1024:
                size_str = f"{size_bytes} B"
            elif size_bytes < 1024 * 1024:
                size_str = f"{max(1, size_bytes // 1024)} KB"
            else:
                size_str = f"{size_bytes / (1024 * 1024):.1f} MB"

            storage_path = r["storage_path"]
            has_file = bool(storage_path and os.path.isfile(storage_path))
            results.append({
                "id": r["id"],
                "attachment_id": r["id"],
                "email_id": r["email_id"],
                "filename": filename,
                "name": filename,
                "type": ext,
                "content_type": r["content_type"],
                "size_bytes": size_bytes,
                "size": size_str,
                "storage_path": storage_path,
                "has_file": has_file,
                "view_url": f"/api/attachments/{r['id']}/view",
                "download_url": f"/api/attachments/{r['id']}/download",
            })
        return results

    # Fallback to audit logs for historical emails without binary rows
    row = conn.execute(
        """
        SELECT metadata FROM audit_logs
        WHERE entity_type = 'EMAIL' AND entity_id = ? AND action = 'EMAIL_INGESTED'
        ORDER BY id DESC LIMIT 1
        """,
        (str(email_id),)
    ).fetchone()
    if not row or not row["metadata"]:
        return []
    try:
        meta = json.loads(row["metadata"])
        atts = meta.get("attachments", [])
        for att in atts:
            if isinstance(att, dict):
                att.setdefault("has_file", False)
        return atts
    except Exception:
        return []


def _get_employee_match_for_email(conn, email_id: int) -> Optional[Dict[str, Any]]:
    """Retrieve latest Employee Service match result recorded in audit_logs for a given email_id."""
    row = conn.execute(
        """
        SELECT metadata FROM audit_logs
        WHERE entity_type = 'EMAIL'
          AND entity_id = ?
          AND action IN ('EMPLOYEE_MATCHED', 'EMPLOYEE_REVIEW_REQUIRED', 'EMPLOYEE_NOT_FOUND')
        ORDER BY id DESC LIMIT 1
        """,
        (str(email_id),)
    ).fetchone()
    if not row or not row["metadata"]:
        return None
    try:
        return json.loads(row["metadata"])
    except Exception:
        return None


def list_stored_emails(
    limit: int = 50,
    category: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    account_email: Optional[str] = None,
    actionable_only: Optional[bool] = True,
) -> List[Dict[str, Any]]:
    """Return stored emails from SQLite ordered by newest first, enriched with Phase 6 pipeline data."""
    from backend.classification.ai_pipeline import get_email_analysis, process_email

    active_account = get_active_account_email(account_email)

    conn = get_connection()
    try:
        unprocessed = conn.execute(
            "SELECT id FROM emails WHERE category IS NULL ORDER BY id DESC"
        ).fetchall()
    finally:
        conn.close()

    for u in unprocessed:
        try:
            process_email(int(u["id"]))
        except Exception as e:
            logger.warning(f"Auto-process warning for email {u['id']}: {e}")

    conn = get_connection()
    try:
        clauses: List[str] = []
        params: List[Any] = []
        if actionable_only is True:
            clauses.append("COALESCE(e.is_actionable, 1) = 1")
        elif actionable_only is False:
            clauses.append("COALESCE(e.is_actionable, 1) = 0")

        if active_account and active_account.upper() not in ("__ALL__", "ALL"):
            clauses.append("(LOWER(e.account_email) = LOWER(?) OR e.account_email IS NULL)")
            params.append(active_account)
        if category and category.upper() != "ALL":
            clauses.append("UPPER(e.category) = UPPER(?)")
            params.append(category.strip())
        if status and status.upper() != "ALL":
            clauses.append("UPPER(e.processing_status) = UPPER(?)")
            params.append(status.strip())
        if search and search.strip():
            q = f"%{search.strip().lower()}%"
            clauses.append("(LOWER(e.subject) LIKE ? OR LOWER(e.sender_email) LIKE ? OR LOWER(e.sender_name) LIKE ? OR LOWER(e.body) LIKE ?)")
            params.extend([q, q, q, q])

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(int(limit))
        rows = conn.execute(
            f"""
            SELECT
                e.*,
                emp.employee_id AS matched_emp_code,
                emp.name AS matched_emp_name,
                emp.department AS matched_emp_dept,
                emp.designation AS matched_emp_designation,
                emp.manager_name AS matched_emp_manager,
                emp.location AS matched_emp_location,
                emp.email AS matched_emp_email
            FROM emails e
            LEFT JOIN employees emp ON e.employee_id = emp.id
            {where_sql}
            ORDER BY COALESCE(datetime(e.received_at), e.received_at) DESC, e.id DESC
            LIMIT ?
            """,
            tuple(params)
        ).fetchall()

        results = []
        for r in rows:
            eid = int(r["id"])
            item = dict(r)
            item["attachments"] = _get_attachments_for_email(conn, eid)
            item["employee_match"] = _get_employee_match_for_email(conn, eid)
            item["requires_review"] = bool(r["requires_review"])
            try:
                analysis = get_email_analysis(eid)
                item["analysis"] = analysis
                item["case"] = analysis.get("case")
                item["workflow"] = analysis.get("workflow")
                item["sla"] = analysis.get("sla")
                item["decision"] = analysis.get("decision")
                item["intent_detail"] = analysis.get("intent")
                item["extracted_fields"] = analysis.get("extracted_fields")
                item["validation"] = analysis.get("validation")
                item["activity"] = analysis.get("activity")
            except Exception as e:
                logger.warning(f"Could not attach analysis for email {eid}: {e}")
            results.append(item)
        return results
    finally:
        conn.close()


def get_stored_email_detail(email_id: int) -> Optional[Dict[str, Any]]:
    """Return normalized detail payload for a single stored email by its database ID."""
    from backend.classification.ai_pipeline import get_email_analysis
    from backend.models.audit_log import _format_audit_row

    conn = get_connection()
    try:
        r = conn.execute(
            """
            SELECT
                e.*,
                emp.employee_id AS matched_emp_code,
                emp.name AS matched_emp_name,
                emp.department AS matched_emp_dept,
                emp.designation AS matched_emp_designation,
                emp.manager_name AS matched_emp_manager,
                emp.location AS matched_emp_location,
                emp.email AS matched_emp_email
            FROM emails e
            LEFT JOIN employees emp ON e.employee_id = emp.id
            WHERE e.id = ?
            """,
            (int(email_id),)
        ).fetchone()

        if not r:
            return None

        attachments = _get_attachments_for_email(conn, int(r["id"]))
        employee_match = _get_employee_match_for_email(conn, int(r["id"]))
        audit_rows = conn.execute(
            """
            SELECT *
            FROM audit_logs
            WHERE entity_type = 'EMAIL' AND entity_id = ?
            ORDER BY id ASC
            """,
            (str(email_id),)
        ).fetchall()
    finally:
        conn.close()

    analysis = None
    try:
        analysis = get_email_analysis(int(email_id))
    except Exception:
        analysis = None

    return {
        "id": r["id"],
        "provider": r["provider"],
        "provider_message_id": r["provider_message_id"],
        "thread_id": r["thread_id"],
        "sender_name": r["sender_name"],
        "sender_email": r["sender_email"],
        "subject": r["subject"],
        "body": r["body"],
        "received_at": r["received_at"],
        "employee_id": r["employee_id"],
        "category": r["category"],
        "category_confidence": r["category_confidence"],
        "intent": r["intent"],
        "intent_score": r["intent_score"],
        "requires_review": bool(r["requires_review"]),
        "decision_status": r["decision_status"],
        "processing_status": r["processing_status"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
        "attachments": attachments,
        "employee": {
            "id": r["matched_emp_code"],
            "name": r["matched_emp_name"],
            "department": r["matched_emp_dept"],
            "designation": r["matched_emp_designation"],
            "manager": r["matched_emp_manager"],
            "location": r["matched_emp_location"],
            "email": r["matched_emp_email"],
            "match_status": "MATCHED",
            "confidence": employee_match.get("confidence") if employee_match else None,
            "match_method": employee_match.get("match_method") if employee_match else None,
        } if r["employee_id"] else None,
        "employee_match": employee_match,
        "analysis": analysis,
        "rich_telemetry": analysis.get("rich_telemetry") if analysis else None,
        "category_analysis": analysis.get("category") if analysis else None,
        "case": analysis.get("case") if analysis else None,
        "workflow": analysis.get("workflow") if analysis else None,
        "sla": analysis.get("sla") if analysis else None,
        "decision": analysis.get("decision") if analysis else None,
        "extracted_fields": analysis.get("extracted_fields") if analysis else None,
        "validation": analysis.get("validation") if analysis else None,
        "activity": analysis.get("activity") if analysis else [_format_audit_row(a) for a in audit_rows],
        "audit": [_format_audit_row(a) for a in audit_rows],
    }


def mark_email_read(email_id: int, is_read: bool = True) -> bool:
    """Update email processing_status between READ and RECEIVED."""
    new_status = "READ" if is_read else "RECEIVED"
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT processing_status, subject FROM emails WHERE id = ?",
            (int(email_id),),
        ).fetchone()
        if not row:
            return False
        old_status = row["processing_status"]
        cur = conn.execute(
            """
            UPDATE emails
            SET processing_status = CASE
                WHEN processing_status IN ('RECEIVED', 'READ') THEN ?
                ELSE processing_status
            END,
            updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_status, int(email_id))
        )
        if not is_read and old_status != "RECEIVED":
            conn.execute(
                """
                INSERT INTO audit_logs (entity_type, entity_id, action, description, performed_by, metadata)
                VALUES ('EMAIL', ?, 'EMAIL_MARKED_UNREAD', ?, 'hr_operator', ?)
                """,
                (
                    str(email_id),
                    f"Email marked as unread in HR Workspace ({old_status} → RECEIVED)",
                    json.dumps({"from_value": old_status, "to_value": "RECEIVED"}),
                ),
            )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


get_stored_emails = list_stored_emails

