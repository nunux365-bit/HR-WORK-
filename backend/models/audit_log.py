"""
HR FLOW — Audit Log Repository (backend/models/audit_log.py)
Supports Phase 6 & Phase 7.25 Audit & Compliance queries and filters (entity_type, entity_id, performed_by, action, date).
"""

import json
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Union
from backend.database.connection import get_connection


def create_audit_log(
    entity_type: str,
    entity_id: Union[str, int],
    action: str,
    description: str,
    performed_by: str = "system",
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            INSERT INTO audit_logs (
                entity_type,
                entity_id,
                action,
                description,
                performed_by,
                metadata
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                str(entity_type).upper(),
                str(entity_id),
                str(action).upper(),
                description,
                performed_by,
                json.dumps(metadata or {}),
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM audit_logs WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _format_audit_row(row)
    finally:
        conn.close()


from datetime import datetime, timezone, timedelta

IST_TZ = timezone(timedelta(hours=5, minutes=30))


def _parse_sqlite_utc_to_local(created_at_str: str) -> Dict[str, str]:
    raw = (created_at_str or "").strip()
    if not raw:
        now_loc = datetime.now(IST_TZ)
        return {
            "time_hms": now_loc.strftime("%I:%M:%S %p"),
            "time_hm": now_loc.strftime("%I:%M %p"),
            "date_time_local": now_loc.strftime("%d %b %Y, %I:%M:%S %p IST"),
            "timestamp_iso": now_loc.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    try:
        clean = raw.replace("T", " ").split(".")[0].replace("Z", "").strip()
        dt_utc = datetime.strptime(clean[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        dt_loc = dt_utc.astimezone(IST_TZ)
        return {
            "time_hms": dt_loc.strftime("%I:%M:%S %p"),
            "time_hm": dt_loc.strftime("%I:%M %p"),
            "date_time_local": dt_loc.strftime("%d %b %Y, %I:%M:%S %p IST"),
            "timestamp_iso": dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    except Exception:
        t_fallback = raw[11:19] if len(raw) >= 19 else (raw[11:16] if len(raw) >= 16 else raw)
        return {
            "time_hms": t_fallback,
            "time_hm": raw[11:16] if len(raw) >= 16 else raw,
            "date_time_local": raw,
            "timestamp_iso": raw,
        }


def _format_audit_row(row) -> Dict[str, Any]:
    if not row:
        return {}
    d = dict(row)
    raw_meta = d.get("metadata")
    try:
        meta = json.loads(raw_meta) if raw_meta else {}
    except Exception:
        meta = {}
    created_at = d.get("created_at") or ""
    t_info = _parse_sqlite_utc_to_local(created_at)
    from_val = meta.get("from") or meta.get("from_state") or meta.get("old_value")
    to_val = meta.get("to") or meta.get("to_state") or meta.get("new_value")
    return {
        "id": d["id"],
        "entity_type": d["entity_type"],
        "entity_id": d["entity_id"],
        "action": d["action"],
        "description": d["description"],
        "performed_by": d["performed_by"],
        "from_value": from_val,
        "to_value": to_val,
        "old_value": from_val,
        "new_value": to_val,
        "reason": meta.get("reason") or meta.get("notes") or meta.get("comments"),
        "metadata": meta,
        "created_at": t_info["date_time_local"],
        "created_at_utc": created_at,
        "timestamp_iso": t_info["timestamp_iso"],
        "time": t_info["time_hms"],
        "time_hm": t_info["time_hm"],
        "text": d["description"],
    }


def list_audit_logs(
    entity_type: Optional[str] = None,
    entity_id: Optional[Union[str, int]] = None,
    performed_by: Optional[str] = None,
    action: Optional[str] = None,
    date_prefix: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 150,
) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        clauses: List[str] = []
        params: List[Any] = []

        if entity_type:
            clauses.append("entity_type = ?")
            params.append(str(entity_type).upper())
        if entity_id is not None and str(entity_id).strip() != "":
            clauses.append("entity_id = ?")
            params.append(str(entity_id).strip())
        if performed_by:
            clauses.append("LOWER(performed_by) LIKE ?")
            params.append(f"%{performed_by.strip().lower()}%")
        if action:
            clauses.append("UPPER(action) LIKE ?")
            params.append(f"%{action.strip().upper()}%")
        if date_prefix:
            clauses.append("created_at LIKE ?")
            params.append(f"{date_prefix.strip()}%")
        if search:
            q = f"%{search.strip().lower()}%"
            clauses.append("(LOWER(description) LIKE ? OR LOWER(action) LIKE ? OR LOWER(performed_by) LIKE ? OR LOWER(entity_id) LIKE ?)")
            params.extend([q, q, q, q])

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        order_dir = "ASC" if (entity_type and entity_id is not None) else "DESC"
        rows = conn.execute(
            f"""
            SELECT * FROM audit_logs
            {where_sql}
            ORDER BY id {order_dir}
            LIMIT ?
            """,
            (*params, int(limit)),
        ).fetchall()
        return [_format_audit_row(r) for r in rows]
    finally:
        conn.close()
