"""
HR FLOW — Phase 6.2 Unified AI Pipeline Service Wrapper (backend/services/classification/ai_pipeline.py)
"""

from backend.classification.ai_pipeline import (
    process_email,
    process_all_emails,
    accept_ai_classification,
    override_email_category,
)

__all__ = [
    "process_email",
    "process_all_emails",
    "accept_ai_classification",
    "override_email_category",
]
