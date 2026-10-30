"""
HR FLOW — Phase 6.7 Dynamic Field Extraction (backend/services/classification/field_extractor.py)
Extracts category-specific required and optional fields driven by `backend/data/categories.json`.
"""

import re
from typing import Dict, Any, List, Optional
from backend.classification.category_config import get_category_config

_DATE_PATTERNS = [
    r"\b(\d{1,2}[\s/\-](?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:[\s,/\-]+\d{2,4})?)\b",
    r"\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s*\d{4})?)\b",
    r"\b(\d{4}-\d{2}-\d{2})\b",
    r"\b(\d{1,2}/\d{1,2}/\d{2,4})\b",
    r"\b(yesterday|today)\b",
]

_TIME_PATTERN = re.compile(r"\b(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)\b")


def _extract_labeled_value(text: str, labels: List[str]) -> Optional[str]:
    for lbl in labels:
        pat = re.compile(
            rf"(?:^|\n)[ \t]*\*?(?:{lbl})\*?[ \t]*[:\-=][ \t]*\*?[ \t]*([^\r\n]+)",
            re.IGNORECASE,
        )
        m = pat.search(text)
        if m:
            val = m.group(1).strip(" \t\r\n*,-")
            if val:
                return val
    return None


def _extract_natural_reason(text: str) -> Optional[str]:
    """Extract natural-language reason clauses like 'due to personal reasons' or 'because of ...' from body text."""
    patterns = [
        r"\b(?:due\s+to|because\s+of|on\s+account\s+of|owing\s+to|as\s+i\s+(?:have|am|was))\s+([^\r\n.;]+)",
        r"\b(?:for|regarding)\s+(a\s+[a-z\s]{3,35}|personal\s+[a-z\s]{3,25}|medical\s+[a-z\s]{3,25}|family\s+[a-z\s]{3,25})\b",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            cleaned = re.sub(r"\s+", " ", m.group(1)).strip(" \t\r\n.,;-*")
            if len(cleaned) >= 3:
                return cleaned
    return None


def _extract_all_dates(text: str) -> List[str]:
    found: List[str] = []
    for pat in _DATE_PATTERNS:
        for m in re.finditer(pat, text, re.IGNORECASE):
            val = m.group(1).strip()
            if val and val not in found:
                found.append(val)
    return found


def extract_fields_for_category(
    category: str,
    email_payload: Dict[str, Any],
    employee_match: Dict[str, Any],
    intent_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Dynamically extract required and optional fields configured for `category` in `categories.json`.
    """
    cfg = get_category_config(category)
    req_fields = cfg.get("required_fields", [])
    opt_fields = cfg.get("optional_fields", [])
    all_fields = req_fields + [f for f in opt_fields if f not in req_fields]

    subject = email_payload.get("subject") or ""
    body = email_payload.get("body") or ""
    combined = f"{subject}\n{body}"
    attachments = email_payload.get("attachments") or []

    extracted_emp = employee_match.get("extracted") or {}
    matched_emp = employee_match.get("employee") or {}
    emp_id = matched_emp.get("id") or extracted_emp.get("employee_id")

    dates_found = _extract_all_dates(combined)
    times_found = [m.group(1) for m in _TIME_PATTERN.finditer(combined)]
    att_names = [a.get("filename") or a.get("name") for a in attachments if isinstance(a, dict)]

    raw_values: Dict[str, Any] = {}

    for field in all_fields:
        if field == "employee_id":
            raw_values[field] = emp_id
        elif field == "date":
            raw_values[field] = (
                _extract_labeled_value(combined, ["date", "attendance date", "for date"])
                or (dates_found[0] if dates_found else None)
            )
        elif field == "issue_type":
            raw_values[field] = (
                _extract_labeled_value(combined, ["issue type", "issue", "problem"])
                or (intent_result.get("name") if intent_result and intent_result.get("name") else None)
                or ("Attendance Correction" if "attendance" in combined.lower() else None)
            )
        elif field == "check_in":
            raw_values[field] = (
                _extract_labeled_value(combined, ["check-in time", "check in time", "check-in", "check in", "in time", "punch in"])
                or (times_found[0] if len(times_found) >= 1 else None)
            )
        elif field == "check_out":
            raw_values[field] = (
                _extract_labeled_value(combined, ["check-out time", "check out time", "check-out", "check out", "out time", "punch out"])
                or (times_found[1] if len(times_found) >= 2 else None)
            )
        elif field == "shift":
            raw_values[field] = _extract_labeled_value(combined, ["shift", "shift timing"]) or "General Shift"
        elif field == "leave_type":
            raw_values[field] = (
                _extract_labeled_value(combined, ["leave type", "type of leave"])
                or (intent_result.get("name") if intent_result and intent_result.get("name") else None)
                or ("Paid / Casual Leave" if "leave" in combined.lower() else None)
            )
        elif field == "start_date":
            raw_values[field] = (
                _extract_labeled_value(combined, ["start date", "from date", "leave from", "from"])
                or (dates_found[0] if len(dates_found) >= 1 else None)
            )
        elif field == "end_date":
            raw_values[field] = (
                _extract_labeled_value(combined, ["end date", "to date", "leave to", "till"])
                or (dates_found[1] if len(dates_found) >= 2 else (dates_found[0] if len(dates_found) == 1 else None))
            )
        elif field == "duration":
            m_dur = re.search(r"\b(\d+\s*(?:day|days|week|weeks))\b", combined, re.IGNORECASE)
            raw_values[field] = _extract_labeled_value(combined, ["duration", "number of days", "days"]) or (m_dur.group(1) if m_dur else None)
        elif field == "resignation_date":
            raw_values[field] = (
                _extract_labeled_value(combined, ["resignation date", "effective date", "date of resignation"])
                or (dates_found[0] if dates_found else "Today")
            )
        elif field == "last_working_day":
            raw_values[field] = (
                _extract_labeled_value(combined, ["last working day", "lwd", "proposed lwd", "relieving date"])
                or (dates_found[1] if len(dates_found) >= 2 else None)
            )
        elif field == "notice_period":
            m_np = re.search(r"\b(\d+\s*(?:days|months|weeks))\s*notice\b", combined, re.IGNORECASE)
            raw_values[field] = _extract_labeled_value(combined, ["notice period", "notice"]) or (m_np.group(1) if m_np else None)
        elif field in ("attachment", "documents"):
            raw_values[field] = ", ".join(att_names) if att_names else None
        elif field == "verification_type":
            raw_values[field] = _extract_labeled_value(combined, ["verification type", "bgv type", "check type"]) or "Standard Employment & Education BGV"
        elif field == "candidate_name":
            raw_values[field] = matched_emp.get("name") or extracted_emp.get("candidate_name")
        elif field == "query_type":
            raw_values[field] = _extract_labeled_value(combined, ["query type", "subject"]) or (subject if subject else "Payroll Inquiry")
        elif field == "pay_period":
            raw_values[field] = _extract_labeled_value(combined, ["pay period", "month"]) or (dates_found[0] if dates_found else None)
        elif field == "asset_type":
            m_asset = re.search(r"\b(laptop|macbook|charger|monitor|headset|id card|access card|vpn)\b", combined, re.IGNORECASE)
            raw_values[field] = _extract_labeled_value(combined, ["asset type", "device"]) or (m_asset.group(1).title() if m_asset else None)
        elif field == "asset_id":
            raw_values[field] = _extract_labeled_value(combined, ["asset id", "serial number", "asset tag"])
        elif field in ("reason", "description", "issue_description"):
            labeled_reason = _extract_labeled_value(combined, ["reason for leave", "leave reason", "reason", "issue description", "description"])
            nat_reason = _extract_natural_reason(body)
            raw_values[field] = labeled_reason or nat_reason or (subject.strip() if len(body.strip()) > 10 else None)
        elif field == "joining_date":
            raw_values[field] = _extract_labeled_value(combined, ["joining date", "date of joining", "doj"]) or (dates_found[0] if dates_found else None)
        elif field == "document_type":
            raw_values[field] = _extract_labeled_value(combined, ["document type", "certificate type"]) or subject.strip()
        else:
            raw_values[field] = _extract_labeled_value(combined, [field.replace("_", " ")])

    return {
        "category": (category or "UNKNOWN").upper(),
        "required_fields": req_fields,
        "optional_fields": opt_fields,
        "fields": raw_values,
    }
