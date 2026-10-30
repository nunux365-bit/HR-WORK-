"""
HR FLOW — Phase 8.1, 8.2, 8.6, 8.21 Integration Registry, Manager & External Data Retrieval Framework
(backend/services/integrations/integration_registry.py)

Responsibilities:
  - Seed & manage the Integration Registry (`integrations` table)
  - Expose every external system's status, mode (MOCK vs REAL), capabilities, and safe credential summary
  - Instantiate the appropriate Provider Adapter (`IntegrationManager.get_adapter(provider_id)`)
  - Perform live integration health checks (8.21: CONNECTED, DISCONNECTED, DEGRADED, ERROR, NOT_CONFIGURED)
  - Provide Generic External Data Retrieval Framework (8.6):
      GET employee, GET attendance, GET leave balance, GET leave history,
      GET payroll information, GET employment information
"""

import json
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from backend.database.connection import get_connection
from backend.models.integration import format_integration_row, VALID_INTEGRATION_STATUSES
from backend.services.integrations.base_adapter import BaseIntegrationAdapter
from backend.services.integrations.credential_vault import (
    store_integration_credentials,
    get_decrypted_credentials,
    get_configured_credential_summary,
    sanitize_payload,
)
from backend.services.integrations.darwinbox.service import DarwinboxAdapter
from backend.services.integrations.adapters import (
    TrueinAdapter,
    BGVProviderAdapter,
    PayrollProviderAdapter,
    ITAssetProviderAdapter,
)
from backend.services.audit.audit_service import log_event


DEFAULT_INTEGRATIONS: List[Dict[str, Any]] = [
    {
        "id": "gmail",
        "name": "Gmail",
        "type": "EMAIL",
        "provider": "gmail",
        "status": "CONNECTED",
        "mode": "REAL",
        "configuration": {"protocol": "IMAP/SMTP", "auth_flow": "Login Page Email + App Password"},
        "capabilities": ["email_ingest", "email_reply", "send_email", "request_document"],
    },
    {
        "id": "darwinbox",
        "name": "HRMS Core",
        "type": "HRMS",
        "provider": "hrms",
        "status": "NOT_CONNECTED",
        "mode": "MOCK",
        "configuration": {
            "base_url": "https://api.hrms.internal/v1",
            "allow_auto_leave_write": True,
            "enable_identity_verification": True,
        },
        "capabilities": [
            "employee_lookup",
            "employee_update",
            "leave_lookup",
            "leave_create",
            "attendance_lookup",
            "attendance_update",
        ],
    },
    {
        "id": "truein",
        "name": "Truein",
        "type": "ATTENDANCE",
        "provider": "truein",
        "status": "NOT_CONNECTED",
        "mode": "MOCK",
        "configuration": {"base_url": "https://api.truein.com/v2", "shift_sync": True},
        "capabilities": [
            "fetch_attendance",
            "fetch_shift",
            "fetch_punches",
            "check_attendance",
            "create_correction_request",
            "update_attendance",
        ],
    },
    {
        "id": "bgv_vendor",
        "name": "BGV",
        "type": "BGV",
        "provider": "bgv_vendor",
        "status": "NOT_CONFIGURED",
        "mode": "MOCK",
        "configuration": {"vendor_name": "Vendor A (Standard BGV Gateway)", "package": "STANDARD_EXIT_AND_ONBOARDING"},
        "capabilities": [
            "create_case",
            "create_bgv",
            "update_bgv",
            "submit_documents",
            "get_status",
            "get_report",
        ],
    },
    {
        "id": "payroll",
        "name": "Payroll",
        "type": "PAYROLL",
        "provider": "payroll",
        "status": "NOT_CONFIGURED",
        "mode": "MOCK",
        "configuration": {"cycle": "MONTHLY", "currency": "INR"},
        "capabilities": [
            "get_payroll_status",
            "get_payslip",
            "get_payment_status",
            "create_payroll_query",
        ],
    },
    {
        "id": "it_service_desk",
        "name": "IT",
        "type": "IT_ASSET",
        "provider": "it_service_desk",
        "status": "NOT_CONFIGURED",
        "mode": "MOCK",
        "configuration": {"ticketing_system": "Enterprise IT Service Desk"},
        "capabilities": [
            "create_it_ticket",
            "get_ticket",
            "update_ticket",
            "assign_ticket",
            "close_ticket",
            "get_employee_assets",
        ],
    },
]


def ensure_default_integrations_seeded() -> None:
    conn = get_connection()
    try:
        for item in DEFAULT_INTEGRATIONS:
            existing = conn.execute("SELECT id FROM integrations WHERE id = ?", (item["id"],)).fetchone()
            if not existing:
                conn.execute(
                    """
                    INSERT INTO integrations (id, name, type, provider, status, mode, configuration, capabilities)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item["id"],
                        item["name"],
                        item["type"],
                        item["provider"],
                        item["status"],
                        item["mode"],
                        json.dumps(item["configuration"]),
                        json.dumps(item["capabilities"]),
                    ),
                )
        conn.commit()
    finally:
        conn.close()


def _enrich_integration_with_live_state(rec: Dict[str, Any]) -> Dict[str, Any]:
    if not rec:
        return {}
    int_id = rec["id"]
    if int_id == "gmail":
        try:
            from backend.services.gmail.gmail_client import get_gmail_status
            g_stat = get_gmail_status()
            rec["status"] = "CONNECTED" if g_stat.get("connected") else "DISCONNECTED"
            rec["configuration"]["connected_email"] = g_stat.get("email")
        except Exception:
            pass

    cred_summary = get_configured_credential_summary(int_id)
    rec["credentials_summary"] = cred_summary
    rec["has_credentials"] = cred_summary["has_credentials"] or (int_id == "gmail" and rec["status"] == "CONNECTED")
    return rec


def list_integrations() -> List[Dict[str, Any]]:
    ensure_default_integrations_seeded()
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM integrations ORDER BY created_at ASC, id ASC").fetchall()
        items = [format_integration_row(r) for r in rows]
    finally:
        conn.close()
    return [_enrich_integration_with_live_state(i) for i in items]


def get_integration(integration_id: str) -> Optional[Dict[str, Any]]:
    ensure_default_integrations_seeded()
    norm_id = (integration_id or "").strip().lower()
    if norm_id in ("it", "it_service_desk"):
        norm_id = "it_service_desk"
    elif norm_id in ("bgv", "bgv_vendor"):
        norm_id = "bgv_vendor"
    elif norm_id in ("hrms", "hrms_core", "internal_hrms"):
        norm_id = "darwinbox"

    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM integrations WHERE id = ?", (norm_id,)).fetchone()
        if not row:
            return None
        rec = format_integration_row(row)
    finally:
        conn.close()
    return _enrich_integration_with_live_state(rec)


def update_integration_config(
    integration_id: str,
    status: Optional[str] = None,
    mode: Optional[str] = None,
    configuration: Optional[Dict[str, Any]] = None,
    credentials: Optional[Dict[str, str]] = None,
    performed_by: str = "admin",
) -> Dict[str, Any]:
    rec = get_integration(integration_id)
    if not rec:
        raise ValueError(f"Integration '{integration_id}' not found.")

    norm_id = rec["id"]
    new_status = (status or rec["status"]).strip().upper()
    if new_status not in VALID_INTEGRATION_STATUSES:
        raise ValueError(f"Invalid integration status '{status}'. Allowed: {sorted(VALID_INTEGRATION_STATUSES)}")

    new_mode = (mode or rec.get("mode") or "MOCK").strip().upper()
    if new_mode not in ("MOCK", "REAL"):
        raise ValueError("Integration mode must be 'MOCK' or 'REAL'.")

    merged_cfg = dict(rec.get("configuration") or {})
    if isinstance(configuration, dict):
        # Never allow raw secrets inside plain configuration JSON
        for k, v in configuration.items():
            if k.lower() in ("api_key", "token", "secret", "password", "client_secret"):
                if credentials is None:
                    credentials = {}
                credentials[k] = str(v)
            else:
                merged_cfg[k] = v

    stored_secret_keys = []
    if credentials and isinstance(credentials, dict):
        stored_secret_keys = store_integration_credentials(norm_id, credentials, updated_by=performed_by)
        if new_status in ("NOT_CONFIGURED", "NOT_CONNECTED", "DISCONNECTED"):
            new_status = "CONNECTED"

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE integrations
            SET status = ?,
                mode = ?,
                configuration = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_status, new_mode, json.dumps(merged_cfg), norm_id),
        )
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="INTEGRATION",
        entity_id=norm_id,
        action="INTEGRATION_CONFIGURED",
        description=f"Integration '{rec['name']}' updated (status={new_status}, mode={new_mode})",
        performed_by=performed_by,
        metadata=sanitize_payload({
            "integration_id": norm_id,
            "status": new_status,
            "mode": new_mode,
            "updated_secret_keys": stored_secret_keys,
        }),
    )
    return get_integration(norm_id)


def get_adapter_for_integration(integration_id: str) -> BaseIntegrationAdapter:
    """
    Phase 8.1 Integration Manager -> Provider Adapter Factory:
    Returns an initialized adapter (with MOCK or REAL mode and decrypted credentials isolated inside the adapter).
    """
    rec = get_integration(integration_id)
    if not rec:
        raise ValueError(f"Unknown integration provider '{integration_id}'.")

    norm_id = rec["id"]
    mode = rec.get("mode", "MOCK")
    cfg = rec.get("configuration") or {}
    creds = get_decrypted_credentials(norm_id)

    if norm_id == "darwinbox":
        return DarwinboxAdapter(mode=mode, config=cfg, credentials=creds)
    if norm_id == "truein":
        return TrueinAdapter(mode=mode, config=cfg, credentials=creds)
    if norm_id == "bgv_vendor":
        return BGVProviderAdapter(mode=mode, config=cfg, credentials=creds)
    if norm_id == "payroll":
        return PayrollProviderAdapter(mode=mode, config=cfg, credentials=creds)
    if norm_id == "it_service_desk":
        return ITAssetProviderAdapter(mode=mode, config=cfg, credentials=creds)

    raise ValueError(f"No adapter class registered for provider '{norm_id}'.")


def check_integration_health(integration_id: str) -> Dict[str, Any]:
    """
    Phase 8.21 Integration Health Monitoring:
    Executes a live health check on the integration and records `last_health_check_at`.
    Statuses: CONNECTED, DISCONNECTED, DEGRADED, ERROR, NOT_CONFIGURED
    """
    rec = get_integration(integration_id)
    if not rec:
        raise ValueError(f"Integration '{integration_id}' not found.")

    norm_id = rec["id"]
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    if norm_id == "gmail":
        from backend.services.gmail.gmail_client import get_gmail_status
        g_stat = get_gmail_status()
        health_status = "CONNECTED" if g_stat.get("connected") else "DISCONNECTED"
        msg = f"Gmail IMAP ({g_stat.get('email') or 'No account'})"
        latency = 25 if g_stat.get("connected") else 0
    else:
        adapter = get_adapter_for_integration(norm_id)
        h_res = adapter.check_health()
        # Respect explicit admin status if set to DISCONNECTED / DEGRADED
        if rec["status"] in ("DISCONNECTED", "DEGRADED", "NOT_CONFIGURED", "NOT_CONNECTED") and adapter.mode == "MOCK":
            # In MOCK mode, adapter is always ready to run sandbox tests; report health status accurately
            health_status = "CONNECTED" if rec["status"] == "CONNECTED" else h_res.get("status", "CONNECTED")
        else:
            health_status = h_res.get("status", "CONNECTED")
        msg = h_res.get("message", "OK")
        latency = h_res.get("latency_ms", 15)

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE integrations
            SET last_health_check_at = ?,
                last_error = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (now_iso, msg if health_status == "ERROR" else None, norm_id),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "integration_id": norm_id,
        "name": rec["name"],
        "type": rec["type"],
        "provider": rec["provider"],
        "mode": rec.get("mode", "MOCK"),
        "configured_status": rec["status"],
        "health_status": health_status,
        "latency_ms": latency,
        "message": msg,
        "capabilities": rec["capabilities"],
        "checked_at": now_iso,
    }


# ============================================================
# Phase 8.6 — Generic External Data Retrieval Framework
# ============================================================
def retrieve_external_data(
    resource_type: str,
    query: Dict[str, Any],
    provider_override: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Generic mechanism for workflows and services to fetch external HR data:
      - employee
      - employment_info
      - attendance
      - leave_balance
      - leave_history
      - payroll_info
    """
    res_key = (resource_type or "").strip().lower()
    mapping = {
        "employee": ("darwinbox", "EMPLOYEE_LOOKUP"),
        "employment_info": ("darwinbox", "GET_EMPLOYMENT_INFO"),
        "leave_balance": ("darwinbox", "GET_LEAVE_BALANCE"),
        "leave_history": ("darwinbox", "GET_LEAVE_HISTORY"),
        "attendance": ("truein", "FETCH_ATTENDANCE"),
        "payroll_info": ("payroll", "GET_PAYROLL_STATUS"),
        "assets": ("it_service_desk", "GET_EMPLOYEE_ASSETS"),
    }
    if res_key not in mapping:
        raise ValueError(f"Unsupported external data resource '{resource_type}'. Allowed: {sorted(mapping.keys())}")

    default_provider, action_type = mapping[res_key]
    provider = provider_override or default_provider
    adapter = get_adapter_for_integration(provider)
    result = adapter.execute_action(action_type, query)
    return {
        "resource_type": res_key,
        "provider": provider,
        "mode": adapter.mode,
        "success": result.get("success", False),
        "external_reference": result.get("external_reference"),
        "data": result.get("data") or {},
        "message": result.get("message"),
    }
