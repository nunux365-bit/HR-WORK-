"""
HR Flow - Phase 6 & Phase 7.28 Task, Approval, and Workflow State Machine Tests
"""

import unittest
from backend.database.init_db import initialize_database
from backend.database.db import execute_query
from backend.services.classification.ai_pipeline import process_email
from backend.services.workflows.workflow_registry import list_workflows
from backend.services.workflows.workflow_engine import (
    get_or_create_workflow_instance,
    transition_workflow_state,
)
from backend.services.tasks.task_service import (
    create_task,
    complete_task,
    cancel_task,
    list_tasks,
)
from backend.services.approvals.approval_service import (
    request_approval,
    decide_approval,
)


class TestPhase7TasksApprovalsWorkflows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize_database()

    @classmethod
    def tearDownClass(cls):
        from backend.services.workflows.workflow_registry import clear_all_predefined_workflows
        clear_all_predefined_workflows(keep_category=None)
        execute_query("DELETE FROM employees WHERE employee_id IN ('EMP1023', 'EMP1024')", commit=True)

    def setUp(self):
        self.email_id = execute_query(
            """
            INSERT INTO emails (provider_message_id, sender_name, sender_email, subject, body, received_at, processing_status)
            VALUES ('TEST-WF-P7-01', 'Rahul Sharma', 'rahul.sharma@company.com',
                    'Missed attendance punch on 2026-04-02',
                    'Employee ID: EMP1023\nForgot to punch in at 09:00 AM on 2026-04-02 due to biometric issue.',
                    '2026-04-02T09:00:00', 'RECEIVED')
            """,
            commit=True,
        )
        res = process_email(self.email_id, force_create_case=True)
        self.case = res["case"]

    def tearDown(self):
        execute_query("DELETE FROM cases WHERE email_id = ?", (self.email_id,), commit=True)
        execute_query("DELETE FROM emails WHERE id = ?", (self.email_id,), commit=True)

    def test_01_workflow_registry_and_valid_transitions(self):
        # By default, all predefined workflows are cleared; only admin can create them
        workflows = list_workflows()
        self.assertEqual(len(workflows), 0)

        # Unconfigured category returns None for workflow instance
        wf_unconfigured = get_or_create_workflow_instance(self.case["db_id"], "ATTENDANCE")
        self.assertIsNone(wf_unconfigured)

        # Admin creates an attendance workflow
        from backend.services.workflows.workflow_registry import save_workflow_definition
        save_workflow_definition("ATTENDANCE", {
            "workflow_id": "WF-ATTENDANCE-001",
            "name": "Attendance Regularization",
            "states": ["ATTENDANCE_RECEIVED", "CLOSED"],
            "initial_state": "ATTENDANCE_RECEIVED",
            "steps_display": ["Attendance Received", "Closed"],
            "transitions": [
                {
                    "from_state": "ATTENDANCE_RECEIVED",
                    "to_state": "CLOSED",
                    "trigger": "RESOLVE_ATTENDANCE",
                    "conditions": [],
                    "actions": ["resolve_and_close_case"],
                    "audit_event": "Attendance resolved"
                }
            ]
        })

        wf_state = get_or_create_workflow_instance(self.case["db_id"], "ATTENDANCE")
        self.assertIsNotNone(wf_state)
        self.assertEqual(wf_state["workflow_id"], "WF-ATTENDANCE-001")
        self.assertTrue(len(wf_state["available_transitions"]) > 0)

        first_trig = wf_state["available_transitions"][0]["trigger"]
        expected_next = wf_state["available_transitions"][0]["to_state"]
        step1 = transition_workflow_state(self.case["db_id"], trigger=first_trig)
        self.assertEqual(step1["current_state"], expected_next)

        # Invalid transition from current state must raise ValueError
        with self.assertRaises(ValueError):
            transition_workflow_state(self.case["db_id"], trigger="NON_EXISTENT_TRIGGER")

    def test_02_task_create_complete_cancel(self):
        t1 = create_task(
            case_identifier=self.case["db_id"],
            title="Verify biometric logs",
            task_type="VERIFICATION",
            assigned_to="Anita HR",
            assigned_team="Attendance HR",
            priority="HIGH",
        )
        self.assertEqual(t1["status"], "PENDING")

        done = complete_task(t1["id"], performed_by="Anita HR")
        self.assertEqual(done["status"], "COMPLETED")

        t2 = create_task(
            case_identifier=self.case["db_id"],
            title="Duplicate check",
            task_type="GENERAL",
            assigned_to="Anita HR",
        )
        cancelled = cancel_task(t2["id"], reason="Not needed", performed_by="Anita HR")
        self.assertEqual(cancelled["status"], "CANCELLED")

        case_tasks = list_tasks(case_id=self.case["db_id"])
        self.assertEqual(len(case_tasks), 2)

    def test_03_approval_engine_connected_to_workflow_and_invalid_double_approval(self):
        app = request_approval(
            case_identifier=self.case["db_id"],
            approval_type="MANAGER_APPROVAL",
            approver="Manager Bob",
            performed_by="Anita HR",
        )
        self.assertEqual(app["status"], "PENDING")

        # Approve request -> records decision
        res = decide_approval(app["id"], decision="APPROVED", performed_by="Manager Bob", comments="Looks good")
        self.assertEqual(res["approval"]["status"], "APPROVED")

        # Invalid double approval must raise ValueError
        with self.assertRaises(ValueError):
            decide_approval(app["id"], decision="APPROVED", performed_by="Manager Bob")

    def test_04_approval_rejection_transitions_case_to_review(self):
        app = request_approval(
            case_identifier=self.case["db_id"],
            approval_type="HR_APPROVAL",
            approver="HR Lead",
            performed_by="Anita HR",
        )
        rej = decide_approval(app["id"], decision="REJECTED", performed_by="HR Lead", comments="Invalid dates")
        self.assertEqual(rej["approval"]["status"], "REJECTED")

    def test_05_24_point_workflow_builder_catalog_autorun_and_test_suite(self):
        from backend.services.workflows.workflow_registry import get_builder_catalog, save_workflow_definition
        from backend.services.workflows.workflow_engine import run_automated_workflow, run_workflow_test_suite

        # Admin saves a Leave workflow for simulation testing
        save_workflow_definition("LEAVE", {
            "workflow_id": "WF-LEAVE-001",
            "name": "Leave Request Workflow",
            "states": ["LEAVE_RECEIVED", "MANAGER_APPROVAL", "CLOSED"],
            "initial_state": "LEAVE_RECEIVED",
            "steps_display": ["Leave Received", "Manager Approval", "Closed"],
            "transitions": [
                {"from_state": "LEAVE_RECEIVED", "to_state": "CLOSED", "trigger": "AUTO_APPROVE"},
                {"from_state": "LEAVE_RECEIVED", "to_state": "MANAGER_APPROVAL", "trigger": "ROUTE_TO_MANAGER"}
            ]
        })

        catalog = get_builder_catalog()
        self.assertEqual(len(catalog["node_box_families"]), 13)
        self.assertEqual(len(catalog["data_mapping_sources"]), 7)
        self.assertEqual(len(catalog["branch_types_catalog"]), 5)
        self.assertTrue(len(catalog["workflow_execution_states"]) >= 6)
        self.assertTrue(len(catalog["case_business_statuses"]) >= 6)

        # Verify strict separation of Node vs Execution State vs Case Business Status on YES branch
        yes_sim = run_automated_workflow(
            category="LEAVE",
            dry_run=True,
            mock_overrides={"employee.matched": True, "fields.missing_fields_count": 0, "fields.duration_days": 2, "hrms.available_balance": 8},
        )
        self.assertEqual(yes_sim["branch_taken"], "YES")
        self.assertEqual(yes_sim["execution_state"], "COMPLETED")
        self.assertEqual(yes_sim["case_business_status"], "CLOSED")
        self.assertTrue(all("input_snapshot" in step and "idempotency_key" in step for step in yes_sim["execution_trace"]))

        # Verify NO branch separation (WAITING_FOR_APPROVAL vs PENDING_APPROVAL)
        no_sim = run_automated_workflow(
            category="LEAVE",
            dry_run=True,
            mock_overrides={"employee.matched": True, "fields.missing_fields_count": 0, "fields.duration_days": 5, "hrms.available_balance": 8},
        )
        self.assertEqual(no_sim["branch_taken"], "NO")
        self.assertEqual(no_sim["execution_state"], "WAITING_FOR_APPROVAL")
        self.assertEqual(no_sim["case_business_status"], "PENDING_APPROVAL")

        # Verify Automated Test Suite Runner for LEAVE and ATTENDANCE
        leave_suite = run_workflow_test_suite("LEAVE")
        self.assertTrue(leave_suite["all_passed"])
        att_suite = run_workflow_test_suite("ATTENDANCE")
        self.assertTrue(att_suite["all_passed"])


if __name__ == "__main__":
    unittest.main()

