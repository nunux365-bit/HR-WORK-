"""
HR FLOW — System Status API Route (backend/api/system_routes.py)
"""

from flask import Blueprint, jsonify
from backend.config import Config
from backend.database.connection import check_database_connection
from backend.services.gmail.gmail_client import get_gmail_status
from backend.services.classification.model_registry import get_all_models_status

system_bp = Blueprint("system", __name__)


@system_bp.route("/api/system/status", methods=["GET"])
def get_system_status():
    """Return current status of major HR Flow platform components."""
    db_online = check_database_connection()
    gmail_info = get_gmail_status()
    models_status = get_all_models_status()

    return jsonify({
        "backend": {
            "status": "online"
        },
        "database": {
            "status": "online" if db_online else "offline"
        },
        "gmail": {
            "status": gmail_info["status"],
            "email": gmail_info["email"],
            "stored_emails_count": gmail_info["stored_emails_count"],
            "last_sync_at": gmail_info["last_sync_at"],
        },
        "ai": {
            "status": Config.AI_CONFIG["status"],
            "models": models_status,
        },
        "models": models_status,
        "workflow_engine": {
            "status": Config.WORKFLOW_ENGINE_CONFIG["status"]
        },
        "case_engine": {
            "status": Config.CASE_ENGINE_CONFIG["status"]
        }
    }), 200
