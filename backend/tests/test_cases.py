"""
HR Flow - Phase 6 & Phase 7.28 Case Management, SLA, Permissions, Resolution/Closure/Reopen Tests
"""

import unittest
from backend.database.init_db import initialize_database
from backend.database.db import execute_query
from backend.services.classification.ai_pipeline import process_email
from backend.models.case import list_cases
from backend.services.cases.case_service import (
    get_full_case_detail,
    get_operational_metrics,
    assign_case,
    update_case_priority,
    update_case_category,
    update_case_extracted_fields,
    request_missing_information,
    add_or_update_case_document,
    add_case_communication,
    resolve_case,
    close_case,
    reopen_case,
    check_role_permission,
    list_notifications,
)
from backend.models.audit_log import list_audit_logs


class TestPhase7CaseOperations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize_database()

    @classmethod
    def tearDownClass(cls):
        execute_query("DELETE FROM employees WHERE employee_id IN ('EMP1023', 'EMP1024')", commit=True)

    def setUp(self):
        self.email_id = execute_query(
            """
            INSERT INTO emails (provider_message_id, sender_name, sender_email, subject, body, received_at, processing_status)
            VALUES ('TEST-CASE-P7-01', 'Rahul Sharma', 'rahul.sharma@company.com',
                    'Leave request from 2026-04-01 to 2026-04-03',
                    'Employee ID: EMP1023\nPlease grant casual leave from 2026-04-01 to 2026-04-03 due to personal work.',
                    '2026-04-01T09:00:00', 'RECEIVED')
            """,
            commit=True,
        )

    def tearDown(self):
        execute_query("DELETE FROM cases WHERE email_id = ?", (self.email_id,), commit=True)
        execute_query("DELETE FROM emails WHERE id = ?", (self.email_id,), commit=True)

    def test_01_case_deduplication_and_detail_view(self):
        res1 = process_email(self.email_id, force_create_case=True)
        res2 = process_email(self.email_id, force_create_case=True)
        c1 = res1["case"]
        c2 = res2["case"]
        self.assertEqual(c1["case_number"], c2["case_number"])

        detail = get_full_case_detail(c1["case_number"])
        self.assertIsNotNone(detail)
        self.assertEqual(detail["case"]["case_number"], c1["case_number"])
        self.assertIn("resolution_readiness", detail)
        self.assertIn("available_actions", detail)

    def test_02_search_filter_and_metrics(self):
        res = process_email(self.email_id, force_create_case=True)
        case_num = res["case"]["case_number"]

        found = list_cases(search=case_num)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["case_number"], case_num)

        leave_cases = list_cases(category="LEAVE")
        self.assertTrue(any(item["case_number"] == case_num for item in leave_cases))

        metrics = get_operational_metrics(current_user="Vaibhav (HR)")
        self.assertIn("my_work", metrics)
        self.assertIn("team_workload", metrics)

    def test_03_assign_reassign_and_field_editing(self):
        res = process_email(self.email_id, force_create_case=True)
        case_num = res["case"]["case_number"]

        updated = assign_case(case_num, team="Leave Operations HR", user="Ananya Iyer", performed_by="Admin", role="HR_LEAD")
        self.assertEqual(updated["assigned_team"], "Leave Operations HR")
        self.assertEqual(updated["assigned_user"], "Ananya Iyer")

        # HR_AGENT cannot reassign someone else's case
        with self.assertRaises(PermissionError):
            assign_case(case_num, team="Leave Operations HR", user="Rohan Kulkarni", performed_by="Rohan", role="HR_AGENT")

        updated_fields = update_case_extracted_fields(
            case_num,
            {"leave_type": "Sick Leave", "duration": "3 days"},
            performed_by="Ananya Iyer",
        )
        self.assertEqual(updated_fields["extracted_fields"]["leave_type"], "Sick Leave")
        self.assertEqual(updated_fields["extracted_fields"]["duration"], "3 days")

    def test_04_request_info_documents_and_communications(self):
        res = process_email(self.email_id, force_create_case=True)
        case_num = res["case"]["case_number"]

        req_res = request_missing_information(
            case_num,
            missing_items="Medical Certificate",
            message="Please share medical certificate.",
            performed_by="Ananya Iyer",
        )
        self.assertEqual(req_res["case"]["status"], "ON_HOLD")

        docs_info = add_or_update_case_document(
            case_num,
            name="Medical Certificate",
            status="RECEIVED",
            doc_type="SUPPORTING_DOCUMENT",
            uploaded_by="Ananya Iyer",
        )
        self.assertEqual(docs_info["missing_count"], 0)

        comm = add_case_communication(
            case_num,
            message="Verified certificate with doctor",
            sender_type="HR",
            sender_name="Ananya Iyer",
            comm_type="INTERNAL_NOTE",
        )
        self.assertEqual(comm["comm_type"], "INTERNAL_NOTE")

    def test_05_controlled_resolution_closure_and_reopen_rules(self):
        res = process_email(self.email_id, force_create_case=True)
        case_num = res["case"]["case_number"]

        # Cannot close before resolving!
        with self.assertRaises(ValueError):
            close_case(case_num, performed_by="Admin")

        # Resolve case
        resolved = resolve_case(
            case_num,
            resolution_note="Leave approved",
            resolution_type="APPROVED",
            performed_by="Ananya Iyer",
            enforce_checks=False,
        )
        self.assertEqual(resolved["status"], "RESOLVED")
        self.assertEqual(resolved["sla_status"], "COMPLETED")

        # Close case after RESOLVED
        execute_query(
            "UPDATE cases SET validation_result = '{\"status\": \"READY\", \"missing_fields\": []}' WHERE id = ?",
            (resolved["db_id"],),
            commit=True,
        )
        closed = close_case(case_num, close_note="Completed", performed_by="Manager")
        self.assertEqual(closed["status"], "CLOSED")

        # Reopen requires non-empty reason
        with self.assertRaises(ValueError):
            reopen_case(case_num, reopen_reason="", performed_by="Manager", role="HR_MANAGER")

        # HR_AGENT cannot reopen case
        with self.assertRaises(PermissionError):
            reopen_case(case_num, reopen_reason="Need change", performed_by="Agent", role="HR_AGENT")

        # HR_MANAGER can reopen with reason
        reopened = reopen_case(case_num, reopen_reason="Employee extended leave dates", performed_by="Manager", role="HR_MANAGER")
        self.assertEqual(reopened["status"], "IN_PROGRESS")

    def test_06_permissions_notifications_and_audit_filters(self):
        self.assertTrue(check_role_permission("HR_AGENT", "resolve_case"))
        self.assertFalse(check_role_permission("HR_AGENT", "reopen_case"))
        self.assertTrue(check_role_permission("HR_LEAD", "reopen_case"))
        self.assertTrue(check_role_permission("HR_MANAGER", "escalate_case"))
        self.assertTrue(check_role_permission("ADMIN", "manage_system"))

        notifs = list_notifications(limit=10)
        self.assertIn("notifications", notifs)

        logs = list_audit_logs(entity_type="CASE", limit=20)
        self.assertIsInstance(logs, list)


if __name__ == "__main__":
    unittest.main()
