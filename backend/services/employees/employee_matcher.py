"""
HR FLOW — Phase 5.3 & 5.4 Employee Matcher, Conflict & Ambiguity Engine
(backend/services/employees/employee_matcher.py)

Supports:
  1. Exact Employee ID matching (e.g., EMP1023)
  2. Exact Email matching (explicit employee email or sender email)
  3. Exact Full Name matching ("Rahul Sharma")
  4. Initial + Last Name matching ("R. Sharma", "R Sharma")
  5. First Name matching ("Rahul")
  6. Typo-tolerant Fuzzy Name matching ("Rahull Sharma", "Rahul Shrma")
  7. Conflict Detection (e.g., EMP1024 -> Priya Singh in DB, but email says Vaibhav)
  8. Ambiguity Detection (e.g., two employees named "Rahul Sharma" or "Rahul")
"""

from difflib import SequenceMatcher
import re
from typing import Dict, Any, List, Optional, Tuple

from backend.models.employee import (
    get_employee_by_employee_id,
    get_employees_by_email,
    get_all_employees,
)


def _normalize_name(name: Optional[str]) -> str:
    if not name:
        return ""
    cleaned = re.sub(r"[^a-zA-Z\s.]", " ", name).lower()
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _name_tokens(name: Optional[str]) -> List[str]:
    norm = _normalize_name(name).replace(".", " ")
    return [t for t in norm.split() if t]


def compute_name_similarity(query_name: str, target_name: str) -> Tuple[float, str]:
    """
    Compare a query name (e.g., 'Rahul Sharma', 'Rahul', 'R. Sharma', 'Rahull Sharma')
    against an employee record's full name.
    Returns (similarity_score, match_subtype).
    match_subtype is one of: 'EXACT_NAME', 'INITIAL_NAME', 'FIRST_NAME', 'FUZZY_NAME', 'NONE'.
    """
    q_tokens = _name_tokens(query_name)
    t_tokens = _name_tokens(target_name)
    if not q_tokens or not t_tokens:
        return 0.0, "NONE"

    q_joined = " ".join(q_tokens)
    t_joined = " ".join(t_tokens)

    # 1. Exact full name match
    if q_joined == t_joined:
        return 0.92, "EXACT_NAME"

    # 2. Single-token query (e.g., "Rahul") matching first name
    if len(q_tokens) == 1:
        q_tok = q_tokens[0]
        if len(q_tok) >= 2 and q_tok == t_tokens[0]:
            return 0.82, "FIRST_NAME"
        # Typo in single first name (e.g. "Rahull" vs "Rahul")
        if len(q_tok) >= 4:
            first_ratio = SequenceMatcher(None, q_tok, t_tokens[0]).ratio()
            if first_ratio >= 0.84:
                return round(0.76 * first_ratio, 2), "FUZZY_NAME"
        return 0.0, "NONE"

    # 3. Initial + Last Name match (e.g., "R. Sharma" or "R Sharma" -> "Rahul Sharma")
    if len(q_tokens) >= 2 and len(t_tokens) >= 2:
        q_first, q_last = q_tokens[0], q_tokens[-1]
        t_first, t_last = t_tokens[0], t_tokens[-1]

        if len(q_first) == 1 and q_first == t_first[0]:
            if q_last == t_last:
                return 0.86, "INITIAL_NAME"
            last_ratio = SequenceMatcher(None, q_last, t_last).ratio()
            if last_ratio >= 0.85:
                return 0.80, "FUZZY_NAME"

        # First + Last token exact match (ignoring middle names)
        if q_first == t_first and q_last == t_last:
            return 0.90, "EXACT_NAME"

    # 4. Typo tolerance / Fuzzy full name match (e.g., "Rahull Sharma" or "Rahul Shrma")
    full_ratio = SequenceMatcher(None, q_joined, t_joined).ratio()
    if full_ratio >= 0.82:
        # Scale confidence between 0.78 and 0.88
        conf = round(min(0.88, max(0.78, full_ratio * 0.95)), 2)
        return conf, "FUZZY_NAME"

    return 0.0, "NONE"


def _names_conflict(extracted_name: Optional[str], db_name: Optional[str]) -> bool:
    """
    Determine whether an extracted name explicitly conflicts with a database employee name.
    Returns True if both names are present and clearly refer to different people.
    """
    if not extracted_name or not db_name:
        return False

    score, subtype = compute_name_similarity(extracted_name, db_name)
    if subtype != "NONE" and score >= 0.70:
        return False

    # Also check if all query tokens appear inside target tokens
    q_tokens = set(_name_tokens(extracted_name))
    t_tokens = set(_name_tokens(db_name))
    if q_tokens and q_tokens.issubset(t_tokens):
        return False

    # Check raw sequence ratio
    raw_ratio = SequenceMatcher(
        None,
        " ".join(_name_tokens(extracted_name)),
        " ".join(_name_tokens(db_name)),
    ).ratio()
    return raw_ratio < 0.65


def _format_employee_payload(emp: Dict[str, Any]) -> Dict[str, Any]:
    """Return the standardized employee dictionary for matching results."""
    return {
        "db_id": emp.get("db_id"),
        "id": emp.get("employee_id") or emp.get("id"),
        "employee_id": emp.get("employee_id") or emp.get("id"),
        "name": emp.get("name"),
        "email": emp.get("email"),
        "department": emp.get("department"),
        "designation": emp.get("designation"),
        "manager_name": emp.get("manager_name"),
        "location": emp.get("location"),
    }


def match_employee_identity(extracted: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute the 7-stage Employee Identification, Conflict & Ambiguity pipeline:
      1. Employee ID lookup + conflict verification against name/email
      2. Explicit Employee Email / Sender Email lookup + conflict verification
      3. Employee Name / Initial / Fuzzy matching + ambiguity detection
      4. Standardized result output (MATCHED, REVIEW_REQUIRED, NOT_FOUND)
    """
    extracted_emp_id = (extracted.get("employee_id") or "").strip().upper() or None
    explicit_email = (extracted.get("explicit_email") or "").strip().lower() or None
    sender_email = (extracted.get("sender_email") or "").strip().lower() or None
    explicit_name = (extracted.get("explicit_name") or "").strip() or None
    candidate_name = (extracted.get("candidate_name") or "").strip() or None

    # ------------------------------------------------------------------
    # STAGE 1: Employee ID Lookup & Conflict Checks
    # ------------------------------------------------------------------
    emp_by_id = get_employee_by_employee_id(extracted_emp_id) if extracted_emp_id else None

    if extracted_emp_id and emp_by_id:
        # Check 1A: Does explicit_name or candidate_name conflict with emp_by_id["name"]?
        name_to_verify = explicit_name or candidate_name
        if name_to_verify and _names_conflict(name_to_verify, emp_by_id["name"]):
            return {
                "status": "REVIEW_REQUIRED",
                "employee": None,
                "confidence": 0.45,
                "match_method": "EMPLOYEE_ID",
                "reason": "Employee ID and employee name conflict",
                "extracted": extracted,
                "candidates": [_format_employee_payload(emp_by_id)],
            }

        # Check 1B: Does explicit_email match a different employee record?
        if explicit_email and emp_by_id.get("email"):
            if explicit_email.lower() != emp_by_id["email"].lower():
                other_by_email = get_employees_by_email(explicit_email)
                if other_by_email and other_by_email[0]["id"] != emp_by_id["id"]:
                    return {
                        "status": "REVIEW_REQUIRED",
                        "employee": None,
                        "confidence": 0.45,
                        "match_method": "EMPLOYEE_ID",
                        "reason": "Employee ID and employee email conflict",
                        "extracted": extracted,
                        "candidates": [
                            _format_employee_payload(emp_by_id),
                            _format_employee_payload(other_by_email[0]),
                        ],
                    }

        # Valid Employee ID match with no conflict
        return {
            "status": "MATCHED",
            "employee": _format_employee_payload(emp_by_id),
            "confidence": 0.99,
            "match_method": "EMPLOYEE_ID",
            "extracted": extracted,
        }

    # ------------------------------------------------------------------
    # STAGE 2: Email Lookup (Explicit Email -> Sender Email) & Conflict Checks
    # ------------------------------------------------------------------
    for email_candidate in [explicit_email, sender_email]:
        if not email_candidate:
            continue
        email_matches = get_employees_by_email(email_candidate)
        if not email_matches:
            continue

        if len(email_matches) > 1:
            return {
                "status": "REVIEW_REQUIRED",
                "employee": None,
                "confidence": 0.65,
                "match_method": "EMAIL",
                "reason": "Multiple employees matched the email address",
                "extracted": extracted,
                "candidates": [_format_employee_payload(m) for m in email_matches],
            }

        emp_by_email = email_matches[0]

        # Conflict check 2A: Email matched an employee, but email text had a DIFFERENT Employee ID
        if extracted_emp_id and extracted_emp_id != (emp_by_email.get("employee_id") or "").upper():
            return {
                "status": "REVIEW_REQUIRED",
                "employee": None,
                "confidence": 0.48,
                "match_method": "EMAIL",
                "reason": "Employee ID and employee email conflict",
                "extracted": extracted,
                "candidates": [_format_employee_payload(emp_by_email)],
            }

        # Conflict check 2B: Email matched an employee, but an explicit_name in body conflicts
        if explicit_name and _names_conflict(explicit_name, emp_by_email["name"]):
            return {
                "status": "REVIEW_REQUIRED",
                "employee": None,
                "confidence": 0.48,
                "match_method": "EMAIL",
                "reason": "Employee email and employee name conflict",
                "extracted": extracted,
                "candidates": [_format_employee_payload(emp_by_email)],
            }

        return {
            "status": "MATCHED",
            "employee": _format_employee_payload(emp_by_email),
            "confidence": 0.96,
            "match_method": "EMAIL",
            "extracted": extracted,
        }

    # ------------------------------------------------------------------
    # STAGE 3: Name, Initial & Typo-Tolerant Fuzzy Matching
    # ------------------------------------------------------------------
    if candidate_name:
        all_employees = get_all_employees()
        scored_candidates: List[Tuple[float, str, Dict[str, Any]]] = []

        for emp in all_employees:
            score, subtype = compute_name_similarity(candidate_name, emp.get("name", ""))
            if subtype != "NONE" and score >= 0.75:
                scored_candidates.append((score, subtype, emp))

        scored_candidates.sort(key=lambda x: x[0], reverse=True)

        if scored_candidates:
            top_score, top_subtype, top_emp = scored_candidates[0]

            # Check if there are multiple candidates with the same or very close similarity
            close_matches = [
                item for item in scored_candidates
                if abs(item[0] - top_score) <= 0.04 or item[1] == top_subtype
            ]

            if len(close_matches) > 1:
                return {
                    "status": "REVIEW_REQUIRED",
                    "employee": None,
                    "confidence": 0.61,
                    "match_method": "NAME",
                    "reason": "Multiple employees matched the extracted name",
                    "extracted": extracted,
                    "candidates": [_format_employee_payload(item[2]) for item in close_matches],
                }

            # Single name match — check if an unknown employee_id was also given that conflicts
            if extracted_emp_id and extracted_emp_id != (top_emp.get("employee_id") or "").upper():
                return {
                    "status": "REVIEW_REQUIRED",
                    "employee": None,
                    "confidence": 0.50,
                    "match_method": "NAME",
                    "reason": "Employee ID and employee name conflict",
                    "extracted": extracted,
                    "candidates": [_format_employee_payload(top_emp)],
                }

            method_label = "FUZZY_NAME" if top_subtype == "FUZZY_NAME" else "NAME"
            return {
                "status": "MATCHED",
                "employee": _format_employee_payload(top_emp),
                "confidence": top_score,
                "match_method": method_label,
                "extracted": extracted,
            }

    # ------------------------------------------------------------------
    # STAGE 4: No Match Found
    # ------------------------------------------------------------------
    return {
        "status": "NOT_FOUND",
        "employee": None,
        "confidence": 0.0,
        "match_method": None,
        "extracted": extracted,
    }
