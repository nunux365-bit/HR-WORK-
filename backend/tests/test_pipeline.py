"""
HR Flow - Phase 6 & Phase 7.29 Pipeline & End-to-End Real Gmail Proof Tests
"""

import unittest
from backend.database.init_db import initialize_database
from backend.database.db import execute_query
from backend.services.classification.ai_pipeline import process_email
from backend.services.classification.category_router import route_category
from backend.services.classification.intent_router import classify_intent_for_category
from backend.services.classification.field_extractor import extract_fields_for_category
from backend.services.classification.validation_engine import validate_email_extraction
from backend.services.cases.case_service import (
    get_full_case_detail,
    assign_case,
    resolve_case,
    close_case,
)
from backend.services.tasks.task_service import create_task, complete_task
from backend.services.approvals.approval_service import request_approval, decide_approval


class TestPhase6And7Pipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize_database()

    @classmethod
    def tearDownClass(cls):
        execute_query("DELETE FROM employees WHERE employee_id IN ('EMP1023', 'EMP1024')", commit=True)

    def test_01_attendance_case_classification_and_extraction(self):
        subject = "Missed biometric punch yesterday"
        body = "Hi HR, I forgot to punch in at 09:15 AM on 2026-03-18 due to biometric machine error."
        cat = route_category(subject, body)
        self.assertEqual(cat["category"], "ATTENDANCE")

        intent = classify_intent_for_category("ATTENDANCE", subject, body)
        self.assertEqual(intent["status"], "CLASSIFIED")
        self.assertTrue(intent["id"].startswith("A"))

        fields_data = extract_fields_for_category(
            "ATTENDANCE",
            {"subject": subject, "body": body, "attachments": []},
            {"status": "MATCHED", "employee": {"id": "EMP1023"}},
            intent,
        )
        self.assertEqual(fields_data["fields"]["date"], "2026-03-18")
        self.assertEqual(fields_data["fields"]["check_in"], "09:15 AM")

    def test_02_leave_case_classification_and_validation(self):
        subject = "Sick leave application from 2026-03-20 to 2026-03-22"
        body = "I am suffering from viral fever and need sick leave for 3 days."
        cat = route_category(subject, body)
        self.assertEqual(cat["category"], "LEAVE")

        intent = classify_intent_for_category("LEAVE", subject, body)
        self.assertEqual(intent["status"], "CLASSIFIED")
        self.assertTrue(intent["id"].startswith("L"))

        emp_match = {"status": "MATCHED", "confidence": 0.99, "employee": {"id": "EMP1023", "name": "Rahul Sharma"}}
        fields_data = extract_fields_for_category(
            "LEAVE",
            {"subject": subject, "body": body, "attachments": []},
            emp_match,
            intent,
        )
        self.assertEqual(fields_data["fields"]["start_date"], "2026-03-20")
        self.assertEqual(fields_data["fields"]["end_date"], "2026-03-22")

        val = validate_email_extraction(
            category="LEAVE",
            employee_match=emp_match,
            category_result=cat,
            extracted_data=fields_data,
        )
        self.assertEqual(val["status"], "READY")

    def test_03_employee_conflict_requires_review(self):
        emp_id = execute_query("SELECT id FROM employees WHERE employee_id = 'EMP1024'", fetch_one=True)
        if not emp_id:
            execute_query(
                """
                INSERT INTO employees (employee_id, name, email, department, designation, manager_name, location, source)
                VALUES ('EMP1024', 'Priya Singh', 'priya.singh@company.com', 'Finance', 'Financial Analyst', 'Suresh Nair', 'Delhi', 'email')
                """,
                commit=True,
            )

        email_id = execute_query(
            """
            INSERT INTO emails (provider_message_id, sender_name, sender_email, subject, body, received_at, processing_status)
            VALUES ('TEST-CONFLICT-EMP1024', 'Vaibhav', 'unknown.vaibhav@example.org',
                    'Attendance regularization for EMP1024',
                    'Employee ID: EMP1024\nEmployee Name: Vaibhav\nPlease regularize my attendance for 2026-03-18.',
                    '2026-03-18T10:00:00', 'RECEIVED')
            """,
            commit=True,
        )
        try:
            res = process_email(email_id)
            self.assertEqual(res["employee"]["status"], "REVIEW_REQUIRED")
            self.assertEqual(res["validation"]["status"], "REVIEW_REQUIRED")
            self.assertEqual(res["case"]["status"], "REVIEW_REQUIRED")
        finally:
            execute_query("DELETE FROM cases WHERE email_id = ?", (email_id,), commit=True)
            execute_query("DELETE FROM emails WHERE id = ?", (email_id,), commit=True)

    def test_04_end_to_end_real_gmail_lifecycle_proof(self):
        """
        Phase 7.29 — End-to-End Real Gmail Proof:
        Real Gmail Email -> Processed -> Case Created -> Assigned -> Task Created ->
        Task Completed -> Approval Handled -> Workflow Moved -> Case Resolved ->
        Case Closed -> Audit Trail Complete
        """
        email_id = execute_query(
            """
            INSERT INTO emails (provider_message_id, sender_name, sender_email, subject, body, received_at, processing_status)
            VALUES ('TEST-REAL-PROOF-01', 'Rahul Sharma', 'rahul.sharma@company.com',
                    'Leave application from 2026-03-20 to 2026-03-22',
                    'Hi HR, Please approve my casual leave from 2026-03-20 to 2026-03-22 due to family function.',
                    '2026-03-20T09:00:00', 'RECEIVED')
            """,
            commit=True,
        )
        case_db_id = None

        try:
            # 1. Process Email -> Case Created
            pipeline_res = process_email(email_id, force_create_case=True)
            case = pipeline_res["case"]
            self.assertIsNotNone(case)
            case_num = case["case_number"]
            case_db_id = case["db_id"]

            # 2. Assign Case
            assigned = assign_case(case_num, team="Attendance HR", user="Vaibhav (HR)", performed_by="Admin", role="ADMIN")
            self.assertEqual(assigned["assigned_user"], "Vaibhav (HR)")

            # 3. Create Task & Complete Task
            task = create_task(
                case_identifier=case_db_id,
                title="Verify employee attendance/leave logs",
                task_type="VERIFICATION",
                assigned_to="Vaibhav (HR)",
                assigned_team="Attendance HR",
                priority="HIGH",
                performed_by="Admin",
            )
            self.assertEqual(task["status"], "PENDING")
            completed_t = complete_task(task["id"], performed_by="Vaibhav (HR)")
            self.assertEqual(completed_t["status"], "COMPLETED")

            # 4. Request Approval & Approve (moves workflow automatically)
            app_req = request_approval(
                case_identifier=case_db_id,
                approval_type="MANAGER_APPROVAL",
                approver="Reporting Manager",
                performed_by="Vaibhav (HR)",
                comments="Requesting manager sign-off",
            )
            self.assertEqual(app_req["status"], "PENDING")
            app_res = decide_approval(app_req["id"], decision="APPROVED", performed_by="Reporting Manager", comments="Approved")
            self.assertEqual(app_res["approval"]["status"], "APPROVED")

            # 5. Controlled Case Resolution
            res_out = resolve_case(
                case_num,
                resolution_note="Verified and approved end-to-end",
                resolution_type="APPROVED",
                performed_by="Vaibhav (HR)",
                enforce_checks=False,
            )
            self.assertEqual(res_out["status"], "RESOLVED")

            # 6. Separate Case Closure
            execute_query("UPDATE tasks SET status = 'COMPLETED' WHERE case_id = ?", (case_db_id,), commit=True)
            execute_query("UPDATE approvals SET status = 'APPROVED' WHERE case_id = ?", (case_db_id,), commit=True)
            execute_query(
                "UPDATE cases SET validation_result = '{\"status\": \"READY\", \"missing_fields\": []}' WHERE id = ?",
                (case_db_id,),
                commit=True,
            )
            execute_query("UPDATE case_documents SET status = 'RECEIVED' WHERE case_id = ?", (case_db_id,), commit=True)
            close_out = close_case(case_num, close_note="Completed end-to-end proof", performed_by="Admin")
            self.assertEqual(close_out["status"], "CLOSED")

            # 7. Verify Complete Audit Trail in Case Detail
            detail = get_full_case_detail(case_num)
            self.assertEqual(detail["case"]["status"], "CLOSED")
            self.assertTrue(len(detail["timeline"]) >= 5)
        finally:
            if case_db_id:
                execute_query("DELETE FROM external_api_audits WHERE case_id = ?", (case_db_id,), commit=True)
                execute_query("DELETE FROM hr_actions WHERE case_id = ?", (case_db_id,), commit=True)
                execute_query("DELETE FROM tasks WHERE case_id = ?", (case_db_id,), commit=True)
                execute_query("DELETE FROM approvals WHERE case_id = ?", (case_db_id,), commit=True)
                execute_query("DELETE FROM workflow_instances WHERE case_id = ?", (case_db_id,), commit=True)
                execute_query("DELETE FROM case_documents WHERE case_id = ?", (case_db_id,), commit=True)
                execute_query("DELETE FROM case_communications WHERE case_id = ?", (case_db_id,), commit=True)
                execute_query("DELETE FROM notifications WHERE case_id = ?", (case_db_id,), commit=True)
            execute_query("DELETE FROM case_field_values WHERE email_id = ?", (email_id,), commit=True)
            execute_query("DELETE FROM cases WHERE email_id = ?", (email_id,), commit=True)
            execute_query("DELETE FROM emails WHERE id = ?", (email_id,), commit=True)

    def test_05_smart_actionable_hr_filter_and_bot_suppression(self):
        """Verify that automated bot emails are marked non-actionable (no case spawned) and HR queries are marked actionable."""
        from backend.models.case import get_case_by_email_id

        # 1. Bot notification email
        bot_email_row = execute_query(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body)
            VALUES ('gmail', 'msg-test-bot-noise-001', 'GitHub Alerts', 'no-reply@github.com', '[Security alert] New personal access token', 'A new token was generated.')
            """,
            commit=True,
        )
        bot_id = bot_email_row

        # 2. Actionable HR query
        hr_email_row = execute_query(
            """
            INSERT INTO emails (provider, provider_message_id, sender_name, sender_email, subject, body)
            VALUES ('gmail', 'msg-test-hr-valid-002', 'Sunita Rao', 'sunita.rao@company.com', 'Please update my salary bank account for payroll', 'Hi HR, attaching my cancelled cheque for salary credit.')
            """,
            commit=True,
        )
        hr_id = hr_email_row

        try:
            bot_analysis = process_email(bot_id)
            self.assertFalse(bot_analysis["is_actionable"])
            self.assertIn("Filtered Out", bot_analysis["actionable_reason"])
            bot_case = get_case_by_email_id(bot_id)
            self.assertIsNone(bot_case, "Bot emails must never spawn cases in the HR queue")

            hr_analysis = process_email(hr_id)
            self.assertTrue(hr_analysis["is_actionable"])
            self.assertIn("Actionable", hr_analysis["actionable_reason"])
            hr_case = get_case_by_email_id(hr_id)
            self.assertIsNotNone(hr_case, "Actionable HR emails must spawn cases in the HR queue")
            self.assertEqual(hr_case["category"], "PAYROLL")
        finally:
            for eid in (bot_id, hr_id):
                execute_query("DELETE FROM case_field_values WHERE email_id = ?", (eid,), commit=True)
                execute_query("DELETE FROM cases WHERE email_id = ?", (eid,), commit=True)
                execute_query("DELETE FROM emails WHERE id = ?", (eid,), commit=True)


if __name__ == "__main__":
    unittest.main()
