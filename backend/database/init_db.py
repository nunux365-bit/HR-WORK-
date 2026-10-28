from pathlib import Path
from backend.database.connection import get_connection


_MIGRATION_COLUMNS = {
    "emails": [
        ("account_email", "TEXT"),
        ("category_reason", "TEXT"),
        ("decision_status", "TEXT"),
        ("extracted_fields", "TEXT"),
        ("validation_result", "TEXT"),
        ("is_actionable", "INTEGER DEFAULT 1"),
        ("actionable_reason", "TEXT"),
    ],
    "cases": [
        ("assigned_team", "TEXT"),
        ("assigned_user", "TEXT"),
        ("assigned_user_email", "TEXT"),
        ("last_dispatch_status", "TEXT"),
        ("last_dispatched_at", "TEXT"),
        ("sla_hours", "INTEGER NOT NULL DEFAULT 48"),
        ("workflow_id", "TEXT"),
        ("workflow_state", "TEXT"),
        ("extracted_fields", "TEXT"),
        ("validation_result", "TEXT"),
        ("resolution_type", "TEXT"),
        ("resolution_notes", "TEXT"),
        ("resolved_by", "TEXT"),
        ("resolved_at", "TEXT"),
        ("closed_by", "TEXT"),
        ("reopened_by", "TEXT"),
        ("reopened_at", "TEXT"),
        ("reopen_reason", "TEXT"),
        ("workflow_stages", "TEXT"),
        ("current_step", "INTEGER DEFAULT 1"),
        ("forensic_proof", "TEXT"),
        ("custom_fields", "TEXT"),
        ("draft_reply", "TEXT"),
        ("parent_case_id", "INTEGER"),
        ("merged_into", "TEXT"),
        ("linked_cases", "TEXT"),
        ("followers", "TEXT"),
    ],
    "tasks": [
        ("task_type", "TEXT NOT NULL DEFAULT 'HR_REVIEW'"),
        ("assigned_team", "TEXT"),
        ("created_by", "TEXT NOT NULL DEFAULT 'hr_admin'"),
    ],
    "case_documents": [
        ("file_path", "TEXT"),
        ("content_type", "TEXT DEFAULT 'application/octet-stream'"),
        ("file_size_bytes", "INTEGER DEFAULT 0"),
        ("attachment_id", "INTEGER"),
    ],
    "hr_department_members": [
        ("dept_ids", "TEXT"),
        ("category_scope", "TEXT"),
        ("sub_department", "TEXT DEFAULT 'Salary & Payroll'"),
    ],
    "connected_mailboxes": [
        ("provider", "TEXT DEFAULT 'GMAIL'"),
        ("imap_host", "TEXT DEFAULT 'imap.gmail.com'"),
        ("smtp_host", "TEXT DEFAULT 'smtp.gmail.com'"),
    ],
}


def initialize_database() -> None:
    schema_path = Path(__file__).with_name("schema.sql")
    schema = schema_path.read_text(encoding="utf-8")

    connection = get_connection()
    try:
        connection.executescript(schema)
        for table_name, cols in _MIGRATION_COLUMNS.items():
            existing_rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
            existing_names = {r["name"] for r in existing_rows}
            for col_name, col_type in cols:
                if col_name not in existing_names:
                    connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type}")
        connection.commit()
    finally:
        connection.close()

    try:
        from backend.services.integrations.integration_registry import ensure_default_integrations_seeded
        from backend.services.actions.action_library import ensure_default_action_policies_seeded
        ensure_default_integrations_seeded()
        ensure_default_action_policies_seeded()
    except Exception:
        pass


    try:
        from backend.services.cases.department_service import ensure_default_departments_seeded
        ensure_default_departments_seeded()
    except Exception:
        pass

    try:
        # Seed Admin & normalize any legacy SUPER_ADMIN rows to ADMIN
        ADMIN_EMAIL = "nunux365@gmail.com"
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET role = 'ADMIN' WHERE UPPER(role) = 'SUPER_ADMIN'")
        cursor.execute("UPDATE users SET name = 'Admin' WHERE LOWER(name) IN ('super admin', 'super_admin')")
        cursor.execute("UPDATE hr_department_members SET role = 'ADMIN' WHERE UPPER(role) = 'SUPER_ADMIN'")
        cursor.execute("UPDATE hr_department_members SET member_name = 'Admin' WHERE LOWER(member_name) IN ('super admin', 'super_admin')")
        cursor.execute("UPDATE hr_department_members SET designation = 'Admin' WHERE LOWER(designation) IN ('super admin', 'super_admin')")
        cursor.execute("SELECT id FROM users WHERE email = ?", (ADMIN_EMAIL,))
        if not cursor.fetchone():
            cursor.execute("INSERT INTO users (email, role, name) VALUES (?, ?, ?)", (ADMIN_EMAIL, "ADMIN", "Admin"))
        conn.commit()
        conn.close()
    except Exception as e:
        print("Error seeding admin:", e)



if __name__ == "__main__":
    initialize_database()
    print("Database initialized successfully.")
