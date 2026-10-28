"""
HR FLOW — Phase 6.8 Validation Engine (backend/services/classification/validation_engine.py)
Validates extracted fields, employee identity, conflicting identity, and required documents.
Determines operational validation status:
  - READY
  - ON_HOLD
  - REVIEW_REQUIRED
"""

from typing import Dict, Any, List
from backend.classification.category_config import get_category_config


def validate_email_extraction(
    category: str,
    employee_match: Dict[str, Any],
    category_result: Dict[str, Any],
    extracted_data: Dict[str, Any],
) -> Dict[str, Any]:
    norm_cat = (category or "UNKNOWN").strip().upper()
    cfg = get_category_config(norm_cat)
    req_fields: List[str] = cfg.get("required_fields", [])
    opt_fields: List[str] = cfg.get("optional_fields", [])
    fields_map: Dict[str, Any] = extracted_data.get("fields") or {}

    emp_status = employee_match.get("status", "NOT_FOUND")
    emp_conflict = emp_status == "REVIEW_REQUIRED"
    emp_matched = emp_status == "MATCHED"

    missing_required: List[str] = []
    field_checks: List[Dict[str, Any]] = []

    for req_f in req_fields:
        val = fields_map.get(req_f)
        present = bool(val is not None and str(val).strip() != "")
        if not present:
            missing_required.append(req_f)
        field_checks.append({
            "field": req_f,
            "required": True,
            "value": val,
            "valid": present,
            "badge": "✓" if present else "✗",
        })

    for opt_f in opt_fields:
        val = fields_map.get(opt_f)
        present = bool(val is not None and str(val).strip() != "")
        field_checks.append({
            "field": opt_f,
            "required": False,
            "value": val,
            "valid": True,
            "badge": "✓" if present else "Optional",
        })

    verified_req_count = len(req_fields) - len(missing_required)
    total_req_count = len(req_fields)
    emp_obj = employee_match.get("employee") or {}
    emp_label = (
        f"{emp_obj.get('id')} ({emp_obj.get('name')})"
        if emp_obj.get("id") and emp_obj.get("name")
        else (emp_obj.get("id") or "Employee")
    )

    # Build concise preview of actual extracted values
    extracted_preview_items = [
        f"{k}: {v}"
        for k, v in fields_map.items()
        if v is not None and str(v).strip() != "" and k != "employee_id"
    ][:3]
    preview_str = " · ".join(extracted_preview_items)

    if emp_conflict:
        status = "REVIEW_REQUIRED"
        summary = f"Blocked: {employee_match.get('reason', 'Employee identity conflict requires HR review')}"
    elif norm_cat == "UNKNOWN" or category_result.get("requires_review"):
        status = "REVIEW_REQUIRED"
        summary = category_result.get("reason") or "Uncertain HR category classification — requires HR review"
    elif not emp_matched:
        status = "REVIEW_REQUIRED"
        summary = f"Employee unverified in directory ({verified_req_count}/{total_req_count} {norm_cat} fields extracted)"
    elif missing_required:
        status = "ON_HOLD"
        summary = f"{verified_req_count}/{total_req_count} required {norm_cat} fields verified — Missing: {', '.join(missing_required)}"
    else:
        status = "READY"
        summary = (
            f"Verified {emp_label} · {verified_req_count}/{total_req_count} required {norm_cat} fields extracted"
            + (f" ({preview_str})" if preview_str else "")
        )

    return {
        "status": status,
        "is_valid": status == "READY",
        "missing_fields": missing_required,
        "verified_required_count": verified_req_count,
        "total_required_count": total_req_count,
        "field_checks": field_checks,
        "checks": {
            "employee_verified": emp_matched,
            "no_identity_conflict": not emp_conflict,
            "category_confident": bool(norm_cat != "UNKNOWN" and not category_result.get("requires_review")),
            "required_fields_present": len(missing_required) == 0,
        },
        "summary": summary,
    }
