"""
HR FLOW — Phase 8.8, 8.9, 8.10, 8.17, 8.22, 8.23, 8.24 Action Execution Engine
(backend/services/actions/action_engine.py)

Pipeline:
  Workflow / Manual Trigger
        ↓
  Action Resolution (Action Library)
        ↓
  Idempotency Check (`case_id + action_type + workflow_step`)
        ↓
  Permission & Approval Policy Check (RBAC + Risk Level)
        ↓
  External Integration Adapter (with Retry & Failure Handling: SUCCESS / RETRYING / FAILED / REQUIRES_REVIEW / SKIPPED)
        ↓
  External API Audit Trail (`external_api_audits` — sanitized, secrets never stored)
        ↓
  Case Update + Timeline Audit (`audit_logs`)
"""

import json
import time
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Union

from backend.database.connection import get_connection
from backend.models.case import get_case_by_id_or_number
from backend.models.integration import (
    format_hr_action_row,
    format_external_audit_row,
    generate_next_action_code,
)
from backend.services.actions.action_library import (
    get_action_policy,
    resolve_standard_action_type,
)
from backend.services.integrations.integration_registry import (
    get_adapter_for_integration,
    get_integration,
)
from backend.services.integrations.base_adapter import IntegrationError
from backend.services.integrations.credential_vault import sanitize_payload, redact_text
from backend.services.audit.audit_service import log_event


ROLE_HIERARCHY = {
    "HR_AGENT": 1,
    "HR_LEAD": 2,
    "HR_MANAGER": 3,
    "ADMIN": 4,
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def check_action_role_permission(role: str, required_role: str) -> bool:
    actor_rank = ROLE_HIERARCHY.get((role or "ADMIN").strip().upper(), 1)
    req_rank = ROLE_HIERARCHY.get((required_role or "HR_AGENT").strip().upper(), 1)
    return actor_rank >= req_rank


def build_idempotency_key(
    case_id: Optional[Union[int, str]],
    action_type: str,
    workflow_step: Optional[str] = None,
    custom_key: Optional[str] = None,
) -> str:
    """
    Phase 8.9 Action Idempotency:
    Deterministic key `case_id + action_type + workflow_step` prevents duplicate external side effects
    when Gmail syncs twice or a transition is re-triggered.
    """
    if custom_key:
        return str(custom_key).strip()
    cid = str(case_id if case_id is not None else "GLOBAL")
    act = resolve_standard_action_type(action_type)
    step = str(workflow_step or "DEFAULT_STEP").strip().upper()
    return f"{cid}:{act}:{step}"


def _record_external_api_audit(
    action_id: Optional[int],
    case_id: Optional[int],
    case_number: Optional[str],
    employee_id: Optional[str],
    provider: str,
    action_type: str,
    performed_by: str,
    status: str,
    external_reference: Optional[str],
    request_payload: Dict[str, Any],
    response_payload: Dict[str, Any],
    error_message: Optional[str] = None,
    duration_ms: int = 12,
) -> Dict[str, Any]:
    """
    Phase 8.22 External API Audit Trail:
    Records WHO, WHAT, WHEN, CASE, EMPLOYEE, PROVIDER, ACTION, REQUEST ID, EXTERNAL ID, RESULT, ERROR.
    Strictly sanitizes request/response payloads and redacts error strings so secrets are NEVER stored.
    """
    req_id = f"REQ-{uuid.uuid4().hex[:10].upper()}"
    safe_req = sanitize_payload(request_payload or {})
    safe_res = sanitize_payload(response_payload or {})
    safe_err = redact_text(error_message) if error_message else None

    conn = get_connection()
    try:
        cur = conn.execute(
            """
            INSERT INTO external_api_audits (
                request_id, action_id, case_id, case_number, employee_id,
                provider, action_type, performed_by, status, external_reference,
                sanitized_request, sanitized_response, error_message, duration_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                req_id,
                action_id,
                case_id,
                case_number,
                employee_id,
                provider,
                action_type,
                performed_by,
                status,
                external_reference,
                json.dumps(safe_req),
                json.dumps(safe_res),
                safe_err,
                int(duration_ms),
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM external_api_audits WHERE id = ?", (cur.lastrowid,)).fetchone()
        return format_external_audit_row(row)
    finally:
        conn.close()


def _create_failure_notification(case_id: Optional[int], case_number: Optional[str], action_type: str, provider: str, error_msg: str):
    if not case_id:
        return
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO notifications (
                notif_type, title, message, case_id, case_number, recipient_role
            ) VALUES ('ACTION_FAILURE_REVIEW', ?, ?, ?, ?, 'HR_LEAD')
            """,
            (
                f"External Action Requires Review: {action_type}",
                f"Action {action_type} via {provider} failed after retries on {case_number or case_id}: {redact_text(error_msg)}",
                int(case_id),
                case_number or f"CASE-{case_id}",
            ),
        )
        conn.commit()
    finally:
        conn.close()


def execute_hr_action(
    action_type: str,
    case_identifier: Optional[Union[int, str]] = None,
    payload: Optional[Dict[str, Any]] = None,
    workflow_id: Optional[str] = None,
    workflow_step: Optional[str] = None,
    provider_override: Optional[str] = None,
    performed_by: str = "system",
    role: str = "ADMIN",
    approved_by: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    force_retry: bool = False,
) -> Dict[str, Any]:
    """
    Phase 8.8 Core Action Execution Engine.
    Returns standardized action result:
    {
      "success": true,
      "action": "EMPLOYEE_LOOKUP",
      "provider": "darwinbox",
      "external_reference": "EMP1024",
      "message": "Employee found",
      ...
    }
    """
    std_action = resolve_standard_action_type(action_type)
    policy = get_action_policy(std_action)
    provider = (provider_override or policy.get("default_provider") or "darwinbox").strip().lower()

    # Resolve linked Case & Employee context if provided
    case_obj = get_case_by_id_or_number(case_identifier) if case_identifier is not None else None
    case_db_id = case_obj["db_id"] if case_obj else None
    case_num = case_obj["case_number"] if case_obj else None

    req_payload = dict(payload or {})
    if case_obj:
        if not req_payload.get("employee_id") and case_obj.get("employee_id"):
            req_payload["employee_id"] = case_obj["employee_id"]
        if not req_payload.get("employee_name") and case_obj.get("employee_name"):
            req_payload["employee_name"] = case_obj["employee_name"]
        # Merge extracted fields from case into payload if not already specified
        ext_fields = (case_obj.get("extracted_fields") or {}).get("fields") or (case_obj.get("extracted_fields") or {})
        if isinstance(ext_fields, dict):
            for fk, fv in ext_fields.items():
                if fk not in req_payload and fv is not None:
                    req_payload[fk] = fv
        if not workflow_id:
            workflow_id = case_obj.get("workflow_id")
        if not workflow_step:
            workflow_step = case_obj.get("workflow_state") or "INITIAL"

    emp_id = req_payload.get("employee_id") or (case_obj.get("employee_id") if case_obj else None)
    emp_name = req_payload.get("employee_name") or (case_obj.get("employee_name") if case_obj else None)

    # 1. Permission Check (Phase 8.24)
    required_role = policy.get("required_role", "HR_AGENT")
    if performed_by != "system" and not check_action_role_permission(role, required_role):
        raise PermissionError(
            f"Role '{role}' is not authorized to execute '{std_action}' (requires '{required_role}' or higher)."
        )

    # 2. Idempotency Check (Phase 8.9)
    idem_key = build_idempotency_key(
        case_id=case_db_id,
        action_type=std_action,
        workflow_step=workflow_step,
        custom_key=idempotency_key,
    )

    conn = get_connection()
    try:
        existing_row = conn.execute(
            "SELECT * FROM hr_actions WHERE idempotency_key = ?",
            (idem_key,),
        ).fetchone()
    finally:
        conn.close()

    if existing_row and not force_retry:
        existing_act = format_hr_action_row(existing_row)
        if existing_act["status"] == "SUCCESS":
            # Prevent duplicate execution — return cached idempotent result with `idempotent_replay: True`
            return {
                "success": True,
                "action": std_action,
                "action_id": existing_act["id"],
                "action_code": existing_act["action_code"],
                "status": "SUCCESS",
                "provider": existing_act["provider"],
                "external_reference": existing_act["external_reference"],
                "message": existing_act["message"],
                "idempotency_key": idem_key,
                "idempotent_replay": True,
                "attempt_count": existing_act["attempt_count"],
                "data": existing_act["response_payload"].get("data", {}),
                "record": existing_act,
            }

    # 3. Action Approval Rules (Phase 8.17)
    needs_approval = bool(policy.get("requires_approval")) or policy.get("execution_mode") == "APPROVAL_REQUIRED"
    if needs_approval and not approved_by:
        now_str = _utc_now_iso()
        act_code = existing_row["action_code"] if existing_row else generate_next_action_code()
        conn = get_connection()
        try:
            if existing_row:
                conn.execute(
                    """
                    UPDATE hr_actions
                    SET status = 'AWAITING_APPROVAL',
                        request_payload = ?,
                        error_message = 'Action requires manager/HR approval before external execution',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (json.dumps(sanitize_payload(req_payload)), existing_row["id"]),
                )
                act_id = existing_row["id"]
            else:
                cur = conn.execute(
                    """
                    INSERT INTO hr_actions (
                        action_code, idempotency_key, case_id, case_number,
                        employee_id, employee_name, workflow_id, workflow_step,
                        action_type, provider, risk_level, status, attempt_count,
                        max_retries, request_payload, response_payload,
                        error_message, requested_by, started_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AWAITING_APPROVAL', 0, ?, ?, '{}', ?, ?, ?)
                    """,
                    (
                        act_code,
                        idem_key,
                        case_db_id,
                        case_num,
                        emp_id,
                        emp_name,
                        workflow_id,
                        workflow_step,
                        std_action,
                        provider,
                        policy.get("risk_level", "HIGH"),
                        int(policy.get("max_retries", 2)),
                        json.dumps(sanitize_payload(req_payload)),
                        f"High-risk action '{std_action}' requires approval before execution.",
                        performed_by,
                        now_str,
                    ),
                )
                act_id = cur.lastrowid
            conn.commit()
            saved = conn.execute("SELECT * FROM hr_actions WHERE id = ?", (act_id,)).fetchone()
        finally:
            conn.close()

        if case_db_id:
            log_event(
                entity_type="CASE",
                entity_id=case_db_id,
                action="ACTION_AWAITING_APPROVAL",
                description=f"Action {std_action} ({act_code}) queued awaiting HR/Manager approval",
                performed_by=performed_by,
                metadata={"action_code": act_code, "action_type": std_action, "provider": provider},
            )
        rec = format_hr_action_row(saved)
        return {
            "success": False,
            "action": std_action,
            "action_id": rec["id"],
            "action_code": rec["action_code"],
            "status": "AWAITING_APPROVAL",
            "provider": provider,
            "external_reference": None,
            "message": f"Action '{std_action}' requires approval before execution.",
            "idempotency_key": idem_key,
            "idempotent_replay": False,
            "record": rec,
        }

    # 4. Initialize or reuse `hr_actions` record
    now_str = _utc_now_iso()
    max_retries = int(req_payload.get("_max_retries") if "_max_retries" in req_payload else policy.get("max_retries", 2))
    conn = get_connection()
    try:
        if existing_row:
            act_id = existing_row["id"]
            act_code = existing_row["action_code"]
            conn.execute(
                """
                UPDATE hr_actions
                SET status = 'RETRYING',
                    request_payload = ?,
                    approved_by = COALESCE(?, approved_by),
                    started_at = COALESCE(started_at, ?),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (json.dumps(sanitize_payload(req_payload)), approved_by, now_str, act_id),
            )
        else:
            act_code = generate_next_action_code()
            cur = conn.execute(
                """
                INSERT INTO hr_actions (
                    action_code, idempotency_key, case_id, case_number,
                    employee_id, employee_name, workflow_id, workflow_step,
                    action_type, provider, risk_level, status, attempt_count,
                    max_retries, request_payload, response_payload,
                    requested_by, approved_by, started_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, '{}', ?, ?, ?)
                """,
                (
                    act_code,
                    idem_key,
                    case_db_id,
                    case_num,
                    emp_id,
                    emp_name,
                    workflow_id,
                    workflow_step,
                    std_action,
                    provider,
                    policy.get("risk_level", "LOW"),
                    max_retries,
                    json.dumps(sanitize_payload(req_payload)),
                    performed_by,
                    approved_by,
                    now_str,
                ),
            )
            act_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    # Phase 8.12 Check if Leave creation is disabled in Darwinbox config
    if std_action == "CREATE_LEAVE" and provider == "darwinbox":
        dbx_int = get_integration("darwinbox") or {}
        if dbx_int.get("configuration", {}).get("allow_auto_leave_write") is False and not approved_by:
            conn = get_connection()
            try:
                conn.execute(
                    """
                    UPDATE hr_actions
                    SET status = 'SKIPPED',
                        error_message = 'Leave write skipped: allow_auto_leave_write is disabled in Darwinbox settings',
                        completed_at = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (_utc_now_iso(), act_id),
                )
                conn.commit()
                saved = conn.execute("SELECT * FROM hr_actions WHERE id = ?", (act_id,)).fetchone()
            finally:
                conn.close()
            rec = format_hr_action_row(saved)
            return {
                "success": False,
                "action": std_action,
                "action_id": rec["id"],
                "action_code": rec["action_code"],
                "status": "SKIPPED",
                "provider": provider,
                "external_reference": None,
                "message": "Skipped: automatic leave write is disabled in integration configuration.",
                "record": rec,
            }

    # 5. Execute via Provider Adapter with Retry & Failure Handling (Phase 8.10)
    attempts = 0
    total_allowed_attempts = max(1, max_retries + 1)
    last_error_msg: Optional[str] = None
    adapter_result: Optional[Dict[str, Any]] = None

    while attempts < total_allowed_attempts:
        attempts += 1
        t0 = time.time()
        try:
            if provider in ("internal", "gmail"):
                # Handle internal/email actions cleanly
                ext_ref = f"INT-{act_code}"
                adapter_result = {
                    "success": True,
                    "action": std_action,
                    "provider": provider,
                    "external_reference": ext_ref,
                    "message": f"Action {std_action} completed ({ext_ref})",
                    "data": {"reference": ext_ref},
                }
            else:
                adapter = get_adapter_for_integration(provider)
                # Support test-specific transient failure simulation that succeeds on retry N
                fail_until = int(req_payload.get("_fail_until_attempt") or 0)
                call_payload = dict(req_payload)
                if fail_until and attempts < fail_until:
                    call_payload["_simulate_timeout"] = True
                adapter_result = adapter.execute_action(std_action, call_payload)

            duration_ms = max(1, int((time.time() - t0) * 1000))
            _record_external_api_audit(
                action_id=act_id,
                case_id=case_db_id,
                case_number=case_num,
                employee_id=emp_id,
                provider=provider,
                action_type=std_action,
                performed_by=performed_by,
                status="SUCCESS" if adapter_result.get("success") else "FAILED",
                external_reference=adapter_result.get("external_reference"),
                request_payload=req_payload,
                response_payload=adapter_result,
                duration_ms=duration_ms,
            )
            last_error_msg = None
            break

        except IntegrationError as ie:
            duration_ms = max(1, int((time.time() - t0) * 1000))
            last_error_msg = redact_text(ie.message)
            _record_external_api_audit(
                action_id=act_id,
                case_id=case_db_id,
                case_number=case_num,
                employee_id=emp_id,
                provider=provider,
                action_type=std_action,
                performed_by=performed_by,
                status="RETRYING" if (ie.retryable and attempts < total_allowed_attempts) else "FAILED",
                external_reference=None,
                request_payload=req_payload,
                response_payload={},
                error_message=last_error_msg,
                duration_ms=duration_ms,
            )
            conn = get_connection()
            try:
                conn.execute(
                    "UPDATE hr_actions SET status = 'RETRYING', attempt_count = ?, error_message = ? WHERE id = ?",
                    (attempts, last_error_msg, act_id),
                )
                conn.commit()
            finally:
                conn.close()

            if not ie.retryable or attempts >= total_allowed_attempts:
                break
        except Exception as exc:
            duration_ms = max(1, int((time.time() - t0) * 1000))
            last_error_msg = redact_text(str(exc))
            _record_external_api_audit(
                action_id=act_id,
                case_id=case_db_id,
                case_number=case_num,
                employee_id=emp_id,
                provider=provider,
                action_type=std_action,
                performed_by=performed_by,
                status="FAILED",
                external_reference=None,
                request_payload=req_payload,
                response_payload={},
                error_message=last_error_msg,
                duration_ms=duration_ms,
            )
            break

    completed_iso = _utc_now_iso()

    # 6. Handle Final Exhausted Failure -> REQUIRES_REVIEW + HR Notification (Phase 8.10)
    if last_error_msg or not adapter_result:
        final_status = "REQUIRES_REVIEW"
        conn = get_connection()
        try:
            conn.execute(
                """
                UPDATE hr_actions
                SET status = ?,
                    attempt_count = ?,
                    error_message = ?,
                    completed_at = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (final_status, attempts, last_error_msg, completed_iso, act_id),
            )
            if case_db_id:
                conn.execute(
                    "UPDATE cases SET status = 'REVIEW_REQUIRED', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (case_db_id,),
                )
            conn.commit()
            saved = conn.execute("SELECT * FROM hr_actions WHERE id = ?", (act_id,)).fetchone()
        finally:
            conn.close()

        _create_failure_notification(case_db_id, case_num, std_action, provider, last_error_msg or "External API error")
        if case_db_id:
            log_event(
                entity_type="CASE",
                entity_id=case_db_id,
                action="EXTERNAL_ACTION_FAILED",
                description=f"External action {std_action} via {provider} failed after {attempts} attempt(s) → REQUIRES_REVIEW ({last_error_msg})",
                performed_by=performed_by,
                metadata=sanitize_payload({
                    "action_code": act_code,
                    "action": std_action,
                    "provider": provider,
                    "attempts": attempts,
                    "status": final_status,
                    "error": last_error_msg,
                }),
            )
        rec = format_hr_action_row(saved)
        return {
            "success": False,
            "action": std_action,
            "action_id": rec["id"],
            "action_code": rec["action_code"],
            "status": final_status,
            "provider": provider,
            "external_reference": None,
            "message": last_error_msg or "Action failed after retries; routed to HR review.",
            "attempt_count": attempts,
            "idempotency_key": idem_key,
            "idempotent_replay": False,
            "record": rec,
        }

    # 7. Handle Success -> Persist External Reference, Update Case & Action Timeline (Phase 8.8 & 8.23)
    ext_ref = adapter_result.get("external_reference")
    final_status = "SUCCESS" if adapter_result.get("success", True) else "FAILED"
    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE hr_actions
            SET status = ?,
                attempt_count = ?,
                response_payload = ?,
                external_reference = ?,
                error_message = NULL,
                completed_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                final_status,
                attempts,
                json.dumps(sanitize_payload(adapter_result)),
                ext_ref,
                completed_iso,
                act_id,
            ),
        )
        conn.commit()
        saved = conn.execute("SELECT * FROM hr_actions WHERE id = ?", (act_id,)).fetchone()
    finally:
        conn.close()

    if case_db_id:
        # Phase 8.23 Action Timeline Events:
        #   - External action executed
        #   - External reference received
        log_event(
            entity_type="CASE",
            entity_id=case_db_id,
            action="EXTERNAL_ACTION_EXECUTED",
            description=f"{provider.title()} action {std_action} executed: {adapter_result.get('message')}",
            performed_by=performed_by,
            metadata=sanitize_payload({
                "action_code": act_code,
                "action": std_action,
                "provider": provider,
                "external_reference": ext_ref,
                "attempts": attempts,
            }),
        )
        if ext_ref:
            log_event(
                entity_type="CASE",
                entity_id=case_db_id,
                action="EXTERNAL_REFERENCE_RECEIVED",
                description=f"External reference received from {provider.title()}: {ext_ref}",
                performed_by=provider,
                metadata=sanitize_payload({
                    "action_code": act_code,
                    "action": std_action,
                    "provider": provider,
                    "external_reference": ext_ref,
                }),
            )

    rec = format_hr_action_row(saved)
    return {
        "success": bool(adapter_result.get("success", True)),
        "action": std_action,
        "action_id": rec["id"],
        "action_code": rec["action_code"],
        "status": final_status,
        "provider": provider,
        "external_reference": ext_ref,
        "message": adapter_result.get("message") or "Action executed successfully",
        "attempt_count": attempts,
        "idempotency_key": idem_key,
        "idempotent_replay": False,
        "data": adapter_result.get("data", {}),
        "record": rec,
    }


def retry_hr_action(
    action_identifier: Union[int, str],
    performed_by: str = "Vaibhav (HR)",
    role: str = "ADMIN",
    override_payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Manually retry a FAILED, REQUIRES_REVIEW, or AWAITING_APPROVAL action from the Action Center."""
    action_rec = get_hr_action(action_identifier)
    if not action_rec:
        raise ValueError(f"Action '{action_identifier}' not found.")

    merged_payload = dict(action_rec.get("request_payload") or {})
    # Clear simulated failure flags on manual retry unless explicitly re-passed
    merged_payload.pop("_simulate_timeout", None)
    merged_payload.pop("_simulate_error", None)
    merged_payload.pop("_fail_until_attempt", None)
    if override_payload:
        merged_payload.update(override_payload)

    approved_by = action_rec.get("approved_by") or (performed_by if role in ("HR_MANAGER", "ADMIN", "HR_LEAD") else None)

    return execute_hr_action(
        action_type=action_rec["action_type"],
        case_identifier=action_rec.get("case_id"),
        payload=merged_payload,
        workflow_id=action_rec.get("workflow_id"),
        workflow_step=action_rec.get("workflow_step"),
        provider_override=action_rec.get("provider"),
        performed_by=performed_by,
        role=role,
        approved_by=approved_by,
        idempotency_key=action_rec["idempotency_key"],
        force_retry=True,
    )


def approve_and_execute_hr_action(
    action_identifier: Union[int, str],
    approved_by: str = "Amit Kumar (HR Manager)",
    role: str = "HR_MANAGER",
) -> Dict[str, Any]:
    """Approve an action that was held in AWAITING_APPROVAL and execute it."""
    if not check_action_role_permission(role, "HR_LEAD"):
        raise PermissionError(f"Role '{role}' cannot approve held HR actions.")
    action_rec = get_hr_action(action_identifier)
    if not action_rec:
        raise ValueError(f"Action '{action_identifier}' not found.")

    return execute_hr_action(
        action_type=action_rec["action_type"],
        case_identifier=action_rec.get("case_id"),
        payload=action_rec.get("request_payload") or {},
        workflow_id=action_rec.get("workflow_id"),
        workflow_step=action_rec.get("workflow_step"),
        provider_override=action_rec.get("provider"),
        performed_by=approved_by,
        role=role,
        approved_by=approved_by,
        idempotency_key=action_rec["idempotency_key"],
        force_retry=True,
    )


def get_hr_action(identifier: Union[int, str]) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        if isinstance(identifier, int) or str(identifier).isdigit():
            row = conn.execute("SELECT * FROM hr_actions WHERE id = ?", (int(identifier),)).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM hr_actions WHERE action_code = ? OR idempotency_key = ?",
                (str(identifier).strip(), str(identifier).strip()),
            ).fetchone()
        return format_hr_action_row(row) if row else None
    finally:
        conn.close()


def list_hr_actions(
    case_id: Optional[Union[int, str]] = None,
    status: Optional[str] = None,
    provider: Optional[str] = None,
    action_type: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        clauses = []
        params: List[Any] = []
        if case_id is not None and str(case_id).strip() != "":
            if str(case_id).isdigit():
                clauses.append("case_id = ?")
                params.append(int(case_id))
            else:
                clauses.append("case_number = ?")
                params.append(str(case_id).strip())
        if status and status.upper() != "ALL":
            clauses.append("status = ?")
            params.append(status.strip().upper())
        if provider and provider.upper() != "ALL":
            clauses.append("LOWER(provider) = ?")
            params.append(provider.strip().lower())
        if action_type and action_type.upper() != "ALL":
            clauses.append("UPPER(action_type) = ?")
            params.append(action_type.strip().upper())

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = conn.execute(
            f"SELECT * FROM hr_actions {where_sql} ORDER BY id DESC LIMIT ?",
            (*params, int(limit)),
        ).fetchall()
        return [format_hr_action_row(r) for r in rows]
    finally:
        conn.close()


def list_external_api_audits(
    case_id: Optional[Union[int, str]] = None,
    action_id: Optional[int] = None,
    provider: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        clauses = []
        params: List[Any] = []
        if case_id is not None and str(case_id).strip() != "":
            if str(case_id).isdigit():
                clauses.append("case_id = ?")
                params.append(int(case_id))
            else:
                clauses.append("case_number = ?")
                params.append(str(case_id).strip())
        if action_id is not None:
            clauses.append("action_id = ?")
            params.append(int(action_id))
        if provider and provider.upper() != "ALL":
            clauses.append("LOWER(provider) = ?")
            params.append(provider.strip().lower())

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = conn.execute(
            f"SELECT * FROM external_api_audits {where_sql} ORDER BY id DESC LIMIT ?",
            (*params, int(limit)),
        ).fetchall()
        return [format_external_audit_row(r) for r in rows]
    finally:
        conn.close()
