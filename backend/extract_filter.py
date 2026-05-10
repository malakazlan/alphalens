"""Cost Lever 3 — targeted ADE Extract input.

Today the worker hands the *entire* parsed markdown to ADE Extract. ADE
bills Extract by input character count, but the FinancialDocument schema
only populates from financial tables, key-value chunks, and section
headers within the financial-statements parts of the document. The
narrative MD&A, boilerplate disclaimers, and bulk of the risk-factor
prose contribute almost nothing to the structured output.

This module builds a focused subset of the markdown — same financial
content, fewer characters. Real-world reduction: ~60-70% on a typical
10-K. Falls back to the full markdown when the filter would over-shrink.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


# ─── Section header patterns ────────────────────────────────────────────────
# Lowercased substring match against `chunk.section_header`. Body chunks
# (paragraphs, lists) are kept ONLY when the section header trips one of
# these patterns. Financial tables are kept regardless of section.
_FIN_SECTION_PATTERNS = (
    "income statement", "statement of operations", "statements of operations",
    "consolidated statement", "consolidated statements",
    "balance sheet", "balance sheets",
    "comprehensive income",
    "cash flow", "cash flows",
    "stockholders' equity", "shareholders' equity",
    "stockholders equity", "shareholders equity",  # apostrophe variants
    "key metrics", "key financial",
    "selected financial", "summary financial",
    "auditor", "audit",
    "fiscal year",
    "red flag", "risk factor",
    "notes to consolidated", "notes to financial",
)

# Chunk types kept regardless of section (the high-density financial signal).
_ALWAYS_KEEP_TYPES = frozenset({
    "table", "key_value", "title",
})

# Below this filtered-length, we don't trust the filter and fall back.
_MIN_FILTERED_LENGTH = 5_000

# Always-included document head — usually has cover-page info: company
# name, fiscal year, currency, exchange listing.
_HEAD_CONTEXT_CHARS = 800


def _section_is_financial(header: str | None) -> bool:
    if not header:
        return False
    h = header.lower()
    return any(p in h for p in _FIN_SECTION_PATTERNS)


def build_extract_markdown(
    full_markdown: str,
    chunks: list[dict[str, Any]],
) -> tuple[str, dict[str, Any]]:
    """Build a focused markdown for ADE Extract.

    Returns `(filtered_markdown, stats)`. When the filter would shrink the
    input below `_MIN_FILTERED_LENGTH`, returns the full markdown unchanged
    plus stats with `applied=False` so the caller can record what happened.
    """
    if not chunks or not full_markdown:
        return full_markdown, {"applied": False, "reason": "no_chunks_or_markdown"}

    parts: list[str] = []

    # Always include the document head — cheap, almost always useful.
    head = full_markdown[:_HEAD_CONTEXT_CHARS].strip()
    if head:
        parts.append(head)

    keep_count = 0
    skip_count = 0
    for c in chunks:
        # ADE chunk objects expose `type`; our dict copies use the same key.
        # Defensive `chunk_type` fallback covers the worker's enriched form.
        ctype     = c.get("type") or c.get("chunk_type") or ""
        section   = c.get("section_header") or ""
        markdown  = c.get("markdown") or ""
        if not markdown:
            continue

        keep = (
            ctype in _ALWAYS_KEEP_TYPES
            or _section_is_financial(section)
        )
        if keep:
            parts.append(markdown)
            keep_count += 1
        else:
            skip_count += 1

    filtered = "\n\n".join(parts)

    full_chars     = len(full_markdown)
    filtered_chars = len(filtered)
    reduction_pct  = (
        round((1 - filtered_chars / full_chars) * 100, 1)
        if full_chars else 0
    )

    # Safety: a too-small result usually means the chunk classification
    # missed the financial sections (different doc structure). Fall back
    # rather than starve Extract.
    if filtered_chars < _MIN_FILTERED_LENGTH:
        logger.warning(
            "extract_filter: filtered to %d chars (<%d threshold) — falling back",
            filtered_chars, _MIN_FILTERED_LENGTH,
        )
        return full_markdown, {
            "applied":        False,
            "reason":         "below_min_length",
            "filtered_chars": filtered_chars,
            "full_chars":     full_chars,
            "chunks_kept":    keep_count,
            "chunks_skipped": skip_count,
        }

    return filtered, {
        "applied":        True,
        "chunks_kept":    keep_count,
        "chunks_skipped": skip_count,
        "full_chars":     full_chars,
        "filtered_chars": filtered_chars,
        "reduction_pct":  reduction_pct,
    }
