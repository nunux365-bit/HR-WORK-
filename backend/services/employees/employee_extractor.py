"""
HR FLOW — Phase 5.2 Employee Identity Extractor (backend/services/employees/employee_extractor.py)
Extracts structured and unstructured employee identity signals from an incoming HR email:
  - employee_id (e.g., EMP1023)
  - sender_email
  - sender_name
  - explicit_email (email mentioned in body/subject)
  - explicit_name (Employee Name: ... or sign-off name)
  - candidate_name (best name signal combining explicit_name and sender_name)
  - department
  - designation
  - manager_name
  - location
"""

import re
from typing import Dict, Any, Optional

# Universal Employee Code Pattern:
# Supports any company prefix (e.g., APRT, 1MG, EMP, INT, CON, FT, TATA, CORP, etc.)
_EXCLUDED_ID_PREFIXES = {
    # System & Workflow identifiers
    "CASE", "TICKET", "REF", "SLA", "STEP", "PAGE", "RULE", "TASK", "INC", "REQ",
    # Months / Calendar / Dates
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
    "YEAR", "DAYS", "DATE", "TIME",
    # Time zones & Common Units
    "AM", "PM", "UTC", "IST", "GMT", "MIN", "SEC", "HRS",
    # Common Prepositions & Short English words that could match prepositions + day of month
    "ON", "AT", "IN", "IS", "IT", "AS", "TO", "BY", "SO", "NO", "OR", "IF", "AN", "DO",
    "GO", "UP", "HE", "WE", "ME", "MY", "THE", "AND", "FOR", "NOT", "YES", "YOU", "ARE",
    "FROM", "WITH", "HAVE", "THIS", "THAT", "DEAR", "TEAM", "NAME", "DEPT", "MAIL", "POST", "SEND", "RECV",
    # Web & Protocols
    "HTTP", "HTTPS", "WWW", "HTML", "COM", "ORG", "NET", "INFO", "API", "SQL", "PHP", "CSS", "UID",
}

# Matches attached or hyphenated codes: APRT1023, APRT-1023, 1MG0023, EMP1023
_ATTACHED_OR_HYPHEN_PATTERN = re.compile(r"\b([A-Za-z0-9]{2,6})[\-_]?(\d{3,7})\b", re.IGNORECASE)

# Matches space-separated codes with 3-6 char prefix: APRT 1023, EMP 1023
_SPACE_SEPARATED_PATTERN = re.compile(r"\b([A-Za-z0-9]{3,6})\s+(\d{3,7})\b", re.IGNORECASE)

# Backward-compatibility alias
_EMP_CODE_PATTERN = _ATTACHED_OR_HYPHEN_PATTERN

# Explicit labeled fields in email body or subject (supports optional Markdown *bold* formatting from Gmail)
_LABELED_EMP_ID_PATTERN = re.compile(
    r"(?:\*?(?:employee\s*(?:id|code|no|number|#)|emp\s*(?:id|code|no|number|#)|staff\s*(?:id|code)|id)\*?\s*[:\-=]\s*\*?([A-Za-z0-9][A-Za-z0-9\-_]{2,15})\*?)"
    r"|(?:\b(?:my\s+(?:official\s+)?(?:employee\s*id|emp\s*id|id)\s+is)\s*[:\-=]?\s*\*?([A-Za-z0-9][A-Za-z0-9\-_]{2,15})\*?)",
    re.IGNORECASE,
)
_LABELED_NAME_PATTERN = re.compile(
    r"\*?(?:employee\s*name|full\s*name|staff\s*name|^name)\*?\s*[:\-=]\s*\*?\s*([A-Za-z][A-Za-z.\s]{1,50})",
    re.IGNORECASE | re.MULTILINE,
)
_LABELED_EMAIL_PATTERN = re.compile(
    r"\*?(?:employee\s*email|work\s*email|official\s*email|email\s*id|email)\*?\s*[:\-=]\s*\*?\s*([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})",
    re.IGNORECASE,
)
_LABELED_DEPT_PATTERN = re.compile(
    r"\*?(?:department|dept)\*?\s*[:\-=]\s*\*?\s*([A-Za-z0-9&\s\-/]{2,45})",
    re.IGNORECASE,
)
_LABELED_DESIGNATION_PATTERN = re.compile(
    r"\*?(?:designation|job\s*title|title|role|position)\*?\s*[:\-=]\s*\*?\s*([A-Za-z0-9&\s\-/()]{2,50})",
    re.IGNORECASE,
)
_LABELED_MANAGER_PATTERN = re.compile(
    r"\*?(?:reporting\s*manager|manager\s*name|manager|supervisor)\*?\s*[:\-=]\s*\*?\s*([A-Za-z][A-Za-z.\s]{2,45})",
    re.IGNORECASE,
)
_LABELED_LOCATION_PATTERN = re.compile(
    r"\*?(?:location|office\s*location|work\s*location|branch|city)\*?\s*[:\-=]\s*\*?\s*([A-Za-z][A-Za-z\s,\-]{2,40})",
    re.IGNORECASE,
)

# Sign-off pattern: "Thanks,\nRahul Sharma" or "Regards,\n*Vaibhav*"
_SIGNOFF_NAME_PATTERN = re.compile(
    r"(?:thanks(?:\s*&\s*regards)?|regards|best\s*regards|warm\s*regards|sincerely|cheers)\s*[,:\-\*]?\s*\r?\n\s*(?:\r?\n\s*)?\*?([A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){0,3})\*?\s*(?:\r?\n|$)",
    re.IGNORECASE,
)

# Multi-line sign-off block pattern (up to 4 lines after Regards/Thanks)
_SIGNOFF_BLOCK_PATTERN = re.compile(
    r"(?:thanks(?:\s*&\s*regards)?|regards|best\s*regards|warm\s*regards|sincerely|cheers)\s*[,:\-\*]?\s*\r?\n((?:\s*[^\r\n]+\r?\n?){1,5})",
    re.IGNORECASE,
)

# Natural-language self-introduction: "I am Rahul Sharma from Engineering" / "I am Priya Singh (EMP1024), working as a Senior Associate in the Finance team"
_SELF_INTRO_PATTERN = re.compile(
    r"\b(?:I\s+am|My\s+name\s+is|This\s+is)\s+\*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\*?",
)

# Natural-language department: "I am Rahul Sharma from Engineering." or "in the Finance team"
_NATURAL_FROM_DEPT_PATTERN = re.compile(
    r"\b(?:I\s+am|My\s+name\s+is)\s+\*?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\*?\s+from\s+(?:the\s+)?([A-Z][A-Za-z0-9&\s\-/]{2,30}?)(?:\s+(?:department|dept|team|division))?(?=\s*[.,;\r\n]|$)",
)
_NATURAL_IN_DEPT_PATTERN = re.compile(
    r"\b(?:working\s+in|in\s+the|from\s+the|part\s+of\s+(?:the\s+)?)\s*([A-Z][A-Za-z0-9&\s\-/]{2,28}?)\s+(?:department|dept|team|division)\b",
    re.IGNORECASE,
)

# Natural-language designation: "working as a Senior Associate"
_NATURAL_DESIGNATION_PATTERN = re.compile(
    r"\bworking\s+as\s+(?:a\s+|an\s+)?([A-Z][A-Za-z0-9&\s\-/]{2,35}?)(?=\s+(?:in|at|from|for|under|with)\b|\s*[.,;\r\n]|$)",
    re.IGNORECASE,
)

# Natural-language manager: "reporting to Amit Kumar"
_NATURAL_MANAGER_PATTERN = re.compile(
    r"\b(?:reporting\s+to|my\s+manager\s+is)\s+\*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\*?",
)

# Natural-language location: "based in Gurgaon" / "located in Bangalore"
_NATURAL_LOCATION_PATTERN = re.compile(
    r"\b(?:based\s+in|located\s+in)\s+([A-Z][A-Za-z\s]{2,25}?)(?:\s+(?:office|branch|campus))?(?=\s*[.,;\r\n]|$)",
)

_NON_NAME_WORDS = {
    "present", "absent", "working", "from", "home", "office", "leave", "casual",
    "sick", "earned", "personal", "attendance", "shift", "general", "regular",
    "full", "half", "day", "days", "week", "month", "team", "department", "dept",
    "hr", "human", "resources", "engineering", "finance", "sales", "marketing",
    "operations", "product", "design", "it", "support", "admin", "manager",
    "associate", "engineer", "analyst", "developer", "lead", "director", "intern",
    "consultant", "writing", "requesting", "applying", "facing", "having", "here",
    "currently", "unable", "happy", "glad", "reaching", "looking", "checking",
    "submitting", "attaching", "sharing", "following", "planning", "taking",
}

_KNOWN_DEPARTMENTS = {
    "engineering", "finance", "hr", "human resources", "hr operations", "operations",
    "product", "design", "sales", "marketing", "it", "information technology",
    "legal", "admin", "administration", "customer support", "support", "quality",
    "qa", "data science", "analytics", "security", "procurement", "supply chain",
    "payroll", "talent acquisition", "recruiting", "accounts", "research",
}

_DESIGNATION_KEYWORDS = {
    "associate", "engineer", "manager", "analyst", "developer", "designer",
    "lead", "specialist", "director", "executive", "consultant", "intern",
    "coordinator", "officer", "architect", "administrator", "vp", "president",
}

_NON_PERSON_SENDER_KEYWORDS = {
    "no-reply",
    "noreply",
    "do-not-reply",
    "donotreply",
    "mailer-daemon",
    "postmaster",
    "notification",
    "notifications",
    "support",
    "helpdesk",
    "team hr",
    "hr team",
    "human resources",
    "people operations",
    "internal communications",
    "corporate communications",
    "technologies private",
    "pvt ltd",
    "private limited",
}


def _clean_single_line_value(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    line = raw.splitlines()[0].strip(" \t\r\n,.;:-*_")
    return line if line else None


def _clean_person_name(raw_name: Optional[str]) -> Optional[str]:
    if not raw_name:
        return None
    cleaned = raw_name.splitlines()[0].strip(" \t\r\n\"'<>()[]-,;:*_")
    # Strip trailing employee code if present in name e.g. "Rahul Sharma (EMP1023)"
    cleaned = re.sub(r"\(?\bEMP[\s\-_]?\d{3,7}\b\)?", "", cleaned, flags=re.IGNORECASE).strip(" -()*_")
    # Strip trailing "from <Department>" if captured inside name
    cleaned = re.sub(r"\s+\b(?:from|in)\s+[A-Za-z&\s]+$", "", cleaned, flags=re.IGNORECASE).strip(" -()*_")
    if "@" in cleaned or len(cleaned) < 2:
        return None
    lower = cleaned.lower()
    if any(k in lower for k in _NON_PERSON_SENDER_KEYWORDS):
        return None
    tokens = [t.lower().strip(".") for t in cleaned.split() if t.strip(".")]
    if not tokens or any(t in _NON_NAME_WORDS for t in tokens):
        return None
    return cleaned


def extract_employee_id(text: str) -> Optional[str]:
    """
    Extract normalized employee ID supporting ANY organization prefix
    (e.g., APRT1024, APRT-0042, 1MG0023, EMP1023, INT009, CON-991, TATA9021).
    """
    if not text:
        return None

    # 1. Explicit labeled pattern (e.g., "Employee ID: APRT1023", "Emp Code: 1MG0023", "My ID is APRT5512")
    m_labeled = _LABELED_EMP_ID_PATTERN.search(text)
    if m_labeled:
        raw_val = (m_labeled.group(1) or m_labeled.group(2)).strip().upper()
        raw_val = re.sub(r"[^A-Z0-9\-_]", "", raw_val)
        if len(raw_val) >= 3 and raw_val not in _EXCLUDED_ID_PREFIXES:
            m_sub = re.match(r"^([A-Z0-9]{2,6})[\-_]?(\d{2,7})$", raw_val)
            if m_sub:
                return f"{m_sub.group(1)}{m_sub.group(2)}"
            return raw_val

    # 2. Standalone line check (in thread replies where employee types just "APRT1024" or "1MG0023")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for ln in lines[:5]:
        if ln.startswith(">") or ln.lower().startswith("on ") or "wrote:" in ln.lower():
            break
        m_line = re.match(r"^\*?([A-Za-z0-9]{2,6})[\s\-_]?(\d{2,7})\*?$", ln, re.IGNORECASE)
        if m_line:
            prefix = m_line.group(1).upper()
            code = m_line.group(2)
            if re.search(r"[A-Za-z]", prefix) and prefix not in _EXCLUDED_ID_PREFIXES:
                return f"{prefix}{code}"

    # 3. Text patterns: attached/hyphenated or space separated
    # Ignore occurrences inside instructions/examples like "(e.g. EMP1023)"
    text_no_eg = re.sub(r"\(?\s*e\.?g\.?[\s:]*[A-Za-z0-9\-_]+\s*\)?", "", text, flags=re.IGNORECASE)

    for m in _ATTACHED_OR_HYPHEN_PATTERN.finditer(text_no_eg):
        prefix = m.group(1).upper()
        code = m.group(2)
        if re.search(r"[A-Za-z]", prefix) and prefix not in _EXCLUDED_ID_PREFIXES:
            return f"{prefix}{code}"

    for m in _SPACE_SEPARATED_PATTERN.finditer(text_no_eg):
        prefix = m.group(1).upper()
        code = m.group(2)
        if re.search(r"[A-Za-z]", prefix) and prefix not in _EXCLUDED_ID_PREFIXES:
            return f"{prefix}{code}"

    return None


def extract_employee_identity(email_payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract all employee identity signals from an email dict containing:
      - sender_name
      - sender_email
      - subject
      - body
    Returns a normalized extraction dictionary used by `employee_matcher`.
    """
    sender_email = (email_payload.get("sender_email") or "").strip().lower() or None
    raw_sender_name = (email_payload.get("sender_name") or "").strip()
    subject = email_payload.get("subject") or ""
    body = email_payload.get("body") or ""
    combined_text = f"{subject}\n{body}"

    in_email_fields = []

    # 1. Employee ID
    extracted_emp_id = extract_employee_id(combined_text) or extract_employee_id(raw_sender_name)
    if extracted_emp_id:
        in_email_fields.append("employee_id")

    # 2. Explicit Employee Email in body/subject
    explicit_email = None
    m_email = _LABELED_EMAIL_PATTERN.search(combined_text)
    if m_email:
        explicit_email = m_email.group(1).strip().lower()
        in_email_fields.append("email")

    # 3. Explicit Employee Name in body ("Employee Name: Vaibhav" or "I am Rahul Sharma")
    explicit_name = None
    m_name = _LABELED_NAME_PATTERN.search(body)
    if m_name:
        explicit_name = _clean_person_name(m_name.group(1))

    if not explicit_name:
        for m_intro in _SELF_INTRO_PATTERN.finditer(body):
            cand_intro = _clean_person_name(m_intro.group(1))
            if cand_intro:
                explicit_name = cand_intro
                break

    signoff_name = None
    m_sign = _SIGNOFF_NAME_PATTERN.search(body)
    if m_sign:
        signoff_name = _clean_person_name(m_sign.group(1))
        # If sign-off has a full name (2+ tokens) and explicit_name wasn't found yet, treat as explicit_name
        if signoff_name and not explicit_name and len(signoff_name.split()) >= 2:
            explicit_name = signoff_name

    if explicit_name or signoff_name:
        in_email_fields.append("name")

    sender_name = _clean_person_name(raw_sender_name)

    # 4. Organizational metadata (Department, Designation, Manager, Location)
    department = None
    m_dept = _LABELED_DEPT_PATTERN.search(body)
    if m_dept:
        department = _clean_single_line_value(m_dept.group(1))
    if not department:
        m_from_dept = _NATURAL_FROM_DEPT_PATTERN.search(body)
        if m_from_dept:
            department = _clean_single_line_value(m_from_dept.group(1))
    if not department:
        m_in_dept = _NATURAL_IN_DEPT_PATTERN.search(body)
        if m_in_dept:
            cand_dept = _clean_single_line_value(m_in_dept.group(1))
            if cand_dept and cand_dept.lower() not in ("hr", "our", "my", "same", "current"):
                department = cand_dept

    designation = None
    m_desig = _LABELED_DESIGNATION_PATTERN.search(body)
    if m_desig:
        designation = _clean_single_line_value(m_desig.group(1))
    if not designation:
        m_nat_desig = _NATURAL_DESIGNATION_PATTERN.search(body)
        if m_nat_desig:
            designation = _clean_single_line_value(m_nat_desig.group(1))

    # Check multi-line sign-off block for Designation / Department lines
    m_block = _SIGNOFF_BLOCK_PATTERN.search(body)
    if m_block:
        block_lines = [
            _clean_single_line_value(ln)
            for ln in m_block.group(1).splitlines()
            if _clean_single_line_value(ln)
        ]
        for ln in block_lines[1:]:
            ln_low = ln.lower()
            if ":" in ln or _EMP_CODE_PATTERN.search(ln):
                continue
            if not department and ln_low in _KNOWN_DEPARTMENTS:
                department = ln
            elif not designation and any(kw in ln_low.split() for kw in _DESIGNATION_KEYWORDS):
                designation = ln

    if department:
        in_email_fields.append("department")
    if designation:
        in_email_fields.append("designation")

    manager_name = None
    m_mgr = _LABELED_MANAGER_PATTERN.search(body)
    if m_mgr:
        manager_name = _clean_person_name(m_mgr.group(1))
    if not manager_name:
        m_nat_mgr = _NATURAL_MANAGER_PATTERN.search(body)
        if m_nat_mgr:
            manager_name = _clean_person_name(m_nat_mgr.group(1))
    if manager_name:
        in_email_fields.append("manager_name")

    location = None
    m_loc = _LABELED_LOCATION_PATTERN.search(body)
    if m_loc:
        location = _clean_single_line_value(m_loc.group(1))
    if not location:
        m_nat_loc = _NATURAL_LOCATION_PATTERN.search(body)
        if m_nat_loc:
            location = _clean_single_line_value(m_nat_loc.group(1))
    if location:
        in_email_fields.append("location")

    # Candidate name prioritizes explicit labeled/intro name -> signoff name -> sender display name
    candidate_name = explicit_name or signoff_name or sender_name
    candidate_email = explicit_email or sender_email

    return {
        "employee_id": extracted_emp_id,
        "sender_email": sender_email,
        "sender_name": sender_name,
        "explicit_email": explicit_email,
        "explicit_name": explicit_name,
        "signoff_name": signoff_name,
        "candidate_name": candidate_name,
        "candidate_email": candidate_email,
        "department": department,
        "designation": designation,
        "manager_name": manager_name,
        "location": location,
        "in_email_fields": in_email_fields,
    }

