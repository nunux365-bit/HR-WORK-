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
        "SELECT id, email, name, role, created_at, updated_at FROM users ORDER BY id ASC",
        fetch_all=True
    )
    for u in users:
        if u.get("role") == "SUPER_ADMIN":
            u["role"] = "ADMIN"
        if u.get("name") == "Super Admin":
            u["name"] = "Admin"
    return success_response({"users": users})

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

    payload = request.get_json() or {}
    new_role = (payload.get("role") or "").strip().upper()
    if new_role == "SUPER_ADMIN":
        new_role = "ADMIN"

    valid_roles = ["ADMIN", "HR_MANAGER", "HR_LEAD", "HR_AGENT"]
    if new_role not in valid_roles:
        return error_response("BAD_REQUEST", f"Invalid role. Must be one of {valid_roles}", 400)

    u = execute_query("SELECT id, email, name, role FROM users WHERE id = ?", (user_id,), fetch_one=True)
    if not u:
        return error_response("NOT_FOUND", f"User #{user_id} not found.", 404)

    target_email = (u.get("email") or "").strip().lower()
    old_role = (u.get("role") or "HR_AGENT").upper()

    execute_query(
        "UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (new_role, user_id),
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

    updated_user = _build_user_profile(target_email) if target_email else {"id": user_id, "role": new_role}
    return success_response({
        "message": f"User {user_id} ({target_email}) role updated to {new_role}",
        "user": updated_user,
        "role": new_role,
    })


@user_bp.route("/switch-role", methods=["POST"])
@user_bp.route("/current/role", methods=["PUT", "POST"])
def user_switch_role():
    from backend.api.auth_routes import switch_active_role
    return switch_active_role()

