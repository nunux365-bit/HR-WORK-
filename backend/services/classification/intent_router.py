"""
HR FLOW — Phase 6.5 Intent Router Service (backend/services/classification/intent_router.py)
"""

from typing import Dict, Any
from backend.classification.intent_model_service import predict_specialized_intent


def classify_email_intent(category: str, email_payload: Dict[str, Any]) -> Dict[str, Any]:
    return predict_specialized_intent(
        category=category,
        subject=email_payload.get("subject") or "",
        body=email_payload.get("body") or "",
    )


def classify_intent_for_category(category: str, subject: str, body: str) -> Dict[str, Any]:
    return predict_specialized_intent(category=category, subject=subject, body=body)
