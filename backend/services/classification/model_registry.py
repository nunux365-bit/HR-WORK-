"""
HR FLOW — Phase 6.5 & Dynamic Specialized AI Model Registry (backend/services/classification/model_registry.py)
Central registry answering: "Which specialized intent model handles this HR category?"
Dynamically discovers any category folder under `backend/classification/models/<category_lower>/`
that contains trained LinearSVC + TF-IDF `.pkl` artifacts and `<category_lower>_intents.json`.
"""

import json
import os
import warnings
from typing import Dict, Any, Optional, Tuple, List
from backend.config import Config

MODELS_ROOT_DIR = os.path.join(Config.BACKEND_DIR, "classification", "models")

MODEL_REGISTRY_CONFIG: Dict[str, Dict[str, Any]] = {
    "ATTENDANCE": {
        "enabled": True,
        "category": "ATTENDANCE",
        "model_type": "LinearSVC",
        "model_path": os.path.join(MODELS_ROOT_DIR, "attendance", "attendance_linear_svm.pkl"),
        "vectorizer_path": os.path.join(MODELS_ROOT_DIR, "attendance", "attendance_tfidf_vectorizer.pkl"),
        "intent_file": os.path.join(MODELS_ROOT_DIR, "attendance", "attendance_intents.json"),
        "metadata_file": os.path.join(MODELS_ROOT_DIR, "attendance", "model_metadata.json"),
        "default_intent_id": "A08",
    },
    "LEAVE": {
        "enabled": True,
        "category": "LEAVE",
        "model_type": "LinearSVC",
        "model_path": os.path.join(MODELS_ROOT_DIR, "leave", "leave_linear_svm.pkl"),
        "vectorizer_path": os.path.join(MODELS_ROOT_DIR, "leave", "leave_tfidf_vectorizer.pkl"),
        "intent_file": os.path.join(MODELS_ROOT_DIR, "leave", "leave_intents.json"),
        "metadata_file": os.path.join(MODELS_ROOT_DIR, "leave", "model_metadata.json"),
        "default_intent_id": "L02",
    },
}

# Cache for loaded (classifier, vectorizer) pairs so .pkl files are loaded once per process
_LOADED_MODELS_CACHE: Dict[str, Tuple[Any, Any]] = {}


def _build_dynamic_category_entry(category: str) -> Optional[Dict[str, Any]]:
    norm = (category or "").strip().upper().replace(" ", "_")
    if not norm or norm == "UNKNOWN":
        return None
    slug = norm.lower()
    cat_dir = os.path.join(MODELS_ROOT_DIR, slug)
    if not os.path.isdir(cat_dir):
        return None

    model_path = os.path.join(cat_dir, f"{slug}_linear_svm.pkl")
    vec_path = os.path.join(cat_dir, f"{slug}_tfidf_vectorizer.pkl")
    intent_file = os.path.join(cat_dir, f"{slug}_intents.json")
    metadata_file = os.path.join(cat_dir, "model_metadata.json")

    has_intents = os.path.isfile(intent_file)
    has_pkl = os.path.isfile(model_path) and os.path.isfile(vec_path)
    if not (has_intents or has_pkl):
        return None

    default_intent_id = None
    if os.path.isfile(metadata_file):
        try:
            with open(metadata_file, "r", encoding="utf-8") as f:
                meta = json.load(f)
                default_intent_id = meta.get("default_intent_id")
        except Exception:
            pass
    if not default_intent_id and has_intents:
        try:
            with open(intent_file, "r", encoding="utf-8") as f:
                raw = json.load(f)
                intents_dict = raw.get("intents", raw) if isinstance(raw, dict) else {}
                if intents_dict:
                    default_intent_id = sorted(intents_dict.keys())[0]
        except Exception:
            pass

    return {
        "enabled": True,
        "category": norm,
        "model_type": "LinearSVC",
        "model_path": model_path,
        "vectorizer_path": vec_path,
        "intent_file": intent_file,
        "metadata_file": metadata_file,
        "default_intent_id": default_intent_id or f"{norm[:1]}01",
    }


def load_model_registry() -> Dict[str, Dict[str, Any]]:
    """
    Return the combined registry of static + dynamically discovered category models.
    """
    registry: Dict[str, Dict[str, Any]] = dict(MODEL_REGISTRY_CONFIG)
    if os.path.isdir(MODELS_ROOT_DIR):
        for entry in sorted(os.listdir(MODELS_ROOT_DIR)):
            sub_path = os.path.join(MODELS_ROOT_DIR, entry)
            if os.path.isdir(sub_path) and not entry.startswith("__"):
                cat_upper = entry.upper()
                dyn_cfg = _build_dynamic_category_entry(cat_upper)
                if dyn_cfg:
                    registry[cat_upper] = dyn_cfg
                    MODEL_REGISTRY_CONFIG[cat_upper] = dyn_cfg
    return registry


def invalidate_model_cache(category: Optional[str] = None) -> None:
    """
    Clear cached (LinearSVC, TfidfVectorizer) pair so freshly trained .pkl models hot-reload.
    """
    if category:
        norm = category.strip().upper().replace(" ", "_")
        _LOADED_MODELS_CACHE.pop(norm, None)
        dyn_cfg = _build_dynamic_category_entry(norm)
        if dyn_cfg:
            MODEL_REGISTRY_CONFIG[norm] = dyn_cfg
    else:
        _LOADED_MODELS_CACHE.clear()
        load_model_registry()


def get_model_config_for_category(category: str) -> Optional[Dict[str, Any]]:
    norm = (category or "").strip().upper().replace(" ", "_")
    cfg = MODEL_REGISTRY_CONFIG.get(norm)
    if not cfg:
        cfg = _build_dynamic_category_entry(norm)
        if cfg:
            MODEL_REGISTRY_CONFIG[norm] = cfg
    if not cfg or not cfg.get("enabled"):
        return None
    return cfg


def get_loaded_sklearn_pair(category: str) -> Optional[Tuple[Any, Any]]:
    """
    Load and cache (LinearSVC, TfidfVectorizer) from disk for any configured category.
    Returns None if .pkl files or joblib/sklearn are unavailable.
    """
    norm = (category or "").strip().upper().replace(" ", "_")
    if norm in _LOADED_MODELS_CACHE:
        return _LOADED_MODELS_CACHE[norm]

    cfg = get_model_config_for_category(norm)
    if not cfg:
        return None

    model_path = cfg.get("model_path")
    vec_path = cfg.get("vectorizer_path")
    if not (model_path and vec_path and os.path.isfile(model_path) and os.path.isfile(vec_path)):
        return None

    try:
        import joblib

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            clf = joblib.load(model_path)
            vec = joblib.load(vec_path)
        _LOADED_MODELS_CACHE[norm] = (clf, vec)
        return clf, vec
    except Exception:
        return None


def load_model_metadata(category: str) -> Dict[str, Any]:
    cfg = get_model_config_for_category(category)
    if not cfg or not os.path.isfile(cfg["metadata_file"]):
        return {}
    try:
        with open(cfg["metadata_file"], "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def get_all_models_status() -> Dict[str, str]:
    from backend.classification.category_config import list_valid_categories
    load_model_registry()
    statuses: Dict[str, str] = {}
    all_cats = set(list_valid_categories()) | set(MODEL_REGISTRY_CONFIG.keys())
    for cat in sorted(all_cats):
        if cat == "UNKNOWN":
            continue
        cfg = get_model_config_for_category(cat)
        if not cfg:
            statuses[cat.lower()] = "not_configured"
        elif (
            os.path.isfile(cfg["model_path"])
            and os.path.isfile(cfg["vectorizer_path"])
            and os.path.isfile(cfg["intent_file"])
        ):
            statuses[cat.lower()] = "loaded"
        elif os.path.isfile(cfg["intent_file"]):
            statuses[cat.lower()] = "loaded"
        else:
            statuses[cat.lower()] = "not_configured"
    return statuses


def load_intents_catalog(category: str) -> Dict[str, Dict[str, Any]]:
    """
    Load and normalize intents from <category>_intents.json.
    Supports both flat mapping {"A01": "Attendance Missing", ...}
    and nested {"intents": {"A01": {"name": "...", "keywords": [...]}}}.
    Always returns {"A01": {"id": "A01", "name": "Attendance Missing", "keywords": [...]}, ...}.
    """
    cfg = get_model_config_for_category(category)
    if not cfg or not os.path.isfile(cfg["intent_file"]):
        return {}
    with open(cfg["intent_file"], "r", encoding="utf-8") as f:
        data = json.load(f)

    raw_intents = data.get("intents", data) if isinstance(data, dict) else {}
    normalized: Dict[str, Dict[str, Any]] = {}
    for code, val in raw_intents.items():
        if isinstance(val, str):
            normalized[code] = {"id": code, "name": val, "keywords": []}
        elif isinstance(val, dict):
            normalized[code] = {
                "id": code,
                "name": val.get("name", code),
                "keywords": val.get("keywords", []),
            }
    return normalized


def get_category_ai_summary(category: str) -> Dict[str, Any]:
    """
    Return a comprehensive AI readiness summary for a given HR Category (Stage 1 + Stage 2).
    Used by the HR Departments UI to show model training status, intents, and accuracy.
    """
    from backend.classification.category_config import get_category_config

    norm = (category or "").strip().upper().replace(" ", "_")
    cat_cfg = get_category_config(norm)
    model_cfg = get_model_config_for_category(norm)
    intents = load_intents_catalog(norm) if model_cfg else {}
    meta = load_model_metadata(norm) if model_cfg else {}

    has_pkl = bool(
        model_cfg
        and os.path.isfile(model_cfg.get("model_path", ""))
        and os.path.isfile(model_cfg.get("vectorizer_path", ""))
    )
    has_intents = bool(intents)

    perf = meta.get("performance", {}) if isinstance(meta.get("performance"), dict) else {}
    accuracy = (
        meta.get("training_accuracy")
        or perf.get("validation_accuracy")
        or perf.get("train_accuracy")
        or (1.0 if has_pkl else None)
    )
    dataset_info = meta.get("dataset", {}) if isinstance(meta.get("dataset"), dict) else {}
    samples_count = (
        meta.get("training_samples")
        or dataset_info.get("total_examples")
        or dataset_info.get("train_examples")
        or 0
    )
    tfidf_info = meta.get("tfidf", {}) if isinstance(meta.get("tfidf"), dict) else {}
    tfidf_features = (
        meta.get("tfidf_features")
        or tfidf_info.get("vocabulary_size")
        or 0
    )
    model_version = meta.get("model_version") or meta.get("version") or ("V1.0" if (has_pkl or has_intents) else None)

    return {
        "category": norm,
        "display_name": cat_cfg.get("display_name") or norm.title(),
        "trained": bool(has_pkl or has_intents),
        "has_sklearn_pkl": has_pkl,
        "model_type": "LinearSVC + TF-IDF" if has_pkl else ("Intent Catalog + Keyword SVM" if has_intents else "Keyword Router Only"),
        "model_version": model_version,
        "intent_count": len(intents),
        "intents": {k: v.get("name", k) for k, v in intents.items()},
        "training_samples": int(samples_count or 0),
        "tfidf_features": int(tfidf_features or 0),
        "training_accuracy": round(float(accuracy) * 100, 1) if accuracy is not None and float(accuracy) <= 1.0 else (round(float(accuracy), 1) if accuracy is not None else None),
        "keywords_strong": cat_cfg.get("keywords_strong", []),
        "keywords_weak": cat_cfg.get("keywords_weak", []),
        "required_fields": cat_cfg.get("required_fields", ["employee_id"]),
        "trained_at": meta.get("created_at") or meta.get("trained_at"),
    }


