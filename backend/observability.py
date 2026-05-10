"""Sentry initialization for backend + worker processes.

Idempotent: safe to call multiple times, only the first call has effect.
Silent no-op if SENTRY_DSN_BACKEND is unset (local dev) or sentry-sdk
isn't installed. This means a missing dependency or env var never breaks
the app.
"""
from __future__ import annotations

# Sentry is optional for local dev. Wrap import so missing package =
# silent no-op (the app still boots; we just lose error reporting).
try:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    _SENTRY_AVAILABLE = True
except ImportError:
    _SENTRY_AVAILABLE = False

_initialized = False


def init_sentry() -> None:
    global _initialized
    if _initialized or not _SENTRY_AVAILABLE:
        return

    # Local import — settings module is loaded lazily so this file has
    # no import-order coupling with config.py.
    from config import settings

    dsn = (settings.SENTRY_DSN_BACKEND or "").strip()
    if not dsn:
        return  # Sentry not configured (local dev). Quiet.

    sentry_sdk.init(
        dsn=dsn,
        environment=settings.SENTRY_ENVIRONMENT,
        release=(settings.SENTRY_RELEASE or None),
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        # send_default_pii=False keeps user IPs and emails out of events.
        # We rely on user_id (UUID) for correlation.
        send_default_pii=False,
        before_send=_scrub_pii,
        integrations=[
            FastApiIntegration(),
            StarletteIntegration(),
        ],
    )
    _initialized = True


def _scrub_pii(event: dict, hint: dict) -> dict:
    """Belt-and-suspenders PII scrubbing in addition to send_default_pii=False.

    Strips Authorization headers, cookies, and API keys from request
    contexts before events ship. Never raises — scrubbing failure must
    not block the send."""
    try:
        request = event.get("request") or {}
        headers = request.get("headers")
        sensitive = {"authorization", "cookie", "x-api-key", "set-cookie"}

        if isinstance(headers, dict):
            for key in list(headers.keys()):
                if key.lower() in sensitive:
                    headers[key] = "[REDACTED]"
        elif isinstance(headers, list):
            for i, item in enumerate(headers):
                if isinstance(item, (list, tuple)) and len(item) == 2:
                    name = str(item[0]).lower()
                    if name in sensitive:
                        headers[i] = [item[0], "[REDACTED]"]

        # Sentry's default may also try to capture cookies separately.
        request.pop("cookies", None)
    except Exception:
        pass
    return event
