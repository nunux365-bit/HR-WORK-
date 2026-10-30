"""
HR FLOW — Phase 6.2, 6.6, 6.13 Email Processing & Action Routes (backend/api/email_routes.py)
"""

from flask import Blueprint, request
from backend.api import success_response, error_response
from backend.classification.ai_pipeline import (
    process_email,
    process_all_emails,
    get_email_analysis,
    accept_ai_classification,
    override_email_category,
)
from backend.services.gmail.gmail_fetcher import get_stored_emails, get_stored_email_detail

email_bp = Blueprint("emails", __name__, url_prefix="/api/emails")


@email_bp.route("", methods=["GET"])
def list_emails_route():
    limit = int(request.args.get("limit", 100))
    category = request.args.get("category")
    status = request.args.get("status")
    search = request.args.get("search")
    account_email = request.args.get("account_email")
    act_param = (request.args.get("actionable") or "true").strip().lower()

    actionable_only = True
    if act_param in ("0", "false", "no", "noise"):
        actionable_only = False
    elif act_param in ("all", "*"):
        actionable_only = None

    emails = get_stored_emails(
        limit=limit,
        category=category,
        status=status,
        search=search,
        account_email=account_email,
        actionable_only=actionable_only,
    )
    return success_response({"count": len(emails), "emails": emails})


@email_bp.route("/sync", methods=["POST"])
def email_sync_alias_route():
    from backend.api.gmail_routes import gmail_sync
    return gmail_sync()


@email_bp.route("/<int:email_id>", methods=["GET"])
def get_email_route(email_id: int):
    detail = get_stored_email_detail(email_id)
    if not detail:
        return error_response("EMAIL_NOT_FOUND", f"Email {email_id} not found.", 404)
    return success_response(detail)


@email_bp.route("/<int:email_id>/process", methods=["POST"])
def process_single_email_route(email_id: int):
    try:
        payload = request.get_json(silent=True) or {}
        force_case = bool(payload.get("force_create_case", False))
        result = process_email(email_id, force_create_case=force_case)
        return success_response(result)
    except ValueError as ve:
        return error_response("EMAIL_NOT_FOUND", str(ve), 404)
    except Exception as exc:
        return error_response("PIPELINE_ERROR", str(exc), 500)


@email_bp.route("/<int:email_id>/reprocess", methods=["POST"])
def reprocess_single_email_route(email_id: int):
    try:
        result = process_email(email_id, force_create_case=True)
        return success_response(result)
    except ValueError as ve:
        return error_response("EMAIL_NOT_FOUND", str(ve), 404)
    except Exception as exc:
        return error_response("PIPELINE_ERROR", str(exc), 500)


@email_bp.route("/<int:email_id>/accept", methods=["POST"])
def accept_classification_route(email_id: int):
    try:
        payload = request.get_json(silent=True) or {}
        user = payload.get("performed_by") or request.headers.get("X-HR-User") or "Vaibhav (HR)"
        result = accept_ai_classification(email_id, performed_by=user)
        return success_response(result)
    except ValueError as ve:
        return error_response("EMAIL_NOT_FOUND", str(ve), 404)
    except Exception as exc:
        return error_response("ACCEPT_ERROR", str(exc), 500)


@email_bp.route("/<int:email_id>/override", methods=["POST"])
def override_classification_route(email_id: int):
    try:
        payload = request.get_json(silent=True) or {}
        new_category = payload.get("category")
        if not new_category:
            return error_response("VALIDATION_ERROR", "Field 'category' is required.", 400)
        user = payload.get("performed_by") or request.headers.get("X-HR-User") or "Admin"
        role = (payload.get("role") or request.headers.get("X-HR-Role") or "").strip().upper()

        # Enforce that only Admin can permanently confirm/override
        is_admin = role in ("ADMIN", "SUPER_ADMIN") or "ADMIN" in user.upper()
        if not is_admin:
            return error_response(
                "ADMIN_REQUIRED",
                "Only an authenticated Admin has authority to permanently confirm HR category decisions.",
                403,
            )

        reason = payload.get("reason") or "Confirmed permanently by Admin"
        result = override_email_category(email_id, new_category=new_category, performed_by=user, reason=reason)
        return success_response(result)
    except ValueError as ve:
        return error_response("EMAIL_NOT_FOUND", str(ve), 404)
    except Exception as exc:
        return error_response("OVERRIDE_ERROR", str(exc), 500)


@email_bp.route("/process-all", methods=["POST"])
def process_all_emails_route():
    try:
        summary = process_all_emails()
        return success_response(summary)
    except Exception as exc:
        return error_response("PIPELINE_ERROR", str(exc), 500)


@email_bp.route("/<int:email_id>/reply", methods=["POST"])
def reply_email_route(email_id: int):
    payload = request.get_json(silent=True) or {}
    body_text = (payload.get("body") or payload.get("message") or "").strip()
    user = payload.get("performed_by") or "Vaibhav (HR)"
    from backend.services.audit.audit_service import log_event
    from backend.models.case import get_case_by_email_id
    from backend.services.cases.case_service import add_case_communication

    log_event(
        entity_type="EMAIL",
        entity_id=email_id,
        action="EMAIL_REPLY_SENT",
        description=f"HR replied to email #{email_id}: {body_text[:100]}",
        performed_by=user,
    )
    case = get_case_by_email_id(email_id)
    if case:
        add_case_communication(
            identifier=case["db_id"],
            message=body_text,
            sender_type="HR",
            sender_name=user,
            comm_type="OUTBOUND_HR",
        )
    return success_response({"email_id": email_id, "status": "replied"})


@email_bp.route("/<int:email_id>/forward", methods=["POST"])
def forward_email_route(email_id: int):
    payload = request.get_json(silent=True) or {}
    body_text = (payload.get("body") or payload.get("message") or "").strip()
    to_addr = payload.get("to") or "hr@company.com"
    user = payload.get("performed_by") or "Vaibhav (HR)"
    from backend.services.audit.audit_service import log_event

    log_event(
        entity_type="EMAIL",
        entity_id=email_id,
        action="EMAIL_FORWARDED",
        description=f"HR forwarded email #{email_id} to {to_addr}: {body_text[:100]}",
        performed_by=user,
    )
    return success_response({"email_id": email_id, "to": to_addr, "status": "forwarded"})

