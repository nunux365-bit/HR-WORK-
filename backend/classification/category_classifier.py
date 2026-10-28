"""
HR FLOW — Phase 6.4 HR Category Classifier (backend/classification/category_classifier.py)
Classifies an incoming HR email (Subject + Body) into one of the 13 official HR categories:
  LEAVE, ATTENDANCE, PAYROLL, BGV, RESIGNATION, ONBOARDING, DOCUMENTS,
  ASSET_IT, EMPLOYEE_PROFILE, BENEFITS, PERFORMANCE, GENERAL_HR, UNKNOWN
"""

import re
from typing import Dict, Any, List
from backend.classification.category_config import load_category_configs

_NON_ACTIONABLE_SUBJECT_PATTERNS = [
    r"^action required:\s*please confirm",
    r"\bworld heart day\b",
    r"\bbirthday\b",
    r"\bmaking milestones\b",
    r"^invitation:",
    r"\banniversary\b",
    r"\btownhall\b",
    r"\ball[- ]hands\b",
    r"\bnewsletter\b",
    r"\bweekly digest\b",
    r"\bsecurity alert\b",
    r"\bverification code\b",
    r"\bwelcome to chatgpt\b",
    r"\bgoogle account\b",
    r"\bdarwinbox\s*digest\b",
    r"\bone[- ]time password\b",
    r"\blogin alert\b",
    r"\bnew sign[- ]in\b",
    r"\bstatement of account\b",
    r"\bcredit card\b",
    r"\bdebit card\b",
    r"\btransaction alert\b",
    r"\border confirmed\b",
    r"\bshipped\b",
    r"\bdelivered\b",
    r"\btracking number\b",
    r"\byour receipt\b",
    r"\bwebinar\b",
    r"\bquarterly pulse\b",
    r"\binsider\b",
    r"\bneon credit\b",
    r"\bcredit for you\b",
    r"\bagentic pipelines\b",
    r"\btech jobs alert\b",
    r"\bquestion bank empty\b",
    r"\btrial has ended\b",
    r"\bhow to enhance performance\b",
    r"\bstop bad code\b",
    r"\bwrite faster with\b",
    r"\bdecks, docs, and designs\b",
    r"\byour photos, edited\b",
    r"\bsecurity vulnerabilities detected\b",
    r"\bmanaging your data\b",
    r"\bweekend plan\b",
    r"\bwelcome aboard\b",
    r"\bnew tables in \"public\"\b",
    r"\bhow one ai project\b",
]

_NON_ACTIONABLE_SENDER_PATTERNS = [
    r"(^|[-._])(no-?reply|donotreply|mailer-daemon|postmaster|notifications?|alerts?|billing|marketing|updates?|news(letter)?|promo|changelog|digest|digests|welcome)@",
    r"@(.*\.)?(github|linkedin|quora|medium|twitter|x|facebookmail|instagram|uber|swiggy|zomato|amazon|flipkart|accounts\.google|render|coderabbit|neon|cerebralvalley|artha|geeksforgeeks|adobe|oreilly|supabase|openai|claude|atlassian|zohoaccounts)\.(com|ai|org|tech|in|link)$",
]


def classify_hr_category(subject: str, body: str, sender_email: str = "") -> Dict[str, Any]:
    """
    Classify email subject + body into one of the 13 HR categories.
    """
    subj_text = (subject or "").strip()
    body_text = (body or "").strip()
    combined = f"{subj_text}\n{body_text}".lower()
    subj_lower = subj_text.lower()
    sender_clean = (sender_email or "").strip().lower()

    is_case_reply = bool(re.search(r"\bCASE-?\d{4,8}\b", f"{subj_text}\n{body_text}", re.IGNORECASE) or subj_lower.startswith("re:"))
    has_emp_code = bool(re.search(r"\bEMP[\s\-_]?\d{3,7}\b", f"{subj_text}\n{body_text}", re.IGNORECASE))
    if not is_case_reply and not has_emp_code:
        # Check non-actionable senders
        if sender_clean:
            for pat in _NON_ACTIONABLE_SENDER_PATTERNS:
                if re.search(pat, sender_clean, re.IGNORECASE):
                    return {
                        "category": "UNKNOWN",
                        "display_name": "Unknown",
                        "confidence": 0.20,
                        "requires_review": True,
                        "reason": "Filtered Out: Automated system bot or external notification sender",
                        "matched_signals": [f"Sender bot filter: '{sender_clean}'"],
                        "is_noise": True,
                    }

        # Check non-actionable subjects
        for pat in _NON_ACTIONABLE_SUBJECT_PATTERNS:
            if re.search(pat, subj_lower, re.IGNORECASE):
                return {
                    "category": "UNKNOWN",
                    "display_name": "Unknown",
                    "confidence": 0.35,
                    "requires_review": True,
                    "reason": "Filtered Out: External or broadcast notification — no actionable HR request detected",
                    "matched_signals": [],
                    "is_noise": True,
                }

    configs = load_category_configs()
    scores: Dict[str, float] = {}
    signals: Dict[str, List[str]] = {}
    subj_hits_map: Dict[str, int] = {}

    for cat_code, cfg in configs.items():
        if cat_code == "UNKNOWN":
            continue

        cat_score = 0.0
        cat_signals: List[str] = []
        subj_hits = 0

        for phrase in cfg.get("keywords_strong", []):
            p_low = phrase.lower()
            if p_low in subj_lower:
                cat_score += 3.2
                subj_hits += 1
                cat_signals.append(f"Subject: '{phrase}'")
            elif p_low in combined:
                cat_score += 2.2
                cat_signals.append(f"Body: '{phrase}'")

        for kw in cfg.get("keywords_weak", []):
            kw_low = kw.lower()
            pattern = r"\b" + re.escape(kw_low) + r"\b"
            if re.search(pattern, subj_lower):
                cat_score += 1.5
                subj_hits += 1
                sig_label = f"Subject: '{kw}'"
                if sig_label not in cat_signals:
                    cat_signals.append(sig_label)
            elif re.search(pattern, combined):
                cat_score += 0.8
                sig_label = f"Body: '{kw}'"
                if sig_label not in cat_signals:
                    cat_signals.append(sig_label)

        if cat_score >= 1.5:
            scores[cat_code] = round(cat_score, 2)
            signals[cat_code] = cat_signals[:6]
            subj_hits_map[cat_code] = subj_hits

    if not scores:
        return {
            "category": "UNKNOWN",
            "display_name": "Unknown",
            "confidence": 0.30,
            "requires_review": True,
            "reason": "No recognized HR category signals found in subject or body",
            "matched_signals": [],
            "top_candidates": [
                {
                    "category": "UNKNOWN",
                    "display_name": "Unknown",
                    "score": 0.0,
                    "probability": 100.0,
                    "margin_from_winner": 0.0,
                    "signals": [],
                }
            ],
        }

    import math
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    best_cat, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
    total_score = sum(scores.values())
    margin = best_score - second_score
    dominance_ratio = best_score / total_score if total_score > 0 else 1.0

    top_candidates = []
    for cat_code_item, sc_item in ranked[:4]:
        prob_pct = round((sc_item / total_score) * 100.0, 1) if total_score > 0 else 100.0
        top_candidates.append({
            "category": cat_code_item,
            "display_name": configs.get(cat_code_item, {}).get("display_name", cat_code_item),
            "score": round(sc_item, 2),
            "probability": prob_pct,
            "margin_from_winner": round(best_score - sc_item, 2),
            "signals": signals.get(cat_code_item, [])[:3],
        })

    # Real logistic calibration over signal strength, dominance ratio, and subject line hits
    signal_strength = 1.0 - math.exp(-best_score / 4.8)
    subj_bonus = 0.04 if subj_hits_map.get(best_cat, 0) > 0 else 0.0
    raw_conf = (0.52 * signal_strength) + (0.38 * dominance_ratio) + subj_bonus + min(0.05, margin * 0.008)
    confidence = round(max(0.42, min(0.97, raw_conf)), 2)

    requires_review = bool(confidence < 0.70 or (second_score > 0 and margin < 0.75))
    best_cfg = configs.get(best_cat, {})
    matched_list = signals.get(best_cat, [])
    clean_Preview = ", ".join(s.replace("Subject: ", "").replace("Body: ", "") for s in matched_list[:4])
    reason_str = (
        f"Router score {best_score:.1f} (margin +{margin:.1f}) on {len(matched_list)} signal(s): {clean_Preview}"
        if matched_list
        else f"Classified as {best_cat} (score {best_score:.1f})"
    )
    if requires_review and second_score > 0 and margin < 0.75:
        reason_str = f"Ambiguous signals between {best_cat} ({best_score:.1f}) and {ranked[1][0]} ({second_score:.1f}): {clean_Preview}"

    return {
        "category": best_cat,
        "display_name": best_cfg.get("display_name", best_cat),
        "confidence": confidence,
        "score": round(best_score, 2),
        "margin": round(margin, 2),
        "requires_review": requires_review,
        "reason": reason_str,
        "matched_signals": matched_list,
        "top_candidates": top_candidates,
    }
