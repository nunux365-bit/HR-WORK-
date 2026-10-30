"""
HR FLOW — Phase 8.3 & 8.28 Secure Integration Credential Vault & Secret Redaction
(backend/services/integrations/credential_vault.py)

Responsibilities:
  - Encrypt/decrypt integration credentials at rest in SQLite (`integration_credentials`)
    using HMAC-derived stream cipher keyed by `Config.SECRET_KEY`.
  - Never expose raw credentials in:
      * logs
      * API responses
      * frontend JavaScript
      * audit logs (`audit_logs` & `external_api_audits`)
      * error messages
  - Provide recursive dictionary & string sanitization (`sanitize_for_audit`, `redact_text`)
"""

import base64
import hashlib
import re
from typing import Dict, Any, Optional, List
from backend.config import Config
from backend.database.connection import get_connection


SENSITIVE_KEY_SUBSTRINGS = (
    "api_key",
    "apikey",
    "secret",
    "token",
    "password",
    "passwd",
    "authorization",
    "auth_header",
    "client_secret",
    "private_key",
    "access_key",
    "credential",
    "bearer",
)


def _derive_keystream(length: int, salt: bytes) -> bytes:
    """Derive a deterministic pseudorandom byte stream from Config.SECRET_KEY + salt."""
    master = (Config.SECRET_KEY or "hrflow-default-key").encode("utf-8")
    out = bytearray()
    counter = 0
    while len(out) < length:
        block = hashlib.sha256(master + salt + counter.to_bytes(4, "big")).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:length])


def encrypt_secret(plain_text: str) -> str:
    """Encrypt a plaintext secret before storing in SQLite."""
    if not plain_text:
        return ""
    raw = plain_text.encode("utf-8")
    salt = hashlib.sha256(raw + b"hrflow_salt_v1").digest()[:8]
    stream = _derive_keystream(len(raw), salt)
    cipher = bytes(a ^ b for a, b in zip(raw, stream))
    return "ENCv1:" + base64.urlsafe_b64encode(salt + cipher).decode("ascii")


def decrypt_secret(cipher_text: str) -> str:
    """Decrypt a stored secret strictly for internal adapter authentication."""
    if not cipher_text:
        return ""
    if not cipher_text.startswith("ENCv1:"):
        return ""
    payload = base64.urlsafe_b64decode(cipher_text[6:].encode("ascii"))
    salt = payload[:8]
    cipher = payload[8:]
    stream = _derive_keystream(len(cipher), salt)
    plain = bytes(a ^ b for a, b in zip(cipher, stream))
    return plain.decode("utf-8")


def mask_secret_preview(secret_val: Optional[str]) -> str:
    """Return a safe masked indicator (never returning actual secret characters)."""
    if not secret_val:
        return "NOT_SET"
    return "•••••••• (CONFIGURED)"


def store_integration_credentials(
    integration_id: str,
    secrets_dict: Dict[str, str],
    updated_by: str = "admin",
) -> List[str]:
    """
    Store encrypted secrets for `integration_id` in `integration_credentials`.
    Returns the list of secret key names stored (never the values).
    """
    stored_keys: List[str] = []
    conn = get_connection()
    try:
        for k, v in (secrets_dict or {}).items():
            if v is None or str(v).strip() == "":
                continue
            key_clean = str(k).strip().lower()
            enc_val = encrypt_secret(str(v).strip())
            conn.execute(
                """
                INSERT INTO integration_credentials (integration_id, secret_key, encrypted_value, updated_by, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(integration_id, secret_key)
                DO UPDATE SET encrypted_value = excluded.encrypted_value,
                              updated_by = excluded.updated_by,
                              updated_at = CURRENT_TIMESTAMP
                """,
                (integration_id, key_clean, enc_val, updated_by),
            )
            stored_keys.append(key_clean)
        conn.commit()
    finally:
        conn.close()
    return stored_keys


def get_decrypted_credentials(integration_id: str) -> Dict[str, str]:
    """
    Internal-only helper for Provider Adapters to retrieve decrypted credentials.
    NEVER expose the return value of this function in API responses or logs.
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT secret_key, encrypted_value FROM integration_credentials WHERE integration_id = ?",
            (integration_id,),
        ).fetchall()
        out: Dict[str, str] = {}
        for r in rows:
            try:
                out[r["secret_key"]] = decrypt_secret(r["encrypted_value"])
            except Exception:
                out[r["secret_key"]] = ""
        return out
    finally:
        conn.close()


def get_configured_credential_summary(integration_id: str) -> Dict[str, Any]:
    """
    Safe summary for API responses and UI showing which credential keys are configured
    without ever returning or exposing secret values.
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT secret_key, updated_by, updated_at FROM integration_credentials WHERE integration_id = ?",
            (integration_id,),
        ).fetchall()
        keys = [r["secret_key"] for r in rows]
        masked = {r["secret_key"]: "•••••••• (CONFIGURED)" for r in rows}
        return {
            "has_credentials": len(keys) > 0,
            "configured_keys": keys,
            "masked_credentials": masked,
        }
    finally:
        conn.close()


def is_sensitive_key(key_name: str) -> bool:
    low = str(key_name or "").lower()
    return any(s in low for s in SENSITIVE_KEY_SUBSTRINGS)


def redact_text(text: Optional[str]) -> str:
    """Redact Bearer tokens, Basic auth headers, and API keys from error messages or logs."""
    if not text:
        return ""
    cleaned = str(text)
    cleaned = re.sub(r"(?i)(Bearer\s+)[A-Za-z0-9\-._~+/]+=*", r"\1[REDACTED]", cleaned)
    cleaned = re.sub(r"(?i)(Basic\s+)[A-Za-z0-9\-._~+/]+=*", r"\1[REDACTED]", cleaned)
    cleaned = re.sub(
        r"(?i)(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['\"]?[^\s,'\"\}]+['\"]?",
        r"\1=[REDACTED]",
        cleaned,
    )
    return cleaned


def sanitize_payload(obj: Any) -> Any:
    """
    Recursively strip or redact any secret/credential/authorization fields from a dictionary or list
    before writing to audit logs, database payloads, or API responses.
    """
    if isinstance(obj, dict):
        sanitized = {}
        for k, v in obj.items():
            if is_sensitive_key(k):
                sanitized[k] = "[REDACTED]"
            else:
                sanitized[k] = sanitize_payload(v)
        return sanitized
    if isinstance(obj, list):
        return [sanitize_payload(item) for item in obj]
    if isinstance(obj, str):
        return redact_text(obj)
    return obj
