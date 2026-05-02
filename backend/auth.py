"""Supabase authentication — email/password, JWT verification."""
import logging
from typing import Optional, Dict, Any
import jwt as pyjwt
from supabase import create_client, Client
from config import settings

logger = logging.getLogger(__name__)
_client: Optional[Client] = None


def get_supabase_client() -> Client:
    global _client
    if _client is None:
        if not settings.SUPABASE_URL or not settings.SUPABASE_ANON_KEY:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env"
            )
        _client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    return _client


def sign_up(email: str, password: str) -> Dict[str, Any]:
    client = get_supabase_client()
    try:
        res = client.auth.sign_up({"email": email, "password": password})
        if res.user:
            return {"success": True, "user": res.user, "session": res.session}
        return {"success": False, "error": "Failed to create user"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def sign_in(email: str, password: str) -> Dict[str, Any]:
    client = get_supabase_client()
    try:
        res = client.auth.sign_in_with_password({"email": email, "password": password})
        if res.user and res.session:
            return {"success": True, "user": res.user, "session": res.session}
        return {"success": False, "error": "Invalid email or password"}
    except Exception as e:
        msg = str(e)
        if "Invalid login credentials" in msg or "Email not confirmed" in msg:
            msg = "Invalid email or password"
        return {"success": False, "error": msg}


def sign_out(access_token: str) -> Dict[str, Any]:
    client = get_supabase_client()
    try:
        client.auth.sign_out()
        return {"success": True}
    except Exception:
        return {"success": True}  # Client-side cleanup still succeeds


def verify_jwt_local(access_token: str) -> Optional[Dict[str, Any]]:
    """Verify a Supabase HS256 JWT locally using SUPABASE_JWT_SECRET.

    Returns the decoded payload (with sub, email, exp, …) or None if:
      - secret is not configured
      - token is malformed, expired, or signature invalid

    This is the fast path: pure CPU work, no network. ~microseconds per call
    versus ~100-300ms for client.auth.get_user().
    """
    if not access_token or not settings.SUPABASE_JWT_SECRET:
        return None
    try:
        return pyjwt.decode(
            access_token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except pyjwt.PyJWTError:
        return None


def get_user(access_token: str) -> Optional[Dict[str, Any]]:
    """Resolve {id, email} from an access token.

    Strategy:
      1. Local HS256 verify if SUPABASE_JWT_SECRET is configured (fast).
      2. Fall back to client.auth.get_user() (network, slow but always works).

    Fallback exists so the app keeps working before/after JWT secret is
    deployed — no flag-day required. Once the secret is set everywhere,
    the fallback is dead code on the hot path.
    """
    if not access_token:
        return None

    # Fast path — local verify
    payload = verify_jwt_local(access_token)
    if payload and payload.get("sub"):
        return {
            "id": payload["sub"],
            "email": payload.get("email", ""),
            "created_at": None,
        }

    # Fallback — remote verify
    if not settings.SUPABASE_JWT_SECRET:
        logger.info("SUPABASE_JWT_SECRET not set — using remote auth (slower)")
    client = get_supabase_client()
    try:
        res = client.auth.get_user(access_token)
        if res and res.user:
            return {
                "id": res.user.id,
                "email": res.user.email,
                "created_at": str(res.user.created_at) if res.user.created_at else None,
            }
        return None
    except Exception:
        return None


def reset_password(email: str) -> Dict[str, Any]:
    """Trigger password reset email.

    Always returns success to the caller, regardless of whether the email
    exists. Surfacing "user not found"-style errors enables email
    enumeration. The actual error is logged server-side for debugging.
    """
    client = get_supabase_client()
    try:
        client.auth.reset_password_for_email(email)
    except Exception as e:
        logger.warning(f"reset_password failed for {email}: {e}")
    return {
        "success": True,
        "message": "If that email is registered, a reset link has been sent.",
    }
