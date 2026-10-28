"""
HR FLOW — Attachment & Document Streaming REST API (backend/api/attachment_routes.py)
Provides secure preview, download, and upload endpoints for email attachments and case documents.
"""

import mimetypes
import os
from typing import Optional, Tuple
from flask import Blueprint, request, send_file, jsonify, Response

from backend.config import Config
from backend.database.connection import get_connection
from backend.api import success_response, error_response
from backend.models.case import get_case_by_id_or_number
from backend.services.cases.case_service import (
    get_case_documents,
    upload_case_document,
    update_case_document_status,
    get_full_case_detail,
)

attachment_bp = Blueprint("attachment_api", __name__, url_prefix="/api")


def _is_safe_path(target_path: str) -> bool:
    """Ensure the target path is strictly within Config.ATTACHMENTS_DIR."""
    try:
        abs_target = os.path.abspath(target_path)
        abs_base = os.path.abspath(Config.ATTACHMENTS_DIR)
        return os.path.commonpath([abs_target, abs_base]) == abs_base
    except Exception:
        return False


def _stream_local_file(
    storage_path: str,
    filename: str,
    content_type: Optional[str] = None,
    as_attachment: bool = False,
) -> Response:
    """Helper to safely stream a file from local disk as inline preview or attachment download."""
    if not storage_path or not os.path.isfile(storage_path):
        return error_response(
            "FILE_NOT_FOUND",
            f"Attachment binary for '{filename}' was not found on local disk.",
            404,
        )

    if not _is_safe_path(storage_path):
        return error_response("ACCESS_DENIED", "Access to file path is restricted.", 403)

    mime = content_type
    if not mime or mime == "application/octet-stream":
        guessed_type, _ = mimetypes.guess_type(filename)
        mime = guessed_type or "application/octet-stream"

    # For text, markdown, or HTML, ensure UTF-8 charset
    if mime.startswith("text/"):
        mime = f"{mime}; charset=utf-8"

    response = send_file(
        storage_path,
        mimetype=mime,
        as_attachment=as_attachment,
        download_name=filename,
        max_age=3600,
    )
    # Ensure inline display headers for PDF/Images when not downloading
    disp_mode = "attachment" if as_attachment else "inline"
    safe_disp_filename = filename.replace('"', '\\"')
    response.headers["Content-Disposition"] = f'{disp_mode}; filename="{safe_disp_filename}"'
    return response


# ============================================================
# Email Attachment View & Download
# ============================================================
@attachment_bp.route("/attachments/<int:att_id>/view", methods=["GET"])
def view_email_attachment(att_id: int):
    """Stream an email attachment inline for in-browser preview (PDF, Image, Text)."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT filename, storage_path, content_type FROM email_attachments WHERE id = ?",
            (att_id,),
        ).fetchone()
        if not row:
            return error_response("ATTACHMENT_NOT_FOUND", f"Attachment #{att_id} not found.", 404)
        return _stream_local_file(
            storage_path=row["storage_path"],
            filename=row["filename"],
            content_type=row["content_type"],
            as_attachment=False,
        )
    finally:
        conn.close()


@attachment_bp.route("/attachments/<int:att_id>/download", methods=["GET"])
def download_email_attachment(att_id: int):
    """Trigger browser download dialog for an email attachment."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT filename, storage_path, content_type FROM email_attachments WHERE id = ?",
            (att_id,),
        ).fetchone()
        if not row:
            return error_response("ATTACHMENT_NOT_FOUND", f"Attachment #{att_id} not found.", 404)
        return _stream_local_file(
            storage_path=row["storage_path"],
            filename=row["filename"],
            content_type=row["content_type"],
            as_attachment=True,
        )
    finally:
        conn.close()


# ============================================================
# Case Document View, Download & Upload
# ============================================================
@attachment_bp.route("/cases/<identifier>/documents/<int:doc_id>/view", methods=["GET"])
def view_case_document(identifier: str, doc_id: int):
    """Stream a case document inline for preview."""
    case = get_case_by_id_or_number(identifier)
    if not case:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT name, file_path, content_type, attachment_id FROM case_documents WHERE id = ? AND case_id = ?",
            (doc_id, case["db_id"]),
        ).fetchone()
        if not row:
            return error_response("DOCUMENT_NOT_FOUND", f"Document #{doc_id} not found on this case.", 404)

        storage_path = row["file_path"]
        content_type = row["content_type"]

        # If file_path is missing, check if linked via attachment_id
        if (not storage_path or not os.path.isfile(storage_path)) and row["attachment_id"]:
            att_row = conn.execute(
                "SELECT storage_path, content_type FROM email_attachments WHERE id = ?",
                (row["attachment_id"],),
            ).fetchone()
            if att_row and att_row["storage_path"] and os.path.isfile(att_row["storage_path"]):
                storage_path = att_row["storage_path"]
                content_type = att_row["content_type"]

        return _stream_local_file(
            storage_path=storage_path,
            filename=row["name"],
            content_type=content_type,
            as_attachment=False,
        )
    finally:
        conn.close()


@attachment_bp.route("/cases/<identifier>/documents/<int:doc_id>/download", methods=["GET"])
def download_case_document(identifier: str, doc_id: int):
    """Trigger browser download dialog for a case document."""
    case = get_case_by_id_or_number(identifier)
    if not case:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT name, file_path, content_type, attachment_id FROM case_documents WHERE id = ? AND case_id = ?",
            (doc_id, case["db_id"]),
        ).fetchone()
        if not row:
            return error_response("DOCUMENT_NOT_FOUND", f"Document #{doc_id} not found on this case.", 404)

        storage_path = row["file_path"]
        content_type = row["content_type"]

        if (not storage_path or not os.path.isfile(storage_path)) and row["attachment_id"]:
            att_row = conn.execute(
                "SELECT storage_path, content_type FROM email_attachments WHERE id = ?",
                (row["attachment_id"],),
            ).fetchone()
            if att_row and att_row["storage_path"] and os.path.isfile(att_row["storage_path"]):
                storage_path = att_row["storage_path"]
                content_type = att_row["content_type"]

        return _stream_local_file(
            storage_path=storage_path,
            filename=row["name"],
            content_type=content_type,
            as_attachment=True,
        )
    finally:
        conn.close()


@attachment_bp.route("/cases/<identifier>/documents/upload", methods=["POST"])
def upload_case_document_route(identifier: str):
    """Upload a manual supporting document or checklist file via multipart/form-data."""
    case = get_case_by_id_or_number(identifier)
    if not case:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)

    file_obj = request.files.get("file")
    if not file_obj or not file_obj.filename:
        return error_response("MISSING_FILE", "No file uploaded. Please provide a file.", 400)

    filename = file_obj.filename.strip()
    payload = file_obj.read()
    if not payload:
        return error_response("EMPTY_FILE", "The uploaded file is empty.", 400)

    # 25 MB limit check
    if len(payload) > 25 * 1024 * 1024:
        return error_response("FILE_TOO_LARGE", "File exceeds maximum 25 MB size limit.", 400)

    content_type = file_obj.mimetype or "application/octet-stream"
    doc_type = request.form.get("doc_type") or request.form.get("type") or "SUPPORTING_DOCUMENT"
    uploaded_by = request.form.get("uploaded_by") or request.form.get("user") or "Vaibhav (HR)"
    target_doc_id = request.form.get("doc_id") or request.form.get("target_doc_id")
    target_doc_id = int(target_doc_id) if target_doc_id and str(target_doc_id).isdigit() else None
    notes = request.form.get("notes")

    try:
        docs_info = upload_case_document(
            identifier=case["db_id"],
            filename=filename,
            payload=payload,
            content_type=content_type,
            doc_type=doc_type,
            uploaded_by=uploaded_by,
            target_doc_id=target_doc_id,
            notes=notes,
        )
        detail = get_full_case_detail(case["db_id"])
        return success_response({
            **docs_info,
            "detail": detail,
            "message": f"Document '{filename}' successfully uploaded.",
        })
    except Exception as e:
        return error_response("UPLOAD_ERROR", f"Failed to upload document: {e}", 500)


@attachment_bp.route("/cases/<identifier>/documents/<int:doc_id>/status", methods=["POST"])
def update_case_document_status_route(identifier: str, doc_id: int):
    """Quick endpoint for HR to Verify or Reject a case document."""
    case = get_case_by_id_or_number(identifier)
    if not case:
        return error_response("CASE_NOT_FOUND", f"Case '{identifier}' not found.", 404)

    payload = request.get_json(silent=True) or {}
    status = payload.get("status") or "VERIFIED"
    notes = payload.get("notes")
    user = payload.get("user") or "Vaibhav (HR)"

    try:
        docs_info = update_case_document_status(
            identifier=case["db_id"],
            doc_id=doc_id,
            status=status,
            notes=notes,
            performed_by=user,
        )
        detail = get_full_case_detail(case["db_id"])
        return success_response({
            **docs_info,
            "detail": detail,
            "message": f"Document #{doc_id} marked {status}.",
        })
    except ValueError as ve:
        return error_response("INVALID_STATUS", str(ve), 400)
    except Exception as e:
        return error_response("STATUS_ERROR", f"Failed to update document status: {e}", 500)

