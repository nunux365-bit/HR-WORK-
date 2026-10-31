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

DEFAULT_NEON_URL = "postgresql://neondb_owner:npg_prCYPycw8L7q@ep-delicate-band-b3531bbp-pooler.c-4.ap-southeast-1.aws.neon.tech/hrflow?sslmode=require"

_BACKUP_LOCK = threading.Lock()
_LAST_BACKUP_TIME = 0
_DEBOUNCE_TIMER: Optional[threading.Timer] = None


def get_neon_url() -> str:
    return (
        os.environ.get("NEON_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
        or DEFAULT_NEON_URL
    ).strip()


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
        return psycopg2.connect(
            dbname=database,
            user=username,
            password=password,
            host=host,
            port=port,
            sslmode="require",
            connect_timeout=10,
        )
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

    _DEBOUNCE_TIMER = threading.Timer(delay_seconds, _run)
    _DEBOUNCE_TIMER.daemon = True
    _DEBOUNCE_TIMER.start()

