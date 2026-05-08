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


def upload_bytes(path: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    """Upload raw bytes to an explicit storage path."""
    get_client().storage.from_(BUCKET).upload(
        path=path,
        file=data,
        file_options={"content-type": content_type, "upsert": "true"},
    )


def delete_folder(user_id: str, doc_id: str) -> None:
    """Delete all storage files for a document. Caller logs on failure."""
    prefix = f"{user_id}/{doc_id}"
    files = get_client().storage.from_(BUCKET).list(prefix)
    if files:
        paths = [f"{prefix}/{f['name']}" for f in files]
        get_client().storage.from_(BUCKET).remove(paths)


def get_signed_url(path: str, expires_in: int = 3600) -> str:
    res = get_client().storage.from_(BUCKET).create_signed_url(path, expires_in)
    # supabase-py v2 returns a Pydantic model with .signed_url attribute
    if hasattr(res, "signed_url"):
        return res.signed_url or ""
    if isinstance(res, dict):
        return res.get("signedURL") or res.get("signed_url") or ""
    return ""
