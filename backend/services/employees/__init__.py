"""
HR FLOW — Phase 5 Employee Service Package (backend/services/employees/__init__.py)
"""

from backend.services.employees.employee_extractor import (
    extract_employee_identity,
    extract_employee_id,
)
from backend.services.employees.employee_matcher import (
    match_employee_identity,
    compute_name_similarity,
)
from backend.services.employees.employee_service import (
    create_employee_record,
    update_employee_record,
    get_employee,
    search_employees,
    identify_employee_from_email,
    process_email_employee_identification,
    process_all_unmatched_emails,
)

__all__ = [
    "extract_employee_identity",
    "extract_employee_id",
    "match_employee_identity",
    "compute_name_similarity",
    "create_employee_record",
    "update_employee_record",
    "get_employee",
    "search_employees",
    "identify_employee_from_email",
    "process_email_employee_identification",
    "process_all_unmatched_emails",
]
