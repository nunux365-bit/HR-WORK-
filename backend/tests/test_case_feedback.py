"""
HR FLOW — Unit Tests for Employee Feedback & CSAT Survey System (backend/tests/test_case_feedback.py)
Verifies:
  1. Feedback submission (ratings 1-5, tags, comments)
  2. Feedback validation (range checking 1-5)
  3. Re-submission updates existing feedback cleanly
  4. Aggregate CSAT summary metrics (distribution, average score)
  5. Case feedback API endpoints (POST /api/cases/<ref>/feedback, GET, Summary)
"""

import unittest
import uuid
from flask import Flask
from backend.database.init_db import initialize_database
from backend.database.connection import get_connection
from backend.api.case_routes import case_bp
from backend.api.agent_routes import agent_bp
from backend.api.audit_routes import audit_bp
from backend.services.cases.feedback_service import (
    submit_case_feedback,
    get_case_feedback,
    get_feedback_summary,
)


class TestCaseFeedback(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize_database()

    def setUp(self):
        self.conn = get_connection()
        self.case_number = f"CASE-FB-{uuid.uuid4().hex[:6].upper()}"
        cur = self.conn.execute(
            """
            INSERT INTO cases (case_number, title, category, status, priority, assigned_user)
            VALUES (?, 'Feedback Test Query', 'ATTENDANCE', 'RESOLVED', 'MEDIUM', 'Vaibhav (HR)')
            """,
            (self.case_number,),
        )
        self.case_id = cur.lastrowid
        self.conn.commit()

        # Test Flask app
        self.app = Flask(__name__)
        self.app.register_blueprint(case_bp, url_prefix="/api/cases")
        self.app.register_blueprint(agent_bp, url_prefix="/api/agent")
        self.app.register_blueprint(audit_bp, url_prefix="/api/audit")
        self.client = self.app.test_client()

    def tearDown(self):
        try:
            self.conn.execute("DELETE FROM case_feedback WHERE case_number = ? OR case_id = ?", (self.case_number, self.case_id))
            self.conn.execute("DELETE FROM audit_logs WHERE entity_id = ?", (self.case_number,))
            self.conn.execute("DELETE FROM cases WHERE id = ?", (self.case_id,))
            self.conn.commit()
        except Exception:
            pass
        finally:
            self.conn.close()

    def test_01_submit_and_get_case_feedback(self):
        """Verify submitting 5-star feedback, tags, and comments."""
        fb = submit_case_feedback(
            case_ref=self.case_number,
            rating=5,
            tags=["Fast Resolution", "Clear Communication"],
            comments="Shift punch corrected instantly. Excellent support!",
            submitted_by="Employee Karan",
        )
        self.assertIsNotNone(fb)
        self.assertEqual(fb["rating"], 5)
        self.assertEqual(fb["rating_label"], "Excellent")
        self.assertIn("Fast Resolution", fb["tags"])
        self.assertEqual(fb["comments"], "Shift punch corrected instantly. Excellent support!")

        # Retrieve again via get_case_feedback
        retrieved = get_case_feedback(self.case_number)
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved["rating"], 5)
        self.assertEqual(retrieved["case_number"], self.case_number)

    def test_02_validation_invalid_rating(self):
        """Verify ratings < 1 or > 5 are rejected."""
        with self.assertRaises(ValueError):
            submit_case_feedback(case_ref=self.case_number, rating=0)

        with self.assertRaises(ValueError):
            submit_case_feedback(case_ref=self.case_number, rating=6)

    def test_03_update_existing_feedback(self):
        """Verify submitting feedback twice updates the existing record rather than creating a duplicate."""
        submit_case_feedback(case_ref=self.case_number, rating=3, comments="Initial okay service")
        updated = submit_case_feedback(case_ref=self.case_number, rating=4, comments="Updated: Actually very helpful!")

        self.assertEqual(updated["rating"], 4)
        self.assertEqual(updated["comments"], "Updated: Actually very helpful!")

        # Count records in table
        count = self.conn.execute(
            "SELECT COUNT(*) as c FROM case_feedback WHERE case_id = ?",
            (self.case_id,),
        ).fetchone()["c"]
        self.assertEqual(count, 1, "Must update existing record, not duplicate")

    def test_04_feedback_api_endpoints(self):
        """Verify POST and GET /api/cases/<identifier>/feedback."""
        # 1. POST feedback
        resp_post = self.client.post(
            f"/api/cases/{self.case_number}/feedback",
            json={
                "rating": 5,
                "tags": ["Courteous Specialist", "Fast Resolution"],
                "comments": "Super quick response via portal.",
                "submitted_by": "Test Requester",
            },
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(resp_post.status_code, 200)
        data_post = resp_post.get_json()["data"]
        self.assertEqual(data_post["feedback"]["rating"], 5)

        # 2. GET feedback
        resp_get = self.client.get(f"/api/cases/{self.case_number}/feedback")
        self.assertEqual(resp_get.status_code, 200)
        data_get = resp_get.get_json()["data"]
        self.assertIsNotNone(data_get["feedback"])
        self.assertEqual(data_get["feedback"]["rating"], 5)
        self.assertEqual(data_get["case"]["case_number"], self.case_number)

    def test_05_feedback_summary_metrics(self):
        """Verify /api/cases/feedback/summary calculations."""
        submit_case_feedback(case_ref=self.case_number, rating=5, tags=["Great"])
        summary = get_feedback_summary()
        self.assertGreaterEqual(summary["total_responses"], 1)
        self.assertGreater(summary["average_rating"], 0)
        self.assertIn("distribution", summary)

    def test_06_csat_audit_report_endpoint(self):
        """Verify GET /api/audit/csat-report returns executive summary and audit records."""
        submit_case_feedback(
            case_ref=self.case_number,
            rating=5,
            tags=["Fast Resolution", "High Accuracy"],
            comments="Executive audit verification comment",
            submitted_by="Audit Verifier",
        )
        resp = self.client.get("/api/audit/csat-report")
        self.assertEqual(resp.status_code, 200)
        payload = resp.get_json()["data"]
        self.assertIn("summary", payload)
        self.assertIn("records", payload)
        self.assertGreaterEqual(len(payload["records"]), 1)
        found = any(r["case_number"] == self.case_number for r in payload["records"])
        self.assertTrue(found, f"Case {self.case_number} must appear in CSAT audit report records")
