"""
Unit tests for HR Flow Attachment & Document View, Download, and Upload APIs.
"""

import io
import unittest
from backend.server import app
from backend.database.connection import get_connection
from backend.models.case import get_case_by_id_or_number


class TestAttachmentAPIs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

        # Ensure a test case exists in the database
        import uuid
        case_num = f"CASE-ATT-{uuid.uuid4().hex[:6].upper()}"
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO cases (
                    case_number, title, category, status, priority
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    case_num,
                    "Test Attachment Case",
                    "SICK_LEAVE",
                    "IN_PROGRESS",
                    "MEDIUM",
                )
            )
            cls.test_case_id = cursor.lastrowid
            conn.commit()
        finally:
            conn.close()

    def test_01_upload_case_document(self):
        file_bytes = b"%PDF-1.4 test medical certificate pdf content"
        data = {
            "file": (io.BytesIO(file_bytes), "medical_cert.pdf"),
            "doc_type": "MEDICAL_CERTIFICATE",
            "uploaded_by": "Test HR",
            "notes": "Valid medical certificate submitted",
        }
        resp = self.client.post(
            f"/api/cases/{self.test_case_id}/documents/upload",
            data=data,
            content_type="multipart/form-data",
        )
        self.assertEqual(resp.status_code, 200)
        res_json = resp.get_json()
        self.assertTrue(res_json["success"])
        docs = res_json["data"]["documents"]
        self.assertTrue(any(d["name"] == "medical_cert.pdf" for d in docs))

        # Store doc_id for subsequent tests
        matched = next(d for d in docs if d["name"] == "medical_cert.pdf")
        self.doc_id = matched["id"]
        self.assertEqual(matched["status"], "RECEIVED")
        self.assertTrue(matched["has_file"])
        self.assertIn("view_url", matched)
        self.assertIn("download_url", matched)

    def test_02_view_case_document_inline(self):
        # First ensure doc uploaded
        self.test_01_upload_case_document()

        resp = self.client.get(f"/api/cases/{self.test_case_id}/documents/{self.doc_id}/view")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.mimetype, "application/pdf")
        self.assertIn("inline", resp.headers.get("Content-Disposition", ""))
        self.assertIn("medical_cert.pdf", resp.headers.get("Content-Disposition", ""))
        self.assertEqual(resp.data, b"%PDF-1.4 test medical certificate pdf content")

    def test_03_download_case_document(self):
        self.test_01_upload_case_document()

        resp = self.client.get(f"/api/cases/{self.test_case_id}/documents/{self.doc_id}/download")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.mimetype, "application/pdf")
        self.assertIn("attachment", resp.headers.get("Content-Disposition", ""))
        self.assertIn("medical_cert.pdf", resp.headers.get("Content-Disposition", ""))
        self.assertEqual(resp.data, b"%PDF-1.4 test medical certificate pdf content")

    def test_04_verify_case_document_status(self):
        self.test_01_upload_case_document()

        resp = self.client.post(
            f"/api/cases/{self.test_case_id}/documents/{self.doc_id}/status",
            json={"status": "VERIFIED", "notes": "Doctor seal verified by HR", "user": "Dr. HR"},
        )
        self.assertEqual(resp.status_code, 200)
        res_json = resp.get_json()
        self.assertTrue(res_json["success"])
        docs = res_json["data"]["documents"]
        matched = next(d for d in docs if d["id"] == self.doc_id)
        self.assertEqual(matched["status"], "VERIFIED")
        self.assertEqual(matched["notes"], "Doctor seal verified by HR")


    def test_05_email_attachment_ingestion_and_download(self):
        from email.message import EmailMessage
        from backend.services.gmail.email_parser import parse_raw_email
        from backend.services.gmail.gmail_fetcher import store_parsed_email, _get_attachments_for_email
        import uuid

        msg = EmailMessage()
        msg["From"] = "Sunil Verma <sunil.verma@company.com>"
        msg["To"] = "hr@company.com"
        msg["Subject"] = "Relieving Letter Copy"
        msg_id = f"<test-att-email-{uuid.uuid4().hex[:6]}@company.com>"
        msg["Message-ID"] = msg_id
        msg["Date"] = "Mon, 19 Oct 2026 10:00:00 +0530"
        msg.set_content("Please find attached my relieving letter.")
        fake_bytes = b"RELIEVING-LETTER-BINARY-DATA"
        msg.add_attachment(
            fake_bytes,
            maintype="application",
            subtype="pdf",
            filename="relieving_letter.pdf",
        )

        parsed = parse_raw_email(msg.as_bytes(), fallback_uid="99881")
        stored = store_parsed_email(parsed)
        self.assertTrue(stored["inserted"])
        email_id = stored["email_id"]

        conn = get_connection()
        try:
            atts = _get_attachments_for_email(conn, email_id)
            self.assertEqual(len(atts), 1)
            att = atts[0]
            self.assertEqual(att["filename"], "relieving_letter.pdf")
            self.assertTrue(att["has_file"])
            self.assertIn("download_url", att)

            # Test download
            resp = self.client.get(f"/api/attachments/{att['id']}/download")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.data, fake_bytes)

            # Test view inline
            resp_view = self.client.get(f"/api/attachments/{att['id']}/view")
            self.assertEqual(resp_view.status_code, 200)
            self.assertEqual(resp_view.data, fake_bytes)
            self.__class__.test_email_id = email_id
        finally:
            conn.close()

    @classmethod
    def tearDownClass(cls):
        import os
        import shutil
        from backend.config import Config
        conn = get_connection()
        try:
            if hasattr(cls, "test_case_id") and cls.test_case_id:
                conn.execute("DELETE FROM case_documents WHERE case_id = ?", (cls.test_case_id,))
                conn.execute("DELETE FROM case_communications WHERE case_id = ?", (cls.test_case_id,))
                conn.execute("DELETE FROM case_field_values WHERE case_id = ?", (cls.test_case_id,))
                conn.execute("DELETE FROM notifications WHERE case_id = ?", (cls.test_case_id,))
                conn.execute("DELETE FROM cases WHERE id = ?", (cls.test_case_id,))
                cdir = os.path.join(Config.STORAGE_DIR, "attachments", "cases", str(cls.test_case_id))
                if os.path.exists(cdir):
                    shutil.rmtree(cdir, ignore_errors=True)

            if hasattr(cls, "test_email_id") and cls.test_email_id:
                conn.execute("DELETE FROM email_attachments WHERE email_id = ?", (cls.test_email_id,))
                conn.execute("DELETE FROM case_documents WHERE email_id = ?", (cls.test_email_id,))
                conn.execute("DELETE FROM case_communications WHERE email_id = ?", (cls.test_email_id,))
                conn.execute("DELETE FROM case_field_values WHERE email_id = ?", (cls.test_email_id,))
                conn.execute("DELETE FROM notifications WHERE case_id IN (SELECT id FROM cases WHERE email_id = ?)", (cls.test_email_id,))
                conn.execute("DELETE FROM cases WHERE email_id = ?", (cls.test_email_id,))
                conn.execute("DELETE FROM emails WHERE id = ?", (cls.test_email_id,))
                edir = os.path.join(Config.STORAGE_DIR, "attachments", "emails", str(cls.test_email_id))
                if os.path.exists(edir):
                    shutil.rmtree(edir, ignore_errors=True)

            conn.commit()
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
