"""
HR FLOW — Phase 8.4 & 8.25 Darwinbox HTTP Client (Mock & Real Provider Layer)
(backend/services/integrations/darwinbox/client.py)
"""

import json
import urllib.request
import urllib.error
from typing import Dict, Any, Optional
from backend.services.integrations.base_adapter import IntegrationError
from backend.services.integrations.credential_vault import redact_text


# Darwinbox Mock Directory & Leave Ledger (Pre-seeded with sample enterprise records)
MOCK_DARWINBOX_EMPLOYEES: Dict[str, Dict[str, Any]] = {
    "EMP1001": {
        "employee_code": "EMP1001",
        "full_name": "Vaibhav Sharma",
        "work_email": "vaibhavx002@gmail.com",
        "dept_name": "Human Resources",
        "job_title": "HR Specialist",
        "work_location": "Bengaluru",
        "employment_status": "ACTIVE",
        "reporting_manager": "Admin Lead",
        "leave_balances": {
            "CASUAL_LEAVE": 10,
            "SICK_LEAVE": 12,
            "EARNED_LEAVE": 18,
        },
        "leave_history": [
            {"leave_id": "DBX-LV-8800", "leave_type": "CASUAL_LEAVE", "from_date": "2026-01-10", "to_date": "2026-01-11", "days": 2, "status": "APPROVED"},
        ],
    },
    "EMP1023": {
        "employee_code": "EMP1023",
        "full_name": "Rahul Sharma",
        "work_email": "rahul.sharma@company.com",
        "dept_name": "Engineering",
        "job_title": "Senior Software Engineer",
        "work_location": "Bengaluru",
        "employment_status": "ACTIVE",
        "reporting_manager": "Amit Kumar",
        "leave_balances": {
            "CASUAL_LEAVE": 8,
            "SICK_LEAVE": 10,
            "EARNED_LEAVE": 15,
        },
        "leave_history": [
            {"leave_id": "DBX-LV-8801", "leave_type": "CASUAL_LEAVE", "from_date": "2026-02-10", "to_date": "2026-02-11", "days": 2, "status": "APPROVED"},
        ],
    },
    "EMP1024": {
        "employee_code": "EMP1024",
        "full_name": "Priya Singh",
        "work_email": "priya.singh@company.com",
        "dept_name": "Finance",
        "job_title": "Financial Analyst",
        "work_location": "Mumbai",
        "employment_status": "ACTIVE",
        "reporting_manager": "Sunil Verma",
        "leave_balances": {
            "CASUAL_LEAVE": 6,
            "SICK_LEAVE": 8,
            "EARNED_LEAVE": 12,
        },
        "leave_history": [],
    },
    "EMP1376": {
        "employee_code": "EMP1376",
        "full_name": "Karan Malhotra",
        "work_email": "karan.malhotra@company.com",
        "dept_name": "Marketing",
        "job_title": "Marketing Associate",
        "work_location": "Delhi NCR",
        "employment_status": "ACTIVE",
        "reporting_manager": "Pooja Mehta",
        "leave_balances": {
            "CASUAL_LEAVE": 5,
            "SICK_LEAVE": 7,
            "EARNED_LEAVE": 10,
        },
        "leave_history": [],
    },
}


class DarwinboxClient:
    """
    Low-level Darwinbox API client supporting both MOCK and REAL modes.
    Never logs or exposes API keys or authorization headers.
    """

    def __init__(self, mode: str = "MOCK", config: Optional[Dict[str, Any]] = None, credentials: Optional[Dict[str, str]] = None):
        self.mode = (mode or "MOCK").strip().upper()
        self.config = config or {}
        self._credentials = credentials or {}
        self.base_url = (self.config.get("base_url") or "https://api.darwinbox.in/v1").rstrip("/")
        self.timeout_sec = int(self.config.get("timeout_sec") or 8)

    def has_valid_credentials(self) -> bool:
        if self.mode == "MOCK":
            return True
        return bool(self._credentials.get("api_key") or self._credentials.get("token"))

    def request(self, method: str, endpoint: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        # Simulate failures/timeouts deterministically when requested in payload (for 8.10 & 8.26 testing)
        if payload and payload.get("_simulate_timeout"):
            raise IntegrationError("Darwinbox API request timed out after 8000ms", retryable=True, status_code=504)
        if payload and payload.get("_simulate_error"):
            raise IntegrationError("Darwinbox API 503 Service Unavailable", retryable=True, status_code=503)

        if self.mode == "MOCK":
            return self._mock_request(method, endpoint, payload or {})

        if not self.has_valid_credentials():
            raise IntegrationError("Darwinbox REAL mode requires configured api_key credential.", retryable=False, status_code=401)

        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        api_key = self._credentials.get("api_key") or self._credentials.get("token") or ""
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Darwinbox-Api-Key": api_key,
        }
        data_bytes = json.dumps(payload or {}).encode("utf-8") if method.upper() in ("POST", "PUT", "PATCH") else None
        req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method.upper())
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
                raw_body = resp.read().decode("utf-8")
                return json.loads(raw_body) if raw_body else {"status": "ok"}
        except urllib.error.HTTPError as he:
            raise IntegrationError(
                redact_text(f"Darwinbox HTTP {he.code}: {he.reason}"),
                retryable=(he.code >= 500 or he.code == 429),
                status_code=he.code,
            )
        except Exception as exc:
            raise IntegrationError(
                redact_text(f"Darwinbox connection error: {exc}"),
                retryable=True,
                status_code=502,
            )

    def _mock_request(self, method: str, endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        ep = endpoint.strip("/").lower()
        if ep == "health":
            return {"status": "ok", "provider": "darwinbox", "mode": "MOCK"}
        return {"status": "ok", "endpoint": ep, "payload": payload}
