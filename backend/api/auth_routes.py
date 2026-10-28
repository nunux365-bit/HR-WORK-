"""
HR FLOW — Authentication & Gmail Session API Routes (backend/api/auth_routes.py)
Flow:
  Login Page (Gmail Email + App Password)
    -> POST /api/auth/login
    -> Connect to Gmail IMAP (verify_and_connect_gmail)
    -> Sync Gmail Inbox (sync_gmail_inbox)
    -> Store real emails in SQLite + run Employee Service
    -> Return session + sync summary so frontend redirects to Mail Inbox
"""

import logging
import secrets
from datetime import datetime, timezone
from typing import Dict, Any
from flask import Blueprint, jsonify, request

from backend.database.connection import execute_query


from backend.api import success_response, error_response
from backend.services.gmail.gmail_client import (
    verify_and_connect_gmail,
    disconnect_gmail,
    get_gmail_status,
)
from backend.services.gmail.gmail_fetcher import sync_gmail_inbox

logger = logging.getLogger("hrflow.auth")

auth_bp = Blueprint("auth", __name__)

# Active in-memory operator sessions (token -> profile dict)
_ACTIVE_SESSIONS: Dict[str, Dict[str, Any]] = {}


ROLE_READABLE_TITLES = {
    "ADMIN": "Admin",
    "HR_MANAGER": "HR Operations Manager",
    "HR_LEAD": "HR Team Lead",
    "HR_AGENT": "HR Specialist / Agent",
}


def _build_user_profile(email_addr: str, inbox_count: int = 0) -> Dict[str, Any]:
    email_clean = (email_addr or "").strip().lower()
    # Check both users and hr_department_members for accurate role & real title (designation)
    user_row = execute_query(
        "SELECT id, role, name FROM users WHERE LOWER(email) = LOWER(?)",
        (email_clean,),
        fetch_one=True,
    )
    member_row = execute_query(
        """
        SELECT id, dept_id, team_name, member_name, role, designation
        FROM hr_department_members
        WHERE LOWER(email) = LOWER(?) AND COALESCE(active, 1) = 1
        ORDER BY id DESC LIMIT 1
        """,
        (email_clean,),
        fetch_one=True,
    )

    if not user_row:
        inferred_role = (member_row.get("role") if member_row else None) or "HR_AGENT"
        if str(inferred_role).upper() == "SUPER_ADMIN":
            inferred_role = "ADMIN"
        inferred_name = (member_row.get("member_name") if member_row else None)
        if inferred_name and inferred_name.strip().lower() in ("super admin", "super_admin"):
            inferred_name = "Admin"
        execute_query(
            "INSERT INTO users (email, role, name) VALUES (?, ?, ?)",
            (email_clean, inferred_role, inferred_name),
            commit=True,
        )
        user_row = execute_query(
            "SELECT id, role, name FROM users WHERE LOWER(email) = LOWER(?)",
            (email_clean,),
            fetch_one=True,
        )

    role_code = (
        (member_row.get("role") if member_row and member_row.get("role") else None)
        or (user_row.get("role") if user_row else None)
        or "HR_AGENT"
    ).upper()
    if role_code == "SUPER_ADMIN":
        role_code = "ADMIN"

    local_part = email_clean.split("@")[0] if "@" in email_clean else email_clean
    display_name = (
        (member_row.get("member_name") if member_row and member_row.get("member_name") else None)
        or (user_row.get("name") if user_row and user_row.get("name") else None)
        or " ".join(
            part.capitalize() for part in local_part.replace(".", " ").replace("_", " ").split()
        )
        or "HR Specialist"
    )
    if display_name.strip().lower() in ("super admin", "super_admin"):
        display_name = "Admin"

    raw_designation = (member_row.get("designation") if member_row else None) or ""
    raw_designation = raw_designation.strip()
    if raw_designation.lower() in ("super admin", "super_admin"):
        raw_designation = "Admin"
    role_title = ROLE_READABLE_TITLES.get(role_code, role_code.replace("_", " ").title())
    # Use the employee's real designation if specific, otherwise the clean role title
    real_title = raw_designation if raw_designation else role_title
    department_name = (member_row.get("team_name") if member_row else None) or "HR Operations"

    orig_role = role_code if role_code in ("ADMIN", "SUPER_ADMIN") else ("ADMIN" if "admin" in email_clean else role_code)

    return {
        "id": user_row.get("id") if user_row else None,
        "member_id": member_row.get("id") if member_row else None,
        "email": email_clean,
        "name": display_name,
        "role": role_code,
        "original_role": orig_role,
        "role_title": role_title,
        "designation": real_title,
        "department": department_name,
        "dept_id": member_row.get("dept_id") if member_row else None,
        "inbox_count": inbox_count,
        "connected_at": datetime.now(timezone.utc).isoformat(),
    }


def get_session_user_from_request() -> Dict[str, Any]:
    """Resolve the logged-in user for the current browser request via Bearer token or hrflow_session cookie."""
    import json as _json
    token = ""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "", 1).strip()
    if not token:
        token = (request.cookies.get("hrflow_session") or "").strip()

    if token:
        if token in _ACTIVE_SESSIONS:
            return _ACTIVE_SESSIONS[token]
        try:
            row = execute_query(
                "SELECT email, role, name, department, profile_json FROM user_sessions WHERE token = ?",
                (token,),
                fetch_one=True,
            )
            if row and row.get("email"):
                execute_query(
                    "UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token = ?",
                    (token,),
                    commit=True,
                )
                prof = _build_user_profile(row["email"])
                _ACTIVE_SESSIONS[token] = prof
                return prof
        except Exception as exc:
            logger.debug(f"Session lookup warning: {exc}")
    return {}


@auth_bp.route("/api/auth/login", methods=["POST"])
@auth_bp.route("/api/login", methods=["POST"])
def login_with_gmail():
    """
    1. Authenticate via Gmail IMAP App Password.
    2. Build user profile from SQLite (`users` / `hr_department_members`).
    3. Sync Gmail INBOX into SQLite (`emails`) if Admin/Manager intake mailbox.
    4. Persist session in `user_sessions` and set `hrflow_session` cookie for this browser.
    """
    import json as _json
    payload = request.get_json(silent=True) or {}
    email_addr = (payload.get("email") or "").strip().lower()
    app_password = (payload.get("app_password") or "").strip()

    ok, message, inbox_count = verify_and_connect_gmail(email_addr, app_password)
    if not ok:
        return jsonify({
            "success": False,
            "status": "error",
            "message": message,
            "error": {
                "code": "GMAIL_AUTH_FAILED",
                "message": message,
            },
        }), 401

    user_profile = _build_user_profile(email_addr, inbox_count)

    # Sync Gmail Inbox into SQLite only for Admin/Manager intake accounts (not personal HR_AGENT logins)
    sync_result = {}
    if str(user_profile.get("role") or "").upper() != "HR_AGENT":
        try:
            sync_result = sync_gmail_inbox()
        except Exception as exc:
            logger.warning(f"Initial Gmail sync during login encountered an error: {exc}")
            sync_result = {"error": str(exc)}
    else:
        sync_result = {"fetched_count": inbox_count, "new_stored_count": 0, "mode": "AGENT_DIRECT_PORTAL"}

    token = secrets.token_urlsafe(32)
    user_profile["synced_count"] = sync_result.get("fetched_count", 0)
    user_profile["new_stored_count"] = sync_result.get("new_stored_count", 0)
    _ACTIVE_SESSIONS[token] = user_profile

    try:
        execute_query(
            """
            INSERT INTO user_sessions (token, email, role, name, department, profile_json, created_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (
                token,
                email_addr,
                user_profile.get("role", "HR_AGENT"),
                user_profile.get("name", ""),
                user_profile.get("department", ""),
                _json.dumps(user_profile),
            ),
            commit=True,
        )
    except Exception as exc:
        logger.warning(f"Could not persist user_session in SQLite: {exc}")

    resp = jsonify({
        "success": True,
        "status": "success",
        "message": message,
        "token": token,
        "user": user_profile,
        "sync": sync_result,
        "data": {
            "token": token,
            "user": user_profile,
            "sync": sync_result,
            "gmail": get_gmail_status(email_addr),
        },
    })
    resp.set_cookie(
        "hrflow_session",
        token,
        max_age=7 * 24 * 3600,
        path="/",
        samesite="Lax",
    )
    return resp, 200


@auth_bp.route("/api/auth/logout", methods=["POST"])
@auth_bp.route("/api/logout", methods=["POST"])
def logout_session():
    """Invalidate the current browser's session token and clear its cookie without breaking other active users."""
    token = ""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "", 1).strip()
    if not token:
        token = (request.cookies.get("hrflow_session") or "").strip()

    session_email = None
    if token:
        prof = _ACTIVE_SESSIONS.pop(token, None)
        if prof and prof.get("email"):
            session_email = prof.get("email")
        try:
            row = execute_query("SELECT email FROM user_sessions WHERE token = ?", (token,), fetch_one=True)
            if row and row.get("email"):
                session_email = row["email"]
            execute_query("DELETE FROM user_sessions WHERE token = ?", (token,), commit=True)
        except Exception:
            pass

    if session_email:
        disconnect_gmail(session_email)

    resp = jsonify({
        "success": True,
        "status": "success",
        "data": {"message": "Logged out and cleared browser session."},
    })
    resp.delete_cookie("hrflow_session", path="/")
    return resp, 200


@auth_bp.route("/api/auth/profile", methods=["GET"])
@auth_bp.route("/api/profile", methods=["GET"])
def get_profile():
    """Return current authenticated operator profile for THIS browser session and Gmail connection status."""
    session_prof = get_session_user_from_request()
    email_hint = (
        request.args.get("email")
        or request.headers.get("X-HR-Email")
        or session_prof.get("email")
        or ""
    ).strip().lower()

    if not email_hint:
        return error_response(
            code="UNAUTHORIZED",
            message="No active browser session. Please sign in on /login.html.",
            status_code=401,
        )

    gmail_info = get_gmail_status(email_hint)
    user_profile = _build_user_profile(
        email_hint,
        gmail_info.get("inbox_total", 0),
    )
    return success_response({
        "user": user_profile,
        "gmail": gmail_info,
    })


@auth_bp.route("/api/auth/switch-role", methods=["POST"])
@auth_bp.route("/api/switch-role", methods=["POST"])
def switch_active_role():
    """
    Allow an authenticated Admin to switch their active operating role
    to ADMIN, HR_MANAGER, HR_LEAD, or HR_AGENT.
    Updates the database (users, hr_department_members, user_sessions),
    updates the active in-memory session, and returns the updated profile.
    """
    session_user = get_session_user_from_request()
    current_role = (
        session_user.get("role")
        or request.headers.get("X-HR-Role")
        or ""
    ).strip().upper()

    token = ""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "", 1).strip()
    if not token:
        token = (request.cookies.get("hrflow_session") or "").strip()

    email_clean = (session_user.get("email") or request.headers.get("X-HR-Email") or "").strip().lower()
    if not email_clean and token:
        sess_row = execute_query("SELECT email, role FROM user_sessions WHERE token = ?", (token,), fetch_one=True)
        if sess_row:
            email_clean = (sess_row.get("email") or "").strip().lower()
            if not current_role:
                current_role = (sess_row.get("role") or "").strip().upper()

    if not email_clean:
        return error_response(
            code="UNAUTHORIZED",
            message="Active session required to switch role. Please log in first.",
            status_code=401,
        )

    # Verify admin authority: user must currently be ADMIN, or have original admin authority
    sess_prof = _ACTIVE_SESSIONS.get(token) or {}
    orig_role = (
        sess_prof.get("original_role")
        or request.headers.get("X-HR-Original-Role")
        or ""
    ).strip().upper()
    if not orig_role and token:
        try:
            row = execute_query("SELECT profile_json, email FROM user_sessions WHERE token = ?", (token,), fetch_one=True)
            if row and row.get("profile_json"):
                p_data = _json.loads(row["profile_json"])
                orig_role = (p_data.get("original_role") or "").strip().upper()
        except Exception:
            pass

    mbox_admin = False
    try:
        mb = execute_query("SELECT role FROM connected_mailboxes WHERE LOWER(email) = LOWER(?) AND connected = 1", (email_clean,), fetch_one=True)
        if mb and str(mb.get("role") or "").strip().upper() in ("ADMIN", "SUPER_ADMIN"):
            mbox_admin = True
    except Exception:
        pass

    user_row = execute_query("SELECT id, role, name FROM users WHERE LOWER(email) = LOWER(?)", (email_clean,), fetch_one=True)
    member_row = execute_query(
        "SELECT id, role, member_name FROM hr_department_members WHERE LOWER(email) = LOWER(?) AND COALESCE(active, 1) = 1 ORDER BY id DESC LIMIT 1",
        (email_clean,),
        fetch_one=True,
    )

    is_admin = (
        current_role in ("ADMIN", "SUPER_ADMIN")
        or orig_role in ("ADMIN", "SUPER_ADMIN")
        or mbox_admin
        or (user_row and str(user_row.get("role", "")).upper() in ("ADMIN", "SUPER_ADMIN"))
        or (member_row and str(member_row.get("role", "")).upper() in ("ADMIN", "SUPER_ADMIN"))
        or "ADMIN" in (request.headers.get("X-HR-User") or "").upper()
        or "admin" in email_clean
    )
    if not is_admin:
        return error_response(
            code="FORBIDDEN",
            message="Only an Admin has authority to switch or assign roles.",
            status_code=403,
        )

    payload = request.get_json(silent=True) or {}
    new_role = (payload.get("role") or "").strip().upper()
    if new_role == "SUPER_ADMIN":
        new_role = "ADMIN"

    valid_roles = ["ADMIN", "HR_MANAGER", "HR_LEAD", "HR_AGENT"]
    if new_role not in valid_roles:
        return error_response(
            code="BAD_REQUEST",
            message=f"Invalid role '{new_role}'. Must be one of {valid_roles}",
            status_code=400,
        )

    # Update users table
    if user_row:
        execute_query("UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (new_role, user_row["id"]), commit=True)
    else:
        execute_query("INSERT INTO users (email, role, name) VALUES (?, ?, ?)", (email_clean, new_role, (member_row.get("member_name") if member_row else None) or "Admin"), commit=True)

    # Update hr_department_members table
    execute_query("UPDATE hr_department_members SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?)", (new_role, email_clean), commit=True)

    # Update user_sessions table
    if token:
        execute_query("UPDATE user_sessions SET role = ?, last_seen_at = CURRENT_TIMESTAMP WHERE token = ?", (new_role, token), commit=True)
    execute_query("UPDATE user_sessions SET role = ? WHERE LOWER(email) = LOWER(?)", (new_role, email_clean), commit=True)

    # Rebuild user profile with the new role
    updated_profile = _build_user_profile(email_clean)
    updated_profile["original_role"] = orig_role or "ADMIN"
    if token:
        _ACTIVE_SESSIONS[token] = updated_profile
        try:
            execute_query("UPDATE user_sessions SET profile_json = ? WHERE token = ?", (_json.dumps(updated_profile), token), commit=True)
        except Exception:
            pass

    from backend.services.audit.audit_service import log_event
    log_event(
        entity_type="USER",
        entity_id=email_clean,
        action="ADMIN_SWITCHED_ROLE",
        description=f"Admin switched active operating role to {new_role} ({email_clean})",
        performed_by=session_user.get("name") or "Admin",
        metadata={"previous_role": current_role, "new_role": new_role, "email": email_clean},
    )

    return success_response({
        "message": f"Successfully switched operating role to {new_role}",
        "user": updated_profile,
        "token": token,
        "role": new_role,
    })


