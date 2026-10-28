"""
HR FLOW — Phase 6.9 Case Number Generator (backend/services/cases/case_number.py)
Generates sequential 6-digit zero-padded case numbers: CASE-000001, CASE-000002, ...
"""

import re
from backend.database.connection import get_connection


def generate_next_case_number() -> str:
    conn = get_connection()
    try:
        rows = conn.execute("SELECT case_number FROM cases ORDER BY id DESC LIMIT 50").fetchall()
        max_num = 0
        for r in rows:
            cn = r["case_number"] or ""
            m = re.search(r"(\d+)$", cn)
            if m:
                val = int(m.group(1))
                if val > max_num:
                    max_num = val
        return f"CASE-{max_num + 1:06d}"
    finally:
        conn.close()
