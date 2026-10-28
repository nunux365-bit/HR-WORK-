"""
HR Flow - Classification & AI Model Training API Routes (backend/api/classification_routes.py)
"""

import json
from flask import Blueprint, request
from backend.api import success_response, error_response
from backend.classification.category_config import list_valid_categories, load_categories_config
from backend.services.classification.category_router import route_category
from backend.services.classification.intent_router import classify_intent_for_category
from backend.classification.intent_model_service import get_intent_models_status
from backend.services.classification.model_registry import get_category_ai_summary
from backend.services.classification.model_trainer import (
    train_department_intent_model,
    update_department_detection_keywords,
)
from backend.services.cases.case_engine import get_routing_for_category

classification_bp = Blueprint("classification", __name__, url_prefix="/api/classification")


@classification_bp.route("/categories", methods=["GET"])
def list_categories_route():
    return success_response({
        "categories": list_valid_categories(),
        "definitions": load_categories_config(),
    })


@classification_bp.route("/models", methods=["GET"])
def list_models_route():
    return success_response({
        "models": get_intent_models_status(),
    })


@classification_bp.route("/models/<category>", methods=["GET"])
def get_category_model_route(category: str):
    summary = get_category_ai_summary(category)
    return success_response({
        "model": summary,
    })


@classification_bp.route("/keywords", methods=["POST"])
def save_department_keywords_route():
    """
    Stage 1 Setup: Save or update Department Detection Keywords (`keywords_strong` + `keywords_weak`)
    in `backend/data/categories.json` so `category_classifier.py` detects emails for this department.
    """
    body = request.get_json(silent=True) or {}
    category_code = (body.get("category_code") or body.get("category") or "").strip().upper()
    display_name = body.get("display_name")
    keywords_strong = body.get("keywords_strong")
    keywords_weak = body.get("keywords_weak")

    # Also support pasting a raw ChatGPT JSON object directly into a `raw_json` field
    raw_json = body.get("raw_json")
    if isinstance(raw_json, str) and raw_json.strip():
        try:
            cleaned = raw_json.strip()
            if cleaned.startswith("```"):
                lines = cleaned.splitlines()
                if lines and lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip().startswith("```"):
                    lines = lines[:-1]
                cleaned = "\n".join(lines).strip()
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                category_code = category_code or parsed.get("category_code") or parsed.get("category") or ""
                display_name = display_name or parsed.get("display_name")
                if parsed.get("keywords_strong") is not None:
                    keywords_strong = parsed.get("keywords_strong")
                if parsed.get("keywords_weak") is not None:
                    keywords_weak = parsed.get("keywords_weak")
        except Exception:
            pass

    try:
        res = update_department_detection_keywords(
            category_code=category_code,
            keywords_strong=keywords_strong,
            keywords_weak=keywords_weak,
            display_name=display_name,
            required_fields=body.get("required_fields"),
        )
        return success_response({
            "saved": True,
            "result": res,
        })
    except ValueError as ve:
        return error_response("KEYWORD_VALIDATION_ERROR", str(ve), 400)
    except Exception as exc:
        return error_response("KEYWORD_SAVE_ERROR", f"Failed to save department keywords: {exc}", 500)


@classification_bp.route("/train", methods=["POST"])
def train_model_route():
    """
    Stage 2 Setup: Train or retrain a Department's LinearSVC + TF-IDF Intent Model
    using a ChatGPT-generated JSON dataset.
    """
    body = request.get_json(silent=True) or {}
    raw_dataset = body.get("dataset") if isinstance(body.get("dataset"), (dict, str)) else body

    if isinstance(raw_dataset, str):
        try:
            # Strip markdown code fences if user pasted ```json ... ``` from ChatGPT
            cleaned = raw_dataset.strip()
            if cleaned.startswith("```"):
                lines = cleaned.splitlines()
                if lines and lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip().startswith("```"):
                    lines = lines[:-1]
                cleaned = "\n".join(lines).strip()
            dataset_dict = json.loads(cleaned)
        except Exception as exc:
            return error_response("INVALID_JSON", f"Could not parse ChatGPT JSON dataset: {exc}", 400)
    elif isinstance(raw_dataset, dict):
        dataset_dict = dict(raw_dataset)
    else:
        return error_response("VALIDATION_ERROR", "A valid JSON training dataset is required.", 400)

    if body.get("category_code") and not dataset_dict.get("category_code"):
        dataset_dict["category_code"] = body["category_code"]
    if body.get("display_name") and not dataset_dict.get("display_name"):
        dataset_dict["display_name"] = body["display_name"]

    append_existing = bool(body.get("append", True))
    try:
        result = train_department_intent_model(dataset_dict, append_existing=append_existing)
        return success_response({
            "trained": True,
            "result": result,
        })
    except ValueError as ve:
        return error_response("TRAINING_VALIDATION_ERROR", str(ve), 400)
    except Exception as exc:
        return error_response("TRAINING_ERROR", f"Model training failed: {exc}", 500)


@classification_bp.route("/predict", methods=["POST"])
def predict_text_route():
    body = request.get_json(silent=True) or {}
    subject = body.get("subject", "")
    text = body.get("body", body.get("text", ""))
    target_category = (body.get("category") or "").strip().upper()

    cat = route_category(subject=subject, body=text)
    eval_cat = target_category if (target_category and cat["category"] == "UNKNOWN") else cat["category"]
    intent = classify_intent_for_category(eval_cat, subject=subject, body=text)
    target_intent = (
        classify_intent_for_category(target_category, subject=subject, body=text)
        if target_category and target_category != eval_cat
        else intent
    )
    routing = get_routing_for_category(eval_cat)
    return success_response({
        "category": cat,
        "intent": intent,
        "target_intent": target_intent,
        "routing": routing,
    })

