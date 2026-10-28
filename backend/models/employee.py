"""
HR FLOW — Phase 5 Employee Repository & Database Operations (backend/models/employee.py)
Provides clean SQLite persistence and query operations for the `employees` table.
"""

from typing import Dict, Any, List, Optional, Union
from backend.database.connection import get_connection


def _row_to_employee_dict(row) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    return {
        "db_id": int(row["id"]),
        "id": row["employee_id"],
        "employee_id": row["employee_id"],
        "name": row["name"],
        "email": row["email"],
        "department": row["department"],
        "designation": row["designation"],
        "manager_name": row["manager_name"],
        "location": row["location"],
        "source": row["source"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def generate_next_employee_id(conn=None) -> str:
    """Generate next sequential EMPxxxx code when an employee is created without an explicit ID."""
    owns_conn = conn is None
    if owns_conn:
        conn = get_connection()
    try:
        rows = conn.execute("SELECT employee_id FROM employees").fetchall()
        existing_codes = {(r["employee_id"] or "").upper().strip() for r in rows}
        max_num = 1000
        for code in existing_codes:
            if code.startswith("EMP") and code[3:].isdigit():
                num = int(code[3:])
                if num < 9000 and num > max_num:
                    max_num = num
        next_num = max_num + 1
        while f"EMP{next_num}" in existing_codes:
            next_num += 1
        return f"EMP{next_num}"
    finally:
        if owns_conn:
            conn.close()


def get_employee_by_db_id(db_id: int) -> Optional[Dict[str, Any]]:
    """Fetch employee by primary key `employees.id`."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM employees WHERE id = ?",
            (int(db_id),),
        ).fetchone()
        return _row_to_employee_dict(row)
    finally:
        conn.close()


def get_employee_by_employee_id(employee_id: str) -> Optional[Dict[str, Any]]:
    """Fetch employee by business code `employees.employee_id` (e.g., EMP1023)."""
    if not employee_id:
        return None
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM employees WHERE UPPER(TRIM(employee_id)) = UPPER(TRIM(?))",
            (employee_id,),
        ).fetchone()
        return _row_to_employee_dict(row)
    finally:
        conn.close()


def get_employees_by_email(email: str) -> List[Dict[str, Any]]:
    """Find employees matching an email address (case-insensitive)."""
    if not email:
        return []
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM employees WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) ORDER BY id ASC",
            (email,),
        ).fetchall()
        return [_row_to_employee_dict(r) for r in rows if r]
    finally:
        conn.close()


def search_employees_by_name(name_query: str) -> List[Dict[str, Any]]:
    """Search employees by exact or partial name (case-insensitive)."""
    if not name_query:
        return []
    clean = name_query.strip()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM employees WHERE LOWER(name) LIKE LOWER(?) ORDER BY id ASC",
            (f"%{clean}%",),
        ).fetchall()
        return [_row_to_employee_dict(r) for r in rows if r]
    finally:
        conn.close()


def list_employees(
    limit: int = 100,
    offset: int = 0,
    search: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """List employees in SQLite with optional search across ID, name, email, or department."""
    conn = get_connection()
    try:
        if search and search.strip():
            q = f"%{search.strip()}%"
            rows = conn.execute(
                """
                SELECT * FROM employees
                WHERE LOWER(employee_id) LIKE LOWER(?)
                   OR LOWER(name) LIKE LOWER(?)
                   OR LOWER(COALESCE(email, '')) LIKE LOWER(?)
                   OR LOWER(COALESCE(department, '')) LIKE LOWER(?)
                ORDER BY id ASC
                LIMIT ? OFFSET ?
                """,
                (q, q, q, q, int(limit), int(offset)),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM employees ORDER BY id ASC LIMIT ? OFFSET ?",
                (int(limit), int(offset)),
            ).fetchall()
        return [_row_to_employee_dict(r) for r in rows if r]
    finally:
        conn.close()


def get_all_employees() -> List[Dict[str, Any]]:
    """Return all employee records for in-memory candidate resolution and fuzzy matching."""
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM employees ORDER BY id ASC").fetchall()
        return [_row_to_employee_dict(r) for r in rows if r]
    finally:
        conn.close()


def create_employee(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a new employee record in SQLite.
    If `employee_id` is omitted, generates the next sequential EMPxxxx code.
    """
    name = (data.get("name") or "").strip()
    if not name:
        raise ValueError("Employee 'name' is required.")

    conn = get_connection()
    try:
        emp_code = (data.get("employee_id") or data.get("id") or "").strip().upper()
        if not emp_code:
            emp_code = generate_next_employee_id(conn)

        email = (data.get("email") or "").strip().lower() or None
        department = (data.get("department") or "").strip() or None
        designation = (data.get("designation") or "").strip() or None
        manager_name = (data.get("manager_name") or data.get("manager") or "").strip() or None
        location = (data.get("location") or "").strip() or None
        source = (data.get("source") or "email").strip()

        cur = conn.execute(
            """
            INSERT INTO employees (
                employee_id,
                name,
                email,
                department,
                designation,
                manager_name,
                location,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                emp_code,
                name,
                email,
                department,
                designation,
                manager_name,
                location,
                source,
            ),
        )
        conn.commit()
        new_id = int(cur.lastrowid)
        row = conn.execute("SELECT * FROM employees WHERE id = ?", (new_id,)).fetchone()
        return _row_to_employee_dict(row)
    finally:
        conn.close()


def update_employee(
    identifier: Union[int, str],
    updates: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """
    Update an employee record by database primary key `id` (int) or `employee_id` code (str).
    Only updates provided keys; preserves existing values when not specified.
    """
    conn = get_connection()
    try:
        if isinstance(identifier, int) or (isinstance(identifier, str) and identifier.isdigit()):
            row = conn.execute("SELECT * FROM employees WHERE id = ?", (int(identifier),)).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM employees WHERE UPPER(TRIM(employee_id)) = UPPER(TRIM(?))",
                (str(identifier),),
            ).fetchone()

        if not row:
            return None

        db_id = int(row["id"])
        allowed_fields = {
            "employee_id": "employee_id",
            "name": "name",
            "email": "email",
            "department": "department",
            "designation": "designation",
            "manager_name": "manager_name",
            "manager": "manager_name",
            "location": "location",
            "source": "source",
        }

        set_clauses = []
        params = []
        for key, col in allowed_fields.items():
            if key in updates and updates[key] is not None:
                val = str(updates[key]).strip()
                if col == "email":
                    val = val.lower()
                elif col == "employee_id":
                    val = val.upper()
                set_clauses.append(f"{col} = ?")
                params.append(val if val != "" else None)

        if set_clauses:
            set_clauses.append("updated_at = CURRENT_TIMESTAMP")
            params.append(db_id)
            sql = f"UPDATE employees SET {', '.join(set_clauses)} WHERE id = ?"
            conn.execute(sql, tuple(params))
            conn.commit()

        updated_row = conn.execute("SELECT * FROM employees WHERE id = ?", (db_id,)).fetchone()
        return _row_to_employee_dict(updated_row)
    finally:
        conn.close()
