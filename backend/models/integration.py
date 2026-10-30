"""
HR FLOW — Phase 8 Integration & Action Automation Models
(backend/models/integration.py)
"""

import json
from typing import Dict, Any, List, Optional
from backend.database.connection import get_connection


VALID_INTEGRATION_STATUSES = {
    "CONNECTED",
    "DISCONNECTED",
    "DEGRADED",
    "ERROR",
    "NOT_CONFIGURED",
    "NOT_CONNECTED",
}

VALID_ACTION_STATUSES = {
    "PENDING",
    "AWAITING_APPROVAL",
    "RETRYING",
    "SUCCESS",
    "FAILED",
    "REQUIRES_REVIEW",
    "SKIPPED",
}

VALID_RISK_LEVELS = {"LOW", "MEDIUM", "HIGH"}


def format_integration_row(row) -> Dict[str, Any]:
    if not row:
        return {}
    d = dict(row)
    try:
        cfg = json.loads(d.get("configuration") or "{}")
    except Exception:
        cfg = {}
    try:
        caps = json.loads(d.get("capabilities") or "[]")
    except Exception:
        caps = []

    return {
        "id": d["id"],
        "name": d["name"],
        "type": d["type"],
        "provider": d["provider"],
        "status": d["status"],
        "mode": d.get("mode", "MOCK"),
        "configuration": cfg,
        "capabilities": caps,
        "last_health_check_at": d.get("last_health_check_at"),
        "last_error": d.get("last_error"),
        "created_at": d.get("created_at"),
        "updated_at": d.get("updated_at"),
    }


def format_hr_action_row(row) -> Dict[str, Any]:
    if not row:
        return {}
    d = dict(row)
    try:
        req = json.loads(d.get("request_payload") or "{}")
    except Exception:
        req = {}
    try:
        res = json.loads(d.get("response_payload") or "{}")
    except Exception:
        res = {}

    return {
        "id": d["id"],
        "action_code": d["action_code"],
        "idempotency_key": d["idempotency_key"],
        "case_id": d.get("case_id"),
        "case_number": d.get("case_number"),
        "employee_id": d.get("employee_id"),
        "employee_name": d.get("employee_name"),
        "workflow_id": d.get("workflow_id"),
        "workflow_step": d.get("workflow_step"),
        "action": d["action_type"],
        "action_type": d["action_type"],
        "provider": d["provider"],
        "risk_level": d.get("risk_level", "LOW"),
        "status": d["status"],
        "success": d["status"] == "SUCCESS",
        "attempt_count": int(d.get("attempt_count") or 0),
        "max_retries": int(d.get("max_retries") or 2),
        "request_payload": req,
        "response_payload": res,
        "external_reference": d.get("external_reference"),
        "error": d.get("error_message"),
        "error_message": d.get("error_message"),
        "message": res.get("message") or d.get("error_message") or f"Action {d['status']}",
        "requested_by": d.get("requested_by", "system"),
        "approved_by": d.get("approved_by"),
        "started_at": d.get("started_at"),
        "completed_at": d.get("completed_at"),
        "created_at": d.get("created_at"),
        "updated_at": d.get("updated_at"),
    }


def format_external_audit_row(row) -> Dict[str, Any]:
    if not row:
        return {}
    d = dict(row)
    try:
        req = json.loads(d.get("sanitized_request") or "{}")
    except Exception:
        req = {}
    try:
        res = json.loads(d.get("sanitized_response") or "{}")
    except Exception:
        res = {}

    return {
        "id": d["id"],
        "request_id": d["request_id"],
        "action_id": d.get("action_id"),
        "case_id": d.get("case_id"),
        "case_number": d.get("case_number"),
        "employee_id": d.get("employee_id"),
        "provider": d["provider"],
        "action": d["action_type"],
        "action_type": d["action_type"],
        "who": d.get("performed_by", "system"),
        "performed_by": d.get("performed_by", "system"),
        "when": d.get("created_at"),
        "status": d["status"],
        "result": d["status"],
        "external_id": d.get("external_reference"),
        "external_reference": d.get("external_reference"),
        "error": d.get("error_message"),
        "sanitized_request": req,
        "sanitized_response": res,
        "duration_ms": d.get("duration_ms", 0),
        "created_at": d.get("created_at"),
    }


def generate_next_action_code() -> str:
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM hr_actions ORDER BY id DESC LIMIT 1").fetchone()
        next_num = (int(row["id"]) + 1) if row else 1
        return f"ACT-{1000 + next_num}"
    finally:
        conn.close()
