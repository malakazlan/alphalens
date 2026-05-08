"""Supabase DB operations using service role key (bypasses RLS server-side)."""
import logging
from typing import Optional
from supabase import create_client, Client
from config import settings

logger = logging.getLogger(__name__)
_client: Optional[Client] = None


def get_client() -> Client:
    global _client
    if _client is None:
        key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
        _client = create_client(settings.SUPABASE_URL, key)
    return _client


def _reset_client() -> Client:
    """Discard the stale singleton and return a fresh client."""
    global _client
    _client = None
    return get_client()


def _with_retry(fn):
    """Call fn(). If it raises RemoteProtocolError (stale HTTP/2 connection),
    reset the Supabase client and retry once."""
    import functools
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            if "RemoteProtocolError" in type(e).__name__ or "Server disconnected" in str(e):
                _reset_client()
                return fn(*args, **kwargs)
            raise
    return wrapper


# ─── Documents ────────────────────────────────────────────────────────────────

@_with_retry
def check_hash(user_id: str, sha256_hash: str) -> Optional[dict]:
    res = get_client().table("documents") \
        .select("id, filename, status") \
        .eq("user_id", user_id) \
        .eq("sha256_hash", sha256_hash) \
        .limit(1).execute()
    return res.data[0] if res.data else None


@_with_retry
def insert_document(doc: dict) -> dict:
    res = get_client().table("documents").insert(doc).execute()
    return res.data[0]


@_with_retry
def get_document(doc_id: str, user_id: str) -> Optional[dict]:
    res = get_client().table("documents") \
        .select("*") \
        .eq("id", doc_id) \
        .eq("user_id", user_id) \
        .limit(1).execute()
    return res.data[0] if res.data else None


@_with_retry
def list_documents(user_id: str) -> list:
    res = get_client().table("documents") \
        .select("id, filename, status, progress, status_message, metadata, upload_time") \
        .eq("user_id", user_id) \
        .order("upload_time", desc=True) \
        .execute()
    return res.data or []


@_with_retry
def update_document(doc_id: str, updates: dict) -> None:
    get_client().table("documents").update(updates).eq("id", doc_id).execute()


@_with_retry
def delete_document(doc_id: str, user_id: str) -> bool:
    for table, filters in [
        ("document_grounding", {"doc_id": doc_id}),
        ("chat_history",       {"doc_id": doc_id}),
        ("reports",            {"doc_id": doc_id, "user_id": user_id}),
    ]:
        try:
            q = get_client().table(table).delete()
            for k, v in filters.items():
                q = q.eq(k, v)
            q.execute()
        except Exception as e:
            # Child cleanup is best-effort; orphaned rows are recoverable
            # and shouldn't block deletion of the parent document.
            logger.warning(f"delete: {table} cleanup failed for doc {doc_id}: {e}")
    res = get_client().table("documents").delete().eq("id", doc_id).eq("user_id", user_id).execute()
    return bool(res.data)


# ─── Reports ─────────────────────────────────────────────────────────────────

@_with_retry
def insert_report(report: dict) -> dict:
    res = get_client().table("reports").insert(report).execute()
    return res.data[0]


@_with_retry
def get_report(report_id: str, user_id: str) -> Optional[dict]:
    res = get_client().table("reports") \
        .select("*") \
        .eq("id", report_id) \
        .eq("user_id", user_id) \
        .limit(1).execute()
    return res.data[0] if res.data else None


@_with_retry
def list_reports(doc_id: str, user_id: str) -> list:
    res = get_client().table("reports") \
        .select("id, doc_id, template, status, word_count, created_at, updated_at") \
        .eq("doc_id", doc_id) \
        .eq("user_id", user_id) \
        .order("created_at", desc=True) \
        .execute()
    return res.data or []


@_with_retry
def update_report(report_id: str, updates: dict) -> None:
    get_client().table("reports").update(updates).eq("id", report_id).execute()


@_with_retry
def update_report_section(report_id: str, section_id: str, section_data: dict) -> None:
    """Update a single section within the report's sections JSONB.
    Fetches current sections, merges, and writes back."""
    res = get_client().table("reports") \
        .select("sections") \
        .eq("id", report_id) \
        .limit(1).execute()
    current = (res.data[0]["sections"] if res.data else {}) or {}
    current[section_id] = section_data
    get_client().table("reports") \
        .update({"sections": current, "updated_at": "now()"}) \
        .eq("id", report_id).execute()


@_with_retry
def delete_report(report_id: str, user_id: str) -> bool:
    res = get_client().table("reports") \
        .delete() \
        .eq("id", report_id) \
        .eq("user_id", user_id) \
        .execute()
    return bool(res.data)


@_with_retry
def get_grounding(doc_id: str, user_id: str) -> list:
    """Return all grounding entries for a document (used for table-cell overlays)."""
    # Validate ownership via documents table first
    doc = get_client().table("documents") \
        .select("id") \
        .eq("id", doc_id) \
        .eq("user_id", user_id) \
        .limit(1).execute()
    if not doc.data:
        return []
    res = get_client().table("document_grounding") \
        .select("element_id, page, bbox_left, bbox_top, bbox_right, bbox_bottom, type") \
        .eq("doc_id", doc_id) \
        .execute()
    return res.data or []
