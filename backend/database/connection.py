"""
HR FLOW — Centralized Database Connection Engine (backend/database/connection.py)
Pure PostgreSQL Connection Engine with automatic SQLite compatibility layer.
Directly connects to Neon PostgreSQL (or production Postgres) with:
  - Transparent placeholder mapping (? -> %s)
  - Full sqlite3.Row dict/tuple hybrid row access (row["col"], row[0], dict(row))
  - Case-insensitive column key lookups
  - Automatic lastrowid capture for INSERT statements
  - Pragma no-op absorption (PRAGMA foreign_keys, busy_timeout)
  - Offline local SQLite fallback if cloud Postgres is unreachable
"""

import os
import re
import logging
from pathlib import Path
from urllib.parse import urlparse
from typing import Any, List, Optional, Tuple, Union, Dict

from backend.config import Config

logger = logging.getLogger("hrflow.database")


def get_database_path() -> Path:
    """Return local database file path (used for fallback or disk reference)."""
    path = Path(Config.DATABASE_PATH)
    if not path.is_absolute():
        path = Path(Config.BASE_DIR) / path
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _get_postgres_url() -> Optional[str]:
    """Resolve active PostgreSQL connection URL."""
    url = (
        os.environ.get("DATABASE_URL")
        or os.environ.get("NEON_DATABASE_URL")
        or getattr(Config, "DATABASE_URL", None)
    )
    if url and url.strip().startswith(("postgresql://", "postgres://")):
        return url.strip()
    return None


class PostgresRow:
    """
    Hybrid Row object mirroring sqlite3.Row:
    Supports:
      - row['column_name'] (case-insensitive)
      - row[0] (integer indexing)
      - dict(row) (conversion to dictionary)
      - row.get('col', default)
      - row.keys(), row.values(), row.items()
    """
    __slots__ = ("_keys", "_map", "_values")

    def __init__(self, description, values):
        if description:
            self._keys = [col[0] for col in description]
            self._map = {k.lower(): v for k, v in zip(self._keys, values)}
        else:
            self._keys = []
            self._map = {}
        self._values = tuple(values) if values is not None else ()

    def __getitem__(self, item):
        if isinstance(item, int):
            return self._values[item]
        if isinstance(item, str):
            k = item.lower()
            if k in self._map:
                return self._map[k]
            raise KeyError(item)
        raise TypeError(f"Row indices must be integers or strings, not {type(item).__name__}")

    def get(self, key, default=None):
        if isinstance(key, str):
            return self._map.get(key.lower(), default)
        return default

    def keys(self) -> List[str]:
        return list(self._keys)

    def values(self) -> List[Any]:
        return list(self._values)

    def items(self) -> List[Tuple[str, Any]]:
        return [(k, self._map.get(k.lower())) for k in self._keys]

    def __iter__(self):
        return iter(self._keys)

    def __len__(self) -> int:
        return len(self._values)

    def __contains__(self, key: str) -> bool:
        if isinstance(key, str):
            return key.lower() in self._map
        return False

    def __repr__(self) -> str:
        return f"<PostgresRow {dict(self.items())}>"


def _adapt_sql_placeholders(sql: str) -> str:
    """Convert unquoted ? placeholders to %s for PostgreSQL."""
    out = []
    in_single = False
    in_double = False
    i = 0
    while i < len(sql):
        c = sql[i]
        if c == "'" and not in_double:
            in_single = not in_single
            out.append(c)
        elif c == '"' and not in_single:
            in_double = not in_double
            out.append(c)
        elif c == "?" and not in_single and not in_double:
            out.append("%s")
        else:
            out.append(c)
        i += 1
    return "".join(out)


def _adapt_sqlite_syntax(sql: str) -> Tuple[Optional[str], str]:
    """
    Adapt SQLite-specific SQL commands into standard PostgreSQL:
    Returns (adapted_sql, action_type).
    """
    s = sql.strip()

    # 1. PRAGMA foreign_keys, busy_timeout, journal_mode -> NO-OP
    if re.match(r"^\s*PRAGMA\s+(foreign_keys|busy_timeout|journal_mode|synchronous)", s, re.IGNORECASE):
        return None, "NOOP"

    # 2. PRAGMA table_info(table) -> Query information_schema.columns
    m_info = re.match(r"^\s*PRAGMA\s+table_info\s*\(\s*([a-zA-Z0-9_]+)\s*\)", s, re.IGNORECASE)
    if m_info:
        tbl = m_info.group(1).lower()
        adapted = (
            f"SELECT ordinal_position - 1 AS cid, column_name AS name, data_type AS type, "
            f"CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull, column_default AS dflt_value, 0 AS pk "
            f"FROM information_schema.columns WHERE table_name = '{tbl}' ORDER BY ordinal_position"
        )
        return adapted, "QUERY"

    # 3. BEGIN IMMEDIATE -> NO-OP (PostgreSQL transactions start automatically)
    if re.match(r"^\s*BEGIN\s+(IMMEDIATE|EXCLUSIVE|DEFERRED)?", s, re.IGNORECASE):
        return None, "NOOP"

    # 4. INSERT OR IGNORE INTO -> INSERT INTO ... ON CONFLICT DO NOTHING
    if re.match(r"^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+", s, re.IGNORECASE):
        s = re.sub(r"^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+", "INSERT INTO ", s, flags=re.IGNORECASE)
        if "ON CONFLICT" not in s.upper():
            s = s.rstrip(";").strip() + " ON CONFLICT DO NOTHING"

    # 5. Convert ? placeholders to %s
    converted = _adapt_sql_placeholders(s)
    return converted, "QUERY"


class PostgresCursorWrapper:
    """Wrapper around real psycopg2/pg8000 cursor providing sqlite3-style API."""

    def __init__(self, raw_cursor, connection_wrapper):
        self._cur = raw_cursor
        self._conn_wrapper = connection_wrapper
        self.lastrowid: Optional[int] = None
        self._rows: List[PostgresRow] = []
        self._pos = 0

    @property
    def rowcount(self) -> int:
        return getattr(self._cur, "rowcount", -1)

    @property
    def description(self):
        return getattr(self._cur, "description", None)

    def execute(self, query: str, params: Any = None):
        adapted_sql, action = _adapt_sqlite_syntax(query)
        if action == "NOOP":
            self._rows = []
            self._pos = 0
            self.lastrowid = None
            return self

        # Normalize params to tuple or None
        exec_params = None
        if params is not None:
            if isinstance(params, (list, tuple)):
                exec_params = tuple(params)
            elif isinstance(params, dict):
                exec_params = params
            else:
                exec_params = (params,)

        is_insert = bool(re.match(r"^\s*INSERT\s+INTO\s+([a-zA-Z0-9_]+)", adapted_sql, re.IGNORECASE))
        has_returning = "RETURNING" in adapted_sql.upper()

        if is_insert and not has_returning:
            # Check if this table is known not to have an 'id' column
            m_tbl = re.match(r"^\s*INSERT\s+INTO\s+([a-zA-Z0-9_]+)", adapted_sql, re.IGNORECASE)
            tbl_name = m_tbl.group(1).lower() if m_tbl else ""
            no_id_tables = {"case_sequences", "app_settings", "action_policies", "user_sessions"}

            if tbl_name not in no_id_tables:
                sql_with_returning = adapted_sql.rstrip(";").strip() + " RETURNING id"
                try:
                    self._cur.execute(sql_with_returning, exec_params)
                    row = self._cur.fetchone()
                    if row:
                        self.lastrowid = row[0]
                    self._fetch_and_wrap_rows()
                    return self
                except Exception:
                    # Table may not have 'id' column or RETURNING failed -> rollback to savepoint / retry raw
                    try:
                        self._conn_wrapper._raw_conn.rollback()
                    except Exception:
                        pass

        # Execute standard adapted SQL
        self._cur.execute(adapted_sql, exec_params)
        self._fetch_and_wrap_rows()
        return self

    def _fetch_and_wrap_rows(self):
        desc = self.description
        if desc:
            try:
                raw_rows = self._cur.fetchall()
                self._rows = [PostgresRow(desc, r) for r in raw_rows]
            except Exception:
                self._rows = []
        else:
            self._rows = []
        self._pos = 0

    def executemany(self, query: str, seq_of_params: List[Any]):
        adapted_sql, action = _adapt_sqlite_syntax(query)
        if action == "NOOP":
            return self
        self._cur.executemany(adapted_sql, seq_of_params)
        self._fetch_and_wrap_rows()
        return self

    def fetchone(self) -> Optional[PostgresRow]:
        if self._pos < len(self._rows):
            r = self._rows[self._pos]
            self._pos += 1
            return r
        return None

    def fetchall(self) -> List[PostgresRow]:
        remaining = self._rows[self._pos:]
        self._pos = len(self._rows)
        return remaining

    def fetchmany(self, size: Optional[int] = None) -> List[PostgresRow]:
        if size is None:
            size = 1
        end = min(self._pos + size, len(self._rows))
        chunk = self._rows[self._pos:end]
        self._pos = end
        return chunk

    def close(self):
        try:
            self._cur.close()
        except Exception:
            pass

    def __iter__(self):
        return iter(self.fetchall())


class PostgresConnectionWrapper:
    """Wrapper around raw psycopg2/pg8000 connection mimicking sqlite3.Connection API."""

    def __init__(self, raw_connection):
        self._raw_conn = raw_connection
        self._row_factory = None

    @property
    def row_factory(self):
        return self._row_factory

    @row_factory.setter
    def row_factory(self, val):
        self._row_factory = val

    def cursor(self) -> PostgresCursorWrapper:
        raw_cur = self._raw_conn.cursor()
        return PostgresCursorWrapper(raw_cur, self)

    def execute(self, query: str, params: Any = None) -> PostgresCursorWrapper:
        cur = self.cursor()
        cur.execute(query, params)
        return cur

    def executescript(self, script: str):
        """Execute multiple SQL statements separated by semicolons."""
        statements = [s.strip() for s in script.split(";") if s.strip()]
        cur = self.cursor()
        for s in statements:
            try:
                cur.execute(s)
            except Exception as e:
                logger.debug(f"[POSTGRES] executescript statement skipped: {e}")
        self.commit()
        return cur

    def commit(self):
        try:
            self._raw_conn.commit()
        except Exception:
            pass

    def rollback(self):
        try:
            self._raw_conn.rollback()
        except Exception:
            pass

    def close(self):
        try:
            self._raw_conn.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.rollback()
        else:
            self.commit()


def _connect_postgres(url: str):
    """Attempt raw connection to PostgreSQL using psycopg2 or pg8000."""
    parsed = urlparse(url)
    username = parsed.username
    password = parsed.password
    host = parsed.hostname
    port = parsed.port or 5432
    database = parsed.path.lstrip("/")

    # Try psycopg2
    try:
        import psycopg2
        connect_kwargs = {
            "dbname": database,
            "user": username,
            "password": password,
            "host": host,
            "port": port,
            "sslmode": "require",
            "connect_timeout": 8,
        }
        try:
            raw_conn = psycopg2.connect(**connect_kwargs)
            return PostgresConnectionWrapper(raw_conn)
        except psycopg2.OperationalError as op_err:
            if "could not translate host name" in str(op_err) or "Name or service not known" in str(op_err):
                connect_kwargs["hostaddr"] = "52.76.212.156"
                raw_conn = psycopg2.connect(**connect_kwargs)
                return PostgresConnectionWrapper(raw_conn)
            raise
    except ImportError:
        pass
    except Exception as exc:
        logger.debug(f"[POSTGRES] psycopg2 connection error: {exc}")

    # Fallback to pg8000
    try:
        import pg8000.dbapi
        import ssl
        ssl_ctx = ssl.create_default_context()
        raw_conn = pg8000.dbapi.connect(
            database=database,
            user=username,
            password=password,
            host=host,
            port=port,
            ssl_context=ssl_ctx,
            timeout=10,
        )
        return PostgresConnectionWrapper(raw_conn)
    except ImportError:
        pass
    except Exception as exc:
        logger.debug(f"[POSTGRES] pg8000 connection error: {exc}")

    return None


def get_connection():
    """
    Primary Database Connection Factory:
    Priority:
      1. Pure PostgreSQL connection to Neon / Cloud Postgres
      2. Local SQLite database as offline fallback if cloud Postgres is unreachable
    """
    pg_url = _get_postgres_url()
    if pg_url:
        try:
            conn = _connect_postgres(pg_url)
            if conn:
                return conn
        except Exception as exc:
            logger.warning(f"[DATABASE] Could not connect to PostgreSQL ({exc}); falling back to local SQLite.")

    # Offline / Local fallback to SQLite
    import sqlite3
    sqlite_conn = sqlite3.connect(get_database_path(), timeout=30)
    sqlite_conn.row_factory = sqlite3.Row
    try:
        sqlite_conn.execute("PRAGMA foreign_keys = ON")
    except Exception:
        pass
    return sqlite_conn


def check_database_connection() -> bool:
    """Verify live connectivity to the active database engine."""
    try:
        conn = get_connection()
        cur = conn.execute("SELECT 1")
        row = cur.fetchone()
        conn.close()
        return bool(row)
    except Exception as exc:
        logger.warning(f"[DATABASE] Health check failed: {exc}")
        return False


def execute_query(
    query: str,
    params: Tuple[Any, ...] = (),
    fetch_one: bool = False,
    fetch_all: bool = False,
    commit: bool = False,
) -> Union[Optional[dict], List[dict], int, None]:
    """Execute a query and return standard dictionary results or affected rows."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(query, params)
        if commit:
            conn.commit()
            if query.strip().upper().startswith("INSERT") and cur.lastrowid is not None:
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
