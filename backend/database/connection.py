from pathlib import Path
import sqlite3
from typing import Any, List, Optional, Tuple, Union

from backend.config import Config


def get_database_path() -> Path:
    path = Path(Config.DATABASE_PATH)

    if not path.is_absolute():
        path = Path(Config.BASE_DIR) / path

    path.parent.mkdir(parents=True, exist_ok=True)

    return path


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(
        get_database_path(),
        timeout=30,
    )

    connection.row_factory = sqlite3.Row

    connection.execute("PRAGMA foreign_keys = ON")

    return connection


def check_database_connection() -> bool:
    try:
        connection = get_connection()

        connection.execute("SELECT 1")

        connection.close()

        return True

    except sqlite3.Error:
        return False


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
