"""
HR FLOW — Phase 8.7 & 8.17 HR Action Library & Configuration-Driven Action Approval Rules
(backend/services/actions/action_library.py)

Standardizes internal action types across all HR categories and maps them to:
  - Target integration capability / default provider (never hard-coded inside workflow engine)
  - Risk Level (LOW, MEDIUM, HIGH)
  - Execution Mode (AUTOMATIC, CONFIGURABLE, APPROVAL_REQUIRED)
  - Required Role (HR_AGENT, HR_LEAD, HR_MANAGER, ADMIN)
"""

from typing import Dict, Any, List, Optional
from backend.database.connection import get_connection


# Phase 8.7 & 8.17 Default Action Catalog & Risk Policies
DEFAULT_ACTION_CATALOG: Dict[str, Dict[str, Any]] = {
    "EMPLOYEE_LOOKUP": {
        "action_type": "EMPLOYEE_LOOKUP",
        "default_provider": "darwinbox",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Lookup employee master profile in external HRMS",
    },
    "GET_LEAVE_BALANCE": {
        "action_type": "GET_LEAVE_BALANCE",
        "default_provider": "darwinbox",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Check employee leave balance and leave history in HRMS",
    },
    "CREATE_LEAVE": {
        "action_type": "CREATE_LEAVE",
        "default_provider": "darwinbox",
        "risk_level": "MEDIUM",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_LEAD",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Create approved leave record in external HRMS",
    },
    "UPDATE_EMPLOYEE": {
        "action_type": "UPDATE_EMPLOYEE",
        "default_provider": "darwinbox",
        "risk_level": "HIGH",
        "execution_mode": "APPROVAL_REQUIRED",
        "required_role": "HR_MANAGER",
        "requires_approval": 1,
        "max_retries": 2,
        "description": "Update employee master data in HRMS",
    },
    "TERMINATE_EMPLOYEE": {
        "action_type": "TERMINATE_EMPLOYEE",
        "default_provider": "darwinbox",
        "risk_level": "HIGH",
        "execution_mode": "APPROVAL_REQUIRED",
        "required_role": "HR_MANAGER",
        "requires_approval": 1,
        "max_retries": 1,
        "description": "Terminate employee active status in HRMS (Mandatory Manager/HR Approval)",
    },
    "FETCH_ATTENDANCE": {
        "action_type": "FETCH_ATTENDANCE",
        "default_provider": "truein",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Fetch biometric punches and shift data from Attendance system",
    },
    "FETCH_SHIFT": {
        "action_type": "FETCH_SHIFT",
        "default_provider": "truein",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Fetch employee assigned shift roster",
    },
    "FETCH_PUNCHES": {
        "action_type": "FETCH_PUNCHES",
        "default_provider": "truein",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Fetch raw biometric clock-in/out logs",
    },
    "CHECK_ATTENDANCE": {
        "action_type": "CHECK_ATTENDANCE",
        "default_provider": "truein",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Compare attendance punches with shift rules",
    },
    "CREATE_CORRECTION_REQUEST": {
        "action_type": "CREATE_CORRECTION_REQUEST",
        "default_provider": "truein",
        "risk_level": "MEDIUM",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_LEAD",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Create attendance regularization request in Attendance system",
    },
    "UPDATE_ATTENDANCE": {
        "action_type": "UPDATE_ATTENDANCE",
        "default_provider": "truein",
        "risk_level": "MEDIUM",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_LEAD",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Update regularized attendance log in external system",
    },
    "CREATE_BGV": {
        "action_type": "CREATE_BGV",
        "default_provider": "bgv_vendor",
        "risk_level": "MEDIUM",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_LEAD",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Initiate Background Verification case with BGV vendor",
    },
    "UPDATE_BGV": {
        "action_type": "UPDATE_BGV",
        "default_provider": "bgv_vendor",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Submit documents or update BGV verification check",
    },
    "GET_BGV_REPORT": {
        "action_type": "GET_REPORT",
        "default_provider": "bgv_vendor",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Retrieve BGV clearance report from vendor",
    },
    "GET_PAYROLL_STATUS": {
        "action_type": "GET_PAYROLL_STATUS",
        "default_provider": "payroll",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Fetch payroll computation and disbursement status",
    },
    "CREATE_PAYROLL_QUERY": {
        "action_type": "CREATE_PAYROLL_QUERY",
        "default_provider": "payroll",
        "risk_level": "MEDIUM",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_LEAD",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Record payroll adjustment or query in Payroll system",
    },
    "CREATE_IT_TICKET": {
        "action_type": "CREATE_IT_TICKET",
        "default_provider": "it_service_desk",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Create IT Service Desk / Asset allocation ticket",
    },
    "GET_EMPLOYEE_ASSETS": {
        "action_type": "GET_EMPLOYEE_ASSETS",
        "default_provider": "it_service_desk",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 2,
        "description": "Retrieve assigned IT hardware assets for employee",
    },
    "SEND_EMAIL": {
        "action_type": "SEND_EMAIL",
        "default_provider": "gmail",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 1,
        "description": "Send outbound HR notification email",
    },
    "REQUEST_DOCUMENT": {
        "action_type": "REQUEST_DOCUMENT",
        "default_provider": "gmail",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 1,
        "description": "Request missing HR documents from employee",
    },
    "CREATE_TASK": {
        "action_type": "CREATE_TASK",
        "default_provider": "internal",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 1,
        "description": "Create internal HR operational task",
    },
    "REQUEST_APPROVAL": {
        "action_type": "REQUEST_APPROVAL",
        "default_provider": "internal",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 1,
        "description": "Create internal manager/HR approval request",
    },
}

# Map legacy/semantic workflow transition action names -> standardized Action Library types
WORKFLOW_ACTION_ALIASES: Dict[str, str] = {
    "check_employee": "EMPLOYEE_LOOKUP",
    "employee_lookup": "EMPLOYEE_LOOKUP",
    "verify_leave_balance": "GET_LEAVE_BALANCE",
    "check_leave_balance": "GET_LEAVE_BALANCE",
    "update_hrms_leave": "CREATE_LEAVE",
    "create_leave": "CREATE_LEAVE",
    "fetch_attendance": "FETCH_ATTENDANCE",
    "check_attendance": "CHECK_ATTENDANCE",
    "update_attendance_log": "UPDATE_ATTENDANCE",
    "update_attendance": "UPDATE_ATTENDANCE",
    "create_correction_request": "CREATE_CORRECTION_REQUEST",
    "assign_bgv_team": "CREATE_BGV",
    "dispatch_bgv_vendor": "CREATE_BGV",
    "create_bgv": "CREATE_BGV",
    "validate_exit_pack": "UPDATE_BGV",
    "record_bgv_clearance": "GET_BGV_REPORT",
    "record_bgv_report": "GET_BGV_REPORT",
    "update_payroll_sheet": "CREATE_PAYROLL_QUERY",
    "initiate_asset_and_payroll_clearance": "GET_EMPLOYEE_ASSETS",
    "allocate_it_asset": "CREATE_IT_TICKET",
    "create_it_ticket": "CREATE_IT_TICKET",
    "send_document_request": "REQUEST_DOCUMENT",
}


def ensure_default_action_policies_seeded() -> None:
    conn = get_connection()
    try:
        for act_type, cfg in DEFAULT_ACTION_CATALOG.items():
            existing = conn.execute(
                "SELECT action_type FROM action_policies WHERE action_type = ?",
                (act_type,),
            ).fetchone()
            if not existing:
                conn.execute(
                    """
                    INSERT INTO action_policies (
                        action_type, risk_level, execution_mode, required_role,
                        requires_approval, max_retries, description
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        act_type,
                        cfg["risk_level"],
                        cfg["execution_mode"],
                        cfg["required_role"],
                        int(cfg["requires_approval"]),
                        int(cfg["max_retries"]),
                        cfg["description"],
                    ),
                )
        conn.commit()
    finally:
        conn.close()


def get_action_policy(action_type: str) -> Dict[str, Any]:
    ensure_default_action_policies_seeded()
    norm = resolve_standard_action_type(action_type)
    base_def = DEFAULT_ACTION_CATALOG.get(norm, {
        "action_type": norm,
        "default_provider": "darwinbox",
        "risk_level": "LOW",
        "execution_mode": "AUTOMATIC",
        "required_role": "HR_AGENT",
        "requires_approval": 0,
        "max_retries": 2,
        "description": f"Execute {norm}",
    })

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM action_policies WHERE action_type = ?",
            (norm,),
        ).fetchone()
        if not row:
            return dict(base_def)
        d = dict(row)
        return {
            **base_def,
            "risk_level": d["risk_level"],
            "execution_mode": d["execution_mode"],
            "required_role": d["required_role"],
            "requires_approval": bool(d["requires_approval"]),
            "max_retries": int(d["max_retries"]),
            "description": d.get("description") or base_def["description"],
        }
    finally:
        conn.close()


def list_action_policies() -> List[Dict[str, Any]]:
    ensure_default_action_policies_seeded()
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM action_policies ORDER BY action_type ASC").fetchall()
        out = []
        for r in rows:
            d = dict(r)
            act = d["action_type"]
            base_def = DEFAULT_ACTION_CATALOG.get(act, {})
            out.append({
                "action_type": act,
                "default_provider": base_def.get("default_provider", "darwinbox"),
                "risk_level": d["risk_level"],
                "execution_mode": d["execution_mode"],
                "required_role": d["required_role"],
                "requires_approval": bool(d["requires_approval"]),
                "max_retries": int(d["max_retries"]),
                "description": d.get("description"),
            })
        return out
    finally:
        conn.close()


def update_action_policy(
    action_type: str,
    risk_level: Optional[str] = None,
    execution_mode: Optional[str] = None,
    required_role: Optional[str] = None,
    requires_approval: Optional[bool] = None,
    max_retries: Optional[int] = None,
) -> Dict[str, Any]:
    current = get_action_policy(action_type)
    norm = current["action_type"]

    new_risk = (risk_level or current["risk_level"]).strip().upper()
    new_mode = (execution_mode or current["execution_mode"]).strip().upper()
    new_role = (required_role or current["required_role"]).strip().upper()
    new_req_app = int(bool(requires_approval)) if requires_approval is not None else int(bool(current["requires_approval"]))
    new_retries = int(max_retries) if max_retries is not None else int(current["max_retries"])

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE action_policies
            SET risk_level = ?,
                execution_mode = ?,
                required_role = ?,
                requires_approval = ?,
                max_retries = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE action_type = ?
            """,
            (new_risk, new_mode, new_role, new_req_app, new_retries, norm),
        )
        conn.commit()
    finally:
        conn.close()

    return get_action_policy(norm)


def resolve_standard_action_type(raw_action: str) -> str:
    clean = (raw_action or "").strip()
    if clean.upper().startswith("EXECUTE_ACTION:"):
        clean = clean.split(":", 1)[1].strip()
    low = clean.lower()
    if low in WORKFLOW_ACTION_ALIASES:
        return WORKFLOW_ACTION_ALIASES[low]
    return clean.upper()
