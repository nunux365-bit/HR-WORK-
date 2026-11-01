from flask import Blueprint, request, jsonify
from backend.api import success_response, error_response
from backend.database.connection import execute_query

user_bp = Blueprint("users", __name__, url_prefix="/api/users")


@user_bp.route("", methods=["GET"])
def list_users():
    role = (request.headers.get("X-HR-Role") or "ADMIN").upper()
    if role == "SUPER_ADMIN":
        role = "ADMIN"
    if role != "ADMIN":
        return error_response("FORBIDDEN", "Only ADMIN can view all users.", 403)

    users = execute_query(
        "SELECT id, email, name, role, status, last_login_at, created_at, updated_at FROM users ORDER BY id ASC",
        fetch_all=True
    )
    for u in users:
        if u.get("role") == "SUPER_ADMIN":
            u["role"] = "ADMIN"
        if u.get("name") == "Super Admin":
            u["name"] = "Admin"
        if not u.get("status"):
            u["status"] = "ACTIVE"
    return success_response({"users": users})


@user_bp.route("", methods=["POST"])
def create_user():
    """Create a new user directly in users table (and optionally in department members)."""
    from backend.api.auth_routes import get_session_user_from_request
    from backend.services.audit.audit_service import log_event

    session_user = get_session_user_from_request()
    hdr_role = (request.headers.get("X-HR-Role") or "").strip().upper()
    caller_role = (session_user.get("role") or hdr_role or "ADMIN").upper()
    if caller_role not in ("ADMIN", "SUPER_ADMIN"):
        return error_response("FORBIDDEN", "Only ADMIN can create users.", 403)

    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    name = (payload.get("name") or "").strip()
    role = (payload.get("role") or "HR_AGENT").strip().upper()
    status = (payload.get("status") or "ACTIVE").strip().upper()

    if not email or "@" not in email:
        return error_response("VALIDATION_ERROR", "A valid email is required.", 400)
    if not name:
        return error_response("VALIDATION_ERROR", "Name is required.", 400)

    if role == "SUPER_ADMIN":
        role = "ADMIN"
    valid_roles = ["ADMIN", "HR_MANAGER", "HR_LEAD", "HR_AGENT"]
    if role not in valid_roles:
        return error_response("VALIDATION_ERROR", f"Invalid role. Must be one of {valid_roles}", 400)

    existing = execute_query("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", (email,), fetch_one=True)
    if existing:
        return error_response("CONFLICT", f"User with email '{email}' already exists.", 409)

    execute_query(
        "INSERT INTO users (email, role, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        (email, role, name, status),
        commit=True
    )
    new_user = execute_query("SELECT id, email, name, role, status, created_at FROM users WHERE LOWER(email) = LOWER(?)", (email,), fetch_one=True)

    log_event(
        entity_type="USER",
        entity_id=new_user["id"],
        action="USER_CREATED",
        description=f"Created user {name} ({email}) with role {role}",
        performed_by=session_user.get("name") or request.headers.get("X-HR-User") or "Admin",
        metadata={"email": email, "role": role, "status": status}
    )

    smtp_res = None
    if payload.get("send_welcome_email", True):
        try:
            from backend.api.agent_routes import build_role_welcome_email_payload
            from backend.services.gmail.gmail_client import send_gmail_smtp_email
            from backend.config import Config
            portal_url = Config.get_portal_base_url(payload.get("portal_base_url") or "")
            email_payload = build_role_welcome_email_payload(
                name=name,
                email=email,
                role=role,
                team_name="HR Operations",
                designation=role.replace("_", " ").title(),
                category_scope="GENERAL_HR",
                custom_note=payload.get("custom_note") or "",
                is_role_update=False,
                portal_base_url=portal_url,
            )
            smtp_res = send_gmail_smtp_email(
                recipient_email=email,
                subject=email_payload["subject"],
                body_text=email_payload["body_text"],
                body_html=email_payload["body_html"],
            )
            log_event(
                entity_type="USER",
                entity_id=new_user["id"],
                action="EMPLOYEE_WELCOME_EMAIL_SENT",
                description=f"Sent Role Election Welcome Email to {name} ({email}) · {smtp_res.get('status')}",
                performed_by=session_user.get("name") or request.headers.get("X-HR-User") or "Admin",
                metadata={"user_id": new_user["id"], "email": email, "role": role, "smtp_status": smtp_res.get("status"), "sent": smtp_res.get("sent", False)},
            )
        except Exception as e:
            pass

    try:
        from backend.database.neon_sync import trigger_async_backup
        trigger_async_backup()
    except Exception:
        pass

    return success_response({
        "user": new_user,
        "welcome_dispatch": smtp_res,
        "message": f"User {name} created successfully."
    })


@user_bp.route("/<int:user_id>/role", methods=["PUT"])
def update_user_role(user_id):
    from backend.api.auth_routes import get_session_user_from_request, _ACTIVE_SESSIONS, _build_user_profile
    from backend.services.audit.audit_service import log_event

    session_user = get_session_user_from_request()
    hdr_role = (request.headers.get("X-HR-Role") or "").strip().upper()
    sess_role = (session_user.get("role") or "").strip().upper()
    caller_role = sess_role or hdr_role or "ADMIN"
    if caller_role == "SUPER_ADMIN":
        caller_role = "ADMIN"

    is_admin = (
        caller_role == "ADMIN"
        or "ADMIN" in (request.headers.get("X-HR-User") or "").upper()
        or session_user.get("role") in ("ADMIN", "SUPER_ADMIN")
    )
    if not is_admin:
        return error_response("FORBIDDEN", "Only ADMIN can assign or update user roles.", 403)

    payload = request.get_json(silent=True) or {}
    new_role = (payload.get("role") or "").strip().upper()
    if new_role == "SUPER_ADMIN":
        new_role = "ADMIN"

    valid_roles = ["ADMIN", "HR_MANAGER", "HR_LEAD", "HR_AGENT"]
    if new_role not in valid_roles:
        return error_response("BAD_REQUEST", f"Invalid role. Must be one of {valid_roles}", 400)

    req_email = (request.args.get("email") or payload.get("email") or "").strip().lower()
    u = execute_query("SELECT id, email, name, role FROM users WHERE id = ?", (user_id,), fetch_one=True)
    if not u and req_email:
        u = execute_query("SELECT id, email, name, role FROM users WHERE LOWER(email) = LOWER(?)", (req_email,), fetch_one=True)
    if not u:
        m = execute_query("SELECT id, email, member_name as name, role FROM hr_department_members WHERE id = ?", (user_id,), fetch_one=True)
        if m:
            m_em = (m.get("email") or "").strip().lower()
            u = execute_query("SELECT id, email, name, role FROM users WHERE LOWER(email) = LOWER(?)", (m_em,), fetch_one=True) or m
    if not u:
        return error_response("NOT_FOUND", f"User #{user_id} not found.", 404)

    target_email = (u.get("email") or "").strip().lower()
    old_role = (u.get("role") or "HR_AGENT").upper()
    real_user_id = u.get("id") or user_id

    execute_query(
        "UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? OR LOWER(email) = LOWER(?)",
        (new_role, real_user_id, target_email),
        commit=True,
    )

    if target_email:
        execute_query(
            "UPDATE hr_department_members SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?)",
            (new_role, target_email),
            commit=True,
        )
        execute_query(
            "UPDATE user_sessions SET role = ? WHERE LOWER(email) = LOWER(?)",
            (new_role, target_email),
            commit=True,
        )
        for tok, prof in list(_ACTIVE_SESSIONS.items()):
            if isinstance(prof, dict) and (prof.get("email") or "").strip().lower() == target_email:
                prof["role"] = new_role
                prof["role_title"] = new_role.replace("_", " ").title()

    log_event(
        entity_type="USER",
        entity_id=user_id,
        action="USER_ROLE_ASSIGNED",
        description=f"Admin assigned role {new_role} to {u.get('name') or target_email} (was {old_role})",
        performed_by=session_user.get("name") or request.headers.get("X-HR-User") or "Admin",
        metadata={"user_id": user_id, "email": target_email, "old_role": old_role, "new_role": new_role},
    )

    try:
        from backend.database.neon_sync import trigger_async_backup
        trigger_async_backup()
    except Exception:
        pass

    updated_user = _build_user_profile(target_email) if target_email else {"id": user_id, "role": new_role}
    return success_response({
        "message": f"User {user_id} ({target_email}) role updated to {new_role}",
        "user": updated_user,
        "role": new_role,
    })


@user_bp.route("/<int:user_id>/status", methods=["PATCH", "PUT"])
def update_user_status(user_id):
    """Toggle or update a user's status between ACTIVE and DEACTIVATED."""
    from backend.api.auth_routes import get_session_user_from_request
    from backend.services.audit.audit_service import log_event

    session_user = get_session_user_from_request()
    hdr_role = (request.headers.get("X-HR-Role") or "").strip().upper()
    caller_role = (session_user.get("role") or hdr_role or "ADMIN").upper()
    if caller_role not in ("ADMIN", "SUPER_ADMIN"):
        return error_response("FORBIDDEN", "Only ADMIN can modify user status.", 403)

    payload = request.get_json(silent=True) or {}
    status_req = str(payload.get("status") or "").strip().upper()
    new_status = "ACTIVE" if status_req in ("ACTIVE", "1", "TRUE") else "DEACTIVATED"
    new_active = 1 if new_status == "ACTIVE" else 0

    req_email = (request.args.get("email") or payload.get("email") or "").strip().lower()
    u = execute_query("SELECT id, email, name, role, status FROM users WHERE id = ?", (user_id,), fetch_one=True)
    if not u and req_email:
        u = execute_query("SELECT id, email, name, role, status FROM users WHERE LOWER(email) = LOWER(?)", (req_email,), fetch_one=True)
    if not u:
        m = execute_query("SELECT id, email, member_name as name, role, active FROM hr_department_members WHERE id = ?", (user_id,), fetch_one=True)
        if m:
            m_em = (m.get("email") or "").strip().lower()
            u = execute_query("SELECT id, email, name, role, status FROM users WHERE LOWER(email) = LOWER(?)", (m_em,), fetch_one=True) or m
    if not u:
        return error_response("NOT_FOUND", f"User #{user_id} not found.", 404)

    target_email = (u.get("email") or "").strip().lower()
    if target_email == "nunux365@gmail.com" and new_status == "DEACTIVATED":
        return error_response("FORBIDDEN", "Primary Admin account cannot be deactivated.", 403)

    real_user_id = u.get("id") or user_id
    execute_query("UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? OR LOWER(email) = LOWER(?)", (new_status, real_user_id, target_email), commit=True)
    execute_query("UPDATE hr_department_members SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?) OR id = ?", (new_active, target_email, user_id), commit=True)

    unassigned_count = 0
    if payload.get("unassign_cases") and new_status == "DEACTIVATED":
        unassigned_count = execute_query(
            "UPDATE cases SET assigned_user = NULL, assigned_user_email = NULL WHERE LOWER(assigned_user_email) = LOWER(?) AND status NOT IN ('RESOLVED', 'CLOSED')",
            (target_email,),
            commit=True
        ) or 0

    log_event(
        entity_type="USER",
        entity_id=user_id,
        action="USER_STATUS_UPDATED",
        description=f"Admin changed user status to {new_status} for {u.get('name') or target_email}" + (f" and unassigned {unassigned_count} active cases" if unassigned_count else ""),
        performed_by=session_user.get("name") or request.headers.get("X-HR-User") or "Admin",
        metadata={"user_id": user_id, "email": target_email, "new_status": new_status, "unassigned_cases": unassigned_count}
    )

    try:
        from backend.database.neon_sync import trigger_async_backup
        trigger_async_backup()
    except Exception:
        pass

    return success_response({
        "message": f"User {u.get('name') or target_email} status set to {new_status}",
        "user_id": user_id,
        "status": new_status,
        "active": new_active,
        "unassigned_cases": unassigned_count,
    })


@user_bp.route("/<int:user_id>", methods=["DELETE"])
def delete_user(user_id):
    """Safely delete user, protecting primary admin and offering case protection."""
    from backend.api.auth_routes import get_session_user_from_request
    from backend.services.audit.audit_service import log_event

    session_user = get_session_user_from_request()
    hdr_role = (request.headers.get("X-HR-Role") or "").strip().upper()
    caller_role = (session_user.get("role") or hdr_role or "ADMIN").upper()
    if caller_role not in ("ADMIN", "SUPER_ADMIN"):
        return error_response("FORBIDDEN", "Only ADMIN can delete users.", 403)

    req_email = (request.args.get("email") or (request.get_json(silent=True) or {}).get("email") or "").strip().lower()
    u = execute_query("SELECT id, email, name, role FROM users WHERE id = ?", (user_id,), fetch_one=True)
    if not u and req_email:
        u = execute_query("SELECT id, email, name, role FROM users WHERE LOWER(email) = LOWER(?)", (req_email,), fetch_one=True)
    if not u:
        m = execute_query("SELECT id, email, member_name as name, role FROM hr_department_members WHERE id = ?", (user_id,), fetch_one=True)
        if m:
            m_em = (m.get("email") or "").strip().lower()
            u = execute_query("SELECT id, email, name, role FROM users WHERE LOWER(email) = LOWER(?)", (m_em,), fetch_one=True) or m
    if not u:
        return error_response("NOT_FOUND", f"User #{user_id} not found.", 404)

    target_email = (u.get("email") or "").strip().lower()
    if target_email == "nunux365@gmail.com":
        return error_response("FORBIDDEN", "Primary Admin account cannot be deleted.", 403)

    real_user_id = u.get("id") or user_id
    execute_query("DELETE FROM users WHERE id = ? OR LOWER(email) = LOWER(?)", (real_user_id, target_email), commit=True)
    execute_query("DELETE FROM hr_department_members WHERE LOWER(email) = LOWER(?) OR id = ?", (target_email, user_id), commit=True)
    execute_query("DELETE FROM user_sessions WHERE LOWER(email) = LOWER(?)", (target_email,), commit=True)

    # Automatically unassign any pending cases
    execute_query(
        "UPDATE cases SET assigned_user = NULL, assigned_user_email = NULL WHERE LOWER(assigned_user_email) = LOWER(?) AND status NOT IN ('RESOLVED', 'CLOSED')",
        (target_email,),
        commit=True
    )

    log_event(
        entity_type="USER",
        entity_id=user_id,
        action="USER_DELETED",
        description=f"Deleted user {u.get('name') or target_email} ({u.get('role')}) and unassigned active cases",
        performed_by=session_user.get("name") or request.headers.get("X-HR-User") or "Admin",
        metadata={"user_id": user_id, "email": target_email}
    )

    try:
        from backend.database.neon_sync import trigger_async_backup
        trigger_async_backup()
    except Exception:
        pass

    return success_response({"message": f"User #{user_id} ({target_email}) removed successfully.", "deleted": True})


@user_bp.route("/switch-role", methods=["POST"])
@user_bp.route("/current/role", methods=["PUT", "POST"])
def user_switch_role():
    from backend.api.auth_routes import switch_active_role
    return switch_active_role()
