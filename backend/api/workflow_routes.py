"""
HR FLOW — Phase 6.14, 6.15 & Phase 7.12 Workflow Control Center API Routes (backend/api/workflow_routes.py)
Endpoints:
  - GET  /api/workflows
  - GET  /api/workflows/<identifier>
  - POST /api/workflows/<identifier>/transition
  - GET  /api/workflows/case/<identifier>
  - POST /api/workflows/case/<identifier>/start
  - POST /api/workflows/case/<identifier>/transition
"""

from flask import Blueprint, request
from backend.api import success_response, error_response
from backend.models.case import get_case_by_id_or_number
from backend.services.workflows.workflow_registry import (
    list_workflows,
    get_workflow_by_id,
    get_builder_catalog,
    save_workflow_definition,
    lifecycle_publish_or_rollback_workflow,
    build_blank_workflow_blueprint,
    reset_workflow_to_blank,
    delete_workflow_definition,
    clear_all_predefined_workflows,
    restore_default_workflows,
)
from backend.services.workflows.workflow_service import get_case_workflow, build_workflow_preview_for_category
from backend.services.workflows.workflow_engine import (
    get_or_create_workflow_instance,
    transition_workflow_state,
    redo_or_step_workflow_state,
    run_automated_workflow,
    run_workflow_test_suite,
)
from backend.classification.category_config import save_or_update_category_config
from backend.services.cases.case_engine import save_or_update_routing_rule
from backend.services.audit.audit_service import get_email_and_case_activity, log_event

workflow_bp = Blueprint("workflows", __name__, url_prefix="/api/workflows")


@workflow_bp.route("", methods=["GET"])
def list_all_workflows_route():
    wfs = list_workflows()
    return success_response({"count": len(wfs), "workflows": wfs})


@workflow_bp.route("/builder/catalog", methods=["GET"])
def get_workflow_builder_catalog_route():
    catalog = get_builder_catalog()
    return success_response(catalog)


def _require_admin_role(req, payload: dict = None) -> tuple:
    payload = payload or {}
    role = (payload.get("role") or req.headers.get("X-HR-Role") or "").strip().upper()
    user = (payload.get("performed_by") or req.headers.get("X-HR-User") or "Admin").strip()

    auth_header = req.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        from backend.database.connection import execute_query
        sess = execute_query("SELECT role, email FROM user_sessions WHERE token = ?", (token,), fetch_one=True)
        if sess and sess.get("role"):
            role = sess["role"].upper()
            if sess.get("email") and not user:
                user = sess["email"]

    if role == "SUPER_ADMIN":
        role = "ADMIN"

    if role not in ("ADMIN", "HR_ADMIN"):
        raise PermissionError(f"Access Denied: Only Administrators are authorized to create, configure, or delete workflows. (Current role: '{role or 'UNAUTHENTICATED'}')")

    return user, role


@workflow_bp.route("/builder/save", methods=["POST"])
def save_workflow_builder_blueprint_route():
    payload = request.get_json(silent=True) or {}
    try:
        user, role = _require_admin_role(request, payload)
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)

    category = (payload.get("category") or "").strip().upper()
    if not category:
        return error_response("VALIDATION_ERROR", "Category code is required to save workflow blueprint.", 400)

    try:
        saved_wf = save_workflow_definition(category, payload)
        log_event(
            entity_type="WORKFLOW",
            entity_id=saved_wf["workflow_id"],
            action="WORKFLOW_BLUEPRINT_SAVED",
            description=f"Workflow blueprint '{saved_wf['name']}' ({category}) saved via Workflow Builder",
            performed_by=user,
            metadata={"category": category, "states_count": len(saved_wf.get("states", []))},
        )
        return success_response({"workflow": saved_wf, "catalog": get_builder_catalog()})
    except ValueError as ve:
        return error_response("VALIDATION_ERROR", str(ve), 400)


@workflow_bp.route("/builder/category", methods=["POST"])
def create_or_update_modular_category_route():
    """
    Atomically registers a new modular HR category across:
      1. backend/data/categories.json
      2. backend/data/routing.json
      3. backend/workflows/definitions/workflows.json
    """
    payload = request.get_json(silent=True) or {}
    try:
        user, role = _require_admin_role(request, payload)
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)

    raw_code = (payload.get("code") or payload.get("category") or "").strip().upper().replace(" ", "_")
    if not raw_code:
        return error_response("VALIDATION_ERROR", "Category code (e.g. TRAVEL_EXPENSE) is required.", 400)

    display_name = (payload.get("display_name") or raw_code.replace("_", " ").title()).strip()
    wf_id = (payload.get("workflow_id") or f"WF-{raw_code}-001").strip().upper()
    wf_name = (payload.get("workflow_name") or f"{display_name} Workflow").strip()

    try:
        # 1. Save in categories.json
        saved_cat = save_or_update_category_config(
            raw_code,
            {
                "display_name": display_name,
                "workflow_id": wf_id,
                "workflow_name": wf_name,
                "keywords_strong": payload.get("keywords_strong") or [display_name.lower()],
                "keywords_weak": payload.get("keywords_weak") or [raw_code.lower().replace("_", " ")],
                "required_fields": payload.get("required_fields") or ["employee_id", "description"],
                "optional_fields": payload.get("optional_fields") or ["attachment"],
                "require_attachment": bool(payload.get("require_attachment", False)),
            },
        )

        # 2. Save in routing.json
        saved_routing = save_or_update_routing_rule(
            raw_code,
            {
                "team": payload.get("team") or "HR Operations",
                "priority": payload.get("priority") or "MEDIUM",
                "sla_hours": int(payload.get("sla_hours") or 48),
                "auto_create_case": bool(payload.get("auto_create_case", True)),
            },
        )

        # 3. Create clean blank starter workflow in workflows.json (unless custom states provided)
        blank_bp = build_blank_workflow_blueprint(raw_code)
        blank_bp["workflow_id"] = wf_id
        blank_bp["name"] = wf_name
        blank_bp["description"] = payload.get("description") or f"Custom {display_name} workflow — designed from scratch in n8n Studio."
        if payload.get("sla_hours"):
            blank_bp["automation_config"]["sla_config"]["sla_hours"] = int(payload.get("sla_hours") or 48)
        if payload.get("states"):
            blank_bp["states"] = payload.get("states")
            blank_bp["initial_state"] = blank_bp["states"][0]
            blank_bp["steps_display"] = payload.get("steps_display") or [s.replace("_", " ").title() for s in blank_bp["states"]]
        if payload.get("transitions"):
            blank_bp["transitions"] = payload.get("transitions")
        if payload.get("automation_config"):
            blank_bp["automation_config"] = payload.get("automation_config")

        saved_wf = save_workflow_definition(raw_code, blank_bp)

        log_event(
            entity_type="CATEGORY",
            entity_id=raw_code,
            action="MODULAR_CATEGORY_REGISTERED",
            description=f"Registered modular HR category '{raw_code}' ({display_name}) with workflow {wf_id}",
            performed_by=user,
            metadata={"category": raw_code, "workflow_id": wf_id, "team": saved_routing.get("team")},
        )

        return success_response({
            "category": saved_cat,
            "routing": saved_routing,
            "workflow": saved_wf,
            "catalog": get_builder_catalog(),
        }, 201)
    except ValueError as ve:
        return error_response("VALIDATION_ERROR", str(ve), 400)


@workflow_bp.route("/builder/autorun", methods=["POST"])
def run_automated_workflow_route():
    """
    Executes the n8n-style automated workflow (Trigger -> Data Enrichment -> IF Condition -> Action/Human Gate)
    for either a bound Case (`case_id`) or a Dry-Run Sandbox (`dry_run=True` + `mock_overrides`).
    """
    payload = request.get_json(silent=True) or {}
    user = payload.get("performed_by") or request.headers.get("X-HR-User") or "Vaibhav (HR)"
    case_ident = payload.get("case_id") or payload.get("case_identifier")
    category = payload.get("category")
    dry_run = bool(payload.get("dry_run", not bool(case_ident)))
    mock_overrides = payload.get("mock_overrides") if isinstance(payload.get("mock_overrides"), dict) else None

    resolved_case_id = None
    case_obj = None
    if case_ident:
        case_obj = get_case_by_id_or_number(case_ident)
        if not case_obj:
            return error_response("CASE_NOT_FOUND", f"Case '{case_ident}' not found.", 404)
        resolved_case_id = int(case_obj["db_id"])
        category = category or case_obj.get("category")

    try:
        result = run_automated_workflow(
            case_id=resolved_case_id,
            category=category or "LEAVE",
            dry_run=dry_run,
            mock_overrides=mock_overrides,
            performed_by=user,
        )
        if resolved_case_id and not dry_run:
            result["case"] = get_case_by_id_or_number(resolved_case_id)
        return success_response(result)
    except ValueError as ve:
        return error_response("AUTORUN_ERROR", str(ve), 400)


@workflow_bp.route("/builder/test-suite", methods=["POST"])
def run_workflow_test_suite_route():
    """
    Executes all saved Automated Workflow Test Cases for a category (`test_cases`)
    and verifies whether `branch_taken` and `final_state` match expectations.
    """
    payload = request.get_json(silent=True) or {}
    category = (payload.get("category") or "LEAVE").strip().upper()
    try:
        suite_result = run_workflow_test_suite(category)
        return success_response(suite_result)
    except ValueError as ve:
        return error_response("TEST_SUITE_ERROR", str(ve), 400)


@workflow_bp.route("/builder/lifecycle", methods=["POST"])
def workflow_lifecycle_route():
    """
    Handles Draft -> Validate -> Publish -> Rollback lifecycle transitions
    with strict Admin RBAC checks.
    """
    payload = request.get_json(silent=True) or {}
    try:
        user, role = _require_admin_role(request, payload)
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)

    category = (payload.get("category") or "").strip().upper()
    action = (payload.get("action") or "PUBLISH").strip().upper()
    target_version = payload.get("target_version")
    notes = payload.get("notes") or ""

    if not category:
        return error_response("VALIDATION_ERROR", "Category is required for lifecycle action.", 400)

    try:
        updated_wf = lifecycle_publish_or_rollback_workflow(
            category=category,
            action=action,
            target_version=target_version,
            performed_by=user,
            notes=notes,
        )
        log_event(
            entity_type="WORKFLOW",
            entity_id=updated_wf["workflow_id"],
            action=f"WORKFLOW_{action}",
            description=f"Workflow '{updated_wf['name']}' ({category}) lifecycle action '{action}' -> {updated_wf.get('version')}",
            performed_by=user,
            metadata={"category": category, "action": action, "version": updated_wf.get("version")},
        )
        return success_response({"workflow": updated_wf, "catalog": get_builder_catalog()})
    except ValueError as ve:
        return error_response("LIFECYCLE_ERROR", str(ve), 400)


@workflow_bp.route("/builder/reset", methods=["POST"])
def reset_or_delete_workflow_builder_route():
    """
    Allows resetting a category workflow to a blank starter canvas, deleting a category workflow,
    or clearing all workflows. Strictly Admin-only.
    """
    payload = request.get_json(silent=True) or {}
    try:
        user, role = _require_admin_role(request, payload)
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)

    mode = (payload.get("mode") or "BLANK_CATEGORY").strip().upper()
    category = (payload.get("category") or "ATTENDANCE").strip().upper()

    try:
        if mode == "DELETE_ALL_PREDEFINED":
            keep = None if category in ("NONE", "ALL", "") else category
            wf = clear_all_predefined_workflows(keep_category=keep)
            log_event(
                entity_type="WORKFLOW",
                entity_id="ALL",
                action="WORKFLOWS_CLEARED_FOR_CUSTOM_DESIGN",
                description=f"All predefined workflows cleared by Admin {user}",
                performed_by=user,
            )
            return success_response({"workflow": wf, "catalog": get_builder_catalog()})
        if mode == "DELETE_CATEGORY":
            res = delete_workflow_definition(category)
            log_event(
                entity_type="WORKFLOW",
                entity_id=f"WF-{category}",
                action="WORKFLOW_DELETED",
                description=f"Deleted workflow blueprint for {category}",
                performed_by=user,
            )
            return success_response({"deleted": res, "catalog": get_builder_catalog()})
        if mode == "RESTORE_DEFAULTS":
            restore_default_workflows()
            return success_response({"catalog": get_builder_catalog()})

        # Default: BLANK_CATEGORY (reset category to blank starter canvas)
        wf = reset_workflow_to_blank(category)
        log_event(
            entity_type="WORKFLOW",
            entity_id=wf["workflow_id"],
            action="WORKFLOW_RESET_TO_BLANK",
            description=f"Workflow '{category}' reset to blank starter canvas for live design",
            performed_by=user,
        )
        return success_response({"workflow": wf, "catalog": get_builder_catalog()})
    except Exception as ex:
        return error_response("RESET_ERROR", str(ex), 400)




@workflow_bp.route("/<identifier>", methods=["GET"])
def get_workflow_or_case_workflow_route(identifier: str):
    # Support both workflow definition ID (e.g. WF-LEAVE-001) and case identifier (e.g. CASE-000001)
    wf_def = get_workflow_by_id(identifier)
    if wf_def:
        return success_response({"workflow": wf_def})

    case = get_case_by_id_or_number(identifier)
    if case:
        wf = build_workflow_preview_for_category(case.get("category") or "GENERAL_HR", case_id=case["db_id"])
        return success_response({"case": case, "workflow": wf})

    return error_response("WORKFLOW_NOT_FOUND", f"Workflow or Case '{identifier}' not found.", 404)


@workflow_bp.route("/case/<identifier>", methods=["GET"])
def get_case_workflow_route(identifier: str):
    case = get_case_by_id_or_number(identifier)
    if not case:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)
    wf = build_workflow_preview_for_category(case.get("category") or "GENERAL_HR", case_id=case["db_id"])
    return success_response({"case": case, "workflow": wf})


@workflow_bp.route("/case/<identifier>/start", methods=["POST"])
def start_case_workflow_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user = payload.get("performed_by") or request.headers.get("X-HR-User") or "Vaibhav (HR)"
    case = get_case_by_id_or_number(identifier)
    if not case:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)
    wf = get_or_create_workflow_instance(case["db_id"], case.get("category") or "GENERAL_HR", performed_by=user)
    updated_case = get_case_by_id_or_number(case["db_id"])
    return success_response({
        "case": updated_case,
        "workflow": wf,
        "activity": get_email_and_case_activity(email_id=case.get("email_id"), case_id=case["db_id"], case_number=case["case_number"]),
    })


@workflow_bp.route("/<identifier>/transition", methods=["POST"])
@workflow_bp.route("/case/<identifier>/transition", methods=["POST"])
def transition_case_workflow_route(identifier: str):
    from backend.services.cases.case_service import require_permission
    payload = request.get_json(silent=True) or {}
    user = payload.get("performed_by") or request.headers.get("X-HR-User") or "Vaibhav (HR)"
    role = (payload.get("role") or request.headers.get("X-HR-Role") or "ADMIN").upper()
    case = get_case_by_id_or_number(identifier)
    if not case:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)

    try:
        require_permission(role, "move_workflow")
        req_action = (payload.get("action") or "").strip().upper()
        if req_action in ("RESTART", "REDO", "RESET", "STEP_BACK", "PREVIOUS_STEP", "BACK", "GOTO_STATE", "SET_STATE", "JUMP"):
            wf = redo_or_step_workflow_state(
                case_id=case["db_id"],
                action=req_action,
                target_state=payload.get("target_state"),
                reason=payload.get("reason"),
                performed_by=user,
            )
        else:
            wf = transition_workflow_state(
                case_id=case["db_id"],
                trigger=payload.get("trigger"),
                target_state=payload.get("target_state"),
                performed_by=user,
                enforce_conditions=bool(payload.get("enforce_conditions", False)),
            )
        updated_case = get_case_by_id_or_number(case["db_id"])
        return success_response({
            "case": updated_case,
            "workflow": wf,
            "activity": get_email_and_case_activity(email_id=case.get("email_id"), case_id=case["db_id"], case_number=case["case_number"]),
        })
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("TRANSITION_ERROR", str(ve), 400)


@workflow_bp.route("/<identifier>/redo", methods=["POST"])
@workflow_bp.route("/case/<identifier>/redo", methods=["POST"])
def redo_or_step_case_workflow_route(identifier: str):
    from backend.services.cases.case_service import require_permission
    payload = request.get_json(silent=True) or {}
    user = payload.get("performed_by") or request.headers.get("X-HR-User") or "Vaibhav (HR)"
    role = (payload.get("role") or request.headers.get("X-HR-Role") or "ADMIN").upper()
    case = get_case_by_id_or_number(identifier)
    if not case:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)

    try:
        require_permission(role, "move_workflow")
        wf = redo_or_step_workflow_state(
            case_id=case["db_id"],
            action=payload.get("action") or "RESTART",
            target_state=payload.get("target_state"),
            reason=payload.get("reason"),
            performed_by=user,
        )
        updated_case = get_case_by_id_or_number(case["db_id"])
        return success_response({
            "case": updated_case,
            "workflow": wf,
            "activity": get_email_and_case_activity(email_id=case.get("email_id"), case_id=case["db_id"], case_number=case["case_number"]),
        })
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("WORKFLOW_REDO_ERROR", str(ve), 400)


