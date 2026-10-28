"""
HR FLOW — Phase 5.7 Employee API Routes (backend/api/employee_routes.py)
Endpoints:
  - GET   /api/employees
  - POST  /api/employees
  - GET   /api/employees/<identifier>
  - PUT   /api/employees/<identifier>
  - PATCH /api/employees/<identifier>
  - POST  /api/employees/identify
  - POST  /api/employees/match-email/<int:email_id>
  - POST  /api/employees/match-all
"""

from flask import Blueprint, request

from backend.api import success_response, error_response
from backend.services.employees.employee_service import (
    create_employee_record,
    update_employee_record,
    get_employee,
    search_employees,
    identify_employee_from_email,
    process_email_employee_identification,
    process_all_unmatched_emails,
)

employee_bp = Blueprint(
    "employees",
    __name__,
    url_prefix="/api/employees",
)


@employee_bp.get("")
@employee_bp.get("/")
def api_list_or_search_employees():
    """List employees or search by query, email, employee_id, or name."""
    query = request.args.get("q") or request.args.get("search")
    email = request.args.get("email")
    employee_id = request.args.get("employee_id") or request.args.get("id")
    name = request.args.get("name")
    limit = request.args.get("limit", default=100, type=int)
    offset = request.args.get("offset", default=0, type=int)

    try:
        items = search_employees(
            query=query,
            email=email,
            employee_id=employee_id,
            name=name,
            limit=limit,
            offset=offset,
        )
        return success_response({
            "count": len(items),
            "employees": items,
        })
    except Exception as exc:
        return error_response("EMPLOYEE_SEARCH_ERROR", str(exc), 500)


@employee_bp.post("")
@employee_bp.post("/")
def api_create_employee():
    """Create a new employee record in SQLite."""
    payload = request.get_json(silent=True) or {}
    if not (payload.get("name") or "").strip():
        return error_response(
            "VALIDATION_ERROR",
            "Employee 'name' is required.",
            400,
        )
    try:
        emp = create_employee_record(payload)
        return success_response({"employee": emp}, status_code=201)
    except Exception as exc:
        return error_response("EMPLOYEE_CREATE_ERROR", str(exc), 400)


@employee_bp.get("/<identifier>")
def api_get_employee(identifier: str):
    """Fetch a single employee by EMPxxxx code or database integer ID."""
    emp = get_employee(identifier)
    if not emp:
        return error_response(
            "EMPLOYEE_NOT_FOUND",
            f"Employee '{identifier}' not found.",
            404,
        )
    return success_response({"employee": emp})


@employee_bp.route("/<identifier>", methods=["PUT", "PATCH"])
def api_update_employee(identifier: str):
    """Update an existing employee record by EMPxxxx code or database integer ID."""
    payload = request.get_json(silent=True) or {}
    try:
        updated = update_employee_record(identifier, payload)
        if not updated:
            return error_response(
                "EMPLOYEE_NOT_FOUND",
                f"Employee '{identifier}' not found.",
                404,
            )
        return success_response({"employee": updated})
    except Exception as exc:
        return error_response("EMPLOYEE_UPDATE_ERROR", str(exc), 400)


@employee_bp.post("/identify")
def api_identify_employee_from_payload():
    """
    Extract employee identity and run matching/conflict/ambiguity engine
    on an email payload (`sender_name`, `sender_email`, `subject`, `body`).
    """
    payload = request.get_json(silent=True) or {}
    try:
        result = identify_employee_from_email(payload)
        return success_response(result)
    except Exception as exc:
        return error_response("EMPLOYEE_IDENTIFY_ERROR", str(exc), 500)


@employee_bp.post("/match-email/<int:email_id>")
def api_match_stored_email(email_id: int):
    """Run Employee Service identification on a stored email in SQLite and persist result."""
    try:
        result = process_email_employee_identification(email_id)
        return success_response({
            "email_id": email_id,
            "match_result": result,
        })
    except ValueError as exc:
        return error_response("EMAIL_NOT_FOUND", str(exc), 404)
    except Exception as exc:
        return error_response("EMPLOYEE_MATCH_EMAIL_ERROR", str(exc), 500)


@employee_bp.post("/match-all")
def api_match_all_stored_emails():
    """Run Employee Service identification across all stored emails in SQLite."""
    try:
        summary = process_all_unmatched_emails()
        return success_response(summary)
    except Exception as exc:
        return error_response("EMPLOYEE_MATCH_ALL_ERROR", str(exc), 500)
