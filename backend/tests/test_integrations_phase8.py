"""
HR FLOW — Phase 8 Comprehensive Integration & Action Automation Test Suite
(backend/tests/test_integrations_phase8.py)

Covers Phase 8.26, 8.27, 8.28, 8.29:
  1. Integration Registry & Health Monitoring (8.1, 8.2, 8.20, 8.21)
  2. Secure Credential Vault & Secret Redaction / Security Audit (8.3, 8.28)
  3. Darwinbox Adapter (Mock vs Real separation), Employee Lookup & Response Mapping (8.4, 8.11, 8.25)
  4. Employee Identity Resolution Upgrade (Local + External HRMS comparison & conflict handling) (8.5)
  5. External Data Retrieval Framework (8.6)
  6. HR Action Library & Action Execution Engine (8.7, 8.8)
  7. Action Idempotency (preventing duplicate side effects) (8.9)
  8. Action Retry, Timeout & Exhausted Failure -> REQUIRES_REVIEW + Notification (8.10)
  9. Action Approval Rules & RBAC Integration Permissions (8.17, 8.24)
  10. Leave, Attendance (Truein), BGV, Payroll, and IT/Asset Integration Frameworks (8.12, 8.13, 8.14, 8.15, 8.16)
  11. Workflow -> Action Mapping & Immutable Sanitized External API Audit Trail (8.18, 8.22, 8.23)
  12. End-to-End Integration Proof: Gmail Leave Email -> AI -> Employee Match -> Leave Case -> Approval -> Darwinbox -> External Reference -> Case Update -> Audit (8.27)
"""

import json
import unittest
from backend.database.init_db import initialize_database
from backend.database.db import execute_query
from backend.services.integrations.credential_vault import (
    encrypt_secret,
    decrypt_secret,
    store_integration_credentials,
    get_configured_credential_summary,
    sanitize_payload,
    redact_text,
)
from backend.services.integrations.integration_registry import (
    list_integrations,
    get_integration,
    update_integration_config,
    check_integration_health,
    retrieve_external_data,
    get_adapter_for_integration,
)
from backend.services.integrations.base_adapter import BaseIntegrationAdapter
from backend.services.actions.action_library import (
    list_action_policies,
    get_action_policy,
    update_action_policy,
)
from backend.services.actions.action_engine import (
    execute_hr_action,
    retry_hr_action,
    approve_and_execute_hr_action,
    list_hr_actions,
    list_external_api_audits,
)
from backend.services.employees.employee_service import identify_employee_from_email
from backend.classification.ai_pipeline import process_email
from backend.services.approvals.approval_service import request_approval, decide_approval
from backend.services.workflows.workflow_engine import transition_workflow_state
from backend.services.cases.case_service import get_full_case_detail, resolve_case, require_permission


class TestPhase8IntegrationsAndActions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize_database()
        from backend.services.integrations.darwinbox.client import MOCK_DARWINBOX_EMPLOYEES
        cls._orig_mock_employees = dict(MOCK_DARWINBOX_EMPLOYEES)
        MOCK_DARWINBOX_EMPLOYEES.update({
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
                "work_location": "Delhi",
                "employment_status": "ACTIVE",
                "reporting_manager": "Suresh Nair",
                "leave_balances": {
                    "CASUAL_LEAVE": 6,
                    "SICK_LEAVE": 7,
                    "EARNED_LEAVE": 12,
                },
                "leave_history": [],
            },
            "EMP1099": {
                "employee_code": "EMP1099",
                "full_name": "Neha Gupta",
                "work_email": "neha.gupta@company.com",
                "dept_name": "Design",
                "job_title": "Lead UX Designer",
                "work_location": "Pune",
                "employment_status": "ACTIVE",
                "reporting_manager": "Ananya Iyer",
                "leave_balances": {
                    "CASUAL_LEAVE": 10,
                    "SICK_LEAVE": 10,
                    "EARNED_LEAVE": 14,
                },
                "leave_history": [],
            },
        })

    @classmethod
    def tearDownClass(cls):
        from backend.services.integrations.darwinbox.client import MOCK_DARWINBOX_EMPLOYEES
        MOCK_DARWINBOX_EMPLOYEES.clear()
        MOCK_DARWINBOX_EMPLOYEES.update(getattr(cls, "_orig_mock_employees", {}))
        execute_query("DELETE FROM employees WHERE employee_id IN ('EMP1023', 'EMP1024', 'EMP1025', 'EMP1099')", commit=True)

    def setUp(self):
        execute_query("DELETE FROM hr_actions WHERE idempotency_key LIKE 'TEST-P8%'", commit=True)

    def test_01_integration_registry_and_health_monitoring(self):
        """Phase 8.2, 8.20, 8.21: Verify all 6 integrations are registered and expose health checks."""
        integrations = list_integrations()
        ids = {i["id"] for i in integrations}
        for expected in ("gmail", "darwinbox", "truein", "bgv_vendor", "payroll", "it_service_desk"):
            self.assertIn(expected, ids)

        dbx = get_integration("darwinbox")
        self.assertIn("employee_lookup", dbx["capabilities"])
        self.assertIn("leave_create", dbx["capabilities"])

        h_data = check_integration_health("darwinbox")
        self.assertIn(h_data["health_status"], ("CONNECTED", "NOT_CONFIGURED", "DISCONNECTED"))

    def test_02_credential_vault_encryption_and_security_audit(self):
        """Phase 8.3 & 8.28: Secrets are encrypted in SQLite and never exposed in responses, logs, or audits."""
        raw_secret = "DBX-SUPER-SECRET-TOKEN-998877"
        cipher = encrypt_secret(raw_secret)
        self.assertTrue(cipher.startswith("ENCv1:"))
        self.assertNotIn(raw_secret, cipher)
        self.assertEqual(decrypt_secret(cipher), raw_secret)

        # Store via integration service as ADMIN
        updated = update_integration_config(
            integration_id="darwinbox",
            status="CONNECTED",
            mode="MOCK",
            credentials={"api_key": raw_secret},
            performed_by="Vaibhav (HR)",
        )
        body_str = json.dumps(updated)
        # Secret must NEVER appear in returned integration record
        self.assertNotIn(raw_secret, body_str)

        # Check summary only exposes masked indicator
        summary = get_configured_credential_summary("darwinbox")
        self.assertTrue(summary["has_credentials"])
        self.assertNotIn(raw_secret, json.dumps(summary))

        # Verify sanitization of payloads and error strings
        dirty = {
            "employee_id": "EMP1023",
            "api_key": raw_secret,
            "authorization": f"Bearer {raw_secret}",
            "nested": {"client_secret": "TOP_SECRET_123"},
        }
        clean = sanitize_payload(dirty)
        self.assertEqual(clean["api_key"], "[REDACTED]")
        self.assertEqual(clean["authorization"], "[REDACTED]")
        self.assertEqual(clean["nested"]["client_secret"], "[REDACTED]")
        self.assertNotIn(raw_secret, redact_text(f"Request failed with Bearer {raw_secret}"))

    def test_03_darwinbox_adapter_and_response_mapping(self):
        """Phase 8.4, 8.11, 8.25: Darwinbox employee lookup and vendor-to-HR-Flow response normalization."""
        raw_vendor = {
            "employee_code": "EMP1024",
            "full_name": "Priya Singh",
            "work_email": "priya.singh@company.com",
            "dept_name": "Finance",
            "job_title": "Financial Analyst",
            "work_location": "Delhi",
            "employment_status": "ACTIVE",
            "reporting_manager": "Suresh Nair",
        }
        norm = BaseIntegrationAdapter.normalize_employee_response(raw_vendor, source_provider="darwinbox")
        self.assertEqual(norm["employee_id"], "EMP1024")
        self.assertEqual(norm["name"], "Priya Singh")
        self.assertEqual(norm["department"], "Finance")
        self.assertEqual(norm["designation"], "Financial Analyst")
        self.assertEqual(norm["manager"], "Suresh Nair")

        adapter = get_adapter_for_integration("darwinbox")
        res = adapter.execute_action("EMPLOYEE_LOOKUP", {"employee_id": "EMP1024"})
        self.assertTrue(res["success"])
        self.assertEqual(res["action"], "EMPLOYEE_LOOKUP")
        self.assertEqual(res["provider"], "darwinbox")
        self.assertEqual(res["external_reference"], "EMP1024")
        self.assertEqual(res["message"], "Employee found")

    def test_04_employee_identity_resolution_upgrade_and_external_hrms(self):
        """Phase 8.5: Local Matcher -> Uncertain -> External HRMS Lookup -> Compare -> MATCHED or CONFLICT."""
        # EMP1099 (Neha Gupta) exists in Darwinbox Mock directory
        execute_query("DELETE FROM employees WHERE employee_id = 'EMP1099'", commit=True)

        # 1. Valid match resolved via Darwinbox HRMS when not in local DB
        match_ok = identify_employee_from_email({
            "sender_name": "Neha Gupta",
            "sender_email": "neha.gupta@company.com",
            "subject": "Leave inquiry",
            "body": "Employee ID: EMP1099\nChecking leave balance.",
        })
        self.assertEqual(match_ok["status"], "MATCHED")
        self.assertEqual(match_ok["employee"]["employee_id"], "EMP1099")

        # 2. Conflict between email body name and Darwinbox HRMS record -> REVIEW_REQUIRED
        execute_query("DELETE FROM employees WHERE employee_id = 'EMP1099'", commit=True)
        match_conflict = identify_employee_from_email({
            "sender_name": "Wrong Person",
            "sender_email": "unknown.sender@example.org",
            "subject": "Update for EMP1099",
            "body": "Employee ID: EMP1099\nEmployee Name: Vikram Malhotra\nPlease update my details.",
        })
        self.assertEqual(match_conflict["status"], "REVIEW_REQUIRED")

    def test_05_external_data_retrieval_framework_and_all_adapters(self):
        """Phase 8.6, 8.13, 8.14, 8.15, 8.16: Generic retrieval & Truein, BGV, Payroll, IT adapters."""
        emp_data = retrieve_external_data("employee", {"employee_id": "EMP1023"})
        self.assertTrue(emp_data["success"])
        self.assertEqual(emp_data["data"]["employee_id"], "EMP1023")

        lv_data = retrieve_external_data("leave_balance", {"employee_id": "EMP1023", "leave_type": "CASUAL_LEAVE"})
        self.assertTrue(lv_data["success"])
        self.assertIn("available_balance", lv_data["data"])

        att_data = retrieve_external_data("attendance", {"employee_id": "EMP1023", "date": "2026-03-18"})
        self.assertTrue(att_data["success"])
        self.assertEqual(att_data["provider"], "truein")

        pay_data = retrieve_external_data("payroll_info", {"employee_id": "EMP1023", "month": "2026-03"})
        self.assertTrue(pay_data["success"])
        self.assertEqual(pay_data["provider"], "payroll")

        ast_data = retrieve_external_data("assets", {"employee_id": "EMP1023"})
        self.assertTrue(ast_data["success"])
        self.assertEqual(ast_data["provider"], "it_service_desk")

        # BGV Adapter actions: CREATE_BGV, UPDATE_BGV, GET_REPORT
        bgv_adapter = get_adapter_for_integration("bgv_vendor")
        b1 = bgv_adapter.execute_action("CREATE_BGV", {"employee_id": "EMP1023"})
        self.assertTrue(b1["success"])
        self.assertTrue(b1["external_reference"].startswith("BGV-CASE-"))
        b2 = bgv_adapter.execute_action("GET_REPORT", {"employee_id": "EMP1023"})
        self.assertEqual(b2["data"]["overall_status"], "CLEAR")

    def test_06_action_idempotency_prevents_duplicate_execution(self):
        """Phase 8.9: Same case_id + action_type + workflow_step must NOT execute twice."""
        idem_key = "TEST-P8-IDEMPOTENT-BGV-001"
        first = execute_hr_action(
            action_type="CREATE_BGV",
            payload={"employee_id": "EMP1023"},
            workflow_step="START_BGV",
            idempotency_key=idem_key,
            performed_by="Vaibhav (HR)",
            role="ADMIN",
        )
        self.assertTrue(first["success"])
        self.assertFalse(first["idempotent_replay"])

        # Second call with same idempotency key must return cached result without re-running external call
        second = execute_hr_action(
            action_type="CREATE_BGV",
            payload={"employee_id": "EMP1023"},
            workflow_step="START_BGV",
            idempotency_key=idem_key,
            performed_by="Vaibhav (HR)",
            role="ADMIN",
        )
        self.assertTrue(second["success"])
        self.assertTrue(second["idempotent_replay"])
        self.assertEqual(first["action_id"], second["action_id"])
        self.assertEqual(first["external_reference"], second["external_reference"])
        self.assertEqual(second["attempt_count"], 1)

    def test_07_action_retry_recovery_and_exhausted_failure_handling(self):
        """Phase 8.10: Transient timeout retries automatically; exhausted failure routes to REQUIRES_REVIEW."""
        # 1. Transient failure on attempt 1 that recovers on attempt 2
        recovered = execute_hr_action(
            action_type="EMPLOYEE_LOOKUP",
            payload={"employee_id": "EMP1023", "_fail_until_attempt": 2},
            idempotency_key="TEST-P8-RETRY-RECOVER-01",
            performed_by="Vaibhav (HR)",
            role="ADMIN",
        )
        self.assertTrue(recovered["success"])
        self.assertEqual(recovered["status"], "SUCCESS")
        self.assertEqual(recovered["attempt_count"], 2)

        # 2. Persistent timeout across all retries -> REQUIRES_REVIEW
        failed = execute_hr_action(
            action_type="EMPLOYEE_LOOKUP",
            payload={"employee_id": "EMP1023", "_simulate_timeout": True, "_max_retries": 2},
            idempotency_key="TEST-P8-RETRY-EXHAUST-01",
            performed_by="Vaibhav (HR)",
            role="ADMIN",
        )
        self.assertFalse(failed["success"])
        self.assertEqual(failed["status"], "REQUIRES_REVIEW")
        self.assertEqual(failed["attempt_count"], 3)  # 1 initial + 2 retries

        # 3. Manual Retry from Action Center succeeds once transient issue clears
        retried = retry_hr_action(failed["action_id"], performed_by="Vaibhav (HR)", role="ADMIN")
        self.assertTrue(retried["success"])
        self.assertEqual(retried["status"], "SUCCESS")

    def test_08_rbac_permissions_and_high_risk_approval_rules(self):
        """Phase 8.17 & 8.24: Enforce role permissions and mandatory approval for high-risk actions."""
        # HR_AGENT cannot configure integrations
        with self.assertRaises(PermissionError):
            require_permission("HR_AGENT", "configure_integrations")

        # HR_AGENT cannot execute MEDIUM/HIGH risk action requiring HR_LEAD or HR_MANAGER
        with self.assertRaises(PermissionError):
            execute_hr_action(
                action_type="UPDATE_EMPLOYEE",
                payload={"employee_id": "EMP1023", "department": "AI Research"},
                idempotency_key="TEST-P8-RBAC-01",
                performed_by="Rohan (Agent)",
                role="HR_AGENT",
            )

        # High-risk action UPDATE_EMPLOYEE without `approved_by` enters AWAITING_APPROVAL
        held = execute_hr_action(
            action_type="UPDATE_EMPLOYEE",
            payload={"employee_id": "EMP1023", "department": "Platform Engineering"},
            idempotency_key="TEST-P8-HIGH-RISK-01",
            performed_by="Amit Kumar",
            role="HR_MANAGER",
        )
        self.assertFalse(held["success"])
        self.assertEqual(held["status"], "AWAITING_APPROVAL")

        # Approving and executing completes the action in Darwinbox
        approved = approve_and_execute_hr_action(
            held["action_id"],
            approved_by="Amit Kumar (HR Manager)",
            role="HR_MANAGER",
        )
        self.assertTrue(approved["success"])
        self.assertEqual(approved["status"], "SUCCESS")
        self.assertTrue(approved["external_reference"].startswith("DBX-EMP-UPD-"))

    def test_09_end_to_end_leave_integration_proof(self):
        """
        Phase 8.12, 8.18, 8.22, 8.23, 8.27 End-to-End Integration Proof:
        Real Gmail Leave Email -> AI Classification -> Employee Match -> Leave Case ->
        Workflow Transition (Darwinbox Employee & Balance Lookup) -> Manager Approval ->
        Darwinbox CREATE_LEAVE Action -> External Reference -> Case Update -> Complete Audit Trail
        """
        email_id = execute_query(
            """
            INSERT INTO emails (provider_message_id, sender_name, sender_email, subject, body, received_at, processing_status)
            VALUES ('TEST-P8-E2E-LEAVE-01', 'Rahul Sharma', 'rahul.sharma@company.com',
                    'Casual leave request from 2026-04-10 to 2026-04-12',
                    'Employee ID: EMP1023\nHi HR, Please approve my casual leave from 2026-04-10 to 2026-04-12 for a family event.',
                    '2026-04-09T09:30:00', 'RECEIVED')
            """,
            commit=True,
        )
        case_db_id = None
        from backend.services.workflows.workflow_registry import save_workflow_definition, clear_all_predefined_workflows
        save_workflow_definition("LEAVE", {
            "workflow_id": "WF-LEAVE-001",
            "name": "Leave Request Workflow",
            "states": ["LEAVE_REQUEST_RECEIVED", "POLICY_CHECK", "MANAGER_APPROVAL", "HRMS_UPDATED", "CLOSED"],
            "initial_state": "LEAVE_REQUEST_RECEIVED",
            "steps_display": ["Leave Request Received", "Policy Check", "Manager Approval", "HRMS Updated", "Closed"],
            "transitions": [
                {
                    "from_state": "LEAVE_REQUEST_RECEIVED",
                    "to_state": "POLICY_CHECK",
                    "trigger": "VERIFY_BALANCE",
                    "actions": ["EMPLOYEE_LOOKUP", "GET_LEAVE_BALANCE"]
                },
                {
                    "from_state": "POLICY_CHECK",
                    "to_state": "MANAGER_APPROVAL",
                    "trigger": "ROUTE_MANAGER",
                    "actions": []
                },
                {
                    "from_state": "MANAGER_APPROVAL",
                    "to_state": "HRMS_UPDATED",
                    "trigger": "APPROVE_LEAVE",
                    "actions": ["update_hrms_leave", "CREATE_LEAVE"]
                },
                {
                    "from_state": "HRMS_UPDATED",
                    "to_state": "CLOSED",
                    "trigger": "RESOLVE_CASE",
                    "actions": ["resolve_and_close_case"]
                }
            ]
        })
        try:
            # 1. Process Email through AI Pipeline -> Creates Leave Case
            pipeline_res = process_email(email_id, force_create_case=True)
            case = pipeline_res["case"]
            self.assertIsNotNone(case)
            self.assertEqual(case["category"], "LEAVE")
            case_db_id = case["db_id"]
            case_num = case["case_number"]

            # 2. Request Approval -> Advances workflow through VERIFY_BALANCE (executes Darwinbox EMPLOYEE_LOOKUP + GET_LEAVE_BALANCE)
            #    and ROUTE_MANAGER
            app_req = request_approval(
                case_identifier=case_db_id,
                approval_type="MANAGER_APPROVAL",
                approver="Amit Kumar",
                performed_by="Vaibhav (HR)",
            )
            self.assertEqual(app_req["status"], "PENDING")

            # 3. Manager Approves -> Triggers APPROVE_LEAVE transition -> Executes CREATE_LEAVE in Darwinbox!
            dec_res = decide_approval(
                app_req["id"],
                decision="APPROVED",
                comments="Approved casual leave",
                performed_by="Amit Kumar",
            )
            self.assertEqual(dec_res["approval"]["status"], "APPROVED")
            if dec_res.get("workflow"):
                self.assertEqual(dec_res["workflow"]["current_state"], "HRMS_UPDATED")

            # 4. Verify Darwinbox actions were executed and recorded with external references
            case_actions = list_hr_actions(case_id=case_db_id)
            action_types = {a["action_type"] for a in case_actions}
            self.assertIn("EMPLOYEE_LOOKUP", action_types)
            self.assertIn("GET_LEAVE_BALANCE", action_types)
            self.assertIn("CREATE_LEAVE", action_types)

            create_leave_act = next(a for a in case_actions if a["action_type"] == "CREATE_LEAVE")
            self.assertEqual(create_leave_act["status"], "SUCCESS")
            self.assertEqual(create_leave_act["provider"], "darwinbox")
            self.assertTrue(create_leave_act["external_reference"].startswith("DBX-LV-"))

            # 5. Verify External API Audit Trail recorded WHO, WHAT, WHEN, CASE, EMPLOYEE, PROVIDER, REQUEST ID, EXTERNAL ID, RESULT
            ext_audits = list_external_api_audits(case_id=case_db_id)
            self.assertTrue(len(ext_audits) >= 3)
            self.assertTrue(all(a["request_id"].startswith("REQ-") for a in ext_audits))

            # 6. Resolve Case & Verify Case Timeline contains EXTERNAL_ACTION_EXECUTED and EXTERNAL_REFERENCE_RECEIVED
            resolve_case(case_num, resolution_note="Leave created in Darwinbox", resolution_type="APPROVED", performed_by="Vaibhav (HR)")
            detail = get_full_case_detail(case_num)
            timeline_actions = [ev["action"] for ev in detail["timeline"]]
            self.assertIn("EXTERNAL_ACTION_EXECUTED", timeline_actions)
            self.assertIn("EXTERNAL_REFERENCE_RECEIVED", timeline_actions)
            self.assertIn("CASE_RESOLVED", timeline_actions)
        finally:
            if case_db_id:
                execute_query("DELETE FROM external_api_audits WHERE case_id = ?", (case_db_id,), commit=True)
                execute_query("DELETE FROM hr_actions WHERE case_id = ?", (case_db_id,), commit=True)
                execute_query("DELETE FROM approvals WHERE case_id = ?", (case_db_id,), commit=True)
                execute_query("DELETE FROM workflow_instances WHERE case_id = ?", (case_db_id,), commit=True)
                execute_query("DELETE FROM notifications WHERE case_id = ?", (case_db_id,), commit=True)
            clear_all_predefined_workflows(keep_category=None)
            execute_query("DELETE FROM case_field_values WHERE email_id = ?", (email_id,), commit=True)
            execute_query("DELETE FROM cases WHERE email_id = ?", (email_id,), commit=True)
            execute_query("DELETE FROM emails WHERE id = ?", (email_id,), commit=True)


if __name__ == "__main__":
    unittest.main()
