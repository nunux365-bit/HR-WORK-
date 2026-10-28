"""
HR FLOW — Phase 4 Attachment Metadata & Binary Parser (backend/services/gmail/attachment_parser.py)
Extracts attachment metadata and saves binary payloads safely to local disk.
"""

from email.header import decode_header
from email.message import Message
import hashlib
import os
import uuid
from typing import List, Dict, Any, Optional

try:
    from werkzeug.utils import secure_filename
except ImportError:
    import re
    def secure_filename(name: str) -> str:
        return re.sub(r"[^A-Za-z0-9_.-]", "_", name).strip("_")

from backend.config import Config


def _decode_mime_words(raw_val: str) -> str:
    if not raw_val:
        return ""
    decoded_parts = []
    for part, enc in decode_header(raw_val):
        if isinstance(part, bytes):
            decoded_parts.append(part.decode(enc or "utf-8", errors="replace"))
        else:
            decoded_parts.append(str(part))
    return "".join(decoded_parts).strip()


def _format_size(num_bytes: int) -> str:
    if num_bytes < 1024:
        return f"{num_bytes} B"
    kb = num_bytes / 1024.0
    if kb < 1024:
        return f"{int(round(kb))} KB"
    mb = kb / 1024.0
    return f"{mb:.1f} MB"


def extract_attachments_metadata(msg: Message, include_payload: bool = False) -> List[Dict[str, Any]]:
    """
    Walk MIME parts of an email message and return a list of attachment metadata dicts.
    If include_payload is True, attaches the raw decoded payload as `_payload_bytes`.
    """
    attachments: List[Dict[str, Any]] = []
    if not msg.is_multipart():
        return attachments

    for part in msg.walk():
        content_disposition = str(part.get("Content-Disposition") or "")
        raw_filename = part.get_filename()

        if not raw_filename and "attachment" not in content_disposition.lower():
            continue

        filename = _decode_mime_words(raw_filename) if raw_filename else "attachment.bin"
        content_type = part.get_content_type() or "application/octet-stream"

        try:
            payload = part.get_payload(decode=True)
            size_bytes = len(payload) if payload else 0
        except Exception:
            payload = None
            size_bytes = 0

        ext = filename.rsplit(".", 1)[-1].upper() if "." in filename else "FILE"

        att_dict: Dict[str, Any] = {
            "filename": filename,
            "name": filename,
            "type": ext,
            "content_type": content_type,
            "size_bytes": size_bytes,
            "size": _format_size(size_bytes),
        }
        if include_payload and payload:
            att_dict["_payload_bytes"] = payload

        attachments.append(att_dict)

    return attachments


def save_attachment_file(email_id: int, filename: str, payload: bytes, content_type: str = "application/octet-stream") -> Dict[str, Any]:
    """
    Persist email attachment binary bytes to local disk:
    backend/storage/attachments/emails/<email_id>/<uuid>_<filename>
    """
    base_dir = os.path.join(Config.ATTACHMENTS_DIR, "emails", str(email_id))
    os.makedirs(base_dir, exist_ok=True)

    clean_name = secure_filename(filename) or "attachment.bin"
    disk_filename = f"{uuid.uuid4().hex[:8]}_{clean_name}"
    storage_path = os.path.join(base_dir, disk_filename)

    with open(storage_path, "wb") as f:
        f.write(payload)

    file_hash = hashlib.sha256(payload).hexdigest()
    size_bytes = len(payload)

    return {
        "filename": filename,
        "disk_filename": disk_filename,
        "storage_path": storage_path,
        "content_type": content_type,
        "size_bytes": size_bytes,
        "size": _format_size(size_bytes),
        "file_hash": file_hash,
    }


def save_case_document_file(case_id: int, filename: str, payload: bytes, content_type: str = "application/octet-stream") -> Dict[str, Any]:
    """
    Persist manual case document binary bytes to local disk:
    backend/storage/attachments/cases/<case_id>/<uuid>_<filename>
    """
    base_dir = os.path.join(Config.ATTACHMENTS_DIR, "cases", str(case_id))
    os.makedirs(base_dir, exist_ok=True)

    clean_name = secure_filename(filename) or "document.bin"
    disk_filename = f"{uuid.uuid4().hex[:8]}_{clean_name}"
    storage_path = os.path.join(base_dir, disk_filename)

    with open(storage_path, "wb") as f:
        f.write(payload)

    file_hash = hashlib.sha256(payload).hexdigest()
    size_bytes = len(payload)

    return {
        "filename": filename,
        "disk_filename": disk_filename,
        "storage_path": storage_path,
        "content_type": content_type,
        "size_bytes": size_bytes,
        "size": _format_size(size_bytes),
        "file_hash": file_hash,
    }
