"""
HR FLOW — Phase 4 Gmail Service & Email Parser Unit Tests (backend/tests/test_gmail.py)
Verifies:
  1. RFC822 MIME parsing (headers, plain/HTML body, thread ID, attachments)
  2. SQLite email storage and deduplication via (provider, provider_message_id)
  3. Read/unread status transitions and audit log creation
"""

from email.message import EmailMessage
import unittest

from backend.database.init_db import initialize_database
from backend.database.connection import get_connection
from backend.services.gmail.email_parser import parse_raw_email
from backend.services.gmail.gmail_fetcher import (
    store_parsed_email,
    get_stored_email_detail,
    mark_email_read,
)


class TestGmailPhase4(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize_database()

    def _cleanup_test_message(self, provider_msg_id: str):
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT id FROM emails WHERE provider = 'gmail' AND provider_message_id = ?",
                (provider_msg_id,),
            ).fetchone()
            if row:
                email_id = row["id"]
                case_rows = conn.execute(
                    "SELECT id, case_number FROM cases WHERE email_id = ?",
                    (email_id,),
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
                    (str(email_id),),
                )
                conn.execute("DELETE FROM emails WHERE id = ?", (email_id,))
                conn.commit()
        finally:
            conn.close()

    def test_parse_rfc822_email_with_attachment(self):
        msg = EmailMessage()
        msg["From"] = "Rahul Sharma <rahul.sharma@company.com>"
        msg["To"] = "hr@company.com"
        msg["Subject"] = "Please correct my attendance for 24 Sept"
        msg["Message-ID"] = "<phase4-test-msg-001@company.com>"
        msg["Date"] = "Wed, 24 Sep 2026 09:32:00 +0530"
        msg.set_content("Hi HR Team,\n\nMy biometric punch was missed on 24 Sept. Please regularize.")
        msg.add_attachment(
            b"PDF-FAKE-BYTES",
            maintype="application",
            subtype="pdf",
            filename="gate_entry_pass.pdf",
        )

        parsed = parse_raw_email(msg.as_bytes(), fallback_uid="99901")
        self.assertEqual(parsed["provider"], "gmail")
        self.assertEqual(parsed["provider_message_id"], "<phase4-test-msg-001@company.com>")
        self.assertEqual(parsed["sender_name"], "Rahul Sharma")
        self.assertEqual(parsed["sender_email"], "rahul.sharma@company.com")
        self.assertEqual(parsed["subject"], "Please correct my attendance for 24 Sept")
        self.assertIn("My biometric punch was missed", parsed["body"])
        self.assertEqual(len(parsed["attachments"]), 1)
        self.assertEqual(parsed["attachments"][0]["filename"], "gate_entry_pass.pdf")

    def test_store_and_deduplicate_email(self):
        test_msg_id = "<phase4-dedup-test-002@company.com>"
        self._cleanup_test_message(test_msg_id)

        try:
            msg = EmailMessage()
            msg["From"] = "Priya Nair <priya.nair@company.com>"
            msg["To"] = "hr@company.com"
            msg["Subject"] = "Medical Leave Request"
            msg["Message-ID"] = test_msg_id
            msg["Date"] = "Thu, 25 Sep 2026 10:15:00 +0530"
            msg.set_content("Requesting 3 days medical leave.")

            parsed = parse_raw_email(msg.as_bytes(), fallback_uid="99902")

            first = store_parsed_email(parsed)
            self.assertTrue(first["inserted"])
            email_id = first["email_id"]

            # Second store with same provider_message_id must deduplicate
            second = store_parsed_email(parsed)
            self.assertFalse(second["inserted"])
            self.assertEqual(second["email_id"], email_id)

            # Detail & audit log verification
            detail = get_stored_email_detail(email_id)
            self.assertIsNotNone(detail)
            self.assertEqual(detail["sender_email"], "priya.nair@company.com")
            self.assertEqual(detail["processing_status"], "RECEIVED")
            self.assertTrue(any(a["action"] == "EMAIL_INGESTED" for a in detail["audit"]))

            # Mark read
            updated = mark_email_read(email_id, is_read=True)
            self.assertTrue(updated)
            detail_after = get_stored_email_detail(email_id)
            self.assertEqual(detail_after["processing_status"], "READ")
        finally:
            self._cleanup_test_message(test_msg_id)

    def test_dual_provider_host_resolution(self):
        from backend.services.gmail.gmail_client import resolve_email_provider_hosts

        # Gmail standard
        prov, ih, ip, sh, sp = resolve_email_provider_hosts("specialist@gmail.com")
        self.assertEqual(prov, "GMAIL")
        self.assertEqual(ih, "imap.gmail.com")
        self.assertEqual(ip, 993)
        self.assertEqual(sh, "smtp.gmail.com")
        self.assertEqual(sp, 465)

        # Zoho global (.com)
        prov, ih, ip, sh, sp = resolve_email_provider_hosts("agent@zohomail.com")
        self.assertEqual(prov, "ZOHO")
        self.assertEqual(ih, "imap.zoho.com")
        self.assertEqual(sh, "smtp.zoho.com")

        # Zoho India (.in)
        prov, ih, ip, sh, sp = resolve_email_provider_hosts("agent@zohomail.in")
        self.assertEqual(prov, "ZOHO")
        self.assertEqual(ih, "imap.zoho.in")
        self.assertEqual(sh, "smtp.zoho.in")

        # Custom corporate domain with explicit ZOHO provider
        prov, ih, ip, sh, sp = resolve_email_provider_hosts("agent@acmecorp.com", explicit_provider="ZOHO")
        self.assertEqual(prov, "ZOHO")
        self.assertEqual(ih, "imap.zoho.com")

    def test_save_and_load_mailbox_dual_provider(self):
        from backend.services.gmail.gmail_client import (
            _save_mailbox_to_db,
            _load_mailboxes_from_db,
            _GMAIL_ACCOUNTS,
        )

        test_zoho_email = "zoho_test_specialist@zohomail.in"
        _save_mailbox_to_db(
            email_clean=test_zoho_email,
            app_password="test-app-password-1234",
            inbox_total=42,
            provider="ZOHO",
            imap_host="imap.zoho.in",
            smtp_host="smtp.zoho.in",
        )

        # Hydrate accounts
        _load_mailboxes_from_db()
        self.assertIn(test_zoho_email, _GMAIL_ACCOUNTS)
        account = _GMAIL_ACCOUNTS[test_zoho_email]
        self.assertEqual(account["provider"], "ZOHO")
        self.assertEqual(account["imap_host"], "imap.zoho.in")
        self.assertEqual(account["smtp_host"], "smtp.zoho.in")
        self.assertEqual(account["app_password"], "test-app-password-1234")

        # Clean up test mailbox
        conn = get_connection()
        try:
            conn.execute("DELETE FROM connected_mailboxes WHERE email = ?", (test_zoho_email,))
            conn.commit()
        finally:
            conn.close()
        _GMAIL_ACCOUNTS.pop(test_zoho_email, None)


if __name__ == "__main__":
    unittest.main()
