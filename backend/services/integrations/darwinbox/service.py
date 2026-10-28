"""
HR FLOW — Phase 8.4 Darwinbox Provider Adapter Service
(backend/services/integrations/darwinbox/service.py)
"""

from typing import Dict, Any, Optional
from backend.services.integrations.base_adapter import BaseIntegrationAdapter, IntegrationError
from backend.services.integrations.darwinbox.client import DarwinboxClient
from backend.services.integrations.darwinbox.employee_api import (
    lookup_employee_in_darwinbox,
    update_employee_in_darwinbox,
)
from backend.services.integrations.darwinbox.leave_api import (
    get_leave_balance_in_darwinbox,
    create_leave_in_darwinbox,
)
from backend.services.integrations.darwinbox.attendance_api import (
    get_attendance_in_darwinbox,
    update_attendance_in_darwinbox,
)


class DarwinboxAdapter(BaseIntegrationAdapter):
    provider_id = "darwinbox"
    provider_name = "Darwinbox HRMS"
    provider_type = "HRMS"
    capabilities = [
        "employee_lookup",
        "employee_update",
        "leave_lookup",
        "leave_create",
        "attendance_lookup",
        "attendance_update",
    ]

    def __init__(self, mode: str = "MOCK", config: Optional[Dict[str, Any]] = None, credentials: Optional[Dict[str, str]] = None):
        super().__init__(mode=mode, config=config, credentials=credentials)
        self.client = DarwinboxClient(mode=self.mode, config=self.config, credentials=self._credentials)

    def check_health(self) -> Dict[str, Any]:
        if self.mode == "REAL" and not self.client.has_valid_credentials():
            return {
                "status": "NOT_CONFIGURED",
                "provider": self.provider_id,
                "mode": self.mode,
                "latency_ms": 0,
                "message": "Darwinbox API credentials not configured.",
            }
        try:
            self.client.request("GET", "/health")
            return {
                "status": "CONNECTED",
                "provider": self.provider_id,
                "mode": self.mode,
                "latency_ms": 18,
                "message": f"Darwinbox ({self.mode}) healthy and reachable.",
            }
        except IntegrationError as ie:
            return {
                "status": "ERROR",
                "provider": self.provider_id,
                "mode": self.mode,
                "latency_ms": 0,
                "message": ie.message,
            }

    def execute_action(self, action_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        act = (action_type or "").strip().upper()

        if act in ("EMPLOYEE_LOOKUP", "GET_EMPLOYEE", "GET_EMPLOYMENT_INFO"):
            emp = lookup_employee_in_darwinbox(
                self.client,
                employee_id=payload.get("employee_id"),
                email=payload.get("email"),
                name=payload.get("name"),
                extra_payload=payload,
            )
            if not emp:
                return {
                    "success": False,
                    "action": act,
                    "provider": self.provider_id,
                    "external_reference": None,
                    "message": "Employee not found in Darwinbox",
                    "data": {},
                }
            return {
                "success": True,
                "action": act,
                "provider": self.provider_id,
                "external_reference": emp["employee_id"],
                "message": "Employee found",
                "data": emp,
            }

        if act == "UPDATE_EMPLOYEE":
            res = update_employee_in_darwinbox(
                self.client,
                employee_id=payload.get("employee_id") or "",
                updates=payload.get("updates") or payload,
            )
            return {
                "success": True,
                "action": act,
                "provider": self.provider_id,
                "external_reference": res["external_reference"],
                "message": f"Employee {payload.get('employee_id')} updated in Darwinbox",
                "data": res["employee"],
            }

        if act in ("LEAVE_LOOKUP", "GET_LEAVE_BALANCE", "GET_LEAVE_HISTORY", "CHECK_LEAVE_BALANCE"):
            res = get_leave_balance_in_darwinbox(self.client, payload)
            return {
                "success": True,
                "action": act,
                "provider": self.provider_id,
                "external_reference": res["external_reference"],
                "message": f"Leave balance verified ({res['available_balance']} days available)",
                "data": res,
            }

        if act == "CREATE_LEAVE":
            res = create_leave_in_darwinbox(self.client, payload)
            return {
                "success": True,
                "action": act,
                "provider": self.provider_id,
                "external_reference": res["external_reference"],
                "message": f"Leave recorded in Darwinbox ({res['external_reference']})",
                "data": res,
            }

        if act in ("FETCH_ATTENDANCE", "GET_ATTENDANCE"):
            res = get_attendance_in_darwinbox(self.client, payload)
            return {
                "success": True,
                "action": act,
                "provider": self.provider_id,
                "external_reference": res.get("correction_reference") or f"DBX-ATT-{res.get('employee_id')}",
                "message": "Attendance record fetched from Darwinbox",
                "data": res,
            }

        if act == "UPDATE_ATTENDANCE":
            res = update_attendance_in_darwinbox(self.client, payload)
            return {
                "success": True,
                "action": act,
                "provider": self.provider_id,
                "external_reference": res["correction_reference"],
                "message": f"Attendance regularized in Darwinbox ({res['correction_reference']})",
                "data": res,
            }

        raise IntegrationError(f"Unsupported action '{act}' for DarwinboxAdapter.", retryable=False, status_code=400)
