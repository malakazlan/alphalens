"""Pre-flight financial-document classifier.

Runs in the worker before any ADE call. Goal: prevent credit waste on
obviously non-financial uploads (resumes, recipes, photos, code, marketing
brochures) without false-rejecting legitimate filings.

Design principles
─────────────────
- **Conservative threshold.** A false positive (rejecting a real filing)
  is far worse than a false negative (parsing a non-financial doc that
  slipped through). When in doubt: allow.
- **Free pre-screen.** Uses PyPDF2 text extraction — no external API
  calls, no LLM, no embeddings. Cost is ~50ms per doc.
- **First-N-pages only.** Real filings declare themselves in pages 1-10
  (cover, TOC, intro). Saves time on long docs.
- **Three outcomes.** `allow` (proceed), `reject` (refuse — no ADE),
  `uncertain` (likely scanned PDF — proceed but flag in metadata so
  ops can review false-allows separately).
"""
from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field
from typing import Literal

logger = logging.getLogger(__name__)

# ─── Vocabulary ─────────────────────────────────────────────────────────────
# Weights are coarse on purpose. The score IS the signal — there's no
# semantic match here, just lowercased substring presence.

# High-confidence financial markers — strings that almost never occur
# outside SEC / financial filings. Each match contributes 5 points.
_KEYWORDS_HIGH = {
    "form 10-k", "form 10-q", "form 8-k", "form s-1", "form 20-f",
    "consolidated balance sheet",
    "consolidated balance sheets",
    "consolidated statements of operations",
    "consolidated statement of operations",
    "consolidated statements of cash flows",
    "consolidated statement of cash flows",
    "consolidated statements of stockholders' equity",
    "consolidated statements of comprehensive income",
    "report of independent registered public accounting firm",
    "auditor's report",
    "auditors' report",
    "fiscal year ended",
    "fiscal years ended",
    "for the year ended december",
    "for the year ended",
    "annual report on form 10-k",
    "quarterly report on form 10-q",
    "diluted earnings per share",
    "basic earnings per share",
    "stockholders' equity",
    "shareholders' equity",
    "securities and exchange commission",
    "notes to consolidated financial statements",
}

# Medium-weight terms common in financials but possible elsewhere. +2 each.
_KEYWORDS_MED = {
    "revenue", "net income", "operating income", "gross profit",
    "gross margin", "operating margin", "net margin",
    "ebitda", "earnings per share", "free cash flow",
    "total assets", "total liabilities", "total equity",
    "current assets", "current liabilities", "long-term debt",
    "balance sheet", "cash flow", "income statement",
    "dividend", "dividends per share", "preferred stock", "common stock",
    "gaap", "non-gaap", "ifrs",
    "10-k", "10-q", "8-k", "annual report", "quarterly report",
    "audited", "audit committee", "internal control over financial reporting",
    "depreciation", "amortization", "impairment",
    "deferred tax", "goodwill",
}

# Low-weight terms. Common in marketing too — earn 1 point but most of
# them together still won't clear the threshold without medium/high hits.
_KEYWORDS_LOW = {
    "company", "business", "operations", "financial", "shares", "stock",
    "report", "period", "results", "performance", "fiscal", "quarterly",
    "auditor", "shareholder", "investor",
}

# ─── Decision rules ─────────────────────────────────────────────────────────
# A pure score threshold lets résumés / marketing brochures through
# because they sprinkle generic terms ("company", "business", "operations")
# that add up. Real filings *always* contain rare, structural phrases
# ("form 10-k", "consolidated balance sheet", "auditor's report"). We
# require that qualitative signal, with a quantitative fallback for
# financial docs that don't use the canonical SEC phrasing.
#
# Rules (in order, first match wins):
#   1. ≥ 1 HIGH-weight phrase           → allow (definitive — résumés never have these)
#   2. ≥ MED_HITS_REQUIRED MEDIUM phrases AND score ≥ MED_SCORE_FLOOR → allow
#   3. otherwise                        → reject
_MED_HITS_REQUIRED = 3
_MED_SCORE_FLOOR   = 10

# If extractable text length < this, the PDF is likely scanned. Don't
# reject (could be a scanned filing) — flag as uncertain and let ADE try.
_SCANNED_TEXT_FLOOR = 200
# Read at most this many pages for text extraction. Most filings declare
# themselves within the first 10 pages; reading more wastes time.
_MAX_PAGES_TO_READ  = 25


@dataclass(frozen=True)
class Classification:
    action: Literal["allow", "reject", "uncertain"]
    score: int
    text_length: int
    reason: str
    matched_keywords: list[str] = field(default_factory=list)


def classify_pdf(pdf_bytes: bytes) -> Classification:
    """Score a PDF against financial-document vocabulary.

    Returns:
      action='allow'      — score cleared the threshold; proceed to ADE.
      action='reject'     — clear non-financial; do not call ADE.
      action='uncertain'  — too little extractable text to judge (scanned
                            PDF); proceed to ADE but flag for review.
    """
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        # Listed in requirements; missing means broken environment. Allow
        # through rather than block uploads.
        logger.warning("PyPDF2 not available — financial classifier disabled, allowing all")
        return Classification(
            action="allow",
            score=0,
            text_length=0,
            reason="classifier unavailable (PyPDF2 missing)",
        )

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as e:
        # Malformed PDF — hand it to ADE which has its own error path.
        logger.warning(f"PDF could not be opened by PyPDF2: {e}")
        return Classification(
            action="allow",
            score=0,
            text_length=0,
            reason=f"could not parse PDF locally ({e})",
        )

    total_pages = len(reader.pages)
    pages_to_read = min(_MAX_PAGES_TO_READ, total_pages)

    text_parts: list[str] = []
    for i in range(pages_to_read):
        try:
            page_text = reader.pages[i].extract_text() or ""
        except Exception:
            continue
        text_parts.append(page_text)

    full_text = " ".join(text_parts).lower()
    text_length = len(full_text.strip())

    # Likely scanned PDF — extractable text is too thin to judge.
    if text_length < _SCANNED_TEXT_FLOOR:
        return Classification(
            action="uncertain",
            score=0,
            text_length=text_length,
            reason=(
                f"only {text_length} chars of extractable text in first "
                f"{pages_to_read} pages — likely scanned"
            ),
        )

    # Score the vocabulary, splitting hits by tier so we can apply
    # qualitative rules (not just a sum).
    matched_high: list[str] = [kw for kw in _KEYWORDS_HIGH if kw in full_text]
    matched_med:  list[str] = [kw for kw in _KEYWORDS_MED  if kw in full_text]
    matched_low:  list[str] = [kw for kw in _KEYWORDS_LOW  if kw in full_text]
    score = len(matched_high) * 5 + len(matched_med) * 2 + len(matched_low) * 1
    matched_summary = (matched_high + matched_med + matched_low)[:12]

    # Rule 1 — any HIGH-weight phrase = definitive financial doc.
    if matched_high:
        return Classification(
            action="allow",
            score=score,
            text_length=text_length,
            reason=f"high-weight phrase matched: '{matched_high[0]}'",
            matched_keywords=matched_summary,
        )

    # Rule 2 — multiple medium-weight signals with backing context.
    if len(matched_med) >= _MED_HITS_REQUIRED and score >= _MED_SCORE_FLOOR:
        return Classification(
            action="allow",
            score=score,
            text_length=text_length,
            reason=(
                f"{len(matched_med)} medium-weight matches "
                f"(score {score}, ≥{_MED_SCORE_FLOOR})"
            ),
            matched_keywords=matched_summary,
        )

    # Rule 3 — fall through. Generic words alone don't qualify.
    return Classification(
        action="reject",
        score=score,
        text_length=text_length,
        reason=(
            "This file does not look like a financial document. "
            "AlphaLens accepts SEC filings (10-K, 10-Q, 8-K, S-1), "
            "audited annual reports, prospectuses, and similar. "
            "Please upload one of those formats."
        ),
        matched_keywords=matched_summary,
    )
