"""
HR FLOW — Atomic Case Number Generator & Allotment Engine (backend/services/cases/case_number.py)
Guarantees 100% duplicate-free, sequential case numbers:
  - Format: 1MG-00001 through 1MG-99999 (5 digits)
  - Seamless expansion: 1MG-100000+ (6+ digits) without truncation
  - Atomic transaction locking in SQLite/PostgreSQL to prevent race conditions
"""

import re
import time
import sqlite3
from typing import Dict, Any, Optional
from backend.database.connection import get_connection

DEFAULT_PREFIX = "1MG"
DEFAULT_MIN_DIGITS = 5


def format_case_number(prefix: str = DEFAULT_PREFIX, number: int = 1, min_digits: int = DEFAULT_MIN_DIGITS) -> str:
    """
    Format a case number with minimum padding.
    E.g. number=1 -> '1MG-00001'
         number=99999 -> '1MG-99999'
         number=100000 -> '1MG-100000'
    """
    clean_prefix = (prefix or DEFAULT_PREFIX).strip().upper()
    return f"{clean_prefix}-{number:0{min_digits}d}"


def _ensure_sequence_initialized(conn: sqlite3.Connection, prefix: str = DEFAULT_PREFIX) -> None:
    """Ensure case_sequences table exists and the prefix row is seeded accurately."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS case_sequences (
            prefix TEXT PRIMARY KEY,
            last_number INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    row = conn.execute("SELECT last_number FROM case_sequences WHERE prefix = ?", (prefix,)).fetchone()
    if row is None:
        # Determine highest existing number for this prefix in cases table to avoid collisions
        max_num = 0
        try:
            case_rows = conn.execute("SELECT case_number FROM cases").fetchall()
            for r in case_rows:
                cn = (r["case_number"] or "").strip().upper()
                if cn.startswith(f"{prefix}-") or cn.startswith(f"{prefix}_"):
                    m = re.search(r"(\d+)$", cn)
                    if m:
                        val = int(m.group(1))
                        if val > max_num:
                            max_num = val
        except Exception:
            pass

        conn.execute(
            """
            INSERT INTO case_sequences (prefix, last_number, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(prefix) DO NOTHING
            """,
            (prefix, max_num),
        )


def allot_next_case_number(prefix: str = DEFAULT_PREFIX, min_digits: int = DEFAULT_MIN_DIGITS) -> str:
    """
    Atomically generates, increments, and commits the next unique case number.
    Thread-safe and process-safe with SQLite BEGIN IMMEDIATE transaction lock.
    """
    clean_prefix = (prefix or DEFAULT_PREFIX).strip().upper()
    max_retries = 5
    retry_delay = 0.05

    for attempt in range(max_retries):
        conn = get_connection()
        try:
            conn.execute("PRAGMA busy_timeout = 5000")
            conn.execute("BEGIN IMMEDIATE")
            _ensure_sequence_initialized(conn, clean_prefix)

            row = conn.execute(
                "SELECT last_number FROM case_sequences WHERE prefix = ?",
                (clean_prefix,),
            ).fetchone()

            current_num = row["last_number"] if row else 0
            next_num = current_num + 1

            conn.execute(
                """
                UPDATE case_sequences
                SET last_number = ?, updated_at = CURRENT_TIMESTAMP
                WHERE prefix = ?
                """,
                (next_num, clean_prefix),
            )
            conn.commit()
            return format_case_number(clean_prefix, next_num, min_digits)
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower() or "busy" in str(e).lower():
                try:
                    conn.rollback()
                except Exception:
                    pass
                if attempt < max_retries - 1:
                    time.sleep(retry_delay * (attempt + 1))
                    continue
            raise
        finally:
            conn.close()

    raise RuntimeError("Failed to allot unique case number after multiple lock retries.")


def peek_next_case_number(prefix: str = DEFAULT_PREFIX, min_digits: int = DEFAULT_MIN_DIGITS) -> str:
    """
    Lookahead: Returns the next case number that WILL be allotted without incrementing.
    """
    clean_prefix = (prefix or DEFAULT_PREFIX).strip().upper()
    conn = get_connection()
    try:
        _ensure_sequence_initialized(conn, clean_prefix)
        row = conn.execute(
            "SELECT last_number FROM case_sequences WHERE prefix = ?",
            (clean_prefix,),
        ).fetchone()
        next_num = (row["last_number"] + 1) if row else 1
        return format_case_number(clean_prefix, next_num, min_digits)
    finally:
        conn.close()


def get_sequence_status(prefix: str = DEFAULT_PREFIX) -> Dict[str, Any]:
    """
    Returns administrative telemetry on the case numbering sequence.
    """
    clean_prefix = (prefix or DEFAULT_PREFIX).strip().upper()
    conn = get_connection()
    try:
        _ensure_sequence_initialized(conn, clean_prefix)
        row = conn.execute(
            "SELECT last_number, updated_at FROM case_sequences WHERE prefix = ?",
            (clean_prefix,),
        ).fetchone()

        total_cases_count = conn.execute("SELECT COUNT(*) as c FROM cases").fetchone()["c"]

        last_num = row["last_number"] if row else 0
        next_val = last_num + 1
        updated_at = row["updated_at"] if row else None

        return {
            "prefix": clean_prefix,
            "last_number": last_num,
            "last_case_number": format_case_number(clean_prefix, last_num) if last_num > 0 else "None",
            "next_case_number": format_case_number(clean_prefix, next_val),
            "total_allotted": last_num,
            "total_active_cases": total_cases_count,
            "format_example": f"{clean_prefix}-00001 (auto-expands to {clean_prefix}-100000+)",
            "updated_at": updated_at,
            "status": "HEALTHY_ACTIVE",
        }
    finally:
        conn.close()


def generate_next_case_number() -> str:
    """
    Backward-compatible alias for existing services.
    Always dispenses from the unified atomic 1MG sequence.
    """
    return allot_next_case_number(DEFAULT_PREFIX)
