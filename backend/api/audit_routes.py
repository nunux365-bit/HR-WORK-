"""
HR Flow - Audit & Compliance API Routes (Phase 7.25)
"""

from flask import Blueprint, request
from backend.api import success_response
from backend.models.audit_log import list_audit_logs

audit_bp = Blueprint("audit", __name__, url_prefix="/api/audit")


@audit_bp.route("/logs", methods=["GET"])
def get_logs():
    entity_type = request.args.get("entity_type")
    entity_id = request.args.get("entity_id") or request.args.get("case")
    performed_by = request.args.get("performed_by") or request.args.get("user")
    action = request.args.get("action")
    date_filter = request.args.get("date")
    search = request.args.get("search")
    limit = int(request.args.get("limit", 100))

    logs = list_audit_logs(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        performed_by=performed_by,
        date_prefix=date_filter,
        search=search,
        limit=limit,
    )
    return success_response({"count": len(logs), "logs": logs})


@audit_bp.route("/csat-report", methods=["GET"])
def get_csat_audit_report():
    """
    Returns an Executive Service Quality & CSAT Audit Report for HR Leadership/Admin.
    Includes aggregate score metrics, rating distribution, and detailed docket audit rows.
    """
    from backend.database.connection import get_connection
    from backend.services.cases.feedback_service import get_feedback_summary
    import json

    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT f.id, f.case_id, f.case_number, f.rating, f.tags, f.comments, f.submitted_by, f.created_at,
                   c.title as case_title, c.category, c.status as case_status, c.priority,
                   c.assigned_user, c.resolved_by, c.resolved_at, c.created_at as case_created_at,
                   e.name as employee_name, e.department as employee_department, e.employee_id as employee_code
              FROM case_feedback f
              JOIN cases c ON f.case_id = c.id
              LEFT JOIN employees e ON c.employee_id = e.id
             ORDER BY f.id DESC
            """
        ).fetchall()

        records = []
        for r in rows:
            rec = dict(r)
            try:
                rec["tags"] = json.loads(rec["tags"]) if isinstance(rec["tags"], str) else (rec["tags"] or [])
            except Exception:
                rec["tags"] = []
            rating = rec.get("rating") or 5
            rec["rating_label"] = {1: "Poor", 2: "Fair", 3: "Good", 4: "Great", 5: "Excellent"}.get(rating, "Rating")

            # Calculate turnaround if timestamps exist
            if rec.get("resolved_at") and rec.get("case_created_at"):
                try:
                    from datetime import datetime
                    res_str = str(rec["resolved_at"])[:19].replace("T", " ")
                    cre_str = str(rec["case_created_at"])[:19].replace("T", " ")
                    t_res = datetime.strptime(res_str, "%Y-%m-%d %H:%M:%S")
                    t_cre = datetime.strptime(cre_str, "%Y-%m-%d %H:%M:%S")
                    diff_h = max(0.1, round((t_res - t_cre).total_seconds() / 3600.0, 1))
                    rec["turnaround_hours"] = f"{diff_h}h"
                except Exception:
                    rec["turnaround_hours"] = "--"
            else:
                rec["turnaround_hours"] = "--"

            records.append(rec)

        summary = get_feedback_summary()
        summary["total_records"] = len(records)

        return success_response({
            "summary": summary,
            "records": records,
        })
    finally:
        conn.close()

