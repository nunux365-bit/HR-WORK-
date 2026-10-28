"""
HR Flow - API Helpers & Blueprint Registration (backend/api/__init__.py)
"""

from datetime import datetime, timezone
from typing import Any, Optional
from flask import jsonify


def success_response(data: Any = None, status_code: int = 200):
    payload = {
        "success": True,
        "status": "success",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }
    if isinstance(data, dict):
        for k, v in data.items():
            if k not in payload:
                payload[k] = v
    return jsonify(payload), status_code


def error_response(code: str, message: str, status_code: int = 400, details: Optional[Any] = None):
    payload = {
        "success": False,
        "status": "error",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "error": {
            "code": code,
            "message": message,
        },
    }
    if details is not None:
        payload["error"]["details"] = details
    return jsonify(payload), status_code


def register_blueprints(app):
    """Register all API blueprints with the Flask application."""
    from backend.api.health_routes import health_bp
    from backend.api.system_routes import system_bp
    from backend.api.database_routes import database_bp
    from backend.api.gmail_routes import gmail_bp
    from backend.api.auth_routes import auth_bp
    from backend.api.employee_routes import employee_bp
    from backend.api.email_routes import email_bp
    from backend.api.case_routes import case_bp
    from backend.api.task_routes import task_bp, approval_bp
    from backend.api.workflow_routes import workflow_bp
    from backend.api.classification_routes import classification_bp
    from backend.api.audit_routes import audit_bp
    from backend.api.settings_routes import settings_bp
    from backend.api.integration_routes import integration_bp
    from backend.api.action_routes import action_bp
    from backend.api.user_routes import user_bp
    from backend.api.agent_routes import agent_bp
    from backend.api.attachment_routes import attachment_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(system_bp)
    app.register_blueprint(database_bp)
    app.register_blueprint(gmail_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(employee_bp)
    app.register_blueprint(email_bp)
    app.register_blueprint(case_bp)
    app.register_blueprint(task_bp)
    app.register_blueprint(approval_bp)
    app.register_blueprint(workflow_bp)
    app.register_blueprint(classification_bp)
    app.register_blueprint(audit_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(integration_bp)
    app.register_blueprint(action_bp)
    app.register_blueprint(user_bp)
    app.register_blueprint(agent_bp)
    app.register_blueprint(attachment_bp)


register_api_blueprints = register_blueprints

