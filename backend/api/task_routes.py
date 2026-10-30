"""
HR FLOW — Phase 7.9, 7.10, 7.11 Task & Approval API Routes (backend/api/task_routes.py)
Endpoints:
  - GET  /api/tasks
  - POST /api/tasks
  - GET  /api/tasks/<task_id>
  - POST /api/tasks/<task_id>/update
  - POST /api/tasks/<task_id>/complete
  - POST /api/tasks/<task_id>/cancel
  - GET  /api/approvals
  - POST /api/approvals
  - POST /api/approvals/<identifier>/approve
  - POST /api/approvals/<identifier>/reject
"""

from flask import Blueprint, request
from backend.api import success_response, error_response
from backend.models.task import get_task_by_id
from backend.services.tasks.task_service import (
    create_task,
    update_task,
    complete_task,
    cancel_task,
    list_tasks,
)
from backend.models.approval import get_approval_by_id_or_code
from backend.services.approvals.approval_service import (
    request_approval,
    decide_approval,
    list_approvals,
)
from backend.services.cases.case_service import require_permission

task_bp = Blueprint("tasks", __name__, url_prefix="/api/tasks")
approval_bp = Blueprint("approvals", __name__, url_prefix="/api/approvals")


def _actor_and_role(payload: dict):
    user = payload.get("performed_by") or request.headers.get("X-HR-User") or "Vaibhav (HR)"
    role = (payload.get("role") or request.headers.get("X-HR-Role") or "ADMIN").upper()
    return user, role


@task_bp.route("", methods=["GET"])
def list_tasks_route():
    user, role = _actor_and_role({})
    assigned_to = request.args.get("assigned_to") or request.args.get("hr")
    
    # Enforce RBAC for HR_AGENT while supporting name or email lookup
    if role == "HR_AGENT" and not assigned_to and not request.args.get("team") and not request.args.get("case_id"):
        assigned_to = user if (user and "@" not in user) else (request.headers.get("X-HR-Email") or user)
    
    tasks = list_tasks(
        case_id=request.args.get("case_id") or request.args.get("case"),
        status=request.args.get("status"),
        priority=request.args.get("priority"),
        team=request.args.get("team"),
        assigned_to=assigned_to,
        due_date=request.args.get("due_date") or request.args.get("due"),
        view=request.args.get("view"),
        current_user=request.args.get("current_user") or user,
        limit=int(request.args.get("limit", 200)),
    )
    return success_response({"count": len(tasks), "tasks": tasks})


@task_bp.route("/<task_id>", methods=["GET"])
def get_task_route(task_id: str):
    t = get_task_by_id(task_id)
    if not t:
        return error_response("TASK_NOT_FOUND", f"Task '{task_id}' not found.", 404)
@task_bp.route("/seed-for-cases", methods=["POST"])
def seed_tasks_for_cases_route():
    """
    Auto-populates standard HR operational tasks for active cases that do not have tasks yet.
    """
    user, role = _actor_and_role({})
    from backend.database.connection import get_connection
    conn = get_connection()
    try:
        cases = conn.execute(
            "SELECT id, case_number, category, priority, assigned_user, assigned_team FROM cases WHERE status NOT IN ('RESOLVED', 'CLOSED')"
        ).fetchall()
        created_count = 0
        for c in cases:
            db_id = c["id"]
            existing = conn.execute("SELECT COUNT(*) AS cnt FROM tasks WHERE case_id = ?", (db_id,)).fetchone()
            if existing and existing["cnt"] > 0:
                continue
            cat_up = str(c["category"] or "GENERAL_HR").upper()
            default_titles = {
                "LEAVE": [
                    ("Verify leave balance & medical documentation", "DOCUMENT_VERIFICATION"),
                    ("Validate supervisor leave approval & policy quota", "HR_REVIEW"),
                    ("Update HRMS attendance ledger", "EXECUTION"),
                ],
                "ATTENDANCE": [
                    ("Audit biometric & VPN access logs", "DOCUMENT_VERIFICATION"),
                    ("Verify shift regularization request with team lead", "HR_REVIEW"),
                    ("Reconcile timesheet before payroll cutoff", "EXECUTION"),
                ],
                "PAYROLL": [
                    ("Inspect salary register & tax ledger for pay cycle", "DOCUMENT_VERIFICATION"),
                    ("Verify investment proofs & bank disbursement details", "HR_REVIEW"),
                    ("Generate payroll reconciliation statement", "EXECUTION"),
                ],
                "RESIGNATION": [
                    ("Conduct exit interview & collect feedback", "HR_REVIEW"),
                    ("Initiate IT asset & ID card return clearance", "ASSET_HANDOVER"),
                    ("Process full & final settlement (FnF) calculation", "FINANCE_CHECK"),
                ],
                "BGV": [
                    ("Verify government ID & Aadhaar/PAN authenticity", "DOCUMENT_VERIFICATION"),
                    ("Check prior employment relieving certificates", "HR_REVIEW"),
                    ("Issue final background verification clearance badge", "EXECUTION"),
                ],
                "ONBOARDING": [
                    ("Collect signed offer letter & tax declaration Form 11", "DOCUMENT_VERIFICATION"),
                    ("Provision corporate email, Slack & HRMS account", "IT_PROVISIONING"),
                    ("Schedule Day 1 orientation & manager introduction", "HR_REVIEW"),
                ],
            }.get(cat_up, [
                ("Verify employee identity & request eligibility", "HR_REVIEW"),
                ("Review submitted details & supporting documents", "DOCUMENT_VERIFICATION"),
                ("Update HRMS records & send confirmation to employee", "EXECUTION"),
            ])

            for title, t_type in default_titles:
                conn.execute(
                    """
                    INSERT INTO tasks (case_id, title, task_type, status, priority, assigned_to, assigned_team, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """,
                    (
                        db_id,
                        title,
                        t_type,
                        c["priority"] or "MEDIUM",
                        c["assigned_user"] or user or "HR Specialist",
                        c["assigned_team"] or "HR Operations",
                        user or "system",
                    ),
                )
                created_count += 1
        conn.commit()
        return success_response({"seeded_count": created_count, "message": f"Successfully created {created_count} operational tasks across active cases."})
    finally:
        conn.close()


@task_bp.route("", methods=["POST"])
def create_task_route():
    payload = request.get_json(silent=True) or {}
    user, role = _actor_and_role(payload)
    case_id = payload.get("case_id") or payload.get("case_number") or payload.get("case")
    title = payload.get("title")
    if not case_id or not title:
        return error_response("VALIDATION_ERROR", "Both 'case_id' and 'title' are required.", 400)
    try:
        require_permission(role, "create_task")
        task = create_task(
            case_identifier=case_id,
            title=title,
            task_type=payload.get("task_type") or "HR_REVIEW",
            description=payload.get("description"),
            assigned_to=payload.get("assigned_to"),
            assigned_team=payload.get("assigned_team") or payload.get("team"),
            priority=payload.get("priority") or "MEDIUM",
            due_at=payload.get("due_at") or payload.get("due_date"),
            performed_by=user,
        )
        return success_response({"task": task}, status_code=201)
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("TASK_CREATE_ERROR", str(ve), 400)


@task_bp.route("/<task_id>/update", methods=["POST", "PATCH"])
def update_task_route(task_id: str):
    payload = request.get_json(silent=True) or {}
    user, _ = _actor_and_role(payload)
    try:
        updated = update_task(
            task_id=task_id,
            status=payload.get("status"),
            assigned_to=payload.get("assigned_to"),
            assigned_team=payload.get("assigned_team") or payload.get("team"),
            priority=payload.get("priority"),
            due_at=payload.get("due_at") or payload.get("due_date"),
            performed_by=user,
            note=payload.get("note"),
        )
        return success_response({"task": updated})
    except ValueError as ve:
        return error_response("TASK_UPDATE_ERROR", str(ve), 400)


@task_bp.route("/<task_id>/complete", methods=["POST"])
def complete_task_route(task_id: str):
    payload = request.get_json(silent=True) or {}
    user, role = _actor_and_role(payload)
    try:
        require_permission(role, "complete_task")
        updated = complete_task(task_id=task_id, performed_by=user, note=payload.get("note"))
        return success_response({"task": updated})
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("TASK_COMPLETE_ERROR", str(ve), 400)


@task_bp.route("/<task_id>/cancel", methods=["POST"])
def cancel_task_route(task_id: str):
    payload = request.get_json(silent=True) or {}
    user, _ = _actor_and_role(payload)
    try:
        updated = cancel_task(task_id=task_id, performed_by=user, reason=payload.get("reason") or payload.get("note"))
        return success_response({"task": updated})
    except ValueError as ve:
        return error_response("TASK_CANCEL_ERROR", str(ve), 400)


# ============================================================
# Phase 7.11 — Approvals API Endpoints
# ============================================================
@approval_bp.route("", methods=["GET"])
def list_approvals_route():
    approvals = list_approvals(
        case_id=request.args.get("case_id") or request.args.get("case"),
        status=request.args.get("status"),
        approver=request.args.get("approver"),
        limit=int(request.args.get("limit", 200)),
    )
    return success_response({"count": len(approvals), "approvals": approvals})


@approval_bp.route("/<identifier>", methods=["GET"])
def get_approval_route(identifier: str):
    apr = get_approval_by_id_or_code(identifier)
    if not apr:
        return error_response("APPROVAL_NOT_FOUND", f"Approval '{identifier}' not found.", 404)
    return success_response(apr)


@approval_bp.route("", methods=["POST"])
def create_approval_route():
    payload = request.get_json(silent=True) or {}
    user, role = _actor_and_role(payload)
    case_id = payload.get("case_id") or payload.get("case_number") or payload.get("case")
    if not case_id:
        return error_response("VALIDATION_ERROR", "Field 'case_id' is required.", 400)
    try:
        require_permission(role, "request_approval")
        approval = request_approval(
            case_identifier=case_id,
            approver=payload.get("approver"),
            approver_role=payload.get("approver_role") or "HR_MANAGER",
            approval_type=payload.get("approval_type") or "MANAGER_APPROVAL",
            task_id=payload.get("task_id"),
            comments=payload.get("comments"),
            workflow_trigger_approve=payload.get("workflow_trigger_approve"),
            performed_by=user,
        )
        return success_response({"approval": approval}, status_code=201)
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("APPROVAL_REQUEST_ERROR", str(ve), 400)


@approval_bp.route("/<identifier>/approve", methods=["POST"])
def approve_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _actor_and_role(payload)
    try:
        require_permission(role, "approve_request")
        res = decide_approval(
            identifier=identifier,
            decision="APPROVED",
            comments=payload.get("comments"),
            performed_by=user,
        )
        return success_response(res)
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("APPROVAL_DECISION_ERROR", str(ve), 400)


@approval_bp.route("/<identifier>/reject", methods=["POST"])
def reject_route(identifier: str):
    payload = request.get_json(silent=True) or {}
    user, role = _actor_and_role(payload)
    try:
        require_permission(role, "reject_request")
        res = decide_approval(
            identifier=identifier,
            decision="REJECTED",
            comments=payload.get("comments") or payload.get("reason") or "Rejected by approver",
            performed_by=user,
        )
        return success_response(res)
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("APPROVAL_DECISION_ERROR", str(ve), 400)
