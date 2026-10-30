"""
HR FLOW — Phase 8.1, 8.11, 8.22, 8.25 Base Integration Provider Adapter & Response Mapper
(backend/services/integrations/base_adapter.py)

Responsibilities:
  - Consistent internal interface for all external systems (HRMS, Attendance, BGV, Payroll, IT, Email)
  - REAL vs MOCK provider mode separation
  - External System Response Mapping (8.11) to HR Flow Standard dictionaries
  - Standardized Action Result structure (8.8)
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List


class IntegrationError(Exception):
    """Raised when an external provider encounters a transient or permanent failure."""
    def __init__(self, message: str, retryable: bool = True, status_code: int = 500):
        super().__init__(message)
        self.message = message
        self.retryable = retryable
        self.status_code = status_code


class BaseIntegrationAdapter(ABC):
    """
    Abstract base class for all external system adapters.
    Supports both 'MOCK' and 'REAL' execution modes so automated tests and sandbox
    environments never modify production HR records unless explicitly configured.
    """

    provider_id: str = "generic"
    provider_name: str = "Generic Provider"
    provider_type: str = "GENERIC"
    capabilities: List[str] = []

    def __init__(self, mode: str = "MOCK", config: Optional[Dict[str, Any]] = None, credentials: Optional[Dict[str, str]] = None):
        self.mode = (mode or "MOCK").strip().upper()
        self.config = config or {}
        self._credentials = credentials or {}

    @abstractmethod
    def check_health(self) -> Dict[str, Any]:
        """
        Verify connectivity and authentication.
        Returns: {status: CONNECTED|DISCONNECTED|DEGRADED|ERROR|NOT_CONFIGURED, latency_ms, message}
        """
        pass

    @abstractmethod
    def execute_action(self, action_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a standardized HR action against the provider (Mock or Real).
        Must return a standardized result dict:
        {
          "success": bool,
          "action": action_type,
          "provider": self.provider_id,
          "external_reference": str,
          "message": str,
          "data": dict (normalized HR Flow format)
        }
        """
        pass

    @staticmethod
    def normalize_employee_response(raw: Dict[str, Any], source_provider: str = "darwinbox") -> Dict[str, Any]:
        """
        Phase 8.11 External System Response Mapping:
        Converts vendor-specific employee objects (e.g. Darwinbox `employee_code`, `full_name`, `work_email`)
        into the universal HR Flow Standard employee format.
        """
        if not raw:
            return {}

        emp_id = (
            raw.get("employee_id")
            or raw.get("employee_code")
            or raw.get("emp_code")
            or raw.get("emp_id")
            or raw.get("id")
            or ""
        )
        name = (
            raw.get("name")
            or raw.get("full_name")
            or raw.get("employee_name")
            or f"{raw.get('first_name', '')} {raw.get('last_name', '')}".strip()
        )
        email = (
            raw.get("email")
            or raw.get("work_email")
            or raw.get("official_email")
            or raw.get("company_email")
        )
        department = (
            raw.get("department")
            or raw.get("dept_name")
            or raw.get("org_unit")
        )
        designation = (
            raw.get("designation")
            or raw.get("job_title")
            or raw.get("title")
            or raw.get("role")
        )
        location = (
            raw.get("location")
            or raw.get("work_location")
            or raw.get("office_city")
        )
        manager = (
            raw.get("manager")
            or raw.get("manager_name")
            or raw.get("reporting_manager")
        )
        status = (
            raw.get("status")
            or raw.get("employment_status")
            or "ACTIVE"
        )

        return {
            "employee_id": str(emp_id).strip().upper(),
            "id": str(emp_id).strip().upper(),
            "name": name,
            "email": email.lower().strip() if isinstance(email, str) and email else None,
            "department": department,
            "designation": designation,
            "location": location,
            "manager": manager,
            "manager_name": manager,
            "status": str(status).upper(),
            "source_provider": source_provider,
        }

    @staticmethod
    def normalize_leave_response(raw: Dict[str, Any], source_provider: str = "darwinbox") -> Dict[str, Any]:
        """Normalize vendor leave balance / leave creation response into HR Flow standard."""
        return {
            "employee_id": raw.get("employee_id") or raw.get("employee_code"),
            "leave_reference": raw.get("leave_reference") or raw.get("leave_id") or raw.get("external_reference"),
            "leave_type": raw.get("leave_type") or raw.get("category") or "CASUAL_LEAVE",
            "available_balance": raw.get("available_balance") if raw.get("available_balance") is not None else raw.get("balance", 12),
            "start_date": raw.get("start_date") or raw.get("from_date"),
            "end_date": raw.get("end_date") or raw.get("to_date"),
            "days": raw.get("days") or raw.get("duration_days") or 1,
            "status": raw.get("status") or "RECORDED",
            "source_provider": source_provider,
        }

    @staticmethod
    def normalize_attendance_response(raw: Dict[str, Any], source_provider: str = "truein") -> Dict[str, Any]:
        """Normalize vendor attendance/biometric response into HR Flow standard."""
        return {
            "employee_id": raw.get("employee_id") or raw.get("emp_code"),
            "date": raw.get("date") or raw.get("attendance_date"),
            "shift": raw.get("shift") or raw.get("shift_code") or "GENERAL (09:00 - 18:00)",
            "first_punch_in": raw.get("first_punch_in") or raw.get("punch_in") or raw.get("check_in"),
            "last_punch_out": raw.get("last_punch_out") or raw.get("punch_out") or raw.get("check_out"),
            "punches": raw.get("punches") or [],
            "biometric_status": raw.get("biometric_status") or raw.get("status") or "MISSED_PUNCH",
            "correction_reference": raw.get("correction_reference") or raw.get("external_reference"),
            "source_provider": source_provider,
        }
