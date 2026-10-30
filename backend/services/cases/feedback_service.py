"""
HR FLOW — Case Feedback & CSAT Service (backend/services/cases/feedback_service.py)
Manages employee satisfaction surveys, star ratings (1-5), feedback tags, and metrics.
"""

import json
from typing import Dict, Any, List, Optional, Union
from backend.database.connection import get_connection
from backend.services.audit.audit_service import log_event
from backend.models.case import get_case_by_id_or_number


def submit_case_feedback(
    case_ref: Union[int, str],
    rating: int,
    tags: Optional[List[str]] = None,
    comments: str = "",
    submitted_by: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Records an employee CSAT / feedback rating (1-5 stars) for a case.
    """
    case_obj = get_case_by_id_or_number(case_ref)
    if not case_obj:
        raise ValueError(f"Case '{case_ref}' not found.")

    rating = int(rating)
    if rating < 1 or rating > 5:
        raise ValueError("Rating must be an integer between 1 and 5.")

    case_db_id = int(case_obj["db_id"])
    case_number = str(case_obj["case_number"])
    emp_id = str(case_obj.get("employee_id") or "")
    emp_email = str(case_obj.get("employee_email") or case_obj.get("sender_email") or "")
    submitter = (submitted_by or case_obj.get("employee_name") or emp_email or "Requester").strip()
    tags_clean = [str(t).strip() for t in (tags or []) if str(t).strip()]
    tags_json = json.dumps(tags_clean)
    clean_comments = (comments or "").strip()

    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM case_feedback WHERE case_id = ? OR case_number = ?",
            (case_db_id, case_number),
        ).fetchone()

        if existing:
            feedback_id = int(existing["id"])
            conn.execute(
                """
                UPDATE case_feedback
                   SET rating = ?,
                       tags = ?,
                       comments = ?,
                       submitted_by = ?,
                       created_at = CURRENT_TIMESTAMP
                 WHERE id = ?
                """,
                (rating, tags_json, clean_comments, submitter, feedback_id),
            )
        else:
            cur = conn.execute(
                """
                INSERT INTO case_feedback (
                    case_id,
                    case_number,
                    employee_id,
                    employee_email,
                    rating,
                    tags,
                    comments,
                    submitted_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    case_db_id,
                    case_number,
                    emp_id,
                    emp_email,
                    rating,
                    tags_json,
                    clean_comments,
                    submitter,
                ),
            )
            feedback_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    try:
        rating_label = {1: "Poor", 2: "Fair", 3: "Good", 4: "Great", 5: "Excellent"}.get(rating, "Rating")
        log_event(
            entity_type="CASE",
            entity_id=case_number,
            action="FEEDBACK_RECORDED",
            description=f"{submitter} submitted {rating}-star ({rating_label}) CSAT feedback: {clean_comments or 'No written comments'}",
            performed_by=submitter,
            metadata={
                "rating": rating,
                "rating_label": rating_label,
                "tags": tags_clean,
                "case_number": case_number,
            },
        )
    except Exception:
        pass

    return get_case_feedback(case_number)


def get_case_feedback(case_ref: Union[int, str]) -> Optional[Dict[str, Any]]:
    """
    Retrieves recorded feedback for a case docket.
    """
    conn = get_connection()
    try:
        row = conn.execute(
            """
            SELECT f.*, c.title as case_title, c.status as case_status, c.assigned_user, c.resolved_by
              FROM case_feedback f
              JOIN cases c ON f.case_id = c.id
             WHERE f.case_number = ? OR f.case_id = ?
             ORDER BY f.id DESC LIMIT 1
            """,
            (str(case_ref), str(case_ref)),
        ).fetchone()
        if not row:
            row = conn.execute(
                "SELECT * FROM case_feedback WHERE case_number = ? OR case_id = ? ORDER BY id DESC LIMIT 1",
                (str(case_ref), str(case_ref)),
            ).fetchone()
        if not row:
            return None

        fb = dict(row)
        try:
            fb["tags"] = json.loads(fb["tags"]) if isinstance(fb["tags"], str) else (fb["tags"] or [])
        except Exception:
            fb["tags"] = []
        rating = fb.get("rating") or 5
        fb["rating_label"] = {1: "Poor", 2: "Fair", 3: "Good", 4: "Great", 5: "Excellent"}.get(rating, "Rating")
        return fb
    finally:
        conn.close()


def get_feedback_summary() -> Dict[str, Any]:
    """
    Calculates overall CSAT metrics across all cases.
    """
    conn = get_connection()
    try:
        rows = conn.execute("SELECT rating, tags FROM case_feedback").fetchall()
        total = len(rows)
        if total == 0:
            return {
                "total_responses": 0,
                "average_rating": 0.0,
                "distribution": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
                "csat_percentage": 0.0,
            }

        dist = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        sum_rating = 0
        positive_count = 0
        for r in rows:
            val = int(r["rating"])
            dist[val] = dist.get(val, 0) + 1
            sum_rating += val
            if val >= 4:
                positive_count += 1

        avg = round(sum_rating / total, 2)
        csat_pct = round((positive_count / total) * 100, 1)
        return {
            "total_responses": total,
            "average_rating": avg,
            "distribution": dist,
            "csat_percentage": csat_pct,
        }
    finally:
        conn.close()
