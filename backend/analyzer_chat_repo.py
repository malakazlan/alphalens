"""Repository for analyzer-side chat persistence.

Keeps the DB calls behind a small surface so the chat endpoint and any
future UI for thread management can talk to the same helpers. All reads
and writes go through the service-role Supabase client (RLS is enforced
at the policy level, but the worker/server already runs with full
access — these helpers re-apply the user_id check defensively).
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import db

logger = logging.getLogger(__name__)


# ─── Conversations ──────────────────────────────────────────────────────────

def get_or_create_conversation(user_id: str, doc_id: str) -> dict:
    """Most chat usage is single-thread per (user, doc). Return the most
    recently-updated conversation for that pair; create one if none exist.

    Future multi-thread UX can call list_conversations + create_conversation
    directly without changing this helper."""
    res = (
        db.get_client()
        .table("analyzer_conversations")
        .select("id, user_id, doc_id, title, created_at, updated_at")
        .eq("user_id", user_id)
        .eq("doc_id", doc_id)
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    if res.data:
        return res.data[0]
    return create_conversation(user_id, doc_id, title=None)


def create_conversation(user_id: str, doc_id: str, title: Optional[str]) -> dict:
    payload: dict[str, Any] = {"user_id": user_id, "doc_id": doc_id}
    if title:
        payload["title"] = title
    res = (
        db.get_client()
        .table("analyzer_conversations")
        .insert(payload)
        .execute()
    )
    return res.data[0]


def get_conversation(conv_id: str, user_id: str) -> Optional[dict]:
    """Single-row lookup keyed by id AND user_id. RLS would also gate this,
    but the explicit check makes the surface unambiguous."""
    res = (
        db.get_client()
        .table("analyzer_conversations")
        .select("id, user_id, doc_id, title, created_at, updated_at")
        .eq("id", conv_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def list_conversations(user_id: str, doc_id: str) -> list[dict]:
    res = (
        db.get_client()
        .table("analyzer_conversations")
        .select("id, title, created_at, updated_at")
        .eq("user_id", user_id)
        .eq("doc_id", doc_id)
        .order("updated_at", desc=True)
        .execute()
    )
    return res.data or []


def update_conversation_title(conv_id: str, user_id: str, title: str) -> None:
    (
        db.get_client()
        .table("analyzer_conversations")
        .update({"title": title})
        .eq("id", conv_id)
        .eq("user_id", user_id)
        .execute()
    )


def delete_conversation(conv_id: str, user_id: str) -> None:
    # Messages cascade via FK ON DELETE CASCADE.
    (
        db.get_client()
        .table("analyzer_conversations")
        .delete()
        .eq("id", conv_id)
        .eq("user_id", user_id)
        .execute()
    )


# ─── Messages ──────────────────────────────────────────────────────────────

def list_messages(conv_id: str, user_id: str) -> list[dict]:
    """Return messages in chronological order. user_id check is defensive —
    RLS would already block cross-user reads, but explicit equality keeps
    the surface explicit."""
    res = (
        db.get_client()
        .table("analyzer_messages")
        .select("id, role, content, sources, created_at")
        .eq("conversation_id", conv_id)
        .eq("user_id", user_id)
        .order("created_at", desc=False)
        .execute()
    )
    return res.data or []


def append_message(
    conv_id: str,
    user_id: str,
    role: str,
    content: str,
    sources: Optional[list[dict]] = None,
) -> dict:
    payload: dict[str, Any] = {
        "conversation_id": conv_id,
        "user_id":         user_id,
        "role":            role,
        "content":         content,
    }
    if sources is not None:
        payload["sources"] = sources
    res = (
        db.get_client()
        .table("analyzer_messages")
        .insert(payload)
        .execute()
    )
    return res.data[0]
