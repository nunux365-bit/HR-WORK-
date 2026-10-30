"""
HR FLOW — Phase 2.5 Health API Route (backend/api/health_routes.py)
"""

from flask import Blueprint, jsonify
from backend.config import Config

health_bp = Blueprint("health", __name__)


@health_bp.route("/api/health", methods=["GET"])
def get_health():
    """Simplest backend liveness diagnostic."""
    return jsonify({
        "status": "ok",
        "service": Config.APP_NAME,
        "version": Config.APP_VERSION
    }), 200
