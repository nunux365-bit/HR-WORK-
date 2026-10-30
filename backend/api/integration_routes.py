"""
HR FLOW — Phase 8 Integration & Health API Routes (backend/api/integration_routes.py)
Endpoints:
  - GET  /api/integrations
  - GET  /api/integrations/<id>
  - POST /api/integrations/<id>/configure
  - GET  /api/integrations/<id>/health
  - POST /api/integrations/<id>/health
  - POST /api/integrations/retrieve-data
"""

from flask import Blueprint, request
from backend.api import success_response, error_response
from backend.services.cases.case_service import require_permission
from backend.services.integrations.integration_registry import (
    list_integrations,
    get_integration,
    update_integration_config,
    check_integration_health,
    retrieve_external_data,
)

integration_bp = Blueprint("integrations", __name__, url_prefix="/api/integrations")


def _get_actor_and_role(payload: dict):
    user = (
        payload.get("performed_by")
        or request.headers.get("X-HR-User")
        or request.args.get("current_user")
        or "Vaibhav (HR)"
    )
    role = (
        payload.get("role")
        or request.headers.get("X-HR-Role")
        or request.args.get("role")
        or "ADMIN"
    )
    return user, role.upper()


@integration_bp.route("", methods=["GET"])
def api_list_integrations():
    items = list_integrations()
    return success_response({
        "count": len(items),
        "integrations": items,
    })


@integration_bp.route("/<integration_id>", methods=["GET"])
def api_get_integration(integration_id: str):
    item = get_integration(integration_id)
    if not item:
        return error_response("NOT_FOUND", f"Integration '{integration_id}' not found.", 404)
    return success_response({"integration": item, **item})


@integration_bp.route("/<integration_id>/configure", methods=["POST"])
@integration_bp.route("/<integration_id>", methods=["POST", "PUT"])
def api_configure_integration(integration_id: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    try:
        require_permission(role, "configure_integrations")
        if payload.get("credentials"):
            require_permission(role, "manage_credentials")

        updated = update_integration_config(
            integration_id=integration_id,
            status=payload.get("status"),
            mode=payload.get("mode"),
            configuration=payload.get("configuration"),
            credentials=payload.get("credentials"),
            performed_by=user,
        )
        return success_response({"integration": updated, **updated})
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("VALIDATION_ERROR", str(ve), 400)


@integration_bp.route("/<integration_id>/health", methods=["GET", "POST"])
def api_integration_health(integration_id: str):
    try:
        health = check_integration_health(integration_id)
        return success_response(health)
    except ValueError as ve:
        return error_response("NOT_FOUND", str(ve), 404)


@integration_bp.route("/retrieve-data", methods=["POST"])
def api_retrieve_external_data():
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    try:
        require_permission(role, "view_integration_results")
        resource_type = payload.get("resource_type") or payload.get("resource") or "employee"
        query = payload.get("query") or payload
        res = retrieve_external_data(
            resource_type=resource_type,
            query=query,
            provider_override=payload.get("provider"),
        )
        return success_response(res)
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except Exception as exc:
        return error_response("RETRIEVAL_ERROR", str(exc), 400)
