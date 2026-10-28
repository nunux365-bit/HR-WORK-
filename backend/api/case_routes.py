"""
HR FLOW — Phase 6.13 & Phase 7 Operational Case Workspace API Routes (backend/api/case_routes.py)
Endpoints:
  - GET  /api/cases
  - GET  /api/cases/metrics
  - GET  /api/cases/<identifier>
  - GET  /api/cases/<identifier>/timeline
  - POST /api/cases/<identifier>/assign
  - POST /api/cases/<identifier>/status
  - POST /api/cases/<identifier>/priority
  - POST /api/cases/<identifier>/category
  - POST /api/cases/<identifier>/employee
  - POST /api/cases/<identifier>/fields
  - POST /api/cases/<identifier>/hold
  - POST /api/cases/<identifier>/request-info
  - GET  /api/cases/<identifier>/documents
  - POST /api/cases/<identifier>/documents
  - GET  /api/cases/<identifier>/communications
  - POST /api/cases/<identifier>/communications
  - POST /api/cases/<identifier>/reply
  - POST /api/cases/<identifier>/resolve
  - POST /api/cases/<identifier>/close
  - POST /api/cases/<identifier>/reopen
  - POST /api/cases/<identifier>/actions
"""

from flask import Blueprint, request
from backend.api import success_response, error_response
from backend.models.case import get_case_by_id_or_number, list_cases
from backend.services.cases.case_service import (
    assign_case,
    update_case_status,
    update_case_priority,
    update_case_category,
    update_case_employee,
    update_case_extracted_fields,
    get_case_documents,
    add_or_update_case_document,
    get_case_communications,
    add_case_communication,
    request_missing_information,
    resolve_case,
    close_case,
    reopen_case,
    get_full_case_detail,
    get_operational_metrics,
    require_permission,
)
from backend.services.tasks.task_service import create_task
from backend.services.approvals.approval_service import request_approval, decide_approval, list_approvals
from backend.services.workflows.workflow_engine import transition_workflow_state
from backend.classification.ai_pipeline import accept_ai_classification
from backend.services.audit.audit_service import get_email_and_case_activity

case_bp = Blueprint("cases", __name__, url_prefix="/api/cases")


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


@case_bp.route("", methods=["GET"])
def list_cases_route():
    print("Entered list_cases_route", flush=True)
    # RBAC Support
    user = request.headers.get("X-HR-User") or "Vaibhav (HR)"
    role = (request.headers.get("X-HR-Role") or "ADMIN").upper()
    email = request.headers.get("X-HR-Email") or user

    assigned_user = request.args.get("assigned_user") or request.args.get("hr")
    
    if role == "HR_AGENT" and not assigned_user and not request.args.get("team") and not request.args.get("queue"):
        assigned_user = user if (user and "@" not in user) else email

    status = request.args.get("status")
    category = request.args.get("category")
    intent = request.args.get("intent")
    priority = request.args.get("priority")
    team = request.args.get("team")
    workflow_state = request.args.get("workflow_state") or request.args.get("workflow")
    sla_filter = request.args.get("sla") or request.args.get("sla_filter") or request.args.get("sla_state")
    date_prefix = request.args.get("date")
    search = request.args.get("search") or request.args.get("q")
    queue = request.args.get("queue")
    current_user = request.args.get("current_user") or request.args.get("user") or user
    limit = int(request.args.get("limit", 200))


    cases = list_cases(
        status=status,
        category=category,
        intent=intent,
        priority=priority,
        team=team,
        assigned_user=assigned_user,
        workflow_state=workflow_state,
        sla_filter=sla_filter,
        date_prefix=date_prefix,
        search=search,
        queue=queue,
        current_user=current_user,
        limit=limit,
    )

    # Department Mailbox Filtering: Restrict cases to designated department mailbox
    dept_id_arg = request.args.get("dept_id")
    account_email_arg = (request.args.get("account_email") or "").strip().lower()
    is_specialist_caller = bool(
        role == "HR_AGENT" or (email and "@" in email and not email.startswith("admin@"))
    )

    if dept_id_arg or account_email_arg or is_specialist_caller:
        from backend.database.connection import get_connection
        conn = get_connection()
        try:
            target_mailboxes = set()
            if account_email_arg:
                target_mailboxes.add(account_email_arg)
            if dept_id_arg and str(dept_id_arg).isdigit():
                d_row = conn.execute("SELECT dept_gmail FROM hr_departments WHERE id = ? LIMIT 1", (int(dept_id_arg),)).fetchone()
                if d_row and d_row["dept_gmail"]:
                    target_mailboxes.add(d_row["dept_gmail"].strip().lower())
            elif is_specialist_caller:
                m_rows = conn.execute(
                    """
                    SELECT d.dept_gmail
                    FROM hr_departments d
                    JOIN hr_department_members m ON d.id = m.dept_id
                    WHERE LOWER(m.email) = LOWER(?) OR LOWER(d.dept_gmail) = LOWER(?)
                    """,
                    (email, email),
                ).fetchall()
                for mr in m_rows:
                    if mr["dept_gmail"]:
                        target_mailboxes.add(mr["dept_gmail"].strip().lower())

            if target_mailboxes:
                cases = [
                    c for c in cases
                    if not c.get("account_email") or c.get("account_email").strip().lower() in target_mailboxes
                ]
        finally:
            conn.close()

    metrics = get_operational_metrics(current_user=current_user)
    return success_response({
        "count": len(cases),
        "cases": cases,
        "metrics": metrics,
    })


@case_bp.route("", methods=["POST"])
def create_case_from_email_route():
    payload = request.get_json(silent=True) or {}
    email_id = payload.get("email_id")
    if not email_id:
        return error_response("VALIDATION_ERROR", "Field 'email_id' is required.", 400)
    try:
        from backend.classification.ai_pipeline import process_email
        res = process_email(int(email_id), force_create_case=True)
        return success_response({"case": res.get("case"), "pipeline": res}, status_code=201)
    except Exception as exc:
        return error_response("CASE_CREATE_ERROR", str(exc), 400)


@case_bp.route("/metrics", methods=["GET"])
def get_case_metrics_route():
    current_user = (
        request.args.get("current_user")
        or request.args.get("user")
        or request.headers.get("X-HR-User")
        or "Vaibhav (HR)"
    )
    m = get_operational_metrics(current_user=current_user)
    return success_response({**m, "metrics": m.get("my_work", {})})


@case_bp.route("/<identifier>", methods=["GET"])
def get_case_detail_route(identifier: str):
    try:
        role = request.args.get("role") or request.headers.get("X-HR-Role") or "ADMIN"
        detail = get_full_case_detail(identifier, role=role)
        return success_response({
            **detail["case"],
            **detail,
            "detail": detail,
        })
    except ValueError as ve:
        return error_response("CASE_NOT_FOUND", str(ve), 404)


@case_bp.route("/<identifier>/dossier", methods=["GET"])
def get_case_dossier_route(identifier: str):
    from backend.services.cases.case_dossier_service import get_case_dossier
    user = request.headers.get("X-HR-User") or "Specialist"
    dossier = get_case_dossier(identifier, current_user=user)
    if not dossier:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)
    return success_response(dossier)


@case_bp.route("/<identifier>/timeline", methods=["GET"])
def get_case_timeline_route(identifier: str):
    case = get_case_by_id_or_number(identifier)
    if not case:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)
    timeline = get_email_and_case_activity(
        email_id=case.get("email_id"),
        case_id=case["db_id"],
        case_number=case["case_number"],
    )
    return success_response({
        "case_id": case["case_number"],
        "count": len(timeline),
        "timeline": timeline,
    })


@case_bp.route("/departments", methods=["GET"])
def list_departments_route():
    from backend.services.cases.department_service import list_departments_with_members
    depts = list_departments_with_members()
    total_members = sum(len(d.get("members", [])) for d in depts)
    return success_response({
        "count": len(depts),
        "total_members": total_members,
        "departments": depts,
    })


@case_bp.route("/departments", methods=["POST"])
def create_department_route():
    from backend.services.cases.department_service import create_department, list_departments_with_members
    from backend.services.classification.model_trainer import update_department_detection_keywords
    payload = request.get_json(silent=True) or {}
    try:
        dept = create_department(
            team_name=payload.get("team_name") or payload.get("name") or "",
            dept_gmail=payload.get("dept_gmail") or payload.get("email") or payload.get("gmail") or "",
            dept_code=payload.get("dept_code"),
            category_scope=payload.get("category_scope"),
            sla_hours=int(payload.get("sla_hours") or 48),
            default_priority=payload.get("default_priority") or "MEDIUM",
            description=payload.get("description"),
            lead_name=payload.get("lead_name"),
            lead_email=payload.get("lead_email"),
            lead_designation=payload.get("lead_designation"),
        )
        kw_strong = payload.get("keywords_strong")
        kw_weak = payload.get("keywords_weak")
        if kw_strong or kw_weak:
            cats = [c.strip().upper() for c in (dept.get("category_scope") or "").split(",") if c.strip()]
            if cats:
                try:
                    update_department_detection_keywords(
                        category_code=cats[0],
                        keywords_strong=kw_strong,
                        keywords_weak=kw_weak,
                        display_name=dept.get("team_name"),
                    )
                except Exception:
                    pass
        return success_response({
            "department": dept,
            "departments": list_departments_with_members(),
        }, status_code=201)
    except ValueError as ve:
        return error_response("VALIDATION_ERROR", str(ve), 400)



@case_bp.route("/departments/<int:dept_id>/members", methods=["POST"])
def add_department_member_route(dept_id: int):
    from backend.services.cases.department_service import add_department_member, list_departments_with_members
    payload = request.get_json(silent=True) or {}
    try:
        member = add_department_member(
            dept_id=dept_id,
            member_name=payload.get("member_name") or payload.get("name") or "",
            email=payload.get("email") or payload.get("gmail") or "",
            role=payload.get("role") or "HR_AGENT",
            designation=payload.get("designation") or "HR Specialist",
        )
        return success_response({
            "member": member,
            "departments": list_departments_with_members(),
        }, status_code=201)
    except ValueError as ve:
        return error_response("VALIDATION_ERROR", str(ve), 400)


@case_bp.route("/departments/members/<int:member_id>", methods=["PUT", "POST"])
def update_department_member_route(member_id: int):
    from backend.services.cases.department_service import update_department_member, list_departments_with_members
    payload = request.get_json(silent=True) or {}
    try:
        member = update_department_member(
            member_id=member_id,
            member_name=payload.get("member_name") or payload.get("name"),
            email=payload.get("email") or payload.get("gmail"),
            role=payload.get("role"),
            designation=payload.get("designation"),
        )
        return success_response({
            "member": member,
            "departments": list_departments_with_members(),
        })
    except ValueError as ve:
        return error_response("VALIDATION_ERROR", str(ve), 400)


@case_bp.route("/departments/members/<int:member_id>", methods=["DELETE"])
def delete_department_member_route(member_id: int):
    from backend.services.cases.department_service import delete_department_member, list_departments_with_members
    delete_department_member(member_id)
    return success_response({
        "deleted": member_id,
        "departments": list_departments_with_members(),
    })


@case_bp.route("/departments/<int:dept_id>", methods=["PUT", "POST"])
def update_department_route(dept_id: int):
    from backend.services.cases.department_service import update_department_info, list_departments_with_members
    payload = request.get_json(silent=True) or {}
    try:
        dept = update_department_info(
            dept_id=dept_id,
            team_name=payload.get("team_name") or payload.get("name"),
            dept_code=payload.get("dept_code"),
            category_scope=payload.get("category_scope"),
            dept_gmail=payload.get("dept_gmail") or payload.get("email"),
            sla_hours=payload.get("sla_hours"),
            default_priority=payload.get("default_priority"),
            description=payload.get("description"),
        )
        return success_response({
            "department": dept,
            "departments": list_departments_with_members(),
        })
    except ValueError as ve:
        return error_response("VALIDATION_ERROR", str(ve), 400)


@case_bp.route("/departments/<int:dept_id>", methods=["DELETE"])
def delete_department_route(dept_id: int):
    from backend.services.cases.department_service import delete_department, list_departments_with_members
    delete_department(dept_id)
    return success_response({
        "deleted": dept_id,
        "departments": list_departments_with_members(),
    })


@case_bp.route("/<identifier>/assign", methods=["POST"])
def assign_case_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    target_user = (
        user
        if payload.get("assign_to_me")
        else (payload.get("user") or payload.get("assigned_user") or payload.get("assigned_hr"))
    )
    try:
        require_permission(role, "assign_case")
        updated = assign_case(
            identifier=identifier,
            team=payload.get("team") or payload.get("assigned_team"),
            user=target_user,
            user_email=payload.get("user_email") or payload.get("assigned_user_email") or payload.get("email"),
            priority=payload.get("priority"),
            send_email=bool(payload.get("send_email")),
            dispatch_note=payload.get("dispatch_note") or payload.get("note"),
            performed_by=user,
            role=role,
        )
        detail = get_full_case_detail(updated["db_id"], role=role)
        return success_response({
            "case": updated,
            "dispatch": updated.get("dispatch_result"),
            "activity": detail["timeline"],
            "detail": detail,
        })
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("ASSIGN_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/status", methods=["POST"])
def update_status_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    status = payload.get("status")
    if not status:
        return error_response("VALIDATION_ERROR", "Field 'status' is required.", 400)
    try:
        updated = update_case_status(identifier, status=status, note=payload.get("note"), performed_by=user)
        detail = get_full_case_detail(updated["db_id"], role=role)
        return success_response({
            "case": updated,
            "activity": detail["timeline"],
            "detail": detail,
        })
    except ValueError as ve:
        return error_response("STATUS_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/priority", methods=["POST"])
def update_priority_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    priority = payload.get("priority")
    if not priority:
        return error_response("VALIDATION_ERROR", "Field 'priority' is required.", 400)
    try:
        require_permission(role, "change_priority")
        updated = update_case_priority(identifier, priority=priority, performed_by=user)
        detail = get_full_case_detail(updated["db_id"], role=role)
        return success_response({
            "case": updated,
            "activity": detail["timeline"],
            "detail": detail,
        })
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("PRIORITY_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/category", methods=["POST"])
def update_category_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    category = payload.get("category")
    if not category:
        return error_response("VALIDATION_ERROR", "Field 'category' is required.", 400)
    try:
        require_permission(role, "override_category")
        updated = update_case_category(
            identifier,
            category=category,
            intent=payload.get("intent"),
            reason=payload.get("reason"),
            performed_by=user,
        )
        detail = get_full_case_detail(updated["db_id"], role=role)
        return success_response({
            "case": updated,
            "workflow": detail["workflow"],
            "activity": detail["timeline"],
            "detail": detail,
        })
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("CATEGORY_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/employee", methods=["POST"])
def update_employee_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    emp_id = payload.get("employee_id")
    if not emp_id:
        return error_response("VALIDATION_ERROR", "Field 'employee_id' is required.", 400)
    try:
        updated = update_case_employee(identifier, employee_identifier=emp_id, performed_by=user)
        detail = get_full_case_detail(updated["db_id"], role=role)
        return success_response({
            "case": updated,
            "activity": detail["timeline"],
            "detail": detail,
        })
    except ValueError as ve:
        return error_response("EMPLOYEE_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/fields", methods=["POST"])
def update_fields_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    fields = payload.get("fields") or payload
    try:
        updated = update_case_extracted_fields(identifier, fields_patch=fields, performed_by=user)
        detail = get_full_case_detail(updated["db_id"], role=role)
        return success_response({
            "case": updated,
            "activity": detail["timeline"],
            "detail": detail,
        })
    except ValueError as ve:
        return error_response("FIELDS_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/hold", methods=["POST"])
def hold_case_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    reason = payload.get("reason") or payload.get("note") or "Placed on hold — awaiting missing information"
    try:
        updated = update_case_status(identifier, status="ON_HOLD", note=reason, performed_by=user)
        detail = get_full_case_detail(updated["db_id"], role=role)
        return success_response({
            "case": updated,
            "activity": detail["timeline"],
            "detail": detail,
        })
    except ValueError as ve:
        return error_response("HOLD_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/request-info", methods=["POST"])
def request_missing_info_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    missing = payload.get("missing") or payload.get("missing_items") or "Required Document / Information"
    message = payload.get("message") or f"Please provide the missing information: {missing}"
    to_recip = payload.get("to") or payload.get("recipient")
    try:
        res = request_missing_information(
            identifier=identifier,
            missing_items=missing,
            message=message,
            to_recipient=to_recip,
            performed_by=user,
        )
        detail = get_full_case_detail(res["case"]["db_id"], role=role)
        return success_response({
            "case": res["case"],
            "communication": res["communication"],
            "activity": detail["timeline"],
            "detail": detail,
        })
    except ValueError as ve:
        return error_response("REQUEST_INFO_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/documents", methods=["GET", "POST"])
def case_documents_route(identifier: str):
    case = get_case_by_id_or_number(identifier)
    if not case:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)

    if request.method == "GET":
        return success_response(get_case_documents(case["db_id"]))

    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    name = payload.get("name") or payload.get("filename") or "Supporting Document.pdf"
    status = payload.get("status") or "RECEIVED"
    doc_type = payload.get("doc_type") or payload.get("document_type") or payload.get("type") or "SUPPORTING_DOCUMENT"
    size = payload.get("size") or "140 KB"
    doc_id = payload.get("doc_id") or payload.get("id")
    try:
        docs_info = add_or_update_case_document(
            identifier=case["db_id"],
            name=name,
            status=status,
            doc_type=doc_type,
            uploaded_by=user,
            size=size,
            doc_id=doc_id,
        )
        detail = get_full_case_detail(case["db_id"], role=role)
        return success_response({
            **docs_info,
            "detail": detail,
        })
    except ValueError as ve:
        return error_response("DOCUMENT_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/communications", methods=["GET", "POST"])
def case_communications_route(identifier: str):
    case = get_case_by_id_or_number(identifier)
    if not case:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)

    if request.method == "GET":
        comms = get_case_communications(case["db_id"])
        return success_response({"count": len(comms), "communications": comms})

    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    msg = payload.get("message")
    if not msg:
        return error_response("VALIDATION_ERROR", "Field 'message' is required.", 400)
    try:
        comm = add_case_communication(
            identifier=case["db_id"],
            message=msg,
            sender_type=payload.get("sender_type") or "HR",
            sender_name=payload.get("sender_name") or payload.get("sender") or user,
            recipient=payload.get("recipient") or payload.get("to"),
            subject=payload.get("subject"),
            comm_type=payload.get("comm_type") or payload.get("communication_type") or "OUTBOUND_HR",
        )
        detail = get_full_case_detail(case["db_id"], role=role)
        return success_response({
            "communication": comm,
            "communications": detail["communications"],
            "activity": detail["timeline"],
            "detail": detail,
        })
    except ValueError as ve:
        return error_response("COMMUNICATION_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/reply", methods=["POST"])
def reply_to_case_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    message = (payload.get("message") or "").strip()
    if not message:
        return error_response("VALIDATION_ERROR", "Reply message cannot be empty.", 400)
    try:
        comm = add_case_communication(
            identifier=identifier,
            message=message,
            sender_type=payload.get("sender_type") or "HR",
            sender_name=user,
            recipient=payload.get("to"),
            subject=payload.get("subject"),
            comm_type="OUTBOUND_HR",
        )
        detail = get_full_case_detail(identifier, role=role)
        return success_response({
            "case": detail["case"],
            "communication": comm,
            "activity": detail["timeline"],
            "detail": detail,
        })
    except ValueError as ve:
        return error_response("CASE_NOT_FOUND", str(ve), 404)


@case_bp.route("/<identifier>/resolve", methods=["POST"])
def resolve_case_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    note = payload.get("note") or payload.get("resolution_notes") or "Resolved by HR"
    res_type = payload.get("resolution_type") or "STANDARD_RESOLUTION"
    enforce = bool(payload.get("enforce_checks", False))
    try:
        require_permission(role, "resolve_case")
        updated = resolve_case(
            identifier=identifier,
            resolution_note=note,
            resolution_type=res_type,
            performed_by=user,
            enforce_checks=enforce,
        )
        detail = get_full_case_detail(updated["db_id"], role=role)
        return success_response({
            "case": updated,
            "activity": detail["timeline"],
            "detail": detail,
        })
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("RESOLVE_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/close", methods=["POST"])
def close_case_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    note = payload.get("note") or payload.get("close_note")
    try:
        require_permission(role, "close_case")
        updated = close_case(identifier=identifier, close_note=note, performed_by=user)
        detail = get_full_case_detail(updated["db_id"], role=role)
        return success_response({
            "case": updated,
            "workflow": detail["workflow"],
            "activity": detail["timeline"],
            "detail": detail,
        })
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("CLOSE_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/reopen", methods=["POST"])
def reopen_case_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    reason = payload.get("reason") or payload.get("reopen_reason") or ""
    try:
        updated = reopen_case(
            identifier=identifier,
            reopen_reason=reason,
            performed_by=user,
            role=role,
        )
        detail = get_full_case_detail(updated["db_id"], role=role)
        return success_response({
            "case": updated,
            "workflow": detail["workflow"],
            "activity": detail["timeline"],
            "detail": detail,
        })
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("REOPEN_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/actions", methods=["POST"])
@case_bp.route("/<identifier>/execute-action", methods=["POST"])
def execute_case_action_route(identifier: str):
    """
    Phase 7.13 & 7.27 Unified HR Action Center Endpoint:
    Executes a contextual action on a case with role/permission & state validation.
    """
    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    action = (payload.get("action") or "").strip().upper()

    case = get_case_by_id_or_number(identifier)
    if not case:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)

    try:
        if action == "ACCEPT_AI":
            require_permission(role, "accept_ai")
            if case.get("email_id"):
                accept_ai_classification(int(case["email_id"]), performed_by=user)
            update_case_status(case["db_id"], status="READY", note="AI Classification accepted", performed_by=user)
        elif action == "OVERRIDE_CATEGORY":
            require_permission(role, "override_category")
            update_case_category(
                case["db_id"],
                category=payload.get("category") or case["category"],
                intent=payload.get("intent"),
                reason=payload.get("reason"),
                performed_by=user,
            )
        elif action in ("ASSIGN_TEAM", "ASSIGN_HR", "ASSIGN"):
            require_permission(role, "assign_case")
            assign_case(
                case["db_id"],
                team=payload.get("team"),
                user=payload.get("user") or payload.get("assigned_user"),
                priority=payload.get("priority"),
                performed_by=user,
                role=role,
            )
        elif action == "REQUEST_MISSING_INFO":
            require_permission(role, "request_info")
            request_missing_information(
                case["db_id"],
                missing_items=payload.get("missing") or "Required Document",
                message=payload.get("message") or "Please provide the missing information.",
                to_recipient=payload.get("to"),
                performed_by=user,
            )
        elif action == "MARK_READY":
            require_permission(role, "mark_ready")
            update_case_status(case["db_id"], status="READY", note="Marked READY by HR", performed_by=user)
        elif action == "CREATE_TASK":
            require_permission(role, "create_task")
            create_task(
                case_identifier=case["db_id"],
                title=payload.get("title") or "HR Verification Task",
                task_type=payload.get("task_type") or "HR_REVIEW",
                assigned_to=payload.get("assigned_to") or user,
                assigned_team=payload.get("assigned_team") or case.get("assigned_team"),
                priority=payload.get("priority") or case.get("priority"),
                due_at=payload.get("due_at"),
                description=payload.get("description"),
                performed_by=user,
            )
        elif action == "REQUEST_APPROVAL":
            require_permission(role, "request_approval")
            request_approval(
                case_identifier=case["db_id"],
                approver=payload.get("approver"),
                approver_role=payload.get("approver_role") or "HR_MANAGER",
                approval_type=payload.get("approval_type") or "MANAGER_APPROVAL",
                comments=payload.get("comments"),
                performed_by=user,
            )
        elif action in ("APPROVE", "APPROVE_PENDING"):
            require_permission(role, "approve_request")
            pending = list_approvals(case_id=case["db_id"], status="PENDING")
            if not pending:
                return error_response("NO_PENDING_APPROVAL", "No pending approval found for this case.", 400)
            decide_approval(pending[0]["id"], decision="APPROVED", comments=payload.get("comments"), performed_by=user)
        elif action in ("REJECT", "REJECT_PENDING"):
            require_permission(role, "reject_request")
            pending = list_approvals(case_id=case["db_id"], status="PENDING")
            if not pending:
                return error_response("NO_PENDING_APPROVAL", "No pending approval found for this case.", 400)
            decide_approval(pending[0]["id"], decision="REJECTED", comments=payload.get("comments"), performed_by=user)
        elif action == "MOVE_WORKFLOW" or action.startswith("WF_TRIGGER:"):
            require_permission(role, "move_workflow")
            trig = payload.get("trigger") or (action.split(":", 1)[1] if ":" in action else None)
            transition_workflow_state(
                case_id=case["db_id"],
                trigger=trig,
                target_state=payload.get("target_state"),
                performed_by=user,
            )
        elif action == "RESOLVE_CASE":
            require_permission(role, "resolve_case")
            resolve_case(
                case["db_id"],
                resolution_note=payload.get("note") or payload.get("resolution_notes"),
                resolution_type=payload.get("resolution_type") or "STANDARD_RESOLUTION",
                performed_by=user,
                enforce_checks=bool(payload.get("enforce_checks", False)),
            )
        elif action == "CLOSE_CASE":
            require_permission(role, "close_case")
            close_case(case["db_id"], close_note=payload.get("note"), performed_by=user)
        elif action == "REOPEN_CASE":
            reopen_case(
                case["db_id"],
                reopen_reason=payload.get("reason") or payload.get("reopen_reason") or "",
                performed_by=user,
                role=role,
            )
        else:
            from backend.services.actions.action_library import DEFAULT_ACTION_CATALOG, resolve_standard_action_type
            from backend.services.actions.action_engine import execute_hr_action

            std_act = resolve_standard_action_type(action)
            if std_act in DEFAULT_ACTION_CATALOG:
                act_res = execute_hr_action(
                    action_type=std_act,
                    case_identifier=case["db_id"],
                    payload=payload.get("payload") or payload,
                    provider_override=payload.get("provider"),
                    performed_by=user,
                    role=role,
                    approved_by=payload.get("approved_by"),
                )
                detail = get_full_case_detail(case["db_id"], role=role)
                return success_response({
                    "action_result": act_res,
                    "case": detail["case"],
                    "workflow": detail["workflow"],
                    "activity": detail["timeline"],
                    "detail": detail,
                })
            return error_response("INVALID_ACTION", f"Unsupported action '{action}'.", 400)

        detail = get_full_case_detail(case["db_id"], role=role)
        return success_response({
            "case": detail["case"],
            "workflow": detail["workflow"],
            "activity": detail["timeline"],
            "detail": detail,
        })
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("ACTION_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/notify-employee/preview", methods=["GET", "POST"])
def preview_employee_case_email_route(identifier: str):
    """Return the rendered HTML and plain-text Case Registration & Tracking email for preview."""
    from backend.services.cases.case_engine import build_employee_case_email_payload

    case = get_case_by_id_or_number(identifier)
    if not case:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)

    payload = request.get_json(silent=True) or {}
    recip = payload.get("recipient_email") or payload.get("to") or request.args.get("to")
    note = payload.get("note") or payload.get("custom_note") or request.args.get("note")

    preview = build_employee_case_email_payload(
        case_obj=case,
        recipient_override=recip,
        custom_note=note,
        portal_base_url=request.host_url.rstrip("/") if request.host_url else "http://127.0.0.1:5000",
    )
    return success_response(preview)


@case_bp.route("/<identifier>/notify-employee", methods=["POST"])
def notify_employee_case_email_route(identifier: str):
    """Send or resend the beautiful HTML Case Registration & Tracking Details email to the employee/client."""
    from backend.services.cases.case_engine import send_case_created_email_to_employee

    payload = request.get_json(silent=True) or {}
    user, role = _get_actor_and_role(payload)
    recip = payload.get("recipient_email") or payload.get("to") or payload.get("email")
    note = payload.get("note") or payload.get("custom_note")

    try:
        dispatch_res = send_case_created_email_to_employee(
            case_identifier=identifier,
            recipient_override=recip,
            custom_note=note,
            performed_by=user,
            auto_triggered=False,
        )
        detail = get_full_case_detail(identifier, role=role)
        return success_response({
            "dispatch": dispatch_res,
            "case": detail["case"],
            "communications": detail["communications"],
            "activity": detail["timeline"],
            "detail": detail,
        })
    except ValueError as ve:
        return error_response("NOTIFY_EMPLOYEE_ERROR", str(ve), 400)


@case_bp.route("/<identifier>/feedback", methods=["GET"])
def get_case_feedback_route(identifier: str):
    """Retrieve recorded feedback/CSAT rating and comments for this case."""
    from backend.services.cases.feedback_service import get_case_feedback
    from backend.models.case import get_case_by_id_or_number

    case_obj = get_case_by_id_or_number(identifier)
    if not case_obj:
        return error_response("NOT_FOUND", f"Case '{identifier}' not found.", 404)

    fb = get_case_feedback(identifier)
    return success_response({
        "case": {
            "id": case_obj["id"],
            "case_number": case_obj["case_number"],
            "title": case_obj.get("title"),
            "category": case_obj.get("category"),
            "status": case_obj.get("status"),
            "employee_name": case_obj.get("employee_name"),
            "employee_id": case_obj.get("employee_id"),
            "assigned_user": case_obj.get("assigned_user"),
            "resolved_by": case_obj.get("resolved_by"),
            "resolved_at": case_obj.get("resolved_at"),
        },
        "feedback": fb,
    })


@case_bp.route("/<identifier>/feedback", methods=["POST"])
def submit_case_feedback_route(identifier: str):
    """Submit an employee CSAT rating (1-5), feedback tags, and comments."""
    from backend.services.cases.feedback_service import submit_case_feedback

    payload = request.get_json(silent=True) or {}
    rating = payload.get("rating")
    if rating is None:
        return error_response("VALIDATION_ERROR", "Rating is required (1 to 5).", 400)
    try:
        rating_int = int(rating)
    except (ValueError, TypeError):
        return error_response("VALIDATION_ERROR", "Rating must be an integer between 1 and 5.", 400)

    tags = payload.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    comments = payload.get("comments") or ""
    submitted_by = payload.get("submitted_by") or payload.get("employee_name") or payload.get("name")

    try:
        fb = submit_case_feedback(
            case_ref=identifier,
            rating=rating_int,
            tags=tags,
            comments=comments,
            submitted_by=submitted_by,
        )
        return success_response({
            "message": "Thank you! Your feedback has been recorded.",
            "feedback": fb,
        })
    except ValueError as ve:
        return error_response("FEEDBACK_ERROR", str(ve), 400)
    except Exception as exc:
        return error_response("SERVER_ERROR", str(exc), 500)


@case_bp.route("/feedback/summary", methods=["GET"])
def get_feedback_summary_route():
    """Retrieve aggregate CSAT and rating metrics across all cases."""
    from backend.services.cases.feedback_service import get_feedback_summary
    return success_response(get_feedback_summary())


