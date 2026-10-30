"""
HR FLOW — Unit Tests for Inbound Domain Automation & 3-Step Lifecycle
(backend/tests/test_domain_automation_and_stepper.py)
Verifies:
  1. Internal corporate domain (@1mg.com) auto-trust & READY status
  2. External sender (@gmail.com) without Employee ID -> ON_HOLD & Auto Clarification Email
  3. External sender with Employee ID -> Extracted & READY status
  4. Subsequent thread reply providing Employee ID unlocks case from ON_HOLD -> READY
"""

import unittest
import uuid
from flask import Flask
from backend.database.init_db import initialize_database
from backend.database.connection import get_connection
from backend.api.agent_routes import AGENT_HRMS_ACTIONS_CATALOG, agent_bp
from backend.services.cases.case_engine import (
    is_internal_company_domain,
    create_or_update_case_for_email,
)


class TestDomainAutomationAndPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize_database()

    def setUp(self):
        self.conn = get_connection()
        self.created_email_ids = []
        self.created_case_ids = []

    def tearDown(self):
        try:
            for cid in self.created_case_ids:
                self.conn.execute("DELETE FROM case_communications WHERE case_id = ?", (cid,))
                self.conn.execute("DELETE FROM case_field_values WHERE case_id = ?", (cid,))
                self.conn.execute("DELETE FROM workflow_instances WHERE case_id = ?", (cid,))
                self.conn.execute("DELETE FROM tasks WHERE case_id = ?", (cid,))
                self.conn.execute("DELETE FROM audit_logs WHERE entity_type = 'CASE' AND entity_id = ?", (str(cid),))
                self.conn.execute("DELETE FROM cases WHERE id = ?", (cid,))
            for eid in self.created_email_ids:
                self.conn.execute("DELETE FROM audit_logs WHERE entity_type = 'EMAIL' AND entity_id = ?", (str(eid),))
                self.conn.execute("DELETE FROM emails WHERE id = ?", (eid,))
            self.conn.execute("DELETE FROM employees WHERE employee_id IN ('EMP7788', 'EMP1099') OR employee_id LIKE 'APRT%' OR email LIKE '%external@gmail.com' OR email LIKE '%apprentice%'")
            self.conn.commit()
        finally:
            self.conn.close()

    def test_01_is_internal_company_domain_helper(self):
        """Verify @1mg.com detection for corporate staff vs personal accounts."""
        self.assertTrue(is_internal_company_domain("rahul.sharma@1mg.com"))
        self.assertTrue(is_internal_company_domain("Rahul Sharma <rahul.sharma@1mg.com>"))
        self.assertTrue(is_internal_company_domain("hr-ops@internal.1mg.com"))
        self.assertFalse(is_internal_company_domain("rahul.sharma@gmail.com"))
        self.assertFalse(is_internal_company_domain("rahul.1mg.com@yahoo.com"))
        self.assertFalse(is_internal_company_domain(None))
        self.assertFalse(is_internal_company_domain(""))

    def test_02_internal_1mg_corporate_auto_trust(self):
        """Corporate @1mg.com senders must be auto-trusted without requiring explicit employee ID entry."""
        msg_id = f"test-1mg-{uuid.uuid4().hex[:8]}"
        cur = self.conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body, is_actionable)
            VALUES ('gmail', ?, 'Anjali Gupta', 'anjali.gupta@1mg.com', 'Leave Balance Query', 'Please confirm my remaining annual leave balance.', 1)
            """,
            (msg_id,),
        )
        email_id = cur.lastrowid
        self.created_email_ids.append(email_id)
        self.conn.commit()

        email_row = {
            "id": email_id,
            "sender_name": "Anjali Gupta",
            "sender_email": "anjali.gupta@1mg.com",
            "subject": "Leave Balance Query",
            "body": "Please confirm my remaining annual leave balance.",
            "is_actionable": 1,
            "account_email": "peopledesk@1mg.com",
        }
        employee_match = {"status": "NOT_FOUND", "employee": None, "extracted": {}}
        category_result = {"category": "LEAVE", "requires_review": False, "confidence": 0.95}
        intent_result = {"status": "CLASSIFIED", "id": "LEAVE_BALANCE", "name": "Check Leave Balance"}
        extracted_fields = {"fields": {}}
        validation_result = {"status": "READY", "field_checks": []}

        case = create_or_update_case_for_email(
            email_row=email_row,
            employee_match=employee_match,
            category_result=category_result,
            intent_result=intent_result,
            extracted_fields=extracted_fields,
            validation_result=validation_result,
        )

        self.assertIsNotNone(case)
        self.created_case_ids.append(case["db_id"])
        self.assertEqual(case["status"], "READY", "Corporate @1mg.com senders must be set to READY immediately")

    def test_03_external_sender_without_employee_id_triggers_on_hold_and_clarification(self):
        """External senders (@gmail.com) without an Employee ID must be put ON_HOLD and sent clarification email."""
        msg_id = f"test-ext-noid-{uuid.uuid4().hex[:8]}"
        cur = self.conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body, is_actionable)
            VALUES ('gmail', ?, 'Vikram Seth', 'vikram.seth.personal@gmail.com', 'Salary credit missing for September', 'Hi HR, I have not received my September salary. Please help.', 1)
            """,
            (msg_id,),
        )
        email_id = cur.lastrowid
        self.created_email_ids.append(email_id)
        self.conn.commit()

        email_row = {
            "id": email_id,
            "sender_name": "Vikram Seth",
            "sender_email": "vikram.seth.personal@gmail.com",
            "subject": "Salary credit missing for September",
            "body": "Hi HR, I have not received my September salary. Please help.",
            "is_actionable": 1,
            "account_email": "peopledesk@1mg.com",
        }
        employee_match = {"status": "NOT_FOUND", "employee": None, "extracted": {}}
        category_result = {"category": "PAYROLL", "requires_review": False, "confidence": 0.95}
        intent_result = {"status": "CLASSIFIED", "id": "SALARY_MISSING", "name": "Salary Not Credited"}
        extracted_fields = {"fields": {}}
        validation_result = {"status": "READY", "field_checks": []}

        case = create_or_update_case_for_email(
            email_row=email_row,
            employee_match=employee_match,
            category_result=category_result,
            intent_result=intent_result,
            extracted_fields=extracted_fields,
            validation_result=validation_result,
        )

        self.assertIsNotNone(case)
        self.created_case_ids.append(case["db_id"])
        self.assertEqual(case["status"], "ON_HOLD", "External sender without employee ID must be held ON_HOLD")

        # Verify clarification record exists in case_communications
        comm = self.conn.execute(
            "SELECT * FROM case_communications WHERE case_id = ? AND comm_type = 'AWAITING_EMP_ID_CLARIFICATION'",
            (case["db_id"],),
        ).fetchone()
        self.assertIsNotNone(comm, "Clarification email communication must be recorded in case_communications")
        self.assertIn("Please confirm your Employee ID", comm["subject"])

    def test_03b_external_sender_with_name_and_dept_never_autogened_emp_id(self):
        """
        External sender (@gmail.com) specifying Employee Name and Department but NO Employee ID
        must NOT trigger auto-registration of a fake EMP ID, and must be set to ON_HOLD with clarification email.
        """
        from backend.services.employees.employee_service import process_email_employee_identification
        from backend.classification.ai_pipeline import process_email

        msg_id = f"test-ext-nodept-{uuid.uuid4().hex[:8]}"
        body_text = """Dear People Desk Team,
I am writing to request a correction to my attendance record for 22 October 2026.
Employee Name: Deepak Joshi
Department: IT
Date of Attendance Issue: 22 October 2026
Issue: Incorrectly marked absent"""
        cur = self.conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body, is_actionable)
            VALUES ('gmail', ?, 'Deepak Joshi', 'deepak.test.external@gmail.com', 'Request for Attendance Correction', ?, 1)
            """,
            (msg_id, body_text),
        )
        email_id = cur.lastrowid
        self.created_email_ids.append(email_id)
        self.conn.commit()

        # Step 1: Employee identification must NOT invent an employee ID or create a DB row
        emp_match = process_email_employee_identification(email_id)
        self.assertEqual(emp_match["status"], "NOT_FOUND")
        self.assertIsNone(emp_match.get("employee"))

        created_emp = self.conn.execute(
            "SELECT id FROM employees WHERE email = 'deepak.test.external@gmail.com'"
        ).fetchone()
        self.assertIsNone(created_emp, "System must never auto-register an employee for external email without Employee ID")

        # Step 2: Full processing must create an ON_HOLD case with clarification email
        res = process_email(email_id, force_create_case=True)
        case_obj = res.get("case")
        self.assertIsNotNone(case_obj)
        self.created_case_ids.append(case_obj["db_id"])
        self.assertEqual(case_obj["status"], "ON_HOLD")

        comm = self.conn.execute(
            "SELECT * FROM case_communications WHERE case_id = ? AND comm_type = 'AWAITING_EMP_ID_CLARIFICATION'",
            (case_obj["db_id"],),
        ).fetchone()
        self.assertIsNotNone(comm, "Clarification communication must be dispatched")

    def test_04_external_sender_with_employee_id_is_ready(self):
        """External senders who explicitly provide an EMP ID in the body must proceed to READY."""
        msg_id = f"test-ext-id-{uuid.uuid4().hex[:8]}"
        cur = self.conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body, is_actionable)
            VALUES ('gmail', ?, 'Meera Nair', 'meera.personal@gmail.com', 'Tax Deduction Clarification', 'Hello Team, My Employee ID is EMP1088. Please explain the TDS deduction.', 1)
            """,
            (msg_id,),
        )
        email_id = cur.lastrowid
        self.created_email_ids.append(email_id)
        self.conn.commit()

        email_row = {
            "id": email_id,
            "sender_name": "Meera Nair",
            "sender_email": "meera.personal@gmail.com",
            "subject": "Tax Deduction Clarification",
            "body": "Hello Team, My Employee ID is EMP1088. Please explain the TDS deduction.",
            "is_actionable": 1,
            "account_email": "peopledesk@1mg.com",
        }
        employee_match = {"status": "NOT_FOUND", "employee": None, "extracted": {"employee_id": "EMP1088"}}
        category_result = {"category": "PAYROLL", "requires_review": False, "confidence": 0.95}
        intent_result = {"status": "CLASSIFIED", "id": "TDS_EXPLANATION", "name": "TDS Clarification"}
        extracted_fields = {"fields": {"employee_id": "EMP1088"}}
        validation_result = {"status": "READY", "field_checks": []}

        case = create_or_update_case_for_email(
            email_row=email_row,
            employee_match=employee_match,
            category_result=category_result,
            intent_result=intent_result,
            extracted_fields=extracted_fields,
            validation_result=validation_result,
        )

        self.assertIsNotNone(case)
        self.created_case_ids.append(case["db_id"])
        self.assertEqual(case["status"], "READY", "External sender with extracted EMP ID must proceed to READY")

    def test_05_thread_reply_with_emp_id_unlocks_on_hold_case(self):
        """When an employee replies with their Employee ID on an ON_HOLD case thread, the case must unlock to READY."""
        thread_key = f"thread-karan-{uuid.uuid4().hex[:6]}"
        msg_id1 = f"test-thread-orig-{uuid.uuid4().hex[:8]}"
        cur = self.conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body, is_actionable, thread_id)
            VALUES ('gmail', ?, 'Karan Patel', 'karan.patel.personal@gmail.com', 'PF Transfer Status', 'Inquiring about my PF transfer.', 1, ?)
            """,
            (msg_id1, thread_key),
        )
        orig_email_id = cur.lastrowid
        self.created_email_ids.append(orig_email_id)
        self.conn.commit()

        orig_email_row = {
            "id": orig_email_id,
            "sender_name": "Karan Patel",
            "sender_email": "karan.patel.personal@gmail.com",
            "subject": "PF Transfer Status",
            "body": "Inquiring about my PF transfer.",
            "is_actionable": 1,
            "thread_id": thread_key,
            "account_email": "peopledesk@1mg.com",
        }
        case = create_or_update_case_for_email(
            email_row=orig_email_row,
            employee_match={"status": "NOT_FOUND", "employee": None, "extracted": {}},
            category_result={"category": "PAYROLL", "requires_review": False, "confidence": 0.95},
            intent_result={"status": "CLASSIFIED", "id": "PF_INQUIRY", "name": "PF Inquiry"},
            extracted_fields={"fields": {}},
            validation_result={"status": "READY", "field_checks": []},
        )
        self.assertIsNotNone(case)
        self.created_case_ids.append(case["db_id"])
        self.assertEqual(case["status"], "ON_HOLD")

        # Inbound reply containing Employee ID
        msg_id2 = f"test-thread-reply-{uuid.uuid4().hex[:8]}"
        cur2 = self.conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body, is_actionable, thread_id)
            VALUES ('gmail', ?, 'Karan Patel', 'karan.patel.personal@gmail.com', 'Re: Action Required: Please confirm your Employee ID', 'My official Employee ID is EMP1099 and department is Engineering.', 1, ?)
            """,
            (msg_id2, thread_key),
        )
        reply_email_id = cur2.lastrowid
        self.created_email_ids.append(reply_email_id)
        self.conn.commit()

        reply_email_row = {
            "id": reply_email_id,
            "sender_name": "Karan Patel",
            "sender_email": "karan.patel.personal@gmail.com",
            "subject": f"Re: Action Required: Please confirm your Employee ID — Case #{case['case_number']}",
            "body": "My official Employee ID is EMP1099 and department is Engineering.",
            "is_actionable": 1,
            "thread_id": thread_key,
            "account_email": "peopledesk@1mg.com",
        }

        unlocked_case = create_or_update_case_for_email(
            email_row=reply_email_row,
            employee_match={"status": "NOT_FOUND", "employee": None, "extracted": {"employee_id": "EMP1099"}},
            category_result={"category": "PAYROLL", "requires_review": False, "confidence": 0.95},
            intent_result={"status": "CLASSIFIED", "id": "PF_INQUIRY", "name": "PF Inquiry"},
            extracted_fields={"fields": {"employee_id": "EMP1099"}},
            validation_result={"status": "READY", "field_checks": []},
        )

        self.assertIsNotNone(unlocked_case)
        self.assertEqual(unlocked_case["db_id"], case["db_id"], "Reply must correlate to the existing case")
        self.assertEqual(unlocked_case["status"], "READY", "Case must be unlocked from ON_HOLD to READY upon receiving Employee ID")

    def test_05b_attendance_thread_reply_updates_emp_and_preserves_category(self):
        """
        When an external user sends an Attendance inquiry without Employee ID,
        system sends clarification in-thread, and upon reply with Employee ID:
        1. Preserves original ATTENDANCE category and intent
        2. Updates employee_id with the reply ID
        3. Unlocks case to READY
        """
        from backend.classification.ai_pipeline import process_email

        thread_key = f"thread-att-{uuid.uuid4().hex[:6]}"
        msg_id_orig = f"test-att-orig-{uuid.uuid4().hex[:8]}"
        orig_body = """Dear People Desk Team,
I am writing to request a correction to my attendance record for 22 October 2026.
Employee Name: Suresh Raina
Department: IT
Date of Attendance Issue: 22 October 2026
Issue: Incorrectly marked absent"""

        cur = self.conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body, is_actionable, thread_id)
            VALUES ('gmail', ?, 'Suresh Raina', 'suresh.external@gmail.com', 'Request for Attendance Correction – 22 October 2026', ?, 1, ?)
            """,
            (msg_id_orig, orig_body, thread_key),
        )
        orig_eid = cur.lastrowid
        self.created_email_ids.append(orig_eid)
        self.conn.commit()

        # Step 1: Initial email processed -> Case ON_HOLD with ATTENDANCE category
        res1 = process_email(orig_eid, force_create_case=True)
        case1 = res1["case"]
        self.assertIsNotNone(case1)
        self.created_case_ids.append(case1["db_id"])
        self.assertEqual(case1["status"], "ON_HOLD")
        self.assertEqual(case1["category"], "ATTENDANCE")

        # Step 2: Inbound reply email in same thread with Employee ID
        msg_id_reply = f"test-att-reply-{uuid.uuid4().hex[:8]}"
        reply_body = f"""EMP7788

On Sat, Oct 24, 2026 at 10:30 AM HR Flow Operations wrote:
> Action Required: Please confirm your Employee ID [#{case1['case_number']}]"""

        cur2 = self.conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body, is_actionable, thread_id)
            VALUES ('gmail', ?, 'Suresh Raina', 'suresh.external@gmail.com', ?, ?, 1, ?)
            """,
            (msg_id_reply, f"Re: Request for Attendance Correction – 22 October 2026 [#{case1['case_number']}]", reply_body, thread_key),
        )
        reply_eid = cur2.lastrowid
        self.created_email_ids.append(reply_eid)
        self.conn.commit()

        # Step 3: Process the reply email
        res2 = process_email(reply_eid, force_create_case=True)
        case2 = res2["case"]
        self.assertIsNotNone(case2)
        self.assertEqual(case2["db_id"], case1["db_id"], "Reply must update the original case, not create a new one")
        self.assertEqual(case2["status"], "READY", "Status must unlock to READY upon employee ID reply")
        self.assertEqual(case2["category"], "ATTENDANCE", "Category must remain ATTENDANCE, not be hijacked by reply subject")
        self.assertEqual(case2["employee_id"], "EMP7788", "Employee ID must be updated with the reply ID")

    def test_06_consolidated_3_step_pipeline_progression(self):
        """Verify the 3-step lifecycle helper computes step 1, 2, and 3 correctly with total_steps = 3."""
        from backend.api.agent_routes import _compute_workflow_step_number, WORKFLOW_STAGES

        self.assertEqual(len(WORKFLOW_STAGES), 3, "Workflow stages must have exactly 3 consolidated steps")
        self.assertEqual(WORKFLOW_STAGES[0]["code"], "DETAILS_DOSSIER")
        self.assertEqual(WORKFLOW_STAGES[1]["code"], "AUDIT_SECTION")
        self.assertEqual(WORKFLOW_STAGES[2]["code"], "RESPONSE_RESOLUTION")

        # Step 1: Details & Dossier
        self.assertEqual(_compute_workflow_step_number("DETAILS_DOSSIER", "NEW"), 1)
        self.assertEqual(_compute_workflow_step_number("INTAKE_TRIAGE", "READY"), 1)

        # Step 2: Audit Section (Checklist, HRMS checks, approvals)
        self.assertEqual(_compute_workflow_step_number("AUDIT_SECTION", "IN_PROGRESS"), 2)
        self.assertEqual(_compute_workflow_step_number("DOC_VERIFICATION", "IN_PROGRESS"), 2)
        self.assertEqual(_compute_workflow_step_number("HRMS_ACTION_APPROVAL", "IN_PROGRESS"), 2)
        self.assertEqual(_compute_workflow_step_number(None, "ON_HOLD"), 2)

        # Step 3: Response & Resolution
        self.assertEqual(_compute_workflow_step_number("RESPONSE_RESOLUTION", "IN_PROGRESS"), 3)
        self.assertEqual(_compute_workflow_step_number("READY_FOR_RESOLUTION", "IN_PROGRESS"), 3)
        self.assertEqual(_compute_workflow_step_number("RESOLVED", "RESOLVED"), 3)

    def test_07_resolve_action_with_forensic_proof(self):
        """Verify resolving a query with forensic proof (UTR, adjustment, notes) locks proof permanently."""
        from backend.api.agent_routes import agent_bp
        from flask import Flask

        app = Flask(__name__)
        app.register_blueprint(agent_bp, url_prefix="/api/agent")
        client = app.test_client()

        # Create a test case
        cur = self.conn.execute(
            """
            INSERT INTO cases (case_number, title, category, status, workflow_state, priority, created_at, updated_at)
            VALUES ('CASE-999901', 'September Salary Arrears Dispute', 'PAYROLL', 'IN_PROGRESS', 'AUDIT_SECTION', 'HIGH', '2026-10-22T10:00:00Z', '2026-10-22T10:00:00Z')
            """
        )
        case_id = cur.lastrowid
        self.created_case_ids.append(case_id)
        self.conn.commit()

        # Submit RESOLVE action with Forensic Proof
        res = client.post(
            "/api/agent/cases/CASE-999901/action",
            json={
                "action_type": "RESOLVE",
                "resolution_type": "SALARY_CREDITED",
                "reference_id": "UTR98210492817",
                "adjustment_amount": "₹ 4,500.00",
                "resolution_notes": "Verified biometric punch logs in Truein gateway. Punch regularized in HRMS ledger. Arrears processed.",
                "performed_by": "Vaibhav Yadav",
                "notify_employee": False
            }
        )
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))

        # Verify case fields in database
        updated = self.conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
        self.assertEqual(updated["status"], "RESOLVED")
        self.assertEqual(updated["resolution_type"], "SALARY_CREDITED")
        self.assertEqual(updated["resolved_by"], "Vaibhav Yadav")
        self.assertIn("UTR98210492817", updated["resolution_notes"])
        self.assertIn("₹ 4,500.00", updated["resolution_notes"])

        # Verify step is 3/3
        from backend.api.agent_routes import _compute_workflow_step_number
        step = _compute_workflow_step_number(updated["workflow_state"], updated["status"])
        self.assertEqual(step, 3, "Resolved case must be at Step 3 of 3")

    def test_08_multi_department_diagnostic_catalog_and_it_resolution(self):
        """Verify the multi-department action catalog and IT access provisioning resolution."""
        from backend.api.agent_routes import AGENT_HRMS_ACTIONS_CATALOG, agent_bp
        from flask import Flask

        # 1. Verify multi-department actions in catalog
        codes = [a["code"] for a in AGENT_HRMS_ACTIONS_CATALOG]
        self.assertIn("CHECK_IT_ASSET_INVENTORY", codes)
        self.assertIn("AUDIT_SSO_VPN_ACCESS", codes)
        self.assertIn("AUDIT_ERP_INVOICE", codes)
        self.assertIn("VERIFY_CONTRACT_COMPLIANCE", codes)
        self.assertIn("AUDIT_PROCUREMENT_PO", codes)

        app = Flask(__name__)
        app.register_blueprint(agent_bp, url_prefix="/api/agent")
        client = app.test_client()

        # 2. Create an IT Access case
        cur = self.conn.execute(
            """
            INSERT INTO cases (case_number, title, category, status, workflow_state, priority, created_at, updated_at)
            VALUES ('CASE-IT-8849', 'Developer VPN & AWS Cloud Access Grant', 'ASSET_IT', 'IN_PROGRESS', 'AUDIT_SECTION', 'HIGH', '2026-10-24T10:00:00Z', '2026-10-24T10:00:00Z')
            """
        )
        case_id = cur.lastrowid
        self.created_case_ids.append(case_id)
        self.conn.commit()

        # 3. Resolve with IT Ticket & SAML Auth Proof
        res = client.post(
            "/api/agent/cases/CASE-IT-8849/action",
            json={
                "action_type": "RESOLVE",
                "resolution_type": "ACCESS_PROVISIONED",
                "reference_id": "ITSM-99420-SAML",
                "adjustment_amount": "1 Dev License",
                "resolution_notes": "ActiveDirectory security group assigned. Okta SSO credentials and VPN profile verified under Zero-Trust standard.",
                "performed_by": "Nexus Specialist",
                "notify_employee": False
            }
        )
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))

        updated = self.conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
        self.assertEqual(updated["status"], "RESOLVED")
        self.assertEqual(updated["resolution_type"], "ACCESS_PROVISIONED")
        self.assertIn("ITSM-99420-SAML", updated["resolution_notes"])
        self.assertIn("1 Dev License", updated["resolution_notes"])

    def test_09_agent_creator_dynamic_action_and_dossier(self):
        """Test agent dynamically creating & executing custom diagnostics without hardcoded catalogs."""
        app = Flask(__name__)
        app.register_blueprint(agent_bp, url_prefix="/api/agent")
        client = app.test_client()

        cur = self.conn.execute(
            """
            INSERT INTO cases (case_number, title, category, status, workflow_state, priority, created_at, updated_at)
            VALUES ('CASE-DYN-101', 'Multi-Cloud Infrastructure Compliance Audit', 'IT_OPS', 'IN_PROGRESS', 'AUDIT_SECTION', 'HIGH', '2026-10-24T10:00:00Z', '2026-10-24T10:00:00Z')
            """
        )
        case_id = cur.lastrowid
        self.created_case_ids.append(case_id)
        self.conn.commit()

        # 1. Agent creates and executes dynamic custom check
        res = client.post(
            "/api/agent/cases/CASE-DYN-101/action",
            json={
                "action_type": "CREATE_AND_EXECUTE_ACTION",
                "title": "Audit AWS S3 Bucket Object Lock & Encryption",
                "provider": "AWS S3 CloudTrail",
                "details": "Bucket encryption set to SSE-KMS; WORM retention lock enabled for 7 years.",
                "risk_level": "LOW",
                "reference_id": "AWS-LOG-883192",
                "performed_by": "Security Auditor"
            }
        )
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        act_res = data.get("action_result")
        self.assertIsNotNone(act_res)
        self.assertEqual(act_res.get("title"), "Audit AWS S3 Bucket Object Lock & Encryption")
        self.assertEqual(act_res.get("provider"), "AWS S3 CloudTrail")
        self.assertEqual(act_res.get("external_reference"), "AWS-LOG-883192")

        # 2. Check detail context returns the action with parsed response
        dossier_res = client.get("/api/agent/cases/CASE-DYN-101/detail")
        self.assertEqual(dossier_res.status_code, 200)
        dossier_data = dossier_res.get_json()["data"]
        actions = dossier_data.get("hr_actions", [])
        self.assertGreaterEqual(len(actions), 1)
        found = next((a for a in actions if a.get("provider") == "AWS S3 CloudTrail"), None)
        self.assertIsNotNone(found)
        self.assertEqual(found.get("title"), "Audit AWS S3 Bucket Object Lock & Encryption")
        self.assertIn("WORM retention lock enabled", found.get("details", ""))

    def test_10_dynamic_workflow_stages_and_clean_slate(self):
        """Test adding dynamic stages to case pipeline and clean slate without fake tasks."""
        app = Flask(__name__)
        app.register_blueprint(agent_bp, url_prefix="/api/agent")
        client = app.test_client()

        cur = self.conn.execute(
            """
            INSERT INTO cases (case_number, title, category, status, workflow_state, priority, created_at, updated_at)
            VALUES ('CASE-STG-200', 'Enterprise Zero-Trust Network Transition', 'SECURITY_IT', 'IN_PROGRESS', 'AUDIT_SECTION', 'HIGH', '2026-10-24T10:00:00Z', '2026-10-24T10:00:00Z')
            """
        )
        case_id = cur.lastrowid
        self.created_case_ids.append(case_id)
        self.conn.commit()

        # 1. Detail must have clean slate (tasks is empty list, no hardcoded auto-seeding)
        res = client.get("/api/agent/cases/CASE-STG-200/detail")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()["data"]
        self.assertEqual(len(data.get("tasks", [])), 0, "Tasks must be empty clean slate!")
        self.assertEqual(data.get("case", {}).get("total_steps"), 3)

        # 2. Add custom stage: Security Review Gate
        add_res = client.post(
            "/api/agent/cases/CASE-STG-200/action",
            json={
                "action_type": "ADD_STAGE",
                "label": "Zero-Trust Security & Keycard Provisioning",
                "description": "Inspect perimeter firewall, hardware keycard allocation and SAML tokens",
                "stage_type": "SECURITY_GATE",
                "performed_by": "Lead SecOps Engineer"
            }
        )
        self.assertEqual(add_res.status_code, 200)
        add_data = add_res.get_json()["data"]
        updated_stages = add_data["case"]["workflow_stages"]
        self.assertEqual(len(updated_stages), 4, "Total stages should now be 4!")
        # Security stage inserted before resolution
        self.assertEqual(updated_stages[2]["label"], "3. Zero-Trust Security & Keycard Provisioning")
        self.assertEqual(updated_stages[3]["label"], "4. Response & Resolution")

        # 3. Transition to Step 3 (the new dynamic stage)
        step_res = client.post(
            "/api/agent/cases/CASE-STG-200/action",
            json={
                "action_type": "SET_STEP",
                "step": 3,
                "performed_by": "SecOps Engineer"
            }
        )
        self.assertEqual(step_res.status_code, 200)
        step_data = step_res.get_json()["data"]
        self.assertEqual(step_data["case"]["current_step"], 3)
        self.assertEqual(step_data["case"]["total_steps"], 4)

        # 4. Add dynamic compliance task
        task_res = client.post(
            "/api/agent/cases/CASE-STG-200/action",
            json={
                "action_type": "ADD_TASK",
                "title": "Inspect hardware YubiKey serial & cryptographic hash",
                "performed_by": "SecOps Engineer"
            }
        )
        self.assertEqual(task_res.status_code, 200)

        # Verify task is returned in dossier
        dossier_res = client.get("/api/agent/cases/CASE-STG-200/detail")
        self.assertEqual(dossier_res.status_code, 200)
        d_tasks = dossier_res.get_json()["data"]["tasks"]
        self.assertEqual(len(d_tasks), 1)
        self.assertEqual(d_tasks[0]["title"], "Inspect hardware YubiKey serial & cryptographic hash")
        self.assertEqual(d_tasks[0]["status"], "PENDING")

        # 5. Toggle the task to COMPLETED
        t_id = d_tasks[0]["id"]
        toggle_res = client.post(
            "/api/agent/cases/CASE-STG-200/action",
            json={
                "action_type": "TOGGLE_TASK",
                "task_id": t_id,
                "performed_by": "SecOps Engineer"
            }
        )
        self.assertEqual(toggle_res.status_code, 200)

        # 6. Delete dynamic stage (step 3)
        del_res = client.post(
            "/api/agent/cases/CASE-STG-200/action",
            json={
                "action_type": "DELETE_STAGE",
                "step": 3,
                "performed_by": "SecOps Engineer"
            }
        )
        self.assertEqual(del_res.status_code, 200)
        del_data = del_res.get_json()["data"]
        re_stages = del_data["case"]["workflow_stages"]
        self.assertEqual(len(re_stages), 3)
        self.assertEqual(del_data["case"]["total_steps"], 3)
        self.assertEqual(re_stages[2]["label"], "3. Response & Resolution")

    def test_universal_prefix_extraction_aprt_1mg_con_int(self):
        """Universal employee extractor must support APRT, 1MG, EMP, INT, CON, etc."""
        from backend.services.employees.employee_extractor import extract_employee_id
        
        # APRT prefix variants
        self.assertEqual(extract_employee_id("APRT1024"), "APRT1024")
        self.assertEqual(extract_employee_id("APRT-0042"), "APRT0042")
        self.assertEqual(extract_employee_id("APRT 1042"), "APRT1042")
        self.assertEqual(extract_employee_id("My employee id is APRT5512"), "APRT5512")
        self.assertEqual(extract_employee_id("Employee Code: APRT_9901"), "APRT9901")

        # 1MG prefix variants
        self.assertEqual(extract_employee_id("1MG0023"), "1MG0023")
        self.assertEqual(extract_employee_id("1MG-0023"), "1MG0023")
        self.assertEqual(extract_employee_id("My official ID is 1MG0045"), "1MG0045")
        self.assertEqual(extract_employee_id("1MG0023\n\nOn Sun, Oct 25... wrote:"), "1MG0023")

        # Standard EMP, INT, CON, TATA
        self.assertEqual(extract_employee_id("EMP7788"), "EMP7788")
        self.assertEqual(extract_employee_id("INT009"), "INT009")
        self.assertEqual(extract_employee_id("CON-8899"), "CON8899")
        self.assertEqual(extract_employee_id("TATA9021"), "TATA9021")

        # Must ignore dates, case numbers, instructions
        self.assertIsNone(extract_employee_id("I worked on 23 October 2026 from 8:08 PM"))
        self.assertIsNone(extract_employee_id("CASE-000001 status update"))
        self.assertIsNone(extract_employee_id("Ref: (e.g. EMP1023)"))

    def test_aprt_prefix_thread_reply_unlocks_on_hold_case(self):
        """When an external apprentice replies with 'APRT1045', ON_HOLD case must unlock to READY."""
        from backend.classification.ai_pipeline import process_email
        
        thread_key = f"thread-aprt-{uuid.uuid4().hex[:6]}"
        msg_id1 = f"test-thread-orig-{uuid.uuid4().hex[:8]}"
        cur = self.conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body, is_actionable, thread_id)
            VALUES ('gmail', ?, 'Aditya Apprentice', 'aditya.apprentice@gmail.com', 'Stipend credit inquiry', 'Hi Team, I have not received my stipend for this month.', 1, ?)
            """,
            (msg_id1, thread_key),
        )
        orig_email_id = cur.lastrowid
        self.created_email_ids.append(orig_email_id)
        self.conn.commit()

        # Step 1: Ingest initial inquiry -> Must be held ON_HOLD
        res1 = process_email(orig_email_id, force_create_case=True)
        case_obj = res1.get("case")
        self.assertIsNotNone(case_obj)
        self.created_case_ids.append(case_obj["db_id"])
        self.assertEqual(case_obj["status"], "ON_HOLD")

        # Step 2: Inbound reply providing 'APRT1045'
        msg_id2 = f"test-thread-reply-{uuid.uuid4().hex[:8]}"
        cur2 = self.conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body, is_actionable, thread_id)
            VALUES ('gmail', ?, 'Aditya Apprentice', 'aditya.apprentice@gmail.com', ?, 'My official Employee ID is APRT1045 and department is Operations.', 1, ?)
            """,
            (msg_id2, f"Re: Action Required: Please confirm your Employee ID — Case #{case_obj['case_number']}", thread_key),
        )
        reply_email_id = cur2.lastrowid
        self.created_email_ids.append(reply_email_id)
        self.conn.commit()

        res2 = process_email(reply_email_id, force_create_case=True)
        unlocked_case = res2.get("case")
        self.assertIsNotNone(unlocked_case)
        self.assertEqual(unlocked_case["db_id"], case_obj["db_id"])
        self.assertEqual(unlocked_case["status"], "READY", "APRT prefix must unlock case from ON_HOLD to READY")
        self.assertEqual(unlocked_case["employee_code"], "APRT1045")

    def test_10_24h_policy_auto_close_and_reopen(self):
        """Verify 24h expiration auto-closure and <24h reply auto-reopening."""
        from datetime import datetime, timezone, timedelta
        from backend.services.cases.case_service import check_and_auto_close_resolved_cases
        from backend.classification.ai_pipeline import process_email

        thread_key = f"thread-24h-{uuid.uuid4().hex[:6]}"
        msg_id1 = f"test-24h-orig-{uuid.uuid4().hex[:8]}"
        cur = self.conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body, is_actionable, thread_id)
            VALUES ('gmail', ?, 'Test Policy User', 'policy.user@1mg.com', 'Shift regularize', 'Please fix my shift punch.', 1, ?)
            """,
            (msg_id1, thread_key),
        )
        orig_id = cur.lastrowid
        self.created_email_ids.append(orig_id)
        self.conn.commit()

        res1 = process_email(orig_id, force_create_case=True)
        c_obj = res1["case"]
        cid = c_obj["db_id"]
        self.created_case_ids.append(cid)

        # 1. Resolve case now (0 hours elapsed)
        now_utc = datetime.now(timezone.utc)
        now_str = now_utc.strftime("%Y-%m-%d %H:%M:%S")
        self.conn.execute(
            "UPDATE cases SET status = 'RESOLVED', workflow_state = 'RESOLVED', resolved_at = ? WHERE id = ?",
            (now_str, cid),
        )
        self.conn.commit()

        # Run auto-close check: should NOT close because 0h < 24h
        closed_cnt = check_and_auto_close_resolved_cases()
        r = self.conn.execute("SELECT status FROM cases WHERE id = ?", (cid,)).fetchone()
        self.assertEqual(r["status"], "RESOLVED", "Recent resolved ticket must NOT be auto-closed")

        # 2. Inbound reply received within 24h -> Must auto-reopen to IN_PROGRESS at Step 2 (AUDIT_SECTION)
        msg_id_reply = f"test-24h-reply-{uuid.uuid4().hex[:8]}"
        cur_rep = self.conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body, is_actionable, thread_id)
            VALUES ('gmail', ?, 'Test Policy User', 'policy.user@1mg.com', ?, 'I still have a question about this.', 1, ?)
            """,
            (msg_id_reply, f"Re: Shift regularize [CASE #{c_obj['case_number']}]", thread_key),
        )
        rep_id = cur_rep.lastrowid
        self.created_email_ids.append(rep_id)
        self.conn.commit()

        res_rep = process_email(rep_id, force_create_case=True)
        reopened = res_rep["case"]
        self.assertEqual(reopened["status"], "IN_PROGRESS")
        self.assertEqual(reopened["workflow_state"], "AUDIT_SECTION")

        # 3. Resolve again, but back-date resolved_at to 26 hours ago
        past_str = (now_utc - timedelta(hours=26)).strftime("%Y-%m-%d %H:%M:%S")
        self.conn.execute(
            "UPDATE cases SET status = 'RESOLVED', workflow_state = 'RESOLVED', resolved_at = ? WHERE id = ?",
            (past_str, cid),
        )
        self.conn.commit()

        # Run auto-close check: MUST permanently close!
        closed_cnt2 = check_and_auto_close_resolved_cases()
        self.assertGreaterEqual(closed_cnt2, 1)
        r2 = self.conn.execute("SELECT status, workflow_state, closed_by FROM cases WHERE id = ?", (cid,)).fetchone()
        self.assertEqual(r2["status"], "CLOSED")
        self.assertEqual(r2["workflow_state"], "CLOSED")
        self.assertIn("24h Inactivity", r2["closed_by"])

    def test_11_24h_simulation_endpoints(self):
        """Verify workbench simulation actions SIMULATE_24H_REPLY and FORCE_24H_AUTO_CLOSE."""
        app = Flask(__name__)
        app.register_blueprint(agent_bp, url_prefix="/api/agent")
        client = app.test_client()

        thread_key = f"thread-sim-{uuid.uuid4().hex[:6]}"
        cur = self.conn.execute(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body, is_actionable, thread_id)
            VALUES ('gmail', 'msg-sim-orig', 'Sim Tester', 'sim@1mg.com', 'Sim test case', 'Original content', 1, ?)
            """,
            (thread_key,),
        )
        eid = cur.lastrowid
        self.created_email_ids.append(eid)
        self.conn.commit()

        from backend.classification.ai_pipeline import process_email
        res1 = process_email(eid, force_create_case=True)
        c_obj = res1["case"]
        cid = c_obj["db_id"]
        c_num = c_obj["case_number"]
        self.created_case_ids.append(cid)

        # Set to RESOLVED
        self.conn.execute(
            "UPDATE cases SET status = 'RESOLVED', workflow_state = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
            (cid,),
        )
        self.conn.commit()

        # 1. Call SIMULATE_24H_REPLY
        resp1 = client.post(
            f"/api/agent/cases/{c_num}/action",
            json={"action_type": "SIMULATE_24H_REPLY", "reply_text": "Clarification needed."},
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(resp1.status_code, 200)
        d1 = resp1.get_json()["data"]
        self.assertEqual(d1["case"]["status"], "IN_PROGRESS")
        self.assertEqual(d1["case"]["workflow_state"], "AUDIT_SECTION")

        # Set back to RESOLVED
        self.conn.execute(
            "UPDATE cases SET status = 'RESOLVED', workflow_state = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
            (cid,),
        )
        self.conn.commit()

        # 2. Call FORCE_24H_AUTO_CLOSE
        resp2 = client.post(
            f"/api/agent/cases/{c_num}/action",
            json={"action_type": "FORCE_24H_AUTO_CLOSE"},
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(resp2.status_code, 200)
        d2 = resp2.get_json()["data"]
        self.assertEqual(d2["case"]["status"], "CLOSED")
        self.assertEqual(d2["case"]["workflow_state"], "CLOSED")
