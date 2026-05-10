"""Pre-flight page filter — trim TOC, exhibit indexes, blanks, signature
blocks before sending the PDF to ADE.

Cost lever 1. Conservative by design: a false-skip (dropping a page the
user wanted) erodes trust faster than the dollar saved. When in doubt,
keep the page. Hard cap at 60% skip rate as a safety net.

Outputs a `(kept_indices, skip_reason_counts)` tuple. The caller writes a
trimmed PDF using `build_filtered_pdf(...)` and remaps page numbers on
ADE output back to original-PDF coordinates using `kept_indices`.
"""
from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass
from typing import Iterable

logger = logging.getLogger(__name__)


# ─── Tunables ────────────────────────────────────────────────────────────────
# Below this page count, the per-page savings don't justify the filter cost.
_MIN_PAGES_TO_FILTER = 10

# Pages with less extractable text than this are likely cover pages, blank
# backs, or scanned-image pages. Skipping them costs ADE nothing of value.
_EMPTY_TEXT_THRESHOLD = 50

# Hard safety: if the filter would skip more than this fraction of pages,
# we assume the heuristic mis-fired and keep everything.
_MAX_SKIP_FRACTION = 0.60


# ─── Detection patterns ─────────────────────────────────────────────────────
# Dotted leaders typical of TOCs ("Section 1 ............... 12").
_TOC_DOT_LEADER_RE = re.compile(r"\.{4,}\s*\d+", re.MULTILINE)

# Explicit TOC / index header text, anywhere on the page.
_TOC_HEADER_RE = re.compile(
    r"\b(table\s+of\s+contents|index\s+of\s+exhibits|exhibit\s+index)\b",
    re.IGNORECASE,
)

# An "INDEX OF EXHIBITS" line at the start of a page = pure exhibit list.
_EXHIBIT_INDEX_TOP_RE = re.compile(
    r"^\s*(?:index\s+of\s+exhibits|exhibit\s+index)\b",
    re.IGNORECASE | re.MULTILINE,
)

# Signature block markers usually near the top of a page.
_SIGNATURE_HEADER_RE = re.compile(
    r"\b(signatures?|in\s+witness\s+whereof)\b",
    re.IGNORECASE,
)

# "By:" line is the canonical signature line in SEC filings.
_SIGNATURE_BY_RE = re.compile(r"^\s*By:\s*", re.MULTILINE)


# ─── Public types ───────────────────────────────────────────────────────────
@dataclass(frozen=True)
class PageDecision:
    keep: bool
    reason: str  # included in audit metadata


# ─── Per-page classifier ────────────────────────────────────────────────────
def _classify_page(text: str) -> PageDecision:
    text_stripped = text.strip()
    if len(text_stripped) < _EMPTY_TEXT_THRESHOLD:
        return PageDecision(keep=False, reason="empty_or_image")

    # TOC-style page.
    leader_count = len(_TOC_DOT_LEADER_RE.findall(text))
    has_toc_header = bool(_TOC_HEADER_RE.search(text))
    if has_toc_header and leader_count >= 3:
        return PageDecision(keep=False, reason="toc")
    if leader_count >= 8:
        # Dense dotted leaders with no other signal — almost certainly TOC.
        return PageDecision(keep=False, reason="toc")

    # Pure exhibit-index page.
    if _EXHIBIT_INDEX_TOP_RE.search(text):
        return PageDecision(keep=False, reason="exhibit_index")

    # Signature block.
    if _SIGNATURE_HEADER_RE.search(text[:600]):
        if len(_SIGNATURE_BY_RE.findall(text)) >= 2:
            return PageDecision(keep=False, reason="signature_block")

    return PageDecision(keep=True, reason="content")


# ─── Page selection ─────────────────────────────────────────────────────────
def select_pages(pdf_bytes: bytes) -> tuple[list[int], dict[str, int]]:
    """Return `(indices_to_keep, skip_reason_counts)`.

    Falls back to keeping all pages if (a) PyPDF2 is missing, (b) the PDF
    can't be opened locally, (c) total pages < threshold, or (d) the filter
    would skip more than `_MAX_SKIP_FRACTION` of pages."""
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        logger.warning("page_filter: PyPDF2 missing — skipping filter")
        return ([], {"_pypdf2_missing": 1})

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as e:
        logger.warning(f"page_filter: could not open PDF: {e}")
        return ([], {"_open_error": 1})

    total = len(reader.pages)
    if total < _MIN_PAGES_TO_FILTER:
        return (list(range(total)), {"_below_threshold": total})

    keep: list[int] = []
    reasons: dict[str, int] = {}
    for i in range(total):
        try:
            text = reader.pages[i].extract_text() or ""
        except Exception:
            text = ""
        decision = _classify_page(text)
        reasons[decision.reason] = reasons.get(decision.reason, 0) + 1
        if decision.keep:
            keep.append(i)

    # Safety nets.
    if not keep:
        logger.warning("page_filter: would skip all pages — keeping everything")
        return (list(range(total)), {"_safety_keep_all": total})

    skipped = total - len(keep)
    if skipped / total > _MAX_SKIP_FRACTION:
        logger.warning(
            "page_filter: would skip %d/%d (>%.0f%%) — conservative keep all",
            skipped, total, _MAX_SKIP_FRACTION * 100,
        )
        return (list(range(total)), {"_safety_threshold": total})

    return (keep, reasons)


# ─── PDF builder ────────────────────────────────────────────────────────────
def build_filtered_pdf(pdf_bytes: bytes, page_indices: Iterable[int]) -> bytes:
    """Construct a new PDF containing only the listed (0-based) page indices.

    Caller must verify `page_indices` is a strict subset of `range(total)`."""
    from PyPDF2 import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    indices = list(page_indices)
    total = len(reader.pages)
    for idx in indices:
        if 0 <= idx < total:
            writer.add_page(reader.pages[idx])

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
