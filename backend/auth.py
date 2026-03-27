"""Supabase authentication — email/password, JWT verification."""
from typing import Optional, Dict, Any
from supabase import create_client, Client
from config import settings

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


def get_user(access_token: str) -> Optional[Dict[str, Any]]:
    if not access_token:
        return None
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
    client = get_supabase_client()
    try:
        client.auth.reset_password_for_email(email)
        return {"success": True, "message": "Password reset email sent"}
    except Exception as e:
        return {"success": False, "error": str(e)}
