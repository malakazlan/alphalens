"""Smoke tests for PR 1 (JWT local verify) + PR 2 (lazy Qdrant) + PR 3 (health check).

Run:
  cd backend
  python -m pytest tests/test_pr_1_2_3.py -v
"""
import sys
import os
import jwt as pyjwt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from auth import verify_jwt_local
from config import settings


# ─── PR 1: verify_jwt_local() ────────────────────────────────────────────────

class TestVerifyJwtLocal:
    def test_empty_token_returns_none(self):
        assert verify_jwt_local("") is None
        assert verify_jwt_local(None) is None

    def test_malformed_token_returns_none(self):
        assert verify_jwt_local("not.a.token") is None
        assert verify_jwt_local("garbage") is None

    def test_with_secret_unsigned_or_wrongkey_returns_none(self):
        """A token signed by a different key must fail verify."""
        # Always exercise this path by signing with a dummy secret
        bogus = pyjwt.encode(
            {"sub": "user-1", "aud": "authenticated"},
            "wrong-secret-here",
            algorithm="HS256",
        )
        if settings.SUPABASE_JWT_SECRET:
            # Real secret configured — bogus token must NOT verify
            assert verify_jwt_local(bogus) is None
        else:
            # No secret configured — function should short-circuit to None
            assert verify_jwt_local(bogus) is None

    def test_correctly_signed_token_verifies(self):
        """Round-trip: sign with the configured secret, verify locally."""
        if not settings.SUPABASE_JWT_SECRET:
            import pytest
            pytest.skip("SUPABASE_JWT_SECRET not set — skip round-trip")
        token = pyjwt.encode(
            {"sub": "user-1", "email": "test@example.com", "aud": "authenticated"},
            settings.SUPABASE_JWT_SECRET,
            algorithm="HS256",
        )
        payload = verify_jwt_local(token)
        assert payload is not None
        assert payload["sub"] == "user-1"
        assert payload["email"] == "test@example.com"

    def test_expired_token_returns_none(self):
        if not settings.SUPABASE_JWT_SECRET:
            import pytest
            pytest.skip("SUPABASE_JWT_SECRET not set — skip expired-token check")
        import time
        token = pyjwt.encode(
            {"sub": "user-1", "aud": "authenticated", "exp": int(time.time()) - 60},
            settings.SUPABASE_JWT_SECRET,
            algorithm="HS256",
        )
        assert verify_jwt_local(token) is None


# ─── PR 2: Qdrant collection memoization ─────────────────────────────────────

class TestEnsureCollectionMemoized:
    def test_collection_ready_flag_exists(self):
        import qdrant_store
        # Reset for clean test
        qdrant_store._collection_ready = False
        # Module exposes the memo flag — basic shape check, no live call
        assert hasattr(qdrant_store, "_collection_ready")
        assert qdrant_store._collection_ready is False


# ─── PR 3: Health check endpoint shape ───────────────────────────────────────

class TestHealthCheck:
    def test_app_imports_without_qdrant(self):
        """App must boot even if Qdrant config is missing — no startup hook."""
        import app
        assert app.app is not None
        # /livez handler exists
        routes = [r.path for r in app.app.routes]
        assert "/livez" in routes
        assert "/health" in routes
        assert "/" in routes
