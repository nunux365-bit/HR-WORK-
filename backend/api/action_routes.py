"""
HR FLOW — Phase 8 HR Action Center & External Audit API Routes (backend/api/action_routes.py)
Endpoints:
  - GET  /api/actions
  - POST /api/actions/execute
  - GET  /api/actions/<id>
  - POST /api/actions/<id>/retry
  - POST /api/actions/<id>/approve
  - GET  /api/actions/policies
  - POST /api/actions/policies/<action_type>
  - GET  /api/actions/external-audit
"""

from flask import Blueprint, request
from backend.api import success_response, error_response
from backend.services.cases.case_service import require_permission
from backend.services.actions.action_library import (
    list_action_policies,
    get_action_policy,
    update_action_policy,
    DEFAULT_ACTION_CATALOG,
)
from backend.services.actions.action_engine import (
    execute_hr_action,
    retry_hr_action,
    approve_and_execute_hr_action,
    get_hr_action,
    list_hr_actions,
    list_external_api_audits,
)

action_bp = Blueprint("actions", __name__, url_prefix="/api/actions")


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


@action_bp.route("", methods=["GET"])
def api_list_actions():
    case_id = request.args.get("case_id")
    status = request.args.get("status")
    provider = request.args.get("provider")
    action_type = request.args.get("action_type") or request.args.get("action")
    limit = int(request.args.get("limit", 200))

    actions = list_hr_actions(
        case_id=case_id,
        status=status,
        provider=provider,
        action_type=action_type,
        limit=limit,
    )
    policies = list_action_policies()
    return success_response({
        "count": len(actions),
        "actions": actions,
        "policies": policies,
        "action_catalog": list(DEFAULT_ACTION_CATALOG.keys()),
    })


@action_bp.route("/execute", methods=["POST"])
@action_bp.route("", methods=["POST"])
def api_execute_action():
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    action_type = payload.get("action") or payload.get("action_type")
    if not action_type:
        return error_response("VALIDATION_ERROR", "Field 'action' is required.", 400)

    try:
        res = execute_hr_action(
            action_type=action_type,
            case_identifier=payload.get("case_id") or payload.get("case_number"),
            payload=payload.get("payload") or payload,
            workflow_id=payload.get("workflow_id"),
            workflow_step=payload.get("workflow_step"),
            provider_override=payload.get("provider"),
            performed_by=user,
            role=role,
            approved_by=payload.get("approved_by"),
            idempotency_key=payload.get("idempotency_key"),
            force_retry=bool(payload.get("force_retry", False)),
        )
        return success_response(res)
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("ACTION_ERROR", str(ve), 400)


@action_bp.route("/policies", methods=["GET"])
def api_get_action_policies():
    policies = list_action_policies()
    return success_response({
        "count": len(policies),
        "policies": policies,
    })


@action_bp.route("/policies/<action_type>", methods=["POST", "PUT"])
def api_update_action_policy(action_type: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    try:
        require_permission(role, "configure_integrations")
        updated = update_action_policy(
            action_type=action_type,
            risk_level=payload.get("risk_level"),
            execution_mode=payload.get("execution_mode"),
            required_role=payload.get("required_role"),
            requires_approval=payload.get("requires_approval"),
            max_retries=payload.get("max_retries"),
        )
        return success_response({"policy": updated, **updated})
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("POLICY_ERROR", str(ve), 400)


@action_bp.route("/external-audit", methods=["GET"])
def api_list_external_audits():
    case_id = request.args.get("case_id")
    action_id = request.args.get("action_id")
    provider = request.args.get("provider")
    limit = int(request.args.get("limit", 200))
    audits = list_external_api_audits(
        case_id=case_id,
        action_id=int(action_id) if action_id and action_id.isdigit() else None,
        provider=provider,
        limit=limit,
    )
    return success_response({
        "count": len(audits),
        "audits": audits,
    })


@action_bp.route("/<identifier>", methods=["GET"])
def api_get_action_detail(identifier: str):
    act = get_hr_action(identifier)
    if not act:
        return error_response("NOT_FOUND", f"Action '{identifier}' not found.", 404)
    audits = list_external_api_audits(action_id=act["id"])
    return success_response({
        "action": act,
        "audits": audits,
        **act,
    })


@action_bp.route("/<identifier>/retry", methods=["POST"])
def api_retry_action(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    try:
        res = retry_hr_action(
            action_identifier=identifier,
            performed_by=user,
            role=role,
            override_payload=payload.get("payload"),
        )
        return success_response(res)
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("RETRY_ERROR", str(ve), 400)


@action_bp.route("/<identifier>/approve", methods=["POST"])
def api_approve_action(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    try:
        res = approve_and_execute_hr_action(
            action_identifier=identifier,
            approved_by=user,
            role=role,
        )
        return success_response(res)
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("APPROVE_ACTION_ERROR", str(ve), 400)
