"""Repository for Phase 3 report tables.

Lives alongside `db.py` (which keeps the legacy `reports` table CRUD)
and `finbot_repo.py` / `analyzer_chat_repo.py`. Purely data-layer
helpers — no business logic, no streaming, no LLM. The generate +
regenerate flows wire calls to these in commits 2-3.

All reads/writes go through the service-role Supabase client; RLS is
enforced at the policy level (see migration 0007), and we additionally
filter by user_id on every operation as defense-in-depth.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import db

logger = logging.getLogger(__name__)


# ─── report_versions ────────────────────────────────────────────────────────
# Snapshot of one section output. Inserted on every successful section
# generate / regenerate. Caller passes the OUTPUT text (cleaned, no
# citation markers) plus optional model + token metadata for cost audit.

_VERSION_KEEP_PER_SECTION = 20
# Phase 3 §10 risk mitigation: keep last N versions per (report, section).
# A nightly job (Phase 5 cron) prunes older rows; for now we soft-cap on
# read via the LIMIT below.


def insert_version(
    *,
    report_id:   str,
    user_id:     str,
    section_id:  str,
    content:     str,
    model:       Optional[str] = None,
    tokens_in:   Optional[int] = None,
    tokens_out:  Optional[int] = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "report_id":  report_id,
        "user_id":    user_id,
        "section_id": section_id,
        "content":    content,
    }
    if model is not None:
        payload["model"] = model
    if tokens_in is not None:
        payload["tokens_in"] = tokens_in
    if tokens_out is not None:
        payload["tokens_out"] = tokens_out
    res = (
        db.get_client()
        .table("report_versions")
        .insert(payload)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise RuntimeError("INSERT into report_versions returned no row")
    return rows[0]


def list_versions(
    *,
    report_id:  str,
    user_id:    str,
    section_id: str,
    limit:      int = _VERSION_KEEP_PER_SECTION,
) -> list[dict[str, Any]]:
    """Most recent versions first. Capped to keep response size sane."""
    res = (
        db.get_client()
        .table("report_versions")
        .select("id, section_id, content, model, tokens_in, tokens_out, created_at")
        .eq("report_id",  report_id)
        .eq("user_id",    user_id)
        .eq("section_id", section_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def get_version(version_id: str, user_id: str) -> Optional[dict[str, Any]]:
    res = (
        db.get_client()
        .table("report_versions")
        .select("id, report_id, section_id, content, model, tokens_in, tokens_out, created_at")
        .eq("id",      version_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def delete_versions_for_section(
    *,
    report_id:  str,
    user_id:    str,
    section_id: str,
) -> int:
    """Drop every version row for one section. Used when the user resets a
    section. CASCADE on report delete handles the table-wide case."""
    res = (
        db.get_client()
        .table("report_versions")
        .delete()
        .eq("report_id",  report_id)
        .eq("user_id",    user_id)
        .eq("section_id", section_id)
        .execute()
    )
    return len(res.data or [])


# ─── report_sources ─────────────────────────────────────────────────────────
# The audit trail. Inserted per section as a batch — one row per chunk
# that fed the LLM call. Dedup on the application side; the table has no
# unique constraint so a re-run captures the same chunks again with new
# created_at, which is the desired behaviour for ops auditing.

def insert_sources_batch(
    *,
    report_id:  str,
    user_id:    str,
    section_id: str,
    chunks:     list[dict[str, Any]],
) -> int:
    """Insert N source rows in one call. Each chunk dict must have
    `chunk_id`; `page` and `section_header` are optional. Returns the
    count actually inserted (0 if `chunks` was empty)."""
    if not chunks:
        return 0
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()  # dedup within a single batch by chunk_id
    for c in chunks:
        cid = c.get("chunk_id")
        if not cid or cid in seen:
            continue
        seen.add(cid)
        rows.append({
            "report_id":      report_id,
            "user_id":        user_id,
            "section_id":     section_id,
            "chunk_id":       cid,
            "page":           c.get("page"),
            "section_header": c.get("section_header"),
        })
    if not rows:
        return 0
    res = (
        db.get_client()
        .table("report_sources")
        .insert(rows)
        .execute()
    )
    return len(res.data or [])


def list_sources(
    *,
    report_id:  str,
    user_id:    str,
    section_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """All sources for a report, or scoped to one section. Latest first."""
    q = (
        db.get_client()
        .table("report_sources")
        .select("id, section_id, chunk_id, page, section_header, created_at")
        .eq("report_id", report_id)
        .eq("user_id",   user_id)
        .order("created_at", desc=True)
    )
    if section_id is not None:
        q = q.eq("section_id", section_id)
    res = q.execute()
    return res.data or []


def delete_sources_for_section(
    *,
    report_id:  str,
    user_id:    str,
    section_id: str,
) -> int:
    """Drop the audit trail for one section — called BEFORE re-capture on
    a regenerate so the trail reflects the latest run, not an accumulation."""
    res = (
        db.get_client()
        .table("report_sources")
        .delete()
        .eq("report_id",  report_id)
        .eq("user_id",    user_id)
        .eq("section_id", section_id)
        .execute()
    )
    return len(res.data or [])


# ─── report_templates_custom ────────────────────────────────────────────────
# User-owned report templates. `sections` is a JSONB array; the generator
# iterates it the same way it iterates the built-in TEMPLATES dict.

def list_custom_templates(user_id: str) -> list[dict[str, Any]]:
    res = (
        db.get_client()
        .table("report_templates_custom")
        .select("id, name, description, sections, created_at, updated_at")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .execute()
    )
    return res.data or []


def get_custom_template(template_id: str, user_id: str) -> Optional[dict[str, Any]]:
    res = (
        db.get_client()
        .table("report_templates_custom")
        .select("id, name, description, sections, created_at, updated_at")
        .eq("id",      template_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def create_custom_template(
    *,
    user_id:     str,
    name:        str,
    description: Optional[str],
    sections:    list[dict[str, Any]],
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "user_id":  user_id,
        "name":     name[:120],
        "sections": sections,
    }
    if description:
        payload["description"] = description[:500]
    res = (
        db.get_client()
        .table("report_templates_custom")
        .insert(payload)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise RuntimeError("INSERT into report_templates_custom returned no row")
    return rows[0]


def update_custom_template(
    template_id: str,
    user_id:     str,
    *,
    name:        Optional[str]                = None,
    description: Optional[str]                = None,
    sections:    Optional[list[dict[str, Any]]] = None,
) -> Optional[dict[str, Any]]:
    update: dict[str, Any] = {}
    if name        is not None: update["name"]        = name[:120]
    if description is not None: update["description"] = description[:500]
    if sections    is not None: update["sections"]    = sections
    if not update:
        return get_custom_template(template_id, user_id)
    res = (
        db.get_client()
        .table("report_templates_custom")
        .update(update)
        .eq("id",      template_id)
        .eq("user_id", user_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def delete_custom_template(template_id: str, user_id: str) -> bool:
    res = (
        db.get_client()
        .table("report_templates_custom")
        .delete()
        .eq("id",      template_id)
        .eq("user_id", user_id)
        .execute()
    )
    return bool(res.data)


# ─── reports — PDF render state ─────────────────────────────────────────────
# Thin helpers around the new pdf_* columns. We keep them here rather than
# in db.py so the Phase 3 read/write surface lives in one module that
# tests and callers can target without pulling in the legacy report row
# operations.

def set_pdf_status(
    report_id:      str,
    user_id:        str,
    status:         str,
    *,
    pdf_url:        Optional[str] = None,
    size_bytes:     Optional[int] = None,
    rendered_at_now: bool         = False,
    status_message: Optional[str] = None,
) -> None:
    """Update PDF state. `status` must be one of the constraint values
    (idle/queued/rendering/ready/error)."""
    update: dict[str, Any] = {"pdf_status": status}
    if pdf_url is not None:        update["pdf_url"]            = pdf_url
    if size_bytes is not None:     update["pdf_size_bytes"]     = size_bytes
    if rendered_at_now:            update["pdf_rendered_at"]    = "now()"
    if status_message is not None: update["pdf_status_message"] = status_message[:500]
    (
        db.get_client()
        .table("reports")
        .update(update)
        .eq("id",      report_id)
        .eq("user_id", user_id)
        .execute()
    )


def get_pdf_state(report_id: str, user_id: str) -> Optional[dict[str, Any]]:
    """Just the PDF-render state, no heavy sections payload."""
    res = (
        db.get_client()
        .table("reports")
        .select("id, pdf_status, pdf_url, pdf_rendered_at, pdf_size_bytes, pdf_status_message")
        .eq("id",      report_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None
