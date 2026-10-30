"""
HR FLOW — Phase 4 Gmail IMAP Client & Connection Manager (backend/services/gmail/gmail_client.py)
Handles Gmail IMAP SSL authentication, connection verification, and runtime session state.
Never exposes App Passwords to the frontend or API responses.
"""

from datetime import datetime, timezone
import imaplib
import json
import logging
import os
import socket
from typing import Dict, Any, Tuple, Optional

from backend.config import Config
from backend.database.connection import get_connection

logger = logging.getLogger("hrflow.gmail")

_SESSION_FILE = os.path.join(os.path.dirname(Config.LOGS_DIR), "gmail_session.json")

# Runtime Gmail connection state (primary fallback + per-email map)
_GMAIL_STATE: Dict[str, Any] = {
    "connected": False,
    "email": Config.GMAIL_EMAIL or None,
    "app_password": Config.GMAIL_APP_PASSWORD.replace(" ", "") if Config.GMAIL_APP_PASSWORD else None,
    "inbox_total": 0,
    "last_sync_at": None,
    "last_error": None,
}
_GMAIL_ACCOUNTS: Dict[str, Dict[str, Any]] = {}


def resolve_email_provider_hosts(email_clean: str, explicit_provider: Optional[str] = None) -> Tuple[str, str, int, str, int]:
    """
    Returns (provider_name, imap_host, imap_port, smtp_host, smtp_port).
    Auto-detects provider between:
      - Zoho Mail ('ZOHO', imap.zoho.in:993 / imap.zoho.com:993, smtp.zoho.in:465 / smtp.zoho.com:465)
      - Gmail / Google Workspace ('GMAIL', imap.gmail.com:993, smtp.gmail.com:465)
    """
    clean = (email_clean or "").strip().lower()
    prov = (explicit_provider or "").strip().upper()

    is_zoho = prov == "ZOHO" or "zoho" in clean or clean.endswith((".zoho.com", ".zoho.in", "@zohomail.com", "@zohomail.in"))

    if is_zoho:
        if ".in" in clean:
            return "ZOHO", "imap.zoho.in", 993, "smtp.zoho.in", 465
        return "ZOHO", "imap.zoho.com", 993, "smtp.zoho.com", 465

    # Default to Gmail / Google Workspace
    imap_h = Config.GMAIL_HOST or "imap.gmail.com"
    imap_p = Config.GMAIL_PORT or 993
    smtp_h = getattr(Config, "GMAIL_SMTP_HOST", "smtp.gmail.com") or "smtp.gmail.com"
    smtp_p = getattr(Config, "GMAIL_SMTP_PORT", 465) or 465
    return "GMAIL", imap_h, imap_p, smtp_h, smtp_p


def _save_mailbox_to_db(
    email_clean: str,
    app_password: str,
    inbox_total: int,
    last_sync_at: Optional[str] = None,
    provider: Optional[str] = None,
    imap_host: Optional[str] = None,
    smtp_host: Optional[str] = None,
) -> None:
    """Persist mailbox credentials in SQLite connected_mailboxes table for multi-user concurrency."""
    clean_em = (email_clean or "").strip().lower()
    auto_prov, auto_imap, _, auto_smtp, _ = resolve_email_provider_hosts(clean_em, explicit_provider=provider)
    if not provider or (provider == "GMAIL" and auto_prov != "GMAIL"):
        provider = auto_prov
    if not imap_host or (imap_host == "imap.gmail.com" and auto_imap != "imap.gmail.com"):
        imap_host = auto_imap
    if not smtp_host or (smtp_host == "smtp.gmail.com" and auto_smtp != "smtp.gmail.com"):
        smtp_host = auto_smtp

    try:
        conn = get_connection()
        role_row = conn.execute("SELECT role FROM users WHERE LOWER(email) = LOWER(?)", (email_clean,)).fetchone()
        role_str = str(role_row["role"]).upper() if role_row and role_row["role"] else "ADMIN"
        if role_str == "SUPER_ADMIN":
            role_str = "ADMIN"
        conn.execute(
            """
            INSERT INTO connected_mailboxes (email, app_password, role, inbox_total, last_sync_at, connected, provider, imap_host, smtp_host, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(email) DO UPDATE SET
                app_password = excluded.app_password,
                role = excluded.role,
                inbox_total = excluded.inbox_total,
                last_sync_at = COALESCE(excluded.last_sync_at, connected_mailboxes.last_sync_at),
                connected = 1,
                provider = excluded.provider,
                imap_host = excluded.imap_host,
                smtp_host = excluded.smtp_host,
                updated_at = CURRENT_TIMESTAMP
            """,
            (email_clean, app_password, role_str, int(inbox_total or 0), last_sync_at, provider, imap_host, smtp_host),
        )
        conn.commit()
        conn.close()
    except Exception as exc:
        logger.debug(f"Could not save mailbox to SQLite connected_mailboxes: {exc}")


def _load_mailboxes_from_db() -> None:
    """Hydrate _GMAIL_ACCOUNTS from SQLite connected_mailboxes table."""
    try:
        conn = get_connection()
        rows = conn.execute(
            "SELECT email, app_password, role, inbox_total, last_sync_at, connected, provider, imap_host, smtp_host FROM connected_mailboxes WHERE connected = 1"
        ).fetchall()
        conn.close()
        for r in rows:
            em = str(r["email"] or "").strip().lower()
            if em and r["app_password"]:
                prov = str(r["provider"] or "").upper()
                ih = str(r["imap_host"] or "")
                sh = str(r["smtp_host"] or "")
                auto_prov, auto_imap, _, auto_smtp, _ = resolve_email_provider_hosts(em, explicit_provider=prov or None)
                if not prov or (prov == "GMAIL" and auto_prov != "GMAIL"):
                    prov = auto_prov
                if not ih or (ih == "imap.gmail.com" and auto_imap != "imap.gmail.com"):
                    ih = auto_imap
                if not sh or (sh == "smtp.gmail.com" and auto_smtp != "smtp.gmail.com"):
                    sh = auto_smtp
                _GMAIL_ACCOUNTS[em] = {
                    "connected": True,
                    "email": em,
                    "app_password": str(r["app_password"]).strip(),
                    "role": str(r["role"] or "ADMIN").upper(),
                    "provider": prov,
                    "imap_host": ih,
                    "smtp_host": sh,
                    "inbox_total": int(r["inbox_total"] or 0),
                    "last_sync_at": r["last_sync_at"],
                    "last_error": None,
                }
                # Prefer ADMIN account as the default _GMAIL_STATE intake mailbox
                if not _GMAIL_STATE.get("connected") or str(r["role"] or "").upper() in ("ADMIN", "SUPER_ADMIN"):
                    _GMAIL_STATE["connected"] = True
                    _GMAIL_STATE["email"] = em
                    _GMAIL_STATE["app_password"] = str(r["app_password"]).strip()
                    _GMAIL_STATE["provider"] = prov
                    _GMAIL_STATE["imap_host"] = ih
                    _GMAIL_STATE["smtp_host"] = sh
                    _GMAIL_STATE["inbox_total"] = int(r["inbox_total"] or 0)
                    _GMAIL_STATE["last_sync_at"] = r["last_sync_at"]
    except Exception:
        pass


def _save_session_state() -> None:
    """Persist active Gmail session state locally so backend restarts preserve the current user's mailbox."""
    try:
        os.makedirs(os.path.dirname(_SESSION_FILE), exist_ok=True)
        payload = {
            "connected": bool(_GMAIL_STATE.get("connected")),
            "email": _GMAIL_STATE.get("email"),
            "app_password": _GMAIL_STATE.get("app_password"),
            "inbox_total": int(_GMAIL_STATE.get("inbox_total") or 0),
            "last_sync_at": _GMAIL_STATE.get("last_sync_at"),
            "accounts": _GMAIL_ACCOUNTS,
        }
        with open(_SESSION_FILE, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        try:
            os.chmod(_SESSION_FILE, 0o600)
        except Exception:
            pass
    except Exception as exc:
        logger.debug(f"Could not save gmail session state: {exc}")


def _load_session_state() -> None:
    """Load persisted Gmail session state on startup if not already configured in memory."""
    _load_mailboxes_from_db()
    if os.path.isfile(_SESSION_FILE):
        try:
            with open(_SESSION_FILE, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data.get("accounts"), dict):
                for k, v in data["accounts"].items():
                    if isinstance(v, dict) and v.get("email") and v.get("app_password"):
                        _GMAIL_ACCOUNTS.setdefault(k.strip().lower(), v)
            if data.get("email") and data.get("app_password"):
                em = str(data["email"]).strip().lower()
                _GMAIL_ACCOUNTS.setdefault(em, {
                    "connected": bool(data.get("connected", True)),
                    "email": em,
                    "app_password": str(data["app_password"]).strip(),
                    "inbox_total": int(data.get("inbox_total") or 0),
                    "last_sync_at": data.get("last_sync_at"),
                    "last_error": None,
                })
                if not _GMAIL_STATE.get("connected"):
                    _GMAIL_STATE["connected"] = bool(data.get("connected", True))
                    _GMAIL_STATE["email"] = em
                    _GMAIL_STATE["app_password"] = str(data["app_password"]).strip()
                    _GMAIL_STATE["inbox_total"] = int(data.get("inbox_total") or 0)
                    _GMAIL_STATE["last_sync_at"] = data.get("last_sync_at")
        except Exception as exc:
            logger.debug(f"Could not load gmail session state: {exc}")


_load_session_state()


def _resolve_request_session_email() -> Optional[str]:
    """Check current Flask request (cookie / Bearer token / header) for the logged-in user's email."""
    try:
        from flask import has_request_context, request
        if not has_request_context():
            return None
        hdr_email = (request.headers.get("X-HR-Email") or request.args.get("email") or "").strip().lower()
        if hdr_email:
            return hdr_email
        token = ""
        auth_hdr = request.headers.get("Authorization", "")
        if auth_hdr.startswith("Bearer "):
            token = auth_hdr.replace("Bearer ", "", 1).strip()
        if not token:
            token = (request.cookies.get("hrflow_session") or "").strip()
        if token:
            conn = get_connection()
            row = conn.execute("SELECT email FROM user_sessions WHERE token = ?", (token,)).fetchone()
            conn.close()
            if row and row["email"]:
                return str(row["email"]).strip().lower()
    except Exception:
        pass
    return None


def get_active_account_email(explicit_email: Optional[str] = None) -> Optional[str]:
    """Return the active Gmail account email address for the current request or primary intake account."""
    if explicit_email and str(explicit_email).strip():
        return str(explicit_email).strip().lower()
    _load_session_state()
    req_email = _resolve_request_session_email()
    if req_email:
        return req_email
    acct = _GMAIL_STATE.get("email")
    return str(acct).strip().lower() if acct else None


def normalize_app_password(raw_password: str) -> str:
    """Strip whitespace from 16-digit Google App Password."""
    return (raw_password or "").replace(" ", "").strip()


def verify_and_connect_gmail(email: str, app_password: str, provider: Optional[str] = None) -> Tuple[bool, str, int]:
    """
    Verify Gmail/Workspace or Zoho Mail credentials via IMAP4_SSL and store in multi-account state on success.
    Returns (success, message, inbox_count).
    """
    clean_email = (email or "").strip().lower()
    clean_password = normalize_app_password(app_password)

    if not clean_email or not clean_password:
        return False, "Both Email Address and App Password are required.", 0

    if len(clean_password) < 8:
        return False, "App Password is too short. Please enter your Mail App Password.", 0

    prov_name, imap_host, imap_port, smtp_host, smtp_port = resolve_email_provider_hosts(clean_email, explicit_provider=provider)

    connected_success = False
    inbox_total = 0
    err_text = ""

    # Attempt connection with primary resolved host
    try:
        imap = imaplib.IMAP4_SSL(imap_host, imap_port, timeout=35)
        imap.login(clean_email, clean_password)
        status, messages = imap.select("INBOX", readonly=True)
        inbox_total = int(messages[0]) if status == "OK" and messages and messages[0] else 0
        imap.logout()
        connected_success = True
    except Exception as exc:
        err_text = str(exc)

    # Automatic fallback for custom business domains: if Gmail failed, attempt Zoho
    if not connected_success and prov_name == "GMAIL" and "@gmail.com" not in clean_email:
        for fallback_host in ("imap.zoho.in", "imap.zoho.com"):
            try:
                imap = imaplib.IMAP4_SSL(fallback_host, 993, timeout=15)
                imap.login(clean_email, clean_password)
                status, messages = imap.select("INBOX", readonly=True)
                inbox_total = int(messages[0]) if status == "OK" and messages and messages[0] else 0
                imap.logout()
                connected_success = True
                prov_name = "ZOHO"
                imap_host = fallback_host
                smtp_host = "smtp.zoho.in" if ".in" in fallback_host else "smtp.zoho.com"
                smtp_port = 465
                break
            except Exception:
                pass

    if not connected_success:
        _GMAIL_STATE["last_error"] = err_text
        logger.warning(f"{prov_name} IMAP authentication failed for {clean_email}: {err_text}")
        err_lower = err_text.lower()
        if "enable imap" in err_lower or "yet to enable imap" in err_lower:
            return (
                False,
                "IMAP access is currently disabled for your Zoho Mail account. Please log in to mail.zoho.com / mail.zoho.in, open Settings (gear icon) → Mail Accounts, and turn ON 'IMAP Access'.",
                0,
            )
        if "application-specific password required" in err_lower or "app password" in err_lower:
            return False, f"{prov_name.title()} requires an App-Specific Password (not your regular account password).", 0
        return False, f"Invalid {prov_name.title()} email or App Password ({err_text}).", 0

    now_iso = datetime.now(timezone.utc).isoformat()
    _GMAIL_ACCOUNTS[clean_email] = {
        "connected": True,
        "email": clean_email,
        "app_password": clean_password,
        "provider": prov_name,
        "imap_host": imap_host,
        "smtp_host": smtp_host,
        "inbox_total": inbox_total,
        "last_sync_at": now_iso,
        "last_error": None,
    }
    _save_mailbox_to_db(clean_email, clean_password, inbox_total, now_iso, provider=prov_name, imap_host=imap_host, smtp_host=smtp_host)

    # Update primary _GMAIL_STATE if none connected yet or if this is an Admin/Manager mailbox
    is_agent = False
    try:
        conn = get_connection()
        m_row = conn.execute(
            "SELECT role FROM hr_department_members WHERE LOWER(email) = LOWER(?) AND COALESCE(active, 1) = 1",
            (clean_email,),
        ).fetchone()
        u_row = conn.execute("SELECT role FROM users WHERE LOWER(email) = LOWER(?)", (clean_email,)).fetchone()
        conn.close()
        r_code = str((m_row["role"] if m_row and m_row["role"] else None) or (u_row["role"] if u_row else "")).upper()
        if r_code == "HR_AGENT":
            is_agent = True
    except Exception:
        pass

    if not is_agent or not _GMAIL_STATE.get("connected") or not _GMAIL_STATE.get("email"):
        _GMAIL_STATE["connected"] = True
        _GMAIL_STATE["email"] = clean_email
        _GMAIL_STATE["app_password"] = clean_password
        _GMAIL_STATE["provider"] = prov_name
        _GMAIL_STATE["imap_host"] = imap_host
        _GMAIL_STATE["smtp_host"] = smtp_host
        _GMAIL_STATE["inbox_total"] = inbox_total
        _GMAIL_STATE["last_error"] = None

    _save_session_state()

    logger.info(f"{prov_name.title()} IMAP connected for {clean_email} (INBOX messages: {inbox_total})")
    return True, f"Connected to {prov_name.title()} IMAP successfully.", inbox_total


def open_imap_session(account_email: Optional[str] = None) -> imaplib.IMAP4_SSL:
    """
    Open and return an authenticated IMAP4_SSL connection using active runtime credentials.
    Raises RuntimeError if Gmail is not connected.
    """
    _load_session_state()
    target_email = (account_email or _GMAIL_STATE.get("email") or "").strip().lower()
    acct_info = _GMAIL_ACCOUNTS.get(target_email) if target_email else None
    email_to_use = (acct_info.get("email") if acct_info else None) or _GMAIL_STATE.get("email")
    pass_to_use = (acct_info.get("app_password") if acct_info else None) or _GMAIL_STATE.get("app_password")

    if not email_to_use or not pass_to_use:
        raise RuntimeError("Mail credentials are not configured. Connect via /api/gmail/connect or /api/auth/login first.")

    prov_name = (acct_info.get("provider") if acct_info else _GMAIL_STATE.get("provider")) or "GMAIL"
    imap_host = (acct_info.get("imap_host") if acct_info else _GMAIL_STATE.get("imap_host")) or Config.GMAIL_HOST
    imap_port = 993
    auto_prov, auto_imap, auto_port, _, _ = resolve_email_provider_hosts(email_to_use, explicit_provider=prov_name)
    if not imap_host or (imap_host == "imap.gmail.com" and auto_imap != "imap.gmail.com") or "zoho" in str(email_to_use).lower():
        prov_name = auto_prov
        imap_host = auto_imap
        imap_port = auto_port

    imap = imaplib.IMAP4_SSL(imap_host, imap_port, timeout=35)
    imap.login(email_to_use, pass_to_use)
    _GMAIL_STATE["connected"] = True
    return imap


def update_last_sync(inbox_total: Optional[int] = None, account_email: Optional[str] = None) -> str:
    """Record timestamp of most recent successful inbox synchronization."""
    now_iso = datetime.now(timezone.utc).isoformat()
    _GMAIL_STATE["last_sync_at"] = now_iso
    if inbox_total is not None:
        _GMAIL_STATE["inbox_total"] = inbox_total
    target_em = (account_email or _GMAIL_STATE.get("email") or "").strip().lower()
    if target_em and target_em in _GMAIL_ACCOUNTS:
        _GMAIL_ACCOUNTS[target_em]["last_sync_at"] = now_iso
        if inbox_total is not None:
            _GMAIL_ACCOUNTS[target_em]["inbox_total"] = inbox_total
        acct_entry = _GMAIL_ACCOUNTS[target_em]
        _save_mailbox_to_db(
            target_em,
            acct_entry["app_password"],
            acct_entry.get("inbox_total", 0),
            now_iso,
            provider=acct_entry.get("provider"),
            imap_host=acct_entry.get("imap_host"),
            smtp_host=acct_entry.get("smtp_host"),
        )
    _save_session_state()
    return now_iso


def disconnect_gmail(account_email: Optional[str] = None) -> None:
    """Disconnect a specific user's Gmail session (or the current request's session) without breaking other users."""
    target_em = (account_email or _resolve_request_session_email() or "").strip().lower()
    if target_em and target_em in _GMAIL_ACCOUNTS:
        _GMAIL_ACCOUNTS.pop(target_em, None)
        try:
            conn = get_connection()
            conn.execute("UPDATE connected_mailboxes SET connected = 0 WHERE LOWER(email) = LOWER(?)", (target_em,))
            conn.commit()
            conn.close()
        except Exception:
            pass
    if not target_em or _GMAIL_STATE.get("email") == target_em:
        # Fall back to another connected account if one exists
        remaining = list(_GMAIL_ACCOUNTS.values())
        if remaining:
            first = remaining[0]
            _GMAIL_STATE["connected"] = True
            _GMAIL_STATE["email"] = first["email"]
            _GMAIL_STATE["app_password"] = first["app_password"]
            _GMAIL_STATE["inbox_total"] = first.get("inbox_total", 0)
            _GMAIL_STATE["last_sync_at"] = first.get("last_sync_at")
        else:
            _GMAIL_STATE["connected"] = False
            _GMAIL_STATE["email"] = None
            _GMAIL_STATE["app_password"] = None
            _GMAIL_STATE["last_error"] = None
    _save_session_state()


def get_gmail_status(account_email: Optional[str] = None) -> Dict[str, Any]:
    """Return safe, non-sensitive status of the Gmail integration and stored email counts for the active account."""
    _load_session_state()
    active_email = get_active_account_email(account_email)
    acct_info = _GMAIL_ACCOUNTS.get(active_email) if active_email else None

    stored_count = 0
    try:
        conn = get_connection()
        if active_email and (not acct_info or acct_info.get("role") != "HR_AGENT"):
            row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM emails WHERE provider = 'gmail' AND (LOWER(account_email) = LOWER(?) OR account_email IS NULL)",
                (active_email,),
            ).fetchone()
        else:
            row = conn.execute("SELECT COUNT(*) AS cnt FROM emails WHERE provider = 'gmail'").fetchone()
        stored_count = int(row["cnt"]) if row else 0
        conn.close()
    except Exception:
        stored_count = 0

    is_connected = bool(
        (acct_info and acct_info.get("connected") and acct_info.get("app_password"))
        or (_GMAIL_STATE.get("connected") and active_email and _GMAIL_STATE.get("app_password"))
    )
    inbox_total = int((acct_info.get("inbox_total") if acct_info else _GMAIL_STATE.get("inbox_total")) or 0)
    last_sync = (acct_info.get("last_sync_at") if acct_info else None) or _GMAIL_STATE.get("last_sync_at")
    effective_count = stored_count if stored_count > 0 else inbox_total
    prov_name = (acct_info.get("provider") if acct_info else _GMAIL_STATE.get("provider")) or "GMAIL"
    imap_h = (acct_info.get("imap_host") if acct_info else _GMAIL_STATE.get("imap_host")) or Config.GMAIL_HOST
    return {
        "status": "connected" if is_connected else "not_configured",
        "connected": is_connected,
        "email": active_email,
        "provider": prov_name,
        "imap_host": imap_h,
        "inbox_total": inbox_total,
        "stored_emails_count": stored_count,
        "unread_count": effective_count,
        "total_messages": effective_count,
        "last_sync_at": last_sync,
        "last_error": _GMAIL_STATE["last_error"],
    }


def send_gmail_smtp_email(
    recipient_email: str,
    subject: str,
    body_text: str,
    body_html: Optional[str] = None,
    cc_emails: Optional[list] = None,
    in_reply_to: Optional[str] = None,
    references: Optional[str] = None,
    account_email: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Send a real email from the currently connected Gmail account using smtp.gmail.com:465 (SSL)
    and the active 16-digit App Password.
    Returns a dictionary with status ('SENT_GMAIL_SMTP' or 'LOGGED_OFFLINE') and details.
    """
    from email.message import EmailMessage
    import smtplib

    _load_session_state()
    req_email = (account_email or "").strip().lower() or _resolve_request_session_email()
    acct_info = _GMAIL_ACCOUNTS.get(req_email) if req_email else None
    if not acct_info and req_email:
        conn = get_connection()
        try:
            row = conn.execute("SELECT * FROM connected_mailboxes WHERE LOWER(email) = ? AND connected = 1 LIMIT 1", (req_email,)).fetchone()
            if row:
                acct_info = dict(row)
        except Exception:
            pass
        finally:
            conn.close()
    sender_email = (acct_info.get("email") if acct_info and acct_info.get("app_password") else None) or _GMAIL_STATE.get("email")
    app_password = (acct_info.get("app_password") if acct_info and acct_info.get("app_password") else None) or _GMAIL_STATE.get("app_password")
    is_conn = bool((acct_info and acct_info.get("connected")) or _GMAIL_STATE.get("connected"))
    to_addr = (recipient_email or "").strip()

    if not to_addr or "@" not in to_addr:
        return {
            "sent": False,
            "status": "SKIPPED_NO_RECIPIENT",
            "sender": sender_email,
            "recipient": to_addr,
            "message": "No valid recipient email provided.",
        }

    if not sender_email or not app_password or not is_conn:
        return {
            "sent": False,
            "status": "LOGGED_LOCAL_ONLY",
            "sender": sender_email or "hr-system@local",
            "recipient": to_addr,
            "message": "Gmail session not active; recorded in case communications.",
        }

    msg = EmailMessage()
    msg["From"] = f"HR Flow Operations <{sender_email}>"
    msg["To"] = to_addr
    if in_reply_to:
        clean_irt = str(in_reply_to).strip()
        if clean_irt and not clean_irt.startswith("<") and "@" in clean_irt:
            clean_irt = f"<{clean_irt}>"
        if clean_irt:
            msg["In-Reply-To"] = clean_irt
            if not references:
                msg["References"] = clean_irt
    if references:
        clean_refs = str(references).strip()
        if clean_refs and not clean_refs.startswith("<") and "@" in clean_refs:
            clean_refs = f"<{clean_refs}>"
        if clean_refs:
            msg["References"] = clean_refs
    if cc_emails:
        clean_cc = [c.strip() for c in cc_emails if c and "@" in c and c.strip().lower() != to_addr.lower()]
        if clean_cc:
            msg["Cc"] = ", ".join(clean_cc)
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    prov_name = (acct_info.get("provider") if acct_info else _GMAIL_STATE.get("provider")) or "GMAIL"
    smtp_host = (acct_info.get("smtp_host") if acct_info else _GMAIL_STATE.get("smtp_host")) or "smtp.gmail.com"
    smtp_port = 465
    if not smtp_host or smtp_host == "smtp.gmail.com":
        prov_name, _, _, smtp_host, smtp_port = resolve_email_provider_hosts(sender_email, explicit_provider=prov_name)

    # Attempt 1: Port 465 (SSL), Fallback: Port 587 (STARTTLS)
    sent_successfully = False
    last_smtp_error = None

    try:
        with smtplib.SMTP_SSL(smtp_host, 465, timeout=12) as smtp:
            smtp.login(sender_email, app_password)
            smtp.send_message(msg)
        sent_successfully = True
    except Exception as exc_ssl:
        last_smtp_error = exc_ssl
        logger.debug(f"{prov_name} SMTP_SSL (465) failed ({exc_ssl}), trying STARTTLS on 587...")
        try:
            with smtplib.SMTP(smtp_host, 587, timeout=12) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.ehlo()
                smtp.login(sender_email, app_password)
                smtp.send_message(msg)
            sent_successfully = True
        except Exception as exc_tls:
            last_smtp_error = exc_tls
            logger.warning(f"{prov_name} SMTP (587 STARTTLS) also failed ({exc_tls})")

    if sent_successfully:
        logger.info(f"Sent {prov_name} SMTP dispatch from {sender_email} to {to_addr}: {subject}")
        return {
            "sent": True,
            "status": f"SENT_{prov_name}_SMTP",
            "sender": sender_email,
            "provider": prov_name,
            "recipient": to_addr,
            "message": f"Dispatched via {prov_name.title()} SMTP ({sender_email} → {to_addr})",
        }
    else:
        logger.warning(f"{prov_name} SMTP dispatch failed ({sender_email} -> {to_addr}): {last_smtp_error}")
        return {
            "sent": False,
            "status": "SMTP_ERROR_LOGGED",
            "sender": sender_email,
            "provider": prov_name,
            "recipient": to_addr,
            "error": str(last_smtp_error),
            "message": f"Recorded in Case Communications (SMTP warning: {last_smtp_error})",
        }

