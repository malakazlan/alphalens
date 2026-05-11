"""FinBot data repository — single point of truth for all finbot_* table access.

Per ADR-002, route handlers and tools never call `supabase.table("finbot_...")`
directly. Everything goes through this module so we can later swap the
backing store without touching call sites.

This module covers Phase 2 / Slice 1: `finbot_holdings` only. Profile,
watchlist, conversations, messages get added in subsequent slices.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Optional

import db  # reuse the existing service-role Supabase client singleton

logger = logging.getLogger(__name__)


# ─── Holdings ───────────────────────────────────────────────────────────────

_HOLDING_COLS = (
    "id, user_id, ticker, quantity, cost_basis, currency, account_type, "
    "opened_at, closed_at, note, created_at, updated_at"
)


def list_holdings(user_id: str, *, include_closed: bool = False) -> list[dict[str, Any]]:
    """Return the user's holdings, soft-deleted rows always excluded."""
    q = (
        db.get_client()
        .table("finbot_holdings")
        .select(_HOLDING_COLS)
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .order("opened_at", desc=True)
    )
    if not include_closed:
        q = q.is_("closed_at", "null")
    res = q.execute()
    return list(res.data or [])


def get_holding(holding_id: str, user_id: str) -> Optional[dict[str, Any]]:
    """Single holding owned by user_id. Returns None if missing/foreign."""
    res = (
        db.get_client()
        .table("finbot_holdings")
        .select(_HOLDING_COLS)
        .eq("id", holding_id)
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def add_holding(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Insert a new holding. Caller is responsible for validating shape — the
    Pydantic schema in `schemas.HoldingCreate` does that at the API layer."""
    row = {
        "user_id":      user_id,
        "ticker":       str(payload["ticker"]).upper(),
        "quantity":     payload["quantity"],
        "cost_basis":   payload["cost_basis"],
        "currency":     payload.get("currency", "USD"),
        "account_type": payload["account_type"],
        "opened_at":    _iso_date(payload["opened_at"]),
        "closed_at":    _iso_date(payload.get("closed_at")),
        "note":         payload.get("note"),
    }
    res = (
        db.get_client()
        .table("finbot_holdings")
        .insert(row)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise RuntimeError("INSERT into finbot_holdings returned no row")
    return rows[0]


def update_holding(
    holding_id: str, user_id: str, payload: dict[str, Any]
) -> Optional[dict[str, Any]]:
    """Patch an existing holding. Returns updated row or None if not found."""
    update: dict[str, Any] = {}
    if "ticker" in payload:
        update["ticker"] = str(payload["ticker"]).upper()
    for k in ("quantity", "cost_basis", "currency", "account_type", "note"):
        if k in payload:
            update[k] = payload[k]
    for k in ("opened_at", "closed_at"):
        if k in payload:
            update[k] = _iso_date(payload[k])

    if not update:
        return get_holding(holding_id, user_id)  # nothing to change

    res = (
        db.get_client()
        .table("finbot_holdings")
        .update(update)
        .eq("id", holding_id)
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def soft_delete_holding(holding_id: str, user_id: str) -> bool:
    """Set `deleted_at = now()`. Returns True if a row was hit."""
    now = datetime.utcnow().isoformat() + "Z"
    res = (
        db.get_client()
        .table("finbot_holdings")
        .update({"deleted_at": now})
        .eq("id", holding_id)
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .execute()
    )
    return bool(res.data)


# ─── Profile (Phase 2 / Slice 2) ────────────────────────────────────────────

_PROFILE_COLS = (
    "user_id, risk_tolerance, time_horizon, goals, liquidity_needs, "
    "tax_country, currency_preference, onboarding_completed_at, "
    "created_at, updated_at"
)


def get_profile(user_id: str) -> Optional[dict[str, Any]]:
    res = (
        db.get_client()
        .table("finbot_profile")
        .select(_PROFILE_COLS)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def upsert_profile(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Create or update the user's profile. PK is user_id, so upsert is safe."""
    row: dict[str, Any] = {"user_id": user_id}
    for k in (
        "risk_tolerance", "time_horizon", "goals", "liquidity_needs",
        "tax_country", "currency_preference",
    ):
        if k in payload and payload[k] is not None:
            row[k] = payload[k]
    res = (
        db.get_client()
        .table("finbot_profile")
        .upsert(row, on_conflict="user_id")
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise RuntimeError("UPSERT into finbot_profile returned no row")
    return rows[0]


def mark_onboarding_complete(user_id: str) -> Optional[dict[str, Any]]:
    """Stamp onboarding_completed_at to now. No-op if profile doesn't exist."""
    now = datetime.utcnow().isoformat() + "Z"
    res = (
        db.get_client()
        .table("finbot_profile")
        .update({"onboarding_completed_at": now})
        .eq("user_id", user_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


# ─── Watchlist (Phase 2 / Slice 2) ──────────────────────────────────────────

_WATCH_COLS = (
    "id, user_id, ticker, alert_above, alert_below, note, "
    "created_at, updated_at"
)


def list_watchlist(user_id: str) -> list[dict[str, Any]]:
    res = (
        db.get_client()
        .table("finbot_watchlist")
        .select(_WATCH_COLS)
        .eq("user_id", user_id)
        .order("created_at", desc=False)
        .execute()
    )
    return list(res.data or [])


def add_watch(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Insert. Caller pre-checks duplicates (the UNIQUE constraint surfaces a
    23505 if violated — repository raises and route handler maps to 409)."""
    row = {
        "user_id":     user_id,
        "ticker":      str(payload["ticker"]).upper(),
        "alert_above": payload.get("alert_above"),
        "alert_below": payload.get("alert_below"),
        "note":        payload.get("note"),
    }
    res = (
        db.get_client()
        .table("finbot_watchlist")
        .insert(row)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise RuntimeError("INSERT into finbot_watchlist returned no row")
    return rows[0]


def update_watch(watch_id: str, user_id: str, payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    update: dict[str, Any] = {}
    if "ticker" in payload:
        update["ticker"] = str(payload["ticker"]).upper()
    for k in ("alert_above", "alert_below", "note"):
        if k in payload:
            update[k] = payload[k]
    if not update:
        # nothing to change — return current row
        res = (
            db.get_client()
            .table("finbot_watchlist")
            .select(_WATCH_COLS)
            .eq("id", watch_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None

    res = (
        db.get_client()
        .table("finbot_watchlist")
        .update(update)
        .eq("id", watch_id)
        .eq("user_id", user_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def delete_watch(watch_id: str, user_id: str) -> bool:
    res = (
        db.get_client()
        .table("finbot_watchlist")
        .delete()
        .eq("id", watch_id)
        .eq("user_id", user_id)
        .execute()
    )
    return bool(res.data)


# ─── Conversations + Messages (Phase 2 / Slice 4) ──────────────────────────

_CONVO_COLS = "id, user_id, title, pinned, archived_at, created_at, updated_at, active_doc_id"
_MSG_COLS   = ("id, conversation_id, user_id, role, content, tool_calls, "
               "tokens_prompt, tokens_completion, created_at")


def list_conversations(user_id: str, *, include_archived: bool = False) -> list[dict[str, Any]]:
    q = (
        db.get_client()
        .table("finbot_conversations")
        .select(_CONVO_COLS)
        .eq("user_id", user_id)
        .order("pinned", desc=True)
        .order("updated_at", desc=True)
    )
    if not include_archived:
        q = q.is_("archived_at", "null")
    res = q.execute()
    return list(res.data or [])


def get_conversation(conversation_id: str, user_id: str) -> Optional[dict[str, Any]]:
    res = (
        db.get_client()
        .table("finbot_conversations")
        .select(_CONVO_COLS)
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def create_conversation(user_id: str, title: Optional[str] = None) -> dict[str, Any]:
    row: dict[str, Any] = {"user_id": user_id}
    if title:
        row["title"] = title[:120]
    res = (
        db.get_client()
        .table("finbot_conversations")
        .insert(row)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise RuntimeError("INSERT into finbot_conversations returned no row")
    return rows[0]


def update_conversation(
    conversation_id: str, user_id: str, payload: dict[str, Any]
) -> Optional[dict[str, Any]]:
    update: dict[str, Any] = {}
    if "title" in payload and payload["title"] is not None:
        update["title"] = str(payload["title"])[:120]
    if "pinned" in payload and payload["pinned"] is not None:
        update["pinned"] = bool(payload["pinned"])
    if "archived" in payload and payload["archived"] is not None:
        # Archive flag toggles archived_at timestamp.
        update["archived_at"] = (datetime.utcnow().isoformat() + "Z") if payload["archived"] else None

    if not update:
        return get_conversation(conversation_id, user_id)

    res = (
        db.get_client()
        .table("finbot_conversations")
        .update(update)
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def set_active_doc(
    conversation_id: str,
    user_id: str,
    doc_id: Optional[str],
) -> Optional[dict[str, Any]]:
    """Pin / unpin an Analyzer document on this conversation.

    `doc_id=None` clears the pin. Ownership is enforced by RLS plus the
    explicit user_id filter; the doc itself is validated by the caller
    (the backend endpoint) before this is invoked — keeps the repo
    layer purely about persistence.
    """
    res = (
        db.get_client()
        .table("finbot_conversations")
        .update({"active_doc_id": doc_id})
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def get_doc_brief(doc_id: str, user_id: str) -> Optional[dict[str, Any]]:
    """Return the fields needed to render a pinned-doc pill AND to
    enrich the FinBot system prompt with top-line financials.

    Pulls `extract_data` (ADE-extracted FinancialDocument JSON) so the
    caller can inject a compact financial summary into FinBot's system
    prompt. Letting the model see top-line numbers up front means a
    'summarize this doc' question can be answered without burning a
    RAG round-trip — frees RAG for specific drill-ins."""
    res = (
        db.get_client()
        .table("documents")
        .select("id, filename, status, upload_time, metadata, extract_data")
        .eq("id", doc_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return None
    row = rows[0]
    meta = row.get("metadata") or {}
    return {
        "doc_id":       row["id"],
        "filename":     row.get("filename"),
        "status":       row.get("status"),
        "uploaded_at":  row.get("upload_time"),
        "company_name": meta.get("company_name"),
        "doc_type":     meta.get("doc_type"),
        "fiscal_year":  meta.get("fiscal_year"),
        "currency":     meta.get("currency"),
        # FinancialDocument-shaped dict — caller decides what to surface.
        "extract_data": row.get("extract_data") or {},
    }


def delete_conversation(conversation_id: str, user_id: str) -> bool:
    """Hard delete. CASCADE removes all messages."""
    res = (
        db.get_client()
        .table("finbot_conversations")
        .delete()
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .execute()
    )
    return bool(res.data)


def touch_conversation(conversation_id: str, user_id: str) -> None:
    """Bump updated_at so the conversation jumps to the top of the sidebar."""
    db.get_client().table("finbot_conversations").update(
        {"updated_at": datetime.utcnow().isoformat() + "Z"}
    ).eq("id", conversation_id).eq("user_id", user_id).execute()


def list_messages(
    conversation_id: str, user_id: str, *, limit: int = 200
) -> list[dict[str, Any]]:
    res = (
        db.get_client()
        .table("finbot_messages")
        .select(_MSG_COLS)
        .eq("conversation_id", conversation_id)
        .eq("user_id", user_id)
        .order("created_at", desc=False)
        .limit(limit)
        .execute()
    )
    return list(res.data or [])


def insert_message(
    *,
    conversation_id: str,
    user_id: str,
    role: str,
    content: str,
    tool_calls: Optional[list[dict[str, Any]]] = None,
    tokens_prompt: int = 0,
    tokens_completion: int = 0,
) -> dict[str, Any]:
    row = {
        "conversation_id":   conversation_id,
        "user_id":           user_id,
        "role":              role,
        "content":           content,
        "tool_calls":        tool_calls,
        "tokens_prompt":     tokens_prompt,
        "tokens_completion": tokens_completion,
    }
    res = (
        db.get_client()
        .table("finbot_messages")
        .insert(row)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise RuntimeError("INSERT into finbot_messages returned no row")
    return rows[0]


# ─── helpers ────────────────────────────────────────────────────────────────

def _iso_date(value: Any) -> Optional[str]:
    """Normalise a date input into 'YYYY-MM-DD' for Postgres `date` columns."""
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value.isoformat()
    return str(value)
