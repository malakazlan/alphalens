"""Supabase Storage operations."""
import os
from typing import Optional
from supabase import create_client, Client
from config import settings

BUCKET = "documents"
_client: Optional[Client] = None


def get_client() -> Client:
    global _client
    if _client is None:
        key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
        _client = create_client(settings.SUPABASE_URL, key)
    return _client


def upload_file(user_id: str, doc_id: str, file_bytes: bytes, filename: str) -> str:
    """Upload to {user_id}/{doc_id}/original.{ext} — returns storage path."""
    ext = os.path.splitext(filename)[-1].lower() or ".pdf"
    path = f"{user_id}/{doc_id}/original{ext}"
    get_client().storage.from_(BUCKET).upload(
        path=path,
        file=file_bytes,
        file_options={"content-type": "application/octet-stream", "upsert": "true"},
    )
    return path


def get_signed_url(path: str, expires_in: int = 3600) -> str:
    res = get_client().storage.from_(BUCKET).create_signed_url(path, expires_in)
    # supabase-py v2 returns a Pydantic model with .signed_url attribute
    if hasattr(res, "signed_url"):
        return res.signed_url or ""
    if isinstance(res, dict):
        return res.get("signedURL") or res.get("signed_url") or ""
    return ""
