"""
HR FLOW — Automatic 30-Second Background Email Sync Scheduler (backend/services/gmail/sync_scheduler.py)
Continuously polls connected Gmail IMAP mailboxes in a lightweight daemon thread every 30 seconds.
Handles multiple mailboxes, transient network retries, and graceful shutdown.
"""

import logging
import threading
import time
from typing import Dict, Any, List

from backend.database.connection import get_connection
from backend.services.gmail.gmail_client import get_gmail_status, _load_mailboxes_from_db
from backend.services.gmail.gmail_fetcher import sync_gmail_inbox

logger = logging.getLogger("hrflow.sync_scheduler")

_scheduler_thread: threading.Thread = None
_stop_event = threading.Event()
_sync_lock = threading.Lock()
_last_sync_summary: Dict[str, Any] = {
    "last_run_at": None,
    "last_status": "idle",
    "total_cycles": 0,
    "last_new_emails": 0,
    "errors": [],
}


def _get_active_mailbox_emails() -> List[str]:
    """Return all active connected mailbox email addresses."""
    emails: List[str] = []
    try:
        conn = get_connection()
        rows = conn.execute(
            "SELECT email FROM connected_mailboxes WHERE connected = 1"
        ).fetchall()
        conn.close()
        emails = [str(r["email"]).strip().lower() for r in rows if r["email"]]
    except Exception as exc:
        logger.debug(f"Error querying connected_mailboxes: {exc}")

    # Fallback to current default Gmail status email if table is empty
    if not emails:
        st = get_gmail_status()
        if st.get("connected") and st.get("email"):
            emails.append(st["email"].strip().lower())
    return emails


def _run_sync_cycle() -> None:
    """Execute a single sync pass across all connected mailboxes and evaluate 24h auto-close policy."""
    if not _sync_lock.acquire(blocking=False):
        logger.debug("[BackgroundSync] Sync already in progress, skipping cycle.")
        return

    try:
        # 1. Evaluate 24-hour auto-close policy for resolved cases
        try:
            from backend.services.cases.case_service import check_and_auto_close_resolved_cases
            closed_cnt = check_and_auto_close_resolved_cases()
            if closed_cnt > 0:
                logger.info(f"[BackgroundSync] Auto-closed {closed_cnt} case(s) resolved > 24 hours ago.")
        except Exception as auto_close_exc:
            logger.warning(f"[BackgroundSync] 24h auto-close check failed: {auto_close_exc}")

        # 2. Fetch and synchronize emails across connected mailboxes
        _load_mailboxes_from_db()
        mailboxes = _get_active_mailbox_emails()
        if not mailboxes:
            logger.debug("[BackgroundSync] No connected mailboxes found to sync.")
            _last_sync_summary["last_status"] = "no_connected_mailboxes"
            return

        total_new = 0
        cycle_errors = []
        for acct in mailboxes:
            try:
                res = sync_gmail_inbox(account_email=acct)
                new_cnt = res.get("new_stored_count", 0)
                total_new += new_cnt
                if new_cnt > 0:
                    logger.info(
                        f"[BackgroundSync] Mailbox {acct}: fetched {res.get('fetched_count', 0)}, "
                        f"{new_cnt} NEW emails stored."
                    )
            except Exception as acct_exc:
                err_msg = f"Failed to sync {acct}: {acct_exc}"
                logger.warning(f"[BackgroundSync] {err_msg}")
                cycle_errors.append(err_msg)

        _last_sync_summary["last_run_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        _last_sync_summary["last_status"] = "success" if not cycle_errors else "partial_error"
        _last_sync_summary["last_new_emails"] = total_new
        _last_sync_summary["total_cycles"] = _last_sync_summary.get("total_cycles", 0) + 1
        if cycle_errors:
            _last_sync_summary["errors"] = cycle_errors[-5:]
    finally:
        _sync_lock.release()


def _background_sync_loop(interval_seconds: int = 30) -> None:
    """Worker loop that sleeps for `interval_seconds` between sync passes."""
    logger.info(f"[BackgroundSync] Daemon thread started (polling every {interval_seconds}s).")
    # Small initial delay of 4s on startup to let DB initialize and app settle
    if _stop_event.wait(4.0):
        return

    while not _stop_event.is_set():
        try:
            _run_sync_cycle()
        except Exception as loop_exc:
            logger.error(f"[BackgroundSync] Unexpected error in sync loop: {loop_exc}")

        # Wait for the next interval or exit promptly if stop requested
        if _stop_event.wait(interval_seconds):
            break

    logger.info("[BackgroundSync] Daemon thread stopped.")


def start_background_sync(interval_seconds: int = 30) -> None:
    """Start background email synchronization thread if not already running."""
    global _scheduler_thread
    if _scheduler_thread is not None and _scheduler_thread.is_alive():
        logger.debug("[BackgroundSync] Already running.")
        return

    _stop_event.clear()
    _scheduler_thread = threading.Thread(
        target=_background_sync_loop,
        args=(interval_seconds,),
        name="HRFlowEmailSyncDaemon",
        daemon=True,
    )
    _scheduler_thread.start()
    logger.info(f"[BackgroundSync] Background email sync scheduler launched ({interval_seconds}s interval).")


def stop_background_sync() -> None:
    """Signal background sync thread to stop."""
    _stop_event.set()


def get_background_sync_status() -> Dict[str, Any]:
    """Return status of background sync scheduler."""
    is_running = _scheduler_thread is not None and _scheduler_thread.is_alive()
    return {
        "active": is_running,
        "interval_seconds": 30,
        "summary": _last_sync_summary,
    }

