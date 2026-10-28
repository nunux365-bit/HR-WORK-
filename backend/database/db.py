"""
HR Flow - Database Helper Utilities (backend/database/db.py)
"""

from typing import Any, List, Optional, Tuple, Union
from backend.database.connection import get_connection


def execute_query(
    query: str,
    params: Tuple[Any, ...] = (),
    fetch_one: bool = False,
    fetch_all: bool = False,
    commit: bool = False,
) -> Union[Optional[dict], List[dict], int, None]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(query, params)
        if commit:
            conn.commit()
            if query.strip().upper().startswith("INSERT"):
                return cur.lastrowid
            return cur.rowcount
        if fetch_one:
            row = cur.fetchone()
            return dict(row) if row else None
        if fetch_all:
            rows = cur.fetchall()
            return [dict(r) for r in rows]
        return None
    finally:
        conn.close()
