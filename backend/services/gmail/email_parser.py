"""
HR FLOW — Phase 4 Email Parser (backend/services/gmail/email_parser.py)
Parses raw RFC822 MIME email bytes into a clean, normalized dictionary ready for SQLite storage.
Handles:
  - RFC2047 encoded Subject & Sender names
  - Sender name + email separation
  - Plain-text and HTML-to-text fallback body extraction
  - Message-ID & Thread-ID extraction
  - Normalized ISO 8601 received_at timestamp
  - Attachment metadata list
"""

from datetime import datetime, timezone
import email
from email.header import decode_header
from email.message import Message
from email.utils import parseaddr, parsedate_to_datetime
import html
import re
from typing import Dict, Any

from backend.services.gmail.attachment_parser import extract_attachments_metadata


def decode_mime_header(raw_header: str) -> str:
    """Decode RFC2047 encoded header strings safely."""
    if not raw_header:
        return ""
    parts = []
    for content, encoding in decode_header(raw_header):
        if isinstance(content, bytes):
            try:
                parts.append(content.decode(encoding or "utf-8", errors="replace"))
            except LookupError:
                parts.append(content.decode("utf-8", errors="replace"))
        else:
            parts.append(str(content))
    return " ".join("".join(parts).split()).strip()


def html_to_plain_text(raw_html: str) -> str:
    """Convert an HTML email body into readable plain text."""
    if not raw_html:
        return ""
    # Remove script and style blocks
    cleaned = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", raw_html, flags=re.DOTALL | re.IGNORECASE)
    # Replace line-break and block tags with newlines
    cleaned = re.sub(r"<(br|p|div|tr|li|h[1-6])[^>]*>", "\n", cleaned, flags=re.IGNORECASE)
    # Strip remaining HTML tags
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    cleaned = html.unescape(cleaned)
    # Normalize excessive blank lines
    lines = [line.strip() for line in cleaned.splitlines()]
    non_empty = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", non_empty).strip()


def extract_email_body(msg: Message) -> str:
    """Extract clean text body from a single-part or multipart MIME message."""
    plain_candidates = []
    html_candidates = []

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            disposition = str(part.get("Content-Disposition") or "").lower()
            if "attachment" in disposition:
                continue

            if content_type in ("text/plain", "text/html"):
                try:
                    raw_bytes = part.get_payload(decode=True)
                    if raw_bytes is None:
                        continue
                    charset = part.get_content_charset() or "utf-8"
                    try:
                        decoded_text = raw_bytes.decode(charset, errors="replace")
                    except LookupError:
                        decoded_text = raw_bytes.decode("utf-8", errors="replace")

                    if content_type == "text/plain":
                        plain_candidates.append(decoded_text.strip())
                    else:
                        html_candidates.append(decoded_text.strip())
                except Exception:
                    continue
    else:
        content_type = msg.get_content_type()
        try:
            raw_bytes = msg.get_payload(decode=True)
            if raw_bytes:
                charset = msg.get_content_charset() or "utf-8"
                try:
                    decoded_text = raw_bytes.decode(charset, errors="replace")
                except LookupError:
                    decoded_text = raw_bytes.decode("utf-8", errors="replace")
                if content_type == "text/html":
                    html_candidates.append(decoded_text.strip())
                else:
                    plain_candidates.append(decoded_text.strip())
        except Exception:
            pass

    if plain_candidates:
        return "\n\n".join(p for p in plain_candidates if p).strip()

    if html_candidates:
        return html_to_plain_text("\n".join(html_candidates))

    return ""


def parse_received_timestamp(date_header: str) -> str:
    """Parse RFC2822 Date header into an ISO 8601 timestamp string."""
    if date_header:
        try:
            dt = parsedate_to_datetime(date_header)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except Exception:
            pass
    return datetime.now(timezone.utc).isoformat()


def parse_raw_email(raw_bytes: bytes, fallback_uid: str = "") -> Dict[str, Any]:
    """
    Parse raw RFC822 message bytes into a normalized email dictionary
    matching the Phase 3 `emails` table schema.
    """
    msg = email.message_from_bytes(raw_bytes)

    raw_msg_id = (msg.get("Message-ID") or "").strip()
    provider_message_id = raw_msg_id if raw_msg_id else f"gmail-uid-{fallback_uid}"

    # Thread ID resolution: In-Reply-To / first Reference / Message-ID
    in_reply_to = (msg.get("In-Reply-To") or "").strip()
    references = (msg.get("References") or "").strip()
    if in_reply_to:
        thread_id = in_reply_to
    elif references:
        thread_id = references.split()[0].strip()
    else:
        thread_id = provider_message_id

    # Sender parsing
    raw_from = decode_mime_header(msg.get("From") or "")
    parsed_name, parsed_email = parseaddr(raw_from)
    sender_email = (parsed_email or "").strip().lower()
    sender_name = decode_mime_header(parsed_name).strip(' "\'')
    if not sender_name and sender_email:
        sender_name = sender_email.split("@")[0].replace(".", " ").title()

    subject = decode_mime_header(msg.get("Subject") or "(No Subject)")
    received_at = parse_received_timestamp(msg.get("Date") or "")
    body = extract_email_body(msg)
    attachments = extract_attachments_metadata(msg, include_payload=True)

    return {
        "provider": "gmail",
        "provider_message_id": provider_message_id,
        "thread_id": thread_id,
        "sender_name": sender_name or "Unknown Sender",
        "sender_email": sender_email,
        "subject": subject or "(No Subject)",
        "body": body,
        "received_at": received_at,
        "attachments": attachments,
    }
