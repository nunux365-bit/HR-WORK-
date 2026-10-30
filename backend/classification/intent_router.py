"""
HR FLOW — Phase 6.5 Intent Router (backend/classification/intent_router.py)
"""

from typing import Dict, Any
from backend.classification.intent_model_service import predict_specialized_intent


def route_and_classify_intent(category: str, subject: str, body: str) -> Dict[str, Any]:
    return predict_specialized_intent(category=category, subject=subject, body=body)
