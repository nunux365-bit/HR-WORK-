"""
HR Flow - Operational Notifications & Role Permissions API Routes (Phase 7.23 & 7.24)
"""

from flask import Blueprint, request
from backend.api import success_response
from backend.services.cases.case_service import (
    list_notifications,
    mark_notification_read,
    ROLE_PERMISSIONS,
    check_role_permission,
    HR_TEAMS,
    HR_USERS,
)

settings_bp = Blueprint("settings", __name__, url_prefix="/api")


@settings_bp.route("/notifications", methods=["GET"])
def api_list_notifications():
    unread_only = request.args.get("unread_only", "").lower() in ("true", "1", "yes")
    limit = int(request.args.get("limit", 50))
    res = list_notifications(unread_only=unread_only, limit=limit)
    return success_response(res)


@settings_bp.route("/notifications/<int:notif_id>/read", methods=["POST"])
def api_read_notification(notif_id: int):
    res = mark_notification_read(notif_id=notif_id, mark_all=False)
    return success_response(res)


@settings_bp.route("/notifications/read-all", methods=["POST"])
def api_read_all_notifications():
    res = mark_notification_read(mark_all=True)
    return success_response(res)


@settings_bp.route("/permissions", methods=["GET"])
def api_get_permissions():
    role = (request.args.get("role") or "ADMIN").upper()
    return success_response({
        "role": role,
        "permissions": ROLE_PERMISSIONS.get(role, []),
        "all_roles": ROLE_PERMISSIONS,
        "hr_teams": HR_TEAMS,
        "hr_users": HR_USERS,
    })


@settings_bp.route("/permissions/check", methods=["POST"])
def api_check_permission():
    body = request.get_json(silent=True) or {}
    role = (body.get("role") or "ADMIN").upper()
    action = body.get("action") or body.get("permission") or ""
    allowed = check_role_permission(role, action)
    return success_response({
        "role": role,
        "action": action,
        "allowed": allowed,
    })
