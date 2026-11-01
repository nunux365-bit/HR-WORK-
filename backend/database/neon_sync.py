"""
backend/database/neon_sync.py
Automatic two-way cloud persistence between HR Flow and Neon PostgreSQL.
Ensures zero data loss on Render free-tier restarts, sleeps, and rebuilds.
"""

import logging
import os
import threading
import time
import zlib
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

logger = logging.getLogger("hrflow.neon_sync")

DEFAULT_NEON_URL = "postgresql://neondb_owner:npg_prCYPycw8L7q@ep-delicate-band-b3531bbp-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"

_BACKUP_LOCK = threading.Lock()
_LAST_BACKUP_TIME = 0
_DEBOUNCE_TIMER: Optional[threading.Timer] = None


def get_neon_url() -> str:
    neon_env = os.environ.get("NEON_DATABASE_URL")
    if neon_env and neon_env.strip().startswith(("postgres://", "postgresql://")):
        return neon_env.strip()
    db_env = os.environ.get("DATABASE_URL")
    if db_env and db_env.strip().startswith(("postgres://", "postgresql://")):
        return db_env.strip()
    return DEFAULT_NEON_URL.strip()


def get_neon_raw_connection():
    """Connect to Neon PostgreSQL using psycopg2 or pg8000."""
    url = get_neon_url()
    if not url or not url.startswith(("postgres://", "postgresql://")):
        return None

    parsed = urlparse(url)
    username = parsed.username
    password = parsed.password
    host = parsed.hostname
    port = parsed.port or 5432
    database = parsed.path.lstrip("/")

    # Try psycopg2-binary first
    try:
        import psycopg2
        connect_kwargs = {
            "dbname": database,
            "user": username,
            "password": password,
            "host": host,
            "port": port,
            "sslmode": "require",
            "connect_timeout": 5,
        }
        try:
            return psycopg2.connect(**connect_kwargs)
        except psycopg2.OperationalError as op_err:
            # If DNS failed or was unreachable, fallback to direct hostaddr for Neon pooler
            if "could not translate host name" in str(op_err) or "Name or service not known" in str(op_err):
                connect_kwargs["hostaddr"] = "52.76.212.156"
                return psycopg2.connect(**connect_kwargs)
            raise
    except ImportError:
        pass
    except Exception as exc:
        logger.debug(f"psycopg2 connection error: {exc}")

    # Fallback to pg8000 (pure Python)
    try:
        import pg8000.dbapi
        import ssl
        ssl_ctx = ssl.create_default_context()
        return pg8000.dbapi.connect(
            database=database,
            user=username,
            password=password,
            host=host,
            port=port,
            ssl_context=ssl_ctx,
            timeout=10,
        )
    except ImportError:
        pass
    except Exception as exc:
        logger.debug(f"pg8000 connection error: {exc}")

    return None


def ensure_neon_table(conn) -> None:
    """Ensure the persistence table exists in Neon."""
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS hrflow_sqlite_snapshots (
            filename TEXT PRIMARY KEY,
            data BYTEA NOT NULL,
            size_bytes BIGINT NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    conn.commit()
    cur.close()


def restore_db_from_neon(db_path: Optional[str] = None) -> bool:
    """
    Download the latest database snapshot from Neon PostgreSQL and restore
    it to local disk before the application serves requests.
    """
    from backend.config import Config

    target_path = Path(db_path or Config.DATABASE_PATH)
    if not target_path.is_absolute():
        target_path = Path(Config.BASE_DIR) / target_path

    conn = get_neon_raw_connection()
    if not conn:
        logger.info("[NEON] No Neon connection driver available; using local disk.")
        return False

    try:
        ensure_neon_table(conn)
        cur = conn.cursor()
        cur.execute(
            "SELECT data, size_bytes, updated_at FROM hrflow_sqlite_snapshots WHERE filename = %s",
            ("hrflow.db",),
        )
        row = cur.fetchone()
        cur.close()

        if not row or not row[0]:
            logger.info("[NEON] No prior database snapshot found in Neon. Starting fresh.")
            return False

        compressed_data = bytes(row[0])
        try:
            decompressed = zlib.decompress(compressed_data)
        except Exception:
            decompressed = compressed_data

        target_path.parent.mkdir(parents=True, exist_ok=True)
        with open(target_path, "wb") as f:
            f.write(decompressed)

        logger.info(
            f"[NEON] ✅ Successfully restored database from Neon PostgreSQL ({len(decompressed)} bytes, snapshot: {row[2]})"
        )
        return True
    except Exception as exc:
        logger.warning(f"[NEON] Could not restore database from Neon: {exc}")
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass


def backup_db_to_neon(db_path: Optional[str] = None) -> bool:
    """
    Compress and upload current SQLite database to Neon PostgreSQL for permanent persistence.
    """
    from backend.config import Config

    target_path = Path(db_path or Config.DATABASE_PATH)
    if not target_path.is_absolute():
        target_path = Path(Config.BASE_DIR) / target_path

    if not target_path.exists() or target_path.stat().st_size == 0:
        return False

    conn = get_neon_raw_connection()
    if not conn:
        return False

    with _BACKUP_LOCK:
        try:
            ensure_neon_table(conn)
            with open(target_path, "rb") as f:
                raw_bytes = f.read()

            compressed = zlib.compress(raw_bytes, level=6)
            cur = conn.cursor()

            try:
                import psycopg2
                binary_param = psycopg2.Binary(compressed)
            except Exception:
                binary_param = compressed

            cur.execute(
                """
                INSERT INTO hrflow_sqlite_snapshots (filename, data, size_bytes, updated_at)
                VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (filename) DO UPDATE SET
                    data = EXCLUDED.data,
                    size_bytes = EXCLUDED.size_bytes,
                    updated_at = CURRENT_TIMESTAMP;
                """,
                ("hrflow.db", binary_param, len(raw_bytes)),
            )
            conn.commit()
            cur.close()
            logger.info(
                f"[NEON] ☁️ Persisted database snapshot to Neon PostgreSQL ({len(compressed)} compressed bytes, {len(raw_bytes)} original bytes)"
            )
            return True
        except Exception as exc:
            logger.warning(f"[NEON] Could not backup database to Neon: {exc}")
            return False
        finally:
            try:
                conn.close()
            except Exception:
                pass


def trigger_async_backup(delay_seconds: float = 2.0) -> None:
    """Schedule a debounced asynchronous backup to Neon so rapid writes don't lag requests."""
    global _DEBOUNCE_TIMER
    if _DEBOUNCE_TIMER and _DEBOUNCE_TIMER.is_alive():
        _DEBOUNCE_TIMER.cancel()

    def _run():
        backup_db_to_neon()
        sync_case_tables_to_neon()

    _DEBOUNCE_TIMER = threading.Timer(delay_seconds, _run)
    _DEBOUNCE_TIMER.daemon = True
    _DEBOUNCE_TIMER.start()


def sync_case_tables_to_neon(neon_conn=None) -> bool:
    """Sync real operational case tables directly to Neon PostgreSQL."""
    close_conn = False
    if neon_conn is None:
        neon_conn = get_neon_raw_connection()
        close_conn = True

    if not neon_conn:
        return False

    import sqlite3
    from backend.config import Config
    target_path = Path(Config.DATABASE_PATH)
    if not target_path.is_absolute():
        target_path = Path(Config.BASE_DIR) / target_path

    if not target_path.exists():
        return False

    try:
        sqlite_conn = sqlite3.connect(str(target_path))
        sqlite_cur = sqlite_conn.cursor()
        neon_cur = neon_conn.cursor()

        # 1. Employees
        sqlite_cur.execute("SELECT id, employee_id, name, email, department, designation, manager_name, location, source FROM employees")
        emp_rows = sqlite_cur.fetchall()
        for r in emp_rows:
            neon_cur.execute("""
                INSERT INTO employees (id, employee_id, name, email, department, designation, manager_name, location, source)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    employee_id = EXCLUDED.employee_id,
                    name = EXCLUDED.name,
                    email = EXCLUDED.email,
                    department = EXCLUDED.department,
                    designation = EXCLUDED.designation,
                    manager_name = EXCLUDED.manager_name,
                    location = EXCLUDED.location,
                    source = EXCLUDED.source;
            """, r)

        # 2. Cases
        sqlite_cur.execute("PRAGMA table_info(cases)")
        sqlite_case_cols = [col[1] for col in sqlite_cur.fetchall()]
        sqlite_cur.execute(f"SELECT {', '.join(sqlite_case_cols)} FROM cases")
        case_rows = sqlite_cur.fetchall()

        neon_cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'cases'")
        neon_case_types = {r[0]: r[1] for r in neon_cur.fetchall()}
        common_case_cols = [c for c in sqlite_case_cols if c in neon_case_types]
        col_str = ", ".join(common_case_cols)
        val_placeholders = ", ".join(["%s"] * len(common_case_cols))

        for r in case_rows:
            row_dict = dict(zip(sqlite_case_cols, r))
            vals = []
            for c in common_case_cols:
                v = row_dict[c]
                if neon_case_types.get(c) == 'boolean' and v is not None:
                    v = bool(v)
                vals.append(v)
            updates = ", ".join([f"{c} = EXCLUDED.{c}" for c in common_case_cols if c != "id"])
            q = f"INSERT INTO cases ({col_str}) VALUES ({val_placeholders}) ON CONFLICT (id) DO UPDATE SET {updates};"
            neon_cur.execute(q, vals)

        # 3. Communications
        sqlite_cur.execute("PRAGMA table_info(case_communications)")
        sqlite_comm_cols = [col[1] for col in sqlite_cur.fetchall()]
        sqlite_cur.execute(f"SELECT {', '.join(sqlite_comm_cols)} FROM case_communications")
        comm_rows = sqlite_cur.fetchall()

        neon_cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'case_communications'")
        neon_comm_types = {r[0]: r[1] for r in neon_cur.fetchall()}
        common_comm_cols = [c for c in sqlite_comm_cols if c in neon_comm_types]
        col_str = ", ".join(common_comm_cols)
        val_placeholders = ", ".join(["%s"] * len(common_comm_cols))

        for r in comm_rows:
            row_dict = dict(zip(sqlite_comm_cols, r))
            vals = []
            for c in common_comm_cols:
                v = row_dict[c]
                if neon_comm_types.get(c) == 'boolean' and v is not None:
                    v = bool(v)
                vals.append(v)
            updates = ", ".join([f"{c} = EXCLUDED.{c}" for c in common_comm_cols if c != "id"])
            q = f"INSERT INTO case_communications ({col_str}) VALUES ({val_placeholders}) ON CONFLICT (id) DO UPDATE SET {updates};"
            neon_cur.execute(q, vals)

        # 4. HR Departments
        try:
            neon_cur.execute("""
                CREATE TABLE IF NOT EXISTS hr_departments (
                    id SERIAL PRIMARY KEY,
                    dept_code VARCHAR(100) NOT NULL UNIQUE,
                    team_name VARCHAR(255) NOT NULL UNIQUE,
                    category_scope TEXT NOT NULL,
                    dept_gmail VARCHAR(255) NOT NULL,
                    sla_hours INTEGER NOT NULL DEFAULT 48,
                    default_priority VARCHAR(50) NOT NULL DEFAULT 'MEDIUM',
                    description TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS hr_deleted_departments (
                    dept_code VARCHAR(100) PRIMARY KEY,
                    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS hr_department_members (
                    id SERIAL PRIMARY KEY,
                    dept_id INTEGER NOT NULL REFERENCES hr_departments(id) ON DELETE CASCADE,
                    dept_ids TEXT,
                    team_name VARCHAR(255) NOT NULL,
                    member_name VARCHAR(255) NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    role VARCHAR(50) NOT NULL DEFAULT 'HR_AGENT',
                    designation VARCHAR(255) NOT NULL DEFAULT 'HR Specialist',
                    sub_department VARCHAR(255) NOT NULL DEFAULT 'Salary & Payroll',
                    category_scope TEXT,
                    active SMALLINT NOT NULL DEFAULT 1,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)

            sqlite_cur.execute(
                """
                SELECT id, dept_code, team_name, category_scope, dept_gmail, sla_hours, default_priority, description
                FROM hr_departments
                """
            )
            dept_rows = sqlite_cur.fetchall()
            for d in dept_rows:
                neon_cur.execute(
                    """
                    INSERT INTO hr_departments (id, dept_code, team_name, category_scope, dept_gmail, sla_hours, default_priority, description)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        dept_code = EXCLUDED.dept_code,
                        team_name = EXCLUDED.team_name,
                        category_scope = EXCLUDED.category_scope,
                        dept_gmail = EXCLUDED.dept_gmail,
                        sla_hours = EXCLUDED.sla_hours,
                        default_priority = EXCLUDED.default_priority,
                        description = EXCLUDED.description;
                    """,
                    d,
                )

            # Purge any deleted departments
            sqlite_cur.execute("SELECT dept_code FROM hr_deleted_departments")
            del_rows = sqlite_cur.fetchall()
            for dr in del_rows:
                neon_cur.execute("DELETE FROM hr_departments WHERE dept_code = %s", (dr[0],))
                neon_cur.execute(
                    "INSERT INTO hr_deleted_departments (dept_code) VALUES (%s) ON CONFLICT (dept_code) DO NOTHING",
                    (dr[0],),
                )

            # 5. HR Department Members
            sqlite_cur.execute(
                """
                SELECT id, dept_id, dept_ids, team_name, member_name, email, role, designation, sub_department, category_scope, active
                FROM hr_department_members
                """
            )
            mem_rows = sqlite_cur.fetchall()
            active_mem_ids = [m[0] for m in mem_rows]
            for m in mem_rows:
                neon_cur.execute(
                    """
                    INSERT INTO hr_department_members (id, dept_id, dept_ids, team_name, member_name, email, role, designation, sub_department, category_scope, active)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        dept_id = EXCLUDED.dept_id,
                        dept_ids = EXCLUDED.dept_ids,
                        team_name = EXCLUDED.team_name,
                        member_name = EXCLUDED.member_name,
                        email = EXCLUDED.email,
                        role = EXCLUDED.role,
                        designation = EXCLUDED.designation,
                        sub_department = EXCLUDED.sub_department,
                        category_scope = EXCLUDED.category_scope,
                        active = EXCLUDED.active;
                    """,
                    m,
                )
            if active_mem_ids:
                neon_cur.execute("DELETE FROM hr_department_members WHERE id NOT IN %s", (tuple(active_mem_ids),))
            else:
                neon_cur.execute("DELETE FROM hr_department_members")
        except Exception as d_exc:
            logger.debug(f"[NEON] Could not sync departments to Neon: {d_exc}")

        neon_conn.commit()
        neon_cur.close()
        sqlite_cur.close()
        sqlite_conn.close()
        logger.info("[NEON] 🚀 Real case tables and HR departments synchronized with Neon PostgreSQL.")
        return True
    except Exception as exc:
        logger.warning(f"[NEON] Failed to sync tables to Neon: {exc}")
        return False
    finally:
        if close_conn:
            try:
                neon_conn.close()
            except Exception:
                pass


def hydrate_departments_from_neon(sqlite_conn=None) -> bool:
    """
    If local SQLite has no departments or fewer departments than Neon PostgreSQL,
    hydrate local SQLite tables from Neon so the deployed app on Render
    immediately preserves all departments configured by any admin.
    """
    close_sqlite = False
    if sqlite_conn is None:
        import sqlite3
        from backend.config import Config
        target_path = Path(Config.DATABASE_PATH)
        if not target_path.is_absolute():
            target_path = Path(Config.BASE_DIR) / target_path
        if not target_path.exists():
            return False
        sqlite_conn = sqlite3.connect(str(target_path))
        close_sqlite = True

    neon_conn = get_neon_raw_connection()
    if not neon_conn:
        return False

    try:
        sq_cur = sqlite_conn.cursor()
        neon_cur = neon_conn.cursor()

        sq_cur.execute("SELECT COUNT(*) FROM hr_departments")
        count = sq_cur.fetchone()[0]

        neon_cur.execute("""
            CREATE TABLE IF NOT EXISTS hr_departments (
                id SERIAL PRIMARY KEY,
                dept_code VARCHAR(100) NOT NULL UNIQUE,
                team_name VARCHAR(255) NOT NULL UNIQUE,
                category_scope TEXT NOT NULL,
                dept_gmail VARCHAR(255) NOT NULL,
                sla_hours INTEGER NOT NULL DEFAULT 48,
                default_priority VARCHAR(50) NOT NULL DEFAULT 'MEDIUM',
                description TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS hr_department_members (
                id SERIAL PRIMARY KEY,
                dept_id INTEGER NOT NULL REFERENCES hr_departments(id) ON DELETE CASCADE,
                dept_ids TEXT,
                team_name VARCHAR(255) NOT NULL,
                member_name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL DEFAULT 'HR_AGENT',
                designation VARCHAR(255) NOT NULL DEFAULT 'HR Specialist',
                sub_department VARCHAR(255) NOT NULL DEFAULT 'Salary & Payroll',
                category_scope TEXT,
                active SMALLINT NOT NULL DEFAULT 1,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """)
        neon_conn.commit()

        neon_cur.execute("SELECT COUNT(*) FROM hr_departments")
        neon_count = neon_cur.fetchone()[0]

        if count == 0 and neon_count > 0:
            neon_cur.execute("SELECT id, dept_code, team_name, category_scope, dept_gmail, sla_hours, default_priority, description FROM hr_departments")
            dept_rows = neon_cur.fetchall()
            for d in dept_rows:
                sq_cur.execute("""
                    INSERT OR REPLACE INTO hr_departments (id, dept_code, team_name, category_scope, dept_gmail, sla_hours, default_priority, description)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, d)

            neon_cur.execute("SELECT id, dept_id, dept_ids, team_name, member_name, email, role, designation, sub_department, category_scope, active FROM hr_department_members")
            mem_rows = neon_cur.fetchall()
            for m in mem_rows:
                sq_cur.execute("""
                    INSERT OR REPLACE INTO hr_department_members (id, dept_id, dept_ids, team_name, member_name, email, role, designation, sub_department, category_scope, active)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, m)

            sqlite_conn.commit()
            logger.info(f"[NEON] Hydrated {len(dept_rows)} departments and {len(mem_rows)} members from Neon to local SQLite.")

        neon_cur.close()
        sq_cur.close()
        return True
    except Exception as exc:
        logger.debug(f"[NEON] Could not hydrate departments from Neon: {exc}")
        return False
    finally:
        try:
            neon_conn.close()
        except Exception:
            pass
        if close_sqlite:
            try:
                sqlite_conn.close()
            except Exception:
                pass



