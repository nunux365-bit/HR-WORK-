"""
backend/database/neon_sync.py
Pure PostgreSQL Active Mode:
Direct PostgreSQL connection is active via backend/database/connection.py.
Snapshotting and SQLite replication are retired; database operations are permanently executed in Neon PostgreSQL.
"""

import logging
import os
from typing import Optional

logger = logging.getLogger("hrflow.neon_sync")

DEFAULT_NEON_URL = "postgresql://neondb_owner:npg_prCYPycw8L7q@ep-delicate-band-b3531bbp-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"


def get_neon_url() -> str:
    neon_env = os.environ.get("NEON_DATABASE_URL")
    if neon_env and neon_env.strip().startswith(("postgres://", "postgresql://")):
        return neon_env.strip()
    db_env = os.environ.get("DATABASE_URL")
    if db_env and db_env.strip().startswith(("postgres://", "postgresql://")):
        return db_env.strip()
    return DEFAULT_NEON_URL.strip()


def get_neon_raw_connection():
    """Returns a raw connection using connection.py."""
    from backend.database.connection import _connect_postgres
    return _connect_postgres(get_neon_url())


def ensure_neon_table(conn=None) -> None:
    """No-op in pure PostgreSQL mode."""
    pass


def restore_db_from_neon(db_path: Optional[str] = None) -> bool:
    """Direct PostgreSQL mode active; no local SQLite restore required."""
    logger.info("[NEON] Direct PostgreSQL engine active. Connecting directly to Neon cloud.")
    return True


def backup_db_to_neon(db_path: Optional[str] = None) -> bool:
    """Direct PostgreSQL mode active; transactions persist live."""
    return True


def trigger_async_backup(delay_seconds: float = 3.0) -> None:
    """No-op in direct PostgreSQL mode."""
    pass


def sync_tables_to_neon() -> bool:
    """No-op: changes are committed directly to Neon PostgreSQL."""
    return True


def hydrate_departments_from_neon(sqlite_conn=None) -> bool:
    """No-op: departments reside natively in Neon PostgreSQL."""
    return True
