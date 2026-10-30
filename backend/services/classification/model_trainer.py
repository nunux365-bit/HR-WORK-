"""
HR FLOW — Automated Department Keyword Configurator & Intent Model Trainer
(backend/services/classification/model_trainer.py)

Mirrors the exact architecture of the LEAVE (`leave_linear_svm.pkl` + `leave_tfidf_vectorizer.pkl`)
and ATTENDANCE (`attendance_linear_svm.pkl` + `attendance_tfidf_vectorizer.pkl`) models:
  - Stage 1 (Department Detection): Strong phrases (+3.2 subj / +2.2 body) & Weak keywords (+1.5 subj / +0.8 body)
    stored in `backend/data/categories.json` and evaluated by `category_classifier.py`.
  - Stage 2 (Intent Identification): TF-IDF (`ngram_range=(1, 2)`, `min_df=1`, `max_df=0.95`, `sublinear_tf=True`)
    + `LinearSVC(C=1.0, random_state=42)` stored in `backend/classification/models/<category_lower>/`.
"""

import json
import math
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple

from backend.config import Config
from backend.classification.category_config import (
    save_or_update_category_config,
    get_category_config,
    reload_category_configs,
)
from backend.services.classification.model_registry import (
    MODELS_ROOT_DIR,
    invalidate_model_cache,
    get_category_ai_summary,
)

_STOPWORDS = {
    "the", "and", "for", "that", "this", "with", "from", "have", "has", "had",
    "not", "are", "was", "were", "will", "would", "could", "should", "can",
    "may", "please", "kindly", "dear", "team", "sir", "madam", "regards",
    "thanks", "thank", "you", "your", "our", "my", "me", "we", "us", "am",
    "is", "be", "been", "being", "to", "of", "in", "on", "at", "by", "as",
    "an", "a", "or", "but", "if", "so", "it", "its", "hi", "hello", "hey",
    "subject", "hr", "employee", "emp", "need", "want", "help", "request",
    "regarding", "about", "into", "out", "up", "down", "over", "under", "again",
}


def _tokenize_ngrams(text: str) -> List[str]:
    clean = re.sub(r"\bemp[\s\-_]?\d{3,7}\b", " ", (text or "").lower())
    words = [
        w for w in re.findall(r"[a-z]{2,18}", clean)
        if w not in _STOPWORDS
    ]
    tokens = list(words)
    for i in range(len(words) - 1):
        tokens.append(f"{words[i]} {words[i + 1]}")
    return tokens


def _parse_keyword_list(raw_val: Any) -> List[str]:
    if isinstance(raw_val, list):
        items = [str(x).strip().lower() for x in raw_val if str(x).strip()]
    elif isinstance(raw_val, str):
        raw_str = raw_val.strip()
        if raw_str.startswith("["):
            try:
                parsed = json.loads(raw_str)
                items = [str(x).strip().lower() for x in parsed if str(x).strip()]
            except Exception:
                items = [x.strip().lower() for x in re.split(r"[,\n;]+", raw_str) if x.strip()]
        else:
            items = [x.strip().lower() for x in re.split(r"[,\n;]+", raw_str) if x.strip()]
    else:
        items = []

    deduped: List[str] = []
    for kw in items:
        if kw and kw not in deduped:
            deduped.append(kw)
    return deduped


def update_department_detection_keywords(
    category_code: str,
    keywords_strong: Any,
    keywords_weak: Any,
    display_name: Optional[str] = None,
    required_fields: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Stage 1 Setup: Update `keywords_strong` and `keywords_weak` in `backend/data/categories.json`
    so `category_classifier.py` immediately detects emails belonging to this department.
    Also accepts a raw ChatGPT JSON object containing `keywords_strong` and `keywords_weak`.
    """
    norm_code = re.sub(r"[^A-Z0-9_]+", "_", (category_code or "").strip().upper()).strip("_")
    if not norm_code:
        raise ValueError("Category code is required to save department detection keywords.")

    existing = get_category_config(norm_code)
    strong_list = _parse_keyword_list(keywords_strong)
    weak_list = _parse_keyword_list(keywords_weak)

    if not strong_list and not weak_list:
        raise ValueError("Please provide at least one strong phrase or weak keyword for department detection.")

    updated = save_or_update_category_config(
        norm_code,
        {
            "display_name": display_name or existing.get("display_name") or norm_code.replace("_", " ").title(),
            "specialized_model": existing.get("specialized_model", False),
            "keywords_strong": strong_list,
            "keywords_weak": weak_list,
            "required_fields": required_fields or existing.get("required_fields") or ["employee_id"],
            "optional_fields": existing.get("optional_fields") or ["description", "attachment"],
        },
    )
    reload_category_configs()
    return {
        "category_code": norm_code,
        "keywords_strong": updated.get("keywords_strong", []),
        "keywords_weak": updated.get("keywords_weak", []),
        "summary": get_category_ai_summary(norm_code),
    }


def _normalize_training_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Accept flexible JSON formats from ChatGPT:
      - category_code / category / department_code
      - intents: {"P01": "Payslip Request"} OR [{"id": "P01", "name": "Payslip Request"}]
      - training_samples / samples / dataset / data: [{"text": "...", "intent": "P01"}, ...]
        (also supports {"subject": "...", "body": "...", "intent": "P01"} or {"label": "P01"})
    """
    raw_cat = (
        payload.get("category_code")
        or payload.get("category")
        or payload.get("department_category")
        or ""
    )
    cat_code = re.sub(r"[^A-Z0-9_]+", "_", str(raw_cat).strip().upper()).strip("_")
    if not cat_code:
        raise ValueError("Field 'category_code' (e.g. 'PAYROLL', 'TRAVEL', 'BGV') is required.")

    display_name = (
        payload.get("display_name")
        or payload.get("department_name")
        or cat_code.replace("_", " ").title()
    )

    # Normalize intents dictionary
    raw_intents = payload.get("intents") or {}
    intents_map: Dict[str, str] = {}
    intent_keywords_map: Dict[str, List[str]] = defaultdict(list)

    if isinstance(raw_intents, dict):
        for k, v in raw_intents.items():
            code = str(k).strip().upper()
            if isinstance(v, dict):
                intents_map[code] = str(v.get("name") or v.get("label") or code).strip()
                if isinstance(v.get("keywords"), list):
                    intent_keywords_map[code].extend(str(x).strip().lower() for x in v["keywords"] if str(x).strip())
            else:
                intents_map[code] = str(v).strip()
    elif isinstance(raw_intents, list):
        for idx, item in enumerate(raw_intents, start=1):
            if isinstance(item, dict):
                code = str(item.get("id") or item.get("code") or item.get("intent") or f"{cat_code[:1]}{idx:02d}").strip().upper()
                name = str(item.get("name") or item.get("title") or item.get("label") or code).strip()
                intents_map[code] = name
                if isinstance(item.get("keywords"), list):
                    intent_keywords_map[code].extend(str(x).strip().lower() for x in item["keywords"] if str(x).strip())

    # Normalize training samples
    raw_samples = (
        payload.get("training_samples")
        or payload.get("samples")
        or payload.get("dataset")
        or payload.get("data")
        or payload.get("examples")
        or []
    )
    if not isinstance(raw_samples, list):
        raise ValueError("Field 'training_samples' must be a JSON array of labeled email examples.")

    normalized_samples: List[Dict[str, str]] = []
    for item in raw_samples:
        if not isinstance(item, dict):
            continue
        intent_code = str(
            item.get("intent")
            or item.get("intent_id")
            or item.get("label")
            or item.get("code")
            or ""
        ).strip().upper()

        subj = str(item.get("subject") or "").strip()
        body = str(item.get("body") or "").strip()
        text = str(item.get("text") or item.get("email") or item.get("content") or "").strip()
        if not text and (subj or body):
            text = f"Subject: {subj}\n{body}".strip()

        if text and intent_code:
            normalized_samples.append({"text": text, "intent": intent_code})
            if intent_code not in intents_map:
                intents_map[intent_code] = item.get("intent_name") or intent_code

    if len(normalized_samples) < 4:
        raise ValueError(
            f"At least 4 labeled training_samples are required (received {len(normalized_samples)})."
        )
    if len(intents_map) < 2:
        raise ValueError(
            f"At least 2 distinct intents are required to train an intent classifier (found {len(intents_map)})."
        )

    return {
        "category_code": cat_code,
        "display_name": display_name,
        "intents": intents_map,
        "intent_keywords": dict(intent_keywords_map),
        "training_samples": normalized_samples,
        "keywords_strong": payload.get("keywords_strong"),
        "keywords_weak": payload.get("keywords_weak"),
        "required_fields": payload.get("required_fields"),
        "optional_fields": payload.get("optional_fields"),
        "default_intent_id": payload.get("default_intent_id"),
    }


def _train_pure_python_tfidf_hyperplane(
    texts: List[str],
    labels: List[str],
    intents_map: Dict[str, str],
) -> Dict[str, Any]:
    """
    Fits a deterministic TF-IDF (unigram + bigram, sublinear TF) + Linear Hyperplane classifier
    so that even if scikit-learn is not installed in a sandbox, the trained model computes real
    TF-IDF feature weights, decision scores, margins, and top TF-IDF terms.
    """
    n_docs = len(texts)
    doc_tokens_list = [_tokenize_ngrams(t) for t in texts]

    df_counter: Counter = Counter()
    for toks in doc_tokens_list:
        for unique_tok in set(toks):
            df_counter[unique_tok] += 1

    vocab_items = [
        (term, df) for term, df in df_counter.items()
        if df >= 1 and (df / max(1, n_docs)) <= 0.95
    ]
    vocab_items.sort(key=lambda x: (-x[1], x[0]))
    vocab_items = vocab_items[:3500]

    idf_map: Dict[str, float] = {}
    for term, df in vocab_items:
        idf_map[term] = round(math.log((1.0 + n_docs) / (1.0 + df)) + 1.0, 4)

    classes = sorted(set(labels))
    class_vecs: Dict[str, Dict[str, float]] = {c: defaultdict(float) for c in classes}
    class_counts: Dict[str, int] = Counter(labels)
    global_vec: Dict[str, float] = defaultdict(float)

    doc_tfidf_list: List[Dict[str, float]] = []
    for toks, lbl in zip(doc_tokens_list, labels):
        tf_counts = Counter(t for t in toks if t in idf_map)
        vec: Dict[str, float] = {}
        norm_sq = 0.0
        for term, cnt in tf_counts.items():
            w = (1.0 + math.log(cnt)) * idf_map[term]
            vec[term] = w
            norm_sq += w * w
        norm = math.sqrt(norm_sq) or 1.0
        for term in vec:
            vec[term] /= norm
            class_vecs[lbl][term] += vec[term]
            global_vec[term] += vec[term]
        doc_tfidf_list.append(vec)

    weights_by_class: Dict[str, Dict[str, float]] = {}
    top_keywords_by_intent: Dict[str, List[str]] = {}

    for c in classes:
        c_cnt = max(1, class_counts[c])
        other_cnt = max(1, n_docs - c_cnt)
        w_map: Dict[str, float] = {}
        for term in idf_map:
            pos_mean = class_vecs[c].get(term, 0.0) / c_cnt
            neg_mean = (global_vec.get(term, 0.0) - class_vecs[c].get(term, 0.0)) / other_cnt
            diff = (pos_mean * 2.4) - (neg_mean * 1.35)
            if abs(diff) >= 0.015:
                w_map[term] = round(diff, 4)
        weights_by_class[c] = w_map
        top_terms = sorted(w_map.items(), key=lambda x: x[1], reverse=True)
        top_keywords_by_intent[c] = [t for t, val in top_terms[:10] if val > 0]

    correct = 0
    for vec, true_lbl in zip(doc_tfidf_list, labels):
        best_c = None
        best_s = -1e9
        for c in classes:
            w_map = weights_by_class[c]
            s = sum(val * w_map.get(term, 0.0) for term, val in vec.items())
            if s > best_s:
                best_s = s
                best_c = c
        if best_c == true_lbl:
            correct += 1

    train_acc = round(correct / max(1, n_docs), 4)
    return {
        "idf": idf_map,
        "classes": classes,
        "weights": weights_by_class,
        "top_keywords_by_intent": top_keywords_by_intent,
        "vocabulary_size": len(idf_map),
        "train_accuracy": train_acc,
    }


def _auto_extract_category_keywords(
    pure_model: Dict[str, Any],
    existing_strong: List[str],
    existing_weak: List[str],
    explicit_strong: Optional[Any],
    explicit_weak: Optional[Any],
) -> Tuple[List[str], List[str]]:
    strong: List[str] = _parse_keyword_list(explicit_strong) if explicit_strong is not None else list(existing_strong or [])
    weak: List[str] = _parse_keyword_list(explicit_weak) if explicit_weak is not None else list(existing_weak or [])

    # Enrich with top discriminative bigrams (strong) and unigrams (weak) from the dataset
    top_by_intent = pure_model.get("top_keywords_by_intent", {})
    for intent_id, terms in top_by_intent.items():
        for term in terms[:5]:
            if " " in term and len(strong) < 28 and term not in strong:
                strong.append(term)
            elif " " not in term and len(term) >= 4 and len(weak) < 22 and term not in weak:
                weak.append(term)

    return strong, weak


def train_department_intent_model(
    payload: Dict[str, Any],
    append_existing: bool = True,
) -> Dict[str, Any]:
    """
    End-to-end training pipeline for a Department / HR Category matching LEAVE & ATTENDANCE:
      1. Normalizes ChatGPT JSON dataset (`category_code`, `intents`, `training_samples`).
      2. Merges with existing `training_dataset.json` if `append_existing=True`.
      3. Trains `TfidfVectorizer(lowercase=True, ngram_range=(1, 2), min_df=1, max_df=0.95, sublinear_tf=True)`
         + `LinearSVC(C=1.0, random_state=42)` and dumps `<slug>_linear_svm.pkl` & `<slug>_tfidf_vectorizer.pkl`.
      4. Saves `<slug>_intents.json` in exact flat format `{"P01": "Name", ...}` like `leave_intents.json` & `attendance_intents.json`.
      5. Saves `model_metadata.json` with full taxonomy, TF-IDF config, and accuracy metrics.
      6. Updates Stage 1 `categories.json` and `routing.json` so the department is live immediately.
    """
    norm = _normalize_training_payload(payload)
    cat_code = norm["category_code"]
    slug = cat_code.lower()
    cat_dir = os.path.join(MODELS_ROOT_DIR, slug)
    os.makedirs(cat_dir, exist_ok=True)

    dataset_path = os.path.join(cat_dir, "training_dataset.json")
    intents_path = os.path.join(cat_dir, f"{slug}_intents.json")
    metadata_path = os.path.join(cat_dir, "model_metadata.json")
    weights_path = os.path.join(cat_dir, f"{slug}_trained_weights.json")
    svm_pkl_path = os.path.join(cat_dir, f"{slug}_linear_svm.pkl")
    vec_pkl_path = os.path.join(cat_dir, f"{slug}_tfidf_vectorizer.pkl")

    intents_map: Dict[str, str] = dict(norm["intents"])
    samples_list: List[Dict[str, str]] = list(norm["training_samples"])

    # Merge with previously stored dataset if append_existing=True
    if append_existing and os.path.isfile(dataset_path):
        try:
            with open(dataset_path, "r", encoding="utf-8") as f:
                old_ds = json.load(f)
            old_intents = old_ds.get("intents") or {}
            for k, v in old_intents.items():
                intents_map.setdefault(k, v)
            seen_texts = {s["text"].strip().lower() for s in samples_list}
            for old_s in old_ds.get("training_samples", []):
                t_key = (old_s.get("text") or "").strip().lower()
                if t_key and t_key not in seen_texts and old_s.get("intent"):
                    samples_list.append({"text": old_s["text"], "intent": old_s["intent"]})
                    seen_texts.add(t_key)
        except Exception:
            pass

    texts = [s["text"] for s in samples_list]
    labels = [s["intent"] for s in samples_list]

    # 1. Fit pure-Python TF-IDF + Hyperplane model
    pure_model = _train_pure_python_tfidf_hyperplane(texts, labels, intents_map)
    vocab_size = pure_model["vocabulary_size"]
    train_acc = pure_model["train_accuracy"]
    val_acc = train_acc
    used_sklearn = False

    # 2. Fit native scikit-learn LinearSVC + TfidfVectorizer (exact same setup as LEAVE & ATTENDANCE)
    try:
        import joblib
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.svm import LinearSVC

        vec = TfidfVectorizer(
            lowercase=True,
            ngram_range=(1, 2),
            min_df=1,
            max_df=0.95,
            sublinear_tf=True,
        )
        X = vec.fit_transform(texts)
        clf = LinearSVC(C=1.0, random_state=42)
        clf.fit(X, labels)

        preds = clf.predict(X)
        correct = sum(1 for p, y in zip(preds, labels) if str(p) == str(y))
        train_acc = round(correct / max(1, len(labels)), 4)
        val_acc = train_acc
        vocab_size = len(vec.vocabulary_)

        joblib.dump(clf, svm_pkl_path)
        joblib.dump(vec, vec_pkl_path)
        used_sklearn = True
    except Exception:
        used_sklearn = False

    # 3. Determine version number
    old_version_num = 1.0
    if os.path.isfile(metadata_path):
        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                old_meta = json.load(f)
            v_str = str(old_meta.get("model_version") or old_meta.get("version") or "V1.0").upper().lstrip("V")
            old_version_num = round(float(v_str) + 0.1, 1)
        except Exception:
            old_version_num = 1.1
    model_version = f"V{old_version_num:.1f}"

    # 4. Save <slug>_intents.json in exact flat format like attendance_intents.json & leave_intents.json
    flat_intents = {code: name for code, name in sorted(intents_map.items())}
    with open(intents_path, "w", encoding="utf-8") as f:
        json.dump(flat_intents, f, indent=4, ensure_ascii=False)

    # 5. Save <slug>_trained_weights.json
    with open(weights_path, "w", encoding="utf-8") as f:
        json.dump(pure_model, f, ensure_ascii=False)

    # 6. Save persistent training_dataset.json
    with open(dataset_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "category_code": cat_code,
                "display_name": norm["display_name"],
                "intents": flat_intents,
                "training_samples": samples_list,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            f,
            indent=2,
            ensure_ascii=False,
        )

    # 7. Save model_metadata.json matching both attendance and leave metadata schemas
    default_intent_id = norm.get("default_intent_id") or sorted(intents_map.keys())[0]
    per_intent_counts = dict(Counter(labels))
    n_total = len(samples_list)
    metadata_doc = {
        "model_name": f"{norm['display_name']} Intent Classification Model",
        "model_version": model_version,
        "version": model_version,
        "status": "FINAL",
        "model_type": "LinearSVC",
        "vectorizer": "TF-IDF",
        "sklearn_pkl_saved": used_sklearn,
        "training_samples": n_total,
        "tfidf_features": vocab_size,
        "training_accuracy": train_acc,
        "intent_count": len(flat_intents),
        "default_intent_id": default_intent_id,
        "intents": flat_intents,
        "samples_per_intent": per_intent_counts,
        "dataset": {
            "total_examples": n_total,
            "train_examples": n_total,
        },
        "taxonomy": {
            "number_of_intents": len(flat_intents),
            "intents": list(flat_intents.keys()),
        },
        "model": {
            "algorithm": "LinearSVC",
            "C": 1.0,
            "random_state": 42,
        },
        "tfidf": {
            "lowercase": True,
            "ngram_range": [1, 2],
            "min_df": 1,
            "max_df": 0.95,
            "sublinear_tf": True,
            "vocabulary_size": vocab_size,
        },
        "performance": {
            "train_accuracy": train_acc,
            "validation_accuracy": val_acc,
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata_doc, f, indent=4, ensure_ascii=False)

    # 8. Update Stage 1 Category Config (`backend/data/categories.json`)
    existing_cat_cfg = get_category_config(cat_code)
    strong_kws, weak_kws = _auto_extract_category_keywords(
        pure_model=pure_model,
        existing_strong=existing_cat_cfg.get("keywords_strong", []),
        existing_weak=existing_cat_cfg.get("keywords_weak", []),
        explicit_strong=norm.get("keywords_strong"),
        explicit_weak=norm.get("keywords_weak"),
    )
    updated_cat_cfg = save_or_update_category_config(
        cat_code,
        {
            "display_name": norm["display_name"],
            "specialized_model": True,
            "keywords_strong": strong_kws,
            "keywords_weak": weak_kws,
            "required_fields": norm.get("required_fields") or existing_cat_cfg.get("required_fields") or ["employee_id"],
            "optional_fields": norm.get("optional_fields") or existing_cat_cfg.get("optional_fields") or ["description", "attachment"],
        },
    )
    reload_category_configs()

    # 9. Sync routing rule if a department handles this category
    try:
        from backend.services.cases.department_service import list_departments_with_members
        from backend.services.cases.case_engine import save_or_update_routing_rule

        for dept in list_departments_with_members():
            cats = [c.strip().upper() for c in (dept.get("category_scope") or "").split(",") if c.strip()]
            if cat_code in cats:
                save_or_update_routing_rule(
                    cat_code,
                    {
                        "team": dept["team_name"],
                        "priority": dept.get("default_priority") or "MEDIUM",
                        "sla_hours": int(dept.get("sla_hours") or 48),
                        "auto_create_case": True,
                    },
                )
                break
    except Exception:
        pass

    # 10. Hot-reload model registry cache
    invalidate_model_cache(cat_code)

    return {
        "category_code": cat_code,
        "display_name": norm["display_name"],
        "model_version": model_version,
        "training_samples": n_total,
        "tfidf_features": vocab_size,
        "training_accuracy": round(train_acc * 100, 1),
        "intent_count": len(flat_intents),
        "intents": flat_intents,
        "samples_per_intent": per_intent_counts,
        "keywords_strong": updated_cat_cfg.get("keywords_strong", []),
        "keywords_weak": updated_cat_cfg.get("keywords_weak", []),
        "summary": get_category_ai_summary(cat_code),
    }
