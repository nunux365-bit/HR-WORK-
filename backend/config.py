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

    _INTERNAL_HOSTS = ("127.0.0.1", "localhost", "0.0.0.0", "testserver")

    @classmethod
    def get_portal_base_url(cls, explicit_url: str = "") -> str:
        """
        Dynamically resolve the public Cloud/Portal Base URL for email links (Track Case, Welcome Login, etc.).
        Priority:
          1. Explicit non-internal URL passed by caller
          2. Environment variables:
             - PUBLIC_PORTAL_URL / APP_BASE_URL
             - RENDER_EXTERNAL_URL / RENDER_EXTERNAL_HOSTNAME (Render)
             - RAILWAY_PUBLIC_DOMAIN / RAILWAY_STATIC_URL (Railway)
             - VERCEL_URL (Vercel)
          3. Active Flask request headers (X-Forwarded-Proto + X-Forwarded-Host / Origin / Host)
          4. Last detected non-internal URL from any browser request
          5. Fallback http://127.0.0.1:5000 for local development
        """
        if explicit_url and not any(h in explicit_url for h in cls._INTERNAL_HOSTS):
            clean = explicit_url.strip().rstrip("/")
            cls._LAST_DETECTED_PORTAL_URL = clean
            return clean

        # Check environment variables dynamically (works wherever deployed: Render, Railway, Vercel, AWS)
        env_url = (
            os.environ.get("PUBLIC_PORTAL_URL")
            or os.environ.get("APP_BASE_URL")
            or os.environ.get("RENDER_EXTERNAL_URL")
            or (f"https://{os.environ['RENDER_EXTERNAL_HOSTNAME']}" if os.environ.get("RENDER_EXTERNAL_HOSTNAME") else "")
            or (f"https://{os.environ['RAILWAY_PUBLIC_DOMAIN']}" if os.environ.get("RAILWAY_PUBLIC_DOMAIN") else "")
            or (f"https://{os.environ['RAILWAY_STATIC_URL']}" if os.environ.get("RAILWAY_STATIC_URL") else "")
            or (f"https://{os.environ['VERCEL_URL']}" if os.environ.get("VERCEL_URL") else "")
            or cls.PUBLIC_PORTAL_URL
        )
        if env_url and not any(h in env_url for h in cls._INTERNAL_HOSTS):
            clean_env = env_url.strip().rstrip("/")
            cls._LAST_DETECTED_PORTAL_URL = clean_env
            return clean_env

        try:
            from flask import has_request_context, request
            if has_request_context():
                origin = (request.headers.get("Origin") or "").strip().rstrip("/")
                if origin and not any(h in origin for h in cls._INTERNAL_HOSTS):
                    cls._LAST_DETECTED_PORTAL_URL = origin
                    return origin

                fwd_host = (request.headers.get("X-Forwarded-Host") or request.host or "").split(",")[0].strip()
                fwd_proto = (request.headers.get("X-Forwarded-Proto") or request.scheme or "https").split(",")[0].strip()
                if fwd_host and not any(h in fwd_host for h in cls._INTERNAL_HOSTS):
                    candidate = f"{fwd_proto}://{fwd_host}".rstrip("/")
                    cls._LAST_DETECTED_PORTAL_URL = candidate
                    return candidate

                if request.host_url:
                    h_url = request.host_url.rstrip("/")
                    if not any(h in h_url for h in cls._INTERNAL_HOSTS):
                        cls._LAST_DETECTED_PORTAL_URL = h_url
                        return h_url
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
