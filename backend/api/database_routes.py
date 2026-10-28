from flask import Blueprint

from backend.api import success_response, error_response
from backend.database.connection import (
    check_database_connection,
    get_database_path,
)


database_bp = Blueprint(
    "database",
    __name__,
    url_prefix="/api/database",
)


@database_bp.get("/status")
def database_status():
    try:
        online = check_database_connection()

        return success_response({
            "status": "online" if online else "offline",
            "database": "sqlite",
            "path": str(get_database_path()),
        })

    except Exception as exc:
        return error_response(
            code="DATABASE_ERROR",
            message=str(exc),
            status_code=500,
        )
