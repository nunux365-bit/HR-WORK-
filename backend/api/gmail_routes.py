"""
HR FLOW — Phase 4 Gmail Integration API Routes (backend/api/gmail_routes.py)
Endpoints:
  - POST /api/gmail/connect
  - GET  /api/gmail/status
  - POST /api/gmail/sync
  - GET  /api/gmail/messages
  - GET  /api/gmail/messages/<int:email_id>
  - POST /api/gmail/messages/<int:email_id>/read
"""

from flask import Blueprint, request

from backend.api import success_response, error_response
from backend.services.gmail.gmail_client import (
    verify_and_connect_gmail,
    get_gmail_status,
)
from backend.services.gmail.gmail_fetcher import (
    sync_gmail_inbox,
    list_stored_emails,
    get_stored_email_detail,
    mark_email_read,
)
from backend.services.gmail.sync_scheduler import get_background_sync_status

gmail_bp = Blueprint(
    "gmail",
    __name__,
    url_prefix="/api/gmail",
)


@gmail_bp.get("/status")
def gmail_status():
    """Return current Gmail IMAP connection status, stored email counts, and background sync status."""
    acct = request.args.get("account_email")
    st = get_gmail_status(account_email=acct)
    st["background_sync"] = get_background_sync_status()
    return success_response(st)


@gmail_bp.post("/connect")
def gmail_connect():
    """Verify Gmail/Workspace email & 16-digit App Password and activate connection."""
    payload = request.get_json(silent=True) or {}
    email_addr = (payload.get("email") or "").strip()
    app_password = (payload.get("app_password") or "").strip()

    ok, message, inbox_total = verify_and_connect_gmail(email_addr, app_password)
    if not ok:
        return error_response(
            code="GMAIL_AUTH_FAILED",
            message=message,
            status_code=401,
        )

    return success_response({
        "message": message,
        "gmail": get_gmail_status(),
        "inbox_total": inbox_total,
    })


@gmail_bp.post("/sync")
def gmail_sync():
    """
    Synchronize latest emails from Gmail IMAP into SQLite `emails` table.
    Optionally accepts {"email": "...", "app_password": "...", "account_email": "...", "limit": 20}.
    """
    payload = request.get_json(silent=True) or {}
    email_addr = (payload.get("email") or "").strip()
    app_password = (payload.get("app_password") or "").strip()
    limit = payload.get("limit")
    target_account = (
        payload.get("account_email")
        or email_addr
        or request.args.get("account_email")
        or request.headers.get("X-HR-Email")
        or ""
    ).strip()

    if email_addr and app_password:
        ok, message, _ = verify_and_connect_gmail(email_addr, app_password)
        if not ok:
            return error_response(
                code="GMAIL_AUTH_FAILED",
                message=message,
                status_code=401,
            )

    status_info = get_gmail_status()
    if not status_info["connected"]:
        return error_response(
            code="GMAIL_NOT_CONNECTED",
            message="Gmail is not connected. Call POST /api/gmail/connect or sign in first.",
            status_code=400,
        )

    try:
        sync_result = sync_gmail_inbox(limit=limit, account_email=target_account or None)
        return success_response({
            "sync": sync_result,
            "gmail": get_gmail_status(),
        })
    except Exception as exc:
        return error_response(
            code="GMAIL_SYNC_ERROR",
            message=str(exc),
            status_code=500,
        )


@gmail_bp.get("/messages")
def gmail_list_messages():
    """Return stored emails from SQLite along with summary counters."""
    limit = request.args.get("limit", default=50, type=int)
    acct = request.args.get("account_email")
    act_param = (request.args.get("actionable") or "true").strip().lower()

    actionable_only = True
    if act_param in ("0", "false", "no", "noise"):
        actionable_only = False
    elif act_param in ("all", "*"):
        actionable_only = None

    try:
        messages = list_stored_emails(limit=limit, account_email=acct, actionable_only=actionable_only)
        total_emails = len(messages)
        needs_review = sum(1 for m in messages if m.get("requires_review"))
        classified = sum(1 for m in messages if m.get("category") and not m.get("requires_review"))
        with_attachments = sum(1 for m in messages if m.get("attachments"))

        from backend.database.connection import get_connection
        conn = get_connection()
        try:
            total_stored = conn.execute("SELECT COUNT(*) FROM emails").fetchone()[0]
            filtered_noise = conn.execute("SELECT COUNT(*) FROM emails WHERE is_actionable = 0").fetchone()[0]
            actionable_total = conn.execute("SELECT COUNT(*) FROM emails WHERE COALESCE(is_actionable, 1) = 1").fetchone()[0]
        finally:
            conn.close()

        return success_response({
            "summary": {
                "total_emails": total_emails,
                "needs_review": needs_review,
                "classified": classified,
                "attachments": with_attachments,
                "filtered_noise": filtered_noise,
                "actionable_total": actionable_total,
                "all_stored": total_stored,
            },
            "messages": messages,
        })
    except Exception as exc:
        return error_response(
            code="GMAIL_MESSAGES_ERROR",
            message=str(exc),
            status_code=500,
        )


@gmail_bp.get("/messages/<int:email_id>")
def gmail_get_message(email_id: int):
    """Return a single stored email record and its audit trail by database ID."""
    try:
        detail = get_stored_email_detail(email_id)
        if not detail:
            return error_response(
                code="EMAIL_NOT_FOUND",
                message=f"Email with id {email_id} not found",
                status_code=404,
            )
        return success_response(detail)
    except Exception as exc:
        return error_response(
            code="GMAIL_MESSAGE_DETAIL_ERROR",
            message=str(exc),
            status_code=500,
        )


@gmail_bp.post("/messages/<int:email_id>/read")
def gmail_mark_message_read(email_id: int):
    """Mark a stored email as read or unread."""
    payload = request.get_json(silent=True) or {}
    is_read = bool(payload.get("read", True))
    try:
        updated = mark_email_read(email_id, is_read=is_read)
        if not updated:
            return error_response(
                code="EMAIL_NOT_FOUND",
                message=f"Email with id {email_id} not found",
                status_code=404,
            )
        return success_response({
            "email_id": email_id,
            "processing_status": "READ" if is_read else "RECEIVED",
        })
    except Exception as exc:
        return error_response(
            code="GMAIL_READ_UPDATE_ERROR",
            message=str(exc),
            status_code=500,
        )
