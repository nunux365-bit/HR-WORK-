"""
HR FLOW — Phase 5.8 Employee Service Unit & Integration Tests (backend/tests/test_employees.py)
Verifies all 19 Phase 5 acceptance criteria:
  1. Employee table can be queried
  2. Employee can be created
  3. Employee can be updated
  4. Employee can be searched by email
  5. Employee can be searched by ID
  6. Employee can be searched by name
  7. Employee identity can be extracted from email
  8. Exact email matching works
  9. Exact employee-ID matching works
  10. Name matching works ("Rahul Sharma", "Rahul", "R. Sharma")
  11. Typo tolerance works ("Rahull Sharma")
  12. Ambiguous matches are detected ("Multiple employees matched the extracted name")
  13. Conflicting identity information is detected ("Employee ID and employee name conflict")
  14. No-match result is handled
  15. Match confidence is returned
  16. Match method is returned
  17. Employee result is stored against email
  18. Audit event is generated
  19. Gmail -> Email -> Employee Service -> SQLite pipeline works end-to-end
"""

from email.message import EmailMessage
import unittest

from backend.database.init_db import initialize_database
from backend.database.connection import get_connection
from backend.services.employees.employee_extractor import extract_employee_identity
from backend.services.employees.employee_service import (
    create_employee_record,
    update_employee_record,
    get_employee,
    search_employees,
    identify_employee_from_email,
)
from backend.services.gmail.email_parser import parse_raw_email
from backend.services.gmail.gmail_fetcher import store_parsed_email, get_stored_email_detail


class TestEmployeeServicePhase5(unittest.TestCase):
    TEST_EMP_CODES = ["EMP9101", "EMP9102", "EMP9103", "EMP9104"]
    TEST_MSG_IDS = [
        "<phase5-test-emp-match@company.com>",
        "<phase5-test-emp-conflict@company.com>",
    ]

    @classmethod
    def setUpClass(cls):
        initialize_database()

    def setUp(self):
        self._cleanup()
        # Seed test employees for matching scenarios (distinct from live EMP1023/EMP1024)
        create_employee_record({
            "employee_id": "EMP9101",
            "name": "Rohan Deshmukh",
            "email": "rohan.deshmukh@gmail.com",
            "department": "Engineering",
            "location": "Bangalore",
        })
        create_employee_record({
            "employee_id": "EMP9102",
            "name": "Sneha Kulkarni",
            "email": "sneha.kulkarni@company.com",
            "department": "HR Operations",
            "location": "Mumbai",
        })
        # Two employees with first name "Amit" to test ambiguity detection
        create_employee_record({
            "employee_id": "EMP9103",
            "name": "Amit Verma",
            "email": "amit.verma@company.com",
            "department": "Finance",
        })
        create_employee_record({
            "employee_id": "EMP9104",
            "name": "Amit Patel",
            "email": "amit.patel@company.com",
            "department": "Sales",
        })

    def tearDown(self):
        self._cleanup()

    def _cleanup(self):
        conn = get_connection()
        try:
            for msg_id in self.TEST_MSG_IDS:
                row = conn.execute(
                    "SELECT id FROM emails WHERE provider_message_id = ?",
                    (msg_id,),
                ).fetchone()
                if row:
                    eid = row["id"]
                    case_rows = conn.execute(
                        "SELECT id, case_number FROM cases WHERE email_id = ?",
                        (eid,),
                    ).fetchall()
                    for crow in case_rows:
                        cid = crow["id"]
                        cnum = crow["case_number"]
                        conn.execute("DELETE FROM case_field_values WHERE case_id = ?", (cid,))
                        conn.execute("DELETE FROM workflow_instances WHERE case_id = ?", (cid,))
                        conn.execute("DELETE FROM tasks WHERE case_id = ?", (cid,))
                        conn.execute(
                            "DELETE FROM audit_logs WHERE entity_type IN ('CASE', 'WORKFLOW') AND entity_id IN (?, ?)",
                            (str(cid), str(cnum)),
                        )
                        conn.execute("DELETE FROM cases WHERE id = ?", (cid,))
                    conn.execute(
                        "DELETE FROM audit_logs WHERE entity_type = 'EMAIL' AND entity_id = ?",
                        (str(eid),),
                    )
                    conn.execute("DELETE FROM emails WHERE id = ?", (eid,))

            for code in self.TEST_EMP_CODES:
                conn.execute(
                    "DELETE FROM audit_logs WHERE entity_type = 'EMPLOYEE' AND entity_id = ?",
                    (code,),
                )
                conn.execute("DELETE FROM employees WHERE employee_id = ?", (code,))
            conn.commit()
        finally:
            conn.close()

    def test_01_crud_and_search(self):
        # Query by ID
        emp = get_employee("EMP9101")
        self.assertIsNotNone(emp)
        self.assertEqual(emp["name"], "Rohan Deshmukh")

        # Update employee
        updated = update_employee_record("EMP9101", {
            "designation": "Senior Software Engineer",
            "manager_name": "Vikram Desai",
        })
        self.assertEqual(updated["designation"], "Senior Software Engineer")
        self.assertEqual(updated["manager_name"], "Vikram Desai")

        # Search by email
        by_email = search_employees(email="rohan.deshmukh@gmail.com")
        self.assertEqual(len(by_email), 1)
        self.assertEqual(by_email[0]["id"], "EMP9101")

        # Search by ID
        by_id = search_employees(employee_id="EMP9102")
        self.assertEqual(len(by_id), 1)
        self.assertEqual(by_id[0]["name"], "Sneha Kulkarni")

        # Search by name
        by_name = search_employees(name="Rohan")
        self.assertTrue(any(e["id"] == "EMP9101" for e in by_name))

    def test_02_identity_extraction(self):
        extracted = extract_employee_identity({
            "sender_name": "Rohan Deshmukh",
            "sender_email": "rohan.deshmukh@gmail.com",
            "subject": "Attendance correction for EMP9101",
            "body": (
                "Employee ID: EMP9101\n"
                "Employee Name: Rohan Deshmukh\n"
                "Department: Engineering\n"
                "Designation: Software Engineer\n"
                "Manager: Vikram Desai\n"
                "Location: Bangalore\n"
            ),
        })
        self.assertEqual(extracted["employee_id"], "EMP9101")
        self.assertEqual(extracted["explicit_name"], "Rohan Deshmukh")
        self.assertEqual(extracted["department"], "Engineering")
        self.assertEqual(extracted["designation"], "Software Engineer")
        self.assertEqual(extracted["manager_name"], "Vikram Desai")
        self.assertEqual(extracted["location"], "Bangalore")

    def test_03_exact_id_and_email_matching(self):
        # Exact Employee ID match
        res_id = identify_employee_from_email({
            "sender_name": "",
            "sender_email": "personal.mail@example.org",
            "subject": "Leave balance query - EMP9101",
            "body": "Please share leave balance for EMP9101.",
        })
        self.assertEqual(res_id["status"], "MATCHED")
        self.assertEqual(res_id["match_method"], "EMPLOYEE_ID")
        self.assertGreaterEqual(res_id["confidence"], 0.98)
        self.assertEqual(res_id["employee"]["id"], "EMP9101")

        # Exact Email match
        res_email = identify_employee_from_email({
            "sender_name": "Rohan Deshmukh",
            "sender_email": "rohan.deshmukh@gmail.com",
            "subject": "Attendance correction",
            "body": "Please regularize my punch for yesterday.",
        })
        self.assertEqual(res_email["status"], "MATCHED")
        self.assertEqual(res_email["match_method"], "EMAIL")
        self.assertEqual(res_email["confidence"], 0.96)
        self.assertEqual(res_email["employee"]["id"], "EMP9101")

    def test_04_name_initial_and_fuzzy_matching(self):
        # Full name match
        res_full = identify_employee_from_email({
            "sender_name": "Rohan Deshmukh",
            "sender_email": "unknown.sender@external.com",
            "subject": "Attendance query",
            "body": "Hi HR, please check my attendance.",
        })
        self.assertEqual(res_full["status"], "MATCHED")
        self.assertEqual(res_full["match_method"], "NAME")
        self.assertEqual(res_full["employee"]["id"], "EMP9101")

        # Initial + Last name ("R. Deshmukh")
        res_initial = identify_employee_from_email({
            "sender_name": "R. Deshmukh",
            "sender_email": "rdeshmukh.alt@external.com",
            "subject": "Payslip request",
            "body": "Please send payslip.",
        })
        self.assertEqual(res_initial["status"], "MATCHED")
        self.assertEqual(res_initial["match_method"], "NAME")
        self.assertEqual(res_initial["employee"]["id"], "EMP9101")

        # Unique first name ("Rohan")
        res_first = identify_employee_from_email({
            "sender_name": "Rohan",
            "sender_email": "rohan.alt@external.com",
            "subject": "Leave query",
            "body": "Thanks,\nRohan",
        })
        self.assertEqual(res_first["status"], "MATCHED")
        self.assertEqual(res_first["match_method"], "NAME")
        self.assertEqual(res_first["employee"]["id"], "EMP9101")

        # Typo tolerance ("Rohann Deshmukh")
        res_typo = identify_employee_from_email({
            "sender_name": "Rohann Deshmukh",
            "sender_email": "rohann.alt@external.com",
            "subject": "Shift change",
            "body": "Requesting shift update.",
        })
        self.assertEqual(res_typo["status"], "MATCHED")
        self.assertEqual(res_typo["match_method"], "FUZZY_NAME")
        self.assertEqual(res_typo["employee"]["id"], "EMP9101")

    def test_05_conflict_and_ambiguity_and_not_found(self):
        # Conflict: EMP9102 is Sneha Kulkarni, but email says Employee Name: Vaibhav
        res_conflict = identify_employee_from_email({
            "sender_name": "Vaibhav",
            "sender_email": "vaibhav@external.com",
            "subject": "Attendance correction",
            "body": "Employee ID: EMP9102\nEmployee Name: Vaibhav\nPlease update.",
        })
        self.assertEqual(res_conflict["status"], "REVIEW_REQUIRED")
        self.assertEqual(res_conflict["reason"], "Employee ID and employee name conflict")

        # Ambiguity: First name "Amit" matches both Amit Verma (EMP9103) and Amit Patel (EMP9104)
        res_ambig = identify_employee_from_email({
            "sender_name": "Amit",
            "sender_email": "amit.personal@external.com",
            "subject": "Leave request",
            "body": "Please approve my leave.\nThanks,\nAmit",
        })
        self.assertEqual(res_ambig["status"], "REVIEW_REQUIRED")
        self.assertEqual(res_ambig["match_method"], "NAME")
        self.assertEqual(res_ambig["reason"], "Multiple employees matched the extracted name")

        # No Match
        res_none = identify_employee_from_email({
            "sender_name": "Zoya Chatterjee",
            "sender_email": "zoya.unregistered@external.com",
            "subject": "General question",
            "body": "Hello HR.",
        })
        self.assertEqual(res_none["status"], "NOT_FOUND")
        self.assertEqual(res_none["confidence"], 0.0)
        self.assertIsNone(res_none["match_method"])

    def test_06_gmail_to_employee_to_sqlite_pipeline(self):
        # 1. Matched email stored via store_parsed_email
        msg1 = EmailMessage()
        msg1["From"] = "Rohan Deshmukh <rohan.deshmukh@gmail.com>"
        msg1["To"] = "hr@company.com"
        msg1["Subject"] = "Please correct my attendance for 24 Sept"
        msg1["Message-ID"] = self.TEST_MSG_IDS[0]
        msg1.set_content(
            "Hi HR,\nEmployee ID: EMP9101\nDesignation: Software Engineer\nManager: Vikram Desai\nPlease correct my punch."
        )
        parsed1 = parse_raw_email(msg1.as_bytes(), fallback_uid="8001")
        stored1 = store_parsed_email(parsed1)
        self.assertTrue(stored1["inserted"])
        self.assertEqual(stored1["employee_match"]["status"], "MATCHED")

        detail1 = get_stored_email_detail(stored1["email_id"])
        self.assertIsNotNone(detail1["employee"])
        self.assertEqual(detail1["employee"]["id"], "EMP9101")
        # Verify email-derived enrichment updated designation & manager on EMP9101
        self.assertEqual(detail1["employee"]["designation"], "Software Engineer")
        self.assertEqual(detail1["employee"]["manager"], "Vikram Desai")
        self.assertTrue(any(a["action"] == "EMPLOYEE_MATCHED" for a in detail1["audit"]))

        # 2. Conflicting email stored via store_parsed_email marks requires_review = True
        msg2 = EmailMessage()
        msg2["From"] = "Vaibhav <vaibhav.test@external.com>"
        msg2["To"] = "hr@company.com"
        msg2["Subject"] = "Update request"
        msg2["Message-ID"] = self.TEST_MSG_IDS[1]
        msg2.set_content("Employee ID: EMP9102\nEmployee Name: Vaibhav")
        parsed2 = parse_raw_email(msg2.as_bytes(), fallback_uid="8002")
        stored2 = store_parsed_email(parsed2)
        self.assertTrue(stored2["inserted"])
        self.assertEqual(stored2["employee_match"]["status"], "REVIEW_REQUIRED")

        detail2 = get_stored_email_detail(stored2["email_id"])
        self.assertIsNone(detail2["employee_id"])
        self.assertTrue(detail2["requires_review"])
        self.assertTrue(any(a["action"] == "EMPLOYEE_REVIEW_REQUIRED" for a in detail2["audit"]))


if __name__ == "__main__":
    unittest.main()
