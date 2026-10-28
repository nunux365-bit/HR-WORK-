"""
HR FLOW — Centralized Configuration System (backend/config.py)
"""

import os

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.abspath(os.path.join(BACKEND_DIR, ".."))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
ENV_FILE_PATH = os.path.join(BACKEND_DIR, ".env")


def _load_env_file(filepath: str):
    """Load key=value pairs from .env into os.environ if not already set."""
    if not os.path.isfile(filepath):
        return
    try:
        from dotenv import load_dotenv
        load_dotenv(filepath)
    except ImportError:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                os.environ.setdefault(key.strip(), val.strip())


_load_env_file(ENV_FILE_PATH)


class Config:
    BASE_DIR = BASE_DIR
    BACKEND_DIR = BACKEND_DIR

    # Application Metadata
    APP_NAME = "HR Flow"
    APP_VERSION = "1.0.0"

    # Server & Environment
    ENV = os.environ.get("FLASK_ENV", "development")
    DEBUG = os.environ.get("FLASK_DEBUG", "true").lower() in ("true", "1", "yes")
    HOST = os.environ.get("HOST", "0.0.0.0")
    PORT = int(os.environ.get("PORT", "5000"))
    SECRET_KEY = os.environ.get("SECRET_KEY", "hrflow-dev-secret-placeholder")
    PUBLIC_PORTAL_URL = (
        os.environ.get("PUBLIC_PORTAL_URL")
        or os.environ.get("APP_BASE_URL")
        or os.environ.get("RENDER_EXTERNAL_URL")
        or (f"https://{os.environ['RAILWAY_PUBLIC_DOMAIN']}" if os.environ.get("RAILWAY_PUBLIC_DOMAIN") else "")
        or ""
    ).strip().rstrip("/")
    _LAST_DETECTED_PORTAL_URL = ""

    @classmethod
    def get_portal_base_url(cls, explicit_url: str = "") -> str:
        """
        Resolve the public Cloud/Portal Base URL for email links (Track Case, Welcome Login, etc.).
        Priority:
          1. Explicit non-localhost URL passed by caller
          2. Environment variable (PUBLIC_PORTAL_URL / APP_BASE_URL / RENDER_EXTERNAL_URL / RAILWAY_PUBLIC_DOMAIN)
          3. Active Flask request headers (X-Forwarded-Proto + X-Forwarded-Host / Origin / Host)
          4. Last detected non-localhost URL from a browser request
          5. Fallback http://127.0.0.1:5000 for local development
        """
        if explicit_url and "127.0.0.1" not in explicit_url and "localhost" not in explicit_url:
            clean = explicit_url.strip().rstrip("/")
            cls._LAST_DETECTED_PORTAL_URL = clean
            return clean

        if cls.PUBLIC_PORTAL_URL:
            return cls.PUBLIC_PORTAL_URL

        try:
            from flask import has_request_context, request
            if has_request_context():
                origin = (request.headers.get("Origin") or "").strip().rstrip("/")
                if origin and "127.0.0.1" not in origin and "localhost" not in origin:
                    cls._LAST_DETECTED_PORTAL_URL = origin
                    return origin

                fwd_host = (request.headers.get("X-Forwarded-Host") or request.host or "").split(",")[0].strip()
                fwd_proto = (request.headers.get("X-Forwarded-Proto") or request.scheme or "https").split(",")[0].strip()
                if fwd_host:
                    candidate = f"{fwd_proto}://{fwd_host}".rstrip("/")
                    if "127.0.0.1" not in candidate and "localhost" not in candidate:
                        cls._LAST_DETECTED_PORTAL_URL = candidate
                    return candidate

                if request.host_url:
                    return request.host_url.rstrip("/")
        except Exception:
            pass

        if cls._LAST_DETECTED_PORTAL_URL:
            return cls._LAST_DETECTED_PORTAL_URL

        return (explicit_url or "http://127.0.0.1:5000").strip().rstrip("/")

    # Phase 3 Database Configuration -> resolves to ~/Desktop/HRWork/data/hrflow.db
    DATABASE_PATH = os.environ.get("DATABASE_PATH", "data/hrflow.db")

    # CORS Origins (supports localhost, local Wi-Fi IPs, tunnels, and cloud domains)
    CORS_ORIGINS = "*"

    # Storage Paths
    STORAGE_DIR = os.path.join(BACKEND_DIR, "storage")
    ATTACHMENTS_DIR = os.path.join(STORAGE_DIR, "attachments")
    LOGS_DIR = os.path.join(STORAGE_DIR, "logs")

    # Phase 4 Gmail Configuration
    GMAIL_HOST = os.environ.get("GMAIL_HOST", "imap.gmail.com")
    GMAIL_PORT = int(os.environ.get("GMAIL_PORT", "993"))
    GMAIL_SMTP_HOST = os.environ.get("GMAIL_SMTP_HOST", "smtp.gmail.com")
    GMAIL_SMTP_PORT = int(os.environ.get("GMAIL_SMTP_PORT", "465"))
    GMAIL_EMAIL = os.environ.get("GMAIL_EMAIL", "").strip()
    GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    GMAIL_SYNC_LIMIT = int(os.environ.get("GMAIL_SYNC_LIMIT", "25"))

    GMAIL_CONFIG = {
        "enabled": True,
        "status": "not_configured",
        "imap_host": GMAIL_HOST,
        "imap_port": GMAIL_PORT,
        "smtp_host": GMAIL_SMTP_HOST,
        "smtp_port": GMAIL_SMTP_PORT,
    }

    # Phase 6 AI, Workflow, and Case Engine Configuration
    AI_CONFIG = {
        "enabled": True,
        "status": "ready",
        "models_dir": os.path.join(BACKEND_DIR, "classification", "models"),
    }

    WORKFLOW_ENGINE_CONFIG = {
        "enabled": True,
        "status": "ready",
    }

    CASE_ENGINE_CONFIG = {
        "enabled": True,
        "status": "ready",
    }
