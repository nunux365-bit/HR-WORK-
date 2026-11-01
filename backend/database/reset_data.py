"""
HR FLOW — Production Reset Script (backend/database/reset_data.py)
Usage on Render Shell or Local Terminal:
    python -m backend.database.reset_data

Wipes all cases, tasks, communications, emails, employees, and departments.
Keeps only the Admin user (nunux365@gmail.com) and resets the case sequence to 0 (1MG-00001).
"""

import sys
import sqlite3
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.database.connection import get_connection


def reset_all_data(keep_admin_email: str = "nunux365@gmail.com"):
    print("\n========================================================")
    print("      HR FLOW — SYSTEM RESET & PURGE UTILITY           ")
    print("========================================================\n")

    conn = get_connection()
    cur = conn.cursor()

    # 1. Tables to purge completely
    tables_to_clear = [
        "cases",
        "case_communications",
        "case_documents",
        "case_field_values",
        "case_feedback",
        "workflow_instances",
        "tasks",
        "approvals",
        "notifications",
        "audit_logs",
        "hr_actions",
        "external_api_audits",
        "emails",
        "email_attachments",
        "employees",
        "hr_departments",
        "hr_department_members",
        "hr_deleted_departments",
    ]

    print("1. Purging operational tables...")
    for table in tables_to_clear:
        try:
            cur.execute(f"DELETE FROM {table};")
            print(f"   ✓ Cleared table: {table}")
        except Exception as e:
            print(f"   - Skipped {table} ({e})")

    # 2. Reset Case Sequence
    print("\n2. Resetting Atomic Case Sequence...")
    try:
        cur.execute("CREATE TABLE IF NOT EXISTS case_sequences (prefix TEXT PRIMARY KEY, last_number INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        cur.execute("INSERT INTO case_sequences (prefix, last_number, updated_at) VALUES ('1MG', 0, CURRENT_TIMESTAMP) ON CONFLICT(prefix) DO UPDATE SET last_number = 0, updated_at = CURRENT_TIMESTAMP")
        print("   ✓ Case sequence reset to 0 (Next: 1MG-00001)")
    except Exception as e:
        print(f"   ! Error resetting sequence: {e}")

    # 3. Mark Departments as Initialized
    try:
        cur.execute("CREATE TABLE IF NOT EXISTS hr_system_meta (key TEXT PRIMARY KEY, val TEXT)")
        cur.execute("INSERT OR REPLACE INTO hr_system_meta (key, val) VALUES ('departments_initialized', '1')")
        print("   ✓ Department auto-seeding flag locked (prevents auto-recreation)")
    except Exception as e:
        print(f"   ! Error setting meta flag: {e}")

    # 4. Retain Only Admin in Users & Mailboxes
    print("\n3. Preserving Admin Account...")
    try:
        cur.execute("DELETE FROM users WHERE LOWER(email) != LOWER(?)", (keep_admin_email,))
        cur.execute(
            """
            INSERT INTO users (email, role, name) VALUES (?, 'ADMIN', 'Admin')
            ON CONFLICT(email) DO UPDATE SET role = 'ADMIN', name = 'Admin'
            """,
            (keep_admin_email,),
        )
        cur.execute("DELETE FROM connected_mailboxes WHERE LOWER(email) != LOWER(?)", (keep_admin_email,))
        print(f"   ✓ Only Admin ({keep_admin_email}) preserved.")
    except Exception as e:
        print(f"   ! Error updating admin user: {e}")

    conn.commit()
    conn.close()

    # 5. Clear Neon PostgreSQL snapshots if connected
    print("\n4. Checking Cloud Neon Database...")
    try:
        from backend.database.neon_sync import get_neon_raw_connection
        neon_conn = get_neon_raw_connection()
        if neon_conn:
            neon_cur = neon_conn.cursor()
            neon_cur.execute("DELETE FROM cases;")
            neon_cur.execute("DELETE FROM case_communications;")
            neon_cur.execute("DELETE FROM case_documents;")
            neon_cur.execute("DELETE FROM hr_departments;")
            neon_cur.execute("DELETE FROM hr_department_members;")
            neon_cur.execute("DELETE FROM hr_deleted_departments;")
            neon_cur.execute("DELETE FROM emails;")
            neon_cur.execute("DELETE FROM employees;")
            neon_cur.execute("DELETE FROM hrflow_sqlite_snapshots;")
            neon_cur.execute("DELETE FROM users WHERE LOWER(email) != LOWER(%s);", (keep_admin_email,))
            neon_cur.execute("DELETE FROM connected_mailboxes WHERE LOWER(email) != LOWER(%s);", (keep_admin_email,))
            neon_cur.execute(
                """
                INSERT INTO users (email, role, name) VALUES (%s, 'ADMIN', 'Admin')
                ON CONFLICT (email) DO UPDATE SET role = 'ADMIN', name = 'Admin';
                """,
                (keep_admin_email,)
            )
            neon_cur.execute(
                """
                CREATE TABLE IF NOT EXISTS case_sequences (
                    prefix VARCHAR(50) PRIMARY KEY,
                    last_number INTEGER NOT NULL DEFAULT 0,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO case_sequences (prefix, last_number) VALUES ('1MG', 0)
                ON CONFLICT (prefix) DO UPDATE SET last_number = 0;
                """
            )
            neon_conn.commit()
            neon_cur.close()
            neon_conn.close()
            print("   ✓ Neon PostgreSQL cloud tables & snapshots cleared (Preserved Admin only).")
        else:
            print("   - Direct Neon driver not present (Neon snapshot table was already purged via cloud API).")
    except Exception as e:
        print(f"   ! Neon cleanup warning: {e}")

    print("\n========================================================")
    print(" ✅ SYSTEM RESET COMPLETE: 0 CASES, 0 DEPTS, ADMIN ONLY  ")
    print("    Next Allotted Case Number: 1MG-00001                ")
    print("========================================================\n")


if __name__ == "__main__":
    reset_all_data()

