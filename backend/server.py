#!/usr/bin/env python3
"""
HR FLOW — Single Backend Entry Point (backend/server.py)
Responsibilities:
  - Create Flask application
  - Initialize SQLite database schema (data/hrflow.db)
  - Load centralized configuration (backend/config.py)
  - Enable CORS
  - Register API blueprints (health, system, database)
  - Configure consistent JSON error handling & application logging
  - Start development server on http://127.0.0.1:5000
"""

import logging
import os
import sys

# Ensure project root is on sys.path so `from backend...` imports work cleanly
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from flask import Flask, send_from_directory, request
from flask_cors import CORS

from backend.config import Config, FRONTEND_DIR
from backend.api import register_api_blueprints, error_response
from backend.database.init_db import initialize_database


def setup_logging():
    """Configure technical application logging (distinct from HR Audit Logs)."""
    os.makedirs(Config.LOGS_DIR, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(os.path.join(Config.LOGS_DIR, "app.log"), encoding="utf-8")
        ]
    )
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    return logging.getLogger("hrflow")


logger = setup_logging()


def create_app() -> Flask:
    """Application factory for the HR Flow Flask backend."""
    app = Flask(__name__, static_folder=FRONTEND_DIR)
    app.config.from_object(Config)

    # Enable CORS for frontend <-> backend communication
    CORS(app, resources={r"/api/*": {"origins": Config.CORS_ORIGINS}})

    # Register API blueprints
    register_api_blueprints(app)

    @app.before_request
    def _remember_portal_base_url():
        Config.get_portal_base_url()

    def _get_browser_session_role() -> str:
        """Return the uppercase role of THIS browser's session (via hrflow_session cookie or Bearer token)."""
        try:
            from backend.api.auth_routes import get_session_user_from_request
            session_prof = get_session_user_from_request()
            if session_prof and session_prof.get("role"):
                r = str(session_prof.get("role")).upper()
                return "ADMIN" if r == "SUPER_ADMIN" else r
            return ""
        except Exception:
            return ""

    # Serve frontend static pages (login.html, dashboard.html, inbox.html, agent.html, css/, js/)
    @app.route("/", methods=["GET"])
    def serve_root():
        from flask import redirect
        role = _get_browser_session_role()
        if not role:
            return redirect("/login.html")
        if role == "HR_AGENT":
            return redirect("/agent.html")
        return send_from_directory(FRONTEND_DIR, "inbox.html")

    @app.route("/api/email/sync", methods=["POST"])
    def serve_email_sync_alias():
        from backend.api.gmail_routes import gmail_sync
        return gmail_sync()

    @app.route("/<path:filename>", methods=["GET"])
    def serve_frontend(filename: str):
        from flask import redirect
        if filename.startswith("api/"):
            return error_response("NOT_FOUND", "API endpoint not found", 404)
        # Server-side guard for Admin & Agent HTML portals based on THIS browser's session cookie
        admin_only_pages = {"inbox.html", "dashboard.html", "agentworktracker.html", "builder.html", "cases.html"}
        if filename in admin_only_pages:
            role = _get_browser_session_role()
            if not role:
                return redirect("/login.html")
            if role == "HR_AGENT":
                return redirect("/agent.html")
        elif filename == "agent.html":
            role = _get_browser_session_role()
            if not role and not request.args.get("welcome_user") and not request.args.get("email"):
                return redirect("/login.html")
        file_path = os.path.join(FRONTEND_DIR, filename)
        if os.path.isfile(file_path):
            return send_from_directory(FRONTEND_DIR, filename)
        return error_response("NOT_FOUND", "Resource not found", 404)

    @app.route("/workflow", defaults={"filename": "index.html"}, methods=["GET"], strict_slashes=False)
    @app.route("/workflow/", defaults={"filename": "index.html"}, methods=["GET"], strict_slashes=False)
    @app.route("/workflow/<path:filename>", methods=["GET"], strict_slashes=False)
    def serve_workflow_builder(filename: str):
        wf_dir = os.path.join(PROJECT_ROOT, "WorkFlow", "frontend")
        file_path = os.path.join(wf_dir, filename)
        if os.path.isfile(file_path):
            return send_from_directory(wf_dir, filename)
        return send_from_directory(wf_dir, "index.html")

    # Consistent JSON Error Handling
    @app.errorhandler(400)
    def handle_bad_request(err):
        return error_response("BAD_REQUEST", "Bad request", 400)

    @app.errorhandler(404)
    def handle_not_found(err):
        return error_response("NOT_FOUND", "Resource not found", 404)

    @app.errorhandler(405)
    def handle_method_not_allowed(err):
        return error_response("METHOD_NOT_ALLOWED", f"Method {request.method} not allowed", 405)

    @app.errorhandler(500)
    def handle_internal_error(err):
        logger.error(f"Internal server error: {err}")
        return error_response("INTERNAL_ERROR", "An unexpected server error occurred", 500)

    return app


app = create_app()
initialize_database()

try:
    from backend.services.classification.model_registry import get_loaded_sklearn_pair

    att_pair = get_loaded_sklearn_pair("ATTENDANCE")
    lv_pair = get_loaded_sklearn_pair("LEAVE")
    logger.info(
        f"Specialized intent models loaded: ATTENDANCE={'OK' if att_pair else 'FALLBACK'}, "
        f"LEAVE={'OK' if lv_pair else 'FALLBACK'}"
    )
except Exception as startup_exc:
    logger.warning(f"Startup pipeline processing warning: {startup_exc}")

try:
    from backend.services.gmail.sync_scheduler import start_background_sync
    # Launch in worker process when Werkzeug reloader is active, or directly when reloader is disabled
    if not Config.DEBUG or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        start_background_sync(interval_seconds=30)
except Exception as sync_exc:
    logger.warning(f"Failed to start background sync scheduler: {sync_exc}")


if __name__ == "__main__":
    print("\nHR FLOW")
    print("Backend starting...\n")
    logger.info("HR Flow backend starting")
    logger.info(f"Environment: {Config.ENV}")
    logger.info("Database initialized")
    logger.info("API routes registered")
    logger.info(f"Server running on {Config.HOST}:{Config.PORT}")
    print(f"\nRunning on:\nhttp://{Config.HOST}:{Config.PORT}\n")

    app.run(
        host=Config.HOST,
        port=Config.PORT,
        debug=Config.DEBUG,
        use_reloader=Config.DEBUG
    )
