"""
HR FLOW — Phase 6.4 Category Router (backend/services/classification/category_router.py)
"""

from typing import Dict, Any
from backend.classification.category_classifier import classify_hr_category
from backend.classification.category_config import get_category_config, list_valid_categories


def route_email_category(email_payload: Dict[str, Any]) -> Dict[str, Any]:
    return classify_hr_category(
        subject=email_payload.get("subject") or "",
        body=email_payload.get("body") or "",
        sender_email=email_payload.get("sender_email") or "",
    )


def route_category(subject: str, body: str, sender_email: str = "") -> Dict[str, Any]:
    return classify_hr_category(subject=subject, body=body, sender_email=sender_email)
