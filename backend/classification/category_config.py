"""
HR FLOW — Phase 6.4 & 6.7 Category & Process Field Configuration (backend/classification/category_config.py)
Loads `backend/data/categories.json` and provides helper lookups.
"""

import json
import os
from typing import Dict, Any, List
from backend.config import Config

VALID_CATEGORIES = [
    "LEAVE",
    "ATTENDANCE",
    "PAYROLL",
    "BGV",
    "RESIGNATION",
    "ONBOARDING",
    "DOCUMENTS",
    "ASSET_IT",
    "EMPLOYEE_PROFILE",
    "BENEFITS",
    "PERFORMANCE",
    "GENERAL_HR",
    "UNKNOWN",
]

_CATEGORIES_CACHE: Dict[str, Dict[str, Any]] = {}


def load_category_configs(force_reload: bool = False) -> Dict[str, Dict[str, Any]]:
    global _CATEGORIES_CACHE
    if _CATEGORIES_CACHE and not force_reload:
        return _CATEGORIES_CACHE

    path = os.path.join(Config.BACKEND_DIR, "data", "categories.json")
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
            _CATEGORIES_CACHE = raw.get("categories", {})
    return _CATEGORIES_CACHE


def reload_category_configs() -> Dict[str, Dict[str, Any]]:
    return load_category_configs(force_reload=True)


def save_or_update_category_config(category_code: str, category_payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Persist a new or updated category configuration into `backend/data/categories.json`
    and refresh the in-memory cache so the classifier and validator immediately recognize it.
    """
    global _CATEGORIES_CACHE
    norm = (category_code or "").strip().upper().replace(" ", "_")
    if not norm:
        raise ValueError("Category code is required.")

    path = os.path.join(Config.BACKEND_DIR, "data", "categories.json")
    raw_doc: Dict[str, Any] = {"categories": {}}
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            raw_doc = json.load(f) or {"categories": {}}

    cats = raw_doc.setdefault("categories", {})
    existing = cats.get(norm, {})
    merged = {
        "code": norm,
        "display_name": category_payload.get("display_name") or existing.get("display_name") or norm.replace("_", " ").title(),
        "specialized_model": bool(category_payload.get("specialized_model", existing.get("specialized_model", False))),
        "workflow_id": category_payload.get("workflow_id") or existing.get("workflow_id") or f"WF-{norm}-001",
        "workflow_name": category_payload.get("workflow_name") or existing.get("workflow_name") or f"{norm.replace('_', ' ').title()} Workflow",
        "keywords_strong": category_payload.get("keywords_strong") if category_payload.get("keywords_strong") is not None else existing.get("keywords_strong", []),
        "keywords_weak": category_payload.get("keywords_weak") if category_payload.get("keywords_weak") is not None else existing.get("keywords_weak", []),
        "required_fields": category_payload.get("required_fields") if category_payload.get("required_fields") is not None else existing.get("required_fields", ["employee_id"]),
        "optional_fields": category_payload.get("optional_fields") if category_payload.get("optional_fields") is not None else existing.get("optional_fields", ["description", "attachment"]),
        "require_attachment": bool(category_payload.get("require_attachment", existing.get("require_attachment", False))),
    }
    cats[norm] = merged

    with open(path, "w", encoding="utf-8") as f:
        json.dump(raw_doc, f, indent=2, ensure_ascii=False)

    if norm not in VALID_CATEGORIES:
        VALID_CATEGORIES.insert(max(0, len(VALID_CATEGORIES) - 1), norm)

    _CATEGORIES_CACHE = cats
    return merged


def get_category_config(category: str) -> Dict[str, Any]:
    configs = load_category_configs()
    norm = (category or "UNKNOWN").strip().upper()
    return configs.get(norm) or configs.get("UNKNOWN") or {
        "code": "UNKNOWN",
        "display_name": "Unknown",
        "specialized_model": False,
        "required_fields": [],
        "optional_fields": ["description"],
    }


def list_valid_categories() -> List[str]:
    configs = load_category_configs()
    ordered: List[str] = []
    for c in VALID_CATEGORIES:
        if c not in ordered and c != "UNKNOWN":
            ordered.append(c)
    for k in configs.keys():
        if k not in ordered and k != "UNKNOWN":
            ordered.append(k)
    ordered.append("UNKNOWN")
    return ordered


load_categories_config = load_category_configs


