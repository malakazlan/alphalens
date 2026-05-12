"""Finance-analyst tools.

Each function in this module is exposed to the LLM as a tool. The names,
signatures, and docstrings here are what the model sees — they MUST be
unambiguous and short.

Every tool:
  - takes (ctx: DocContext, args: <ArgsModel>) — never raw kwargs
  - returns a ToolResult — never a raw dict
  - populates `citations` for every chunk it touched
  - catches its own exceptions and reports them via ok=False + error

The DocContext is a small bundle of pre-built per-document caches the
orchestrator passes around: chunk_lookup (cell_id → text), grounding,
qdrant chunks, table grids, section map. Building these costs ~200ms;
we build once per turn and share across tool calls.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

from .schemas import (
    CitationRef,
    ToolResult,
    LookupValueArgs,
    GetSectionArgs,
    ListFiguresArgs,
    ReadFigureArgs,
    ComputeRatioArgs,
    ComparePeriodsArgs,
    DecomposeChangeArgs,
    DetectRedFlagsArgs,
    QueryFreeformArgs,
)

logger = logging.getLogger(__name__)


# ─── DocContext — shared per-turn cache ─────────────────────────────────────
@dataclass
class DocContext:
    """Per-document, per-turn working set. Built once by the orchestrator;
    every tool reads from it. NO tool mutates it.

    Fields:
        doc_id, user_id     — for any further qdrant lookups
        cell_lookup         — {cell_id: cell_text}    extracted from full markdown
        grounding_dict      — {element_id: {page, bbox, type}} from document_grounding
        qdrant_chunks       — list of qdrant payloads (chunk_type, page, markdown, ...)
        table_grids         — {table_id: grid}, parsed by _build_table_grids
        cell_section_map    — {cell_id: section_header}
        doc_metadata        — {company_name, fiscal_year, doc_type, currency}
        extract             — extract_data JSONB from documents row (top-line metrics)
    """
    doc_id:           str
    user_id:          str
    cell_lookup:      dict[str, str]                          = field(default_factory=dict)
    grounding_dict:   dict[str, dict[str, Any]]               = field(default_factory=dict)
    qdrant_chunks:    list[dict[str, Any]]                    = field(default_factory=list)
    table_grids:      dict[str, dict[str, Any]]               = field(default_factory=dict)
    cell_section_map: dict[str, str]                          = field(default_factory=dict)
    doc_metadata:     dict[str, Any]                          = field(default_factory=dict)
    extract:          dict[str, Any]                          = field(default_factory=dict)


# ─── Helpers (private) ──────────────────────────────────────────────────────
_WORD_RE = re.compile(r"[a-zA-Z]{3,}")
_NUM_RE  = re.compile(r"[-+]?\$?\(?[\d,]+(?:\.\d+)?\)?%?")


def _normalise(s: str) -> str:
    """Lowercase + collapse whitespace + strip. Stable comparison key."""
    return re.sub(r"\s+", " ", (s or "").lower().strip())


def _parse_amount(s: str) -> float | None:
    """Parse a financial-statement value string to a float.

    Handles:
      - thousands separators (1,234,567)
      - currency prefixes ($ £ € ¥ ₹)
      - parenthetical negatives ((880,843) = -880843)
      - trailing percent signs (12.5% → 12.5)
      - leading sign (+ / -)
    Returns None when the string isn't numeric.

    Shared by every tool that needs numeric arithmetic over cell values
    so the parsing rules stay consistent — diverging interpretations
    of "(123)" would silently corrupt every comparison and ratio.
    """
    s = (s or "").strip()
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    s = re.sub(r"[\s,]", "", s)
    s = re.sub(r"^[\$£€¥₹]", "", s)
    s = s.rstrip("%")
    try:
        v = float(s)
        return -v if neg else v
    except ValueError:
        return None


def _tokens(s: str) -> set[str]:
    return {w.lower() for w in _WORD_RE.findall(s or "")}


def _row_label_for_cell(ctx: DocContext, cell_id: str) -> str:
    """Walk the table grid to find the row label of a cell.

    Returns "" when the cell is itself in the table's header row — header-row
    text is column headers (years, period labels), not row labels. Without
    this guard, a column-header cell like '2024' would be tagged as a row
    of the "Revenue" line item.
    """
    if not ctx.table_grids:
        return ""
    for grid in ctx.table_grids.values():
        rows = grid.get("rows") or []
        hr   = grid.get("header_row", 0)
        for r_idx, r in enumerate(rows):
            if cell_id in r:
                if r_idx == hr:
                    return ""               # header-row cell: no row label
                label_col = grid.get("label_col", 0)
                if 0 <= label_col < len(r):
                    return ctx.cell_lookup.get(r[label_col] or "", "")
                return ""
    return ""


def _is_header_cell(ctx: DocContext, cell_id: str) -> bool:
    """True when the cell sits in the header row of any grid we know about."""
    for grid in ctx.table_grids.values():
        rows = grid.get("rows") or []
        hr   = grid.get("header_row", 0)
        if 0 <= hr < len(rows) and cell_id in rows[hr]:
            return True
    return False


def _col_header_for_cell(ctx: DocContext, cell_id: str) -> str:
    """Column header (period label) for a cell, from the table grid."""
    if not ctx.table_grids:
        return ""
    for grid in ctx.table_grids.values():
        rows = grid.get("rows") or []
        hr = grid.get("header_row", 0)
        for r_idx, r in enumerate(rows):
            if cell_id in r and r_idx != hr and 0 <= hr < len(rows):
                col_idx = r.index(cell_id)
                if 0 <= col_idx < len(rows[hr]):
                    return ctx.cell_lookup.get(rows[hr][col_idx] or "", "")
    return ""


def _make_citation(ctx: DocContext, cell_id: str, label: str | None = None) -> CitationRef | None:
    """Build a CitationRef from a cell or chunk id. Returns None if we don't
    have grounding for it (don't emit chips that can't be highlighted)."""
    g = ctx.grounding_dict.get(cell_id)
    if not g:
        # Maybe it's a Qdrant-only chunk (figure/text without a grounding row)
        for ch in ctx.qdrant_chunks:
            if ch.get("chunk_id") == cell_id:
                return CitationRef(
                    chunk_id=cell_id,
                    chunk_type=ch.get("chunk_type") or "text",
                    page=int(ch.get("page", 0) or 0),
                    label=label,
                    bbox=ch.get("bbox") or None,
                )
        return None
    chunk_type = (g.get("type") or "text").lower()
    if "cell" in chunk_type:
        chunk_type = "table_cell"
    return CitationRef(
        chunk_id=cell_id,
        chunk_type=chunk_type,
        page=int(g.get("page", 0) or 0),
        label=label,
        bbox=g.get("bbox") or None,
    )


# ─── Synonym map for line-item matching ─────────────────────────────────────
# Same canonical financial vocabulary used elsewhere in the system. Lets
# `lookup_value("revenue")` match a cell labelled "Sales" or "Turnover".
_LINE_ITEM_SYNONYMS: dict[str, list[str]] = {
    "revenue":         ["revenue", "net revenue", "sales", "net sales", "turnover", "total revenue", "income from operations"],
    "net income":      ["net income", "profit for the year", "earnings", "profit after tax", "net earnings", "income for the year", "net loss", "loss for the year"],
    "operating income":["operating income", "profit from operations", "ebit", "operating profit"],
    "gross profit":    ["gross profit", "gross margin"],
    "cash from operations": ["cash from operations", "cash generated from operations", "net cash from operating activities", "operating cash flow"],
    "total assets":    ["total assets"],
    "total liabilities":["total liabilities"],
    "total equity":    ["total equity", "shareholders' equity", "stockholders' equity", "members' equity", "total members' equity"],
    "borrowings":      ["borrowings", "total borrowings", "long-term debt", "long term debt", "debt"],
    "cash":            ["cash", "cash and cash equivalents", "cash and due from banks"],
    "interest expense":["interest expense", "interest and similar expense", "finance costs"],
    "depreciation":    ["depreciation", "depreciation and amortization", "depreciation and amortisation"],
}


# ─── Section-name aliases ──────────────────────────────────────────────────
# Same idea as line-item synonyms but at the SECTION level. The doc may
# label the same content as 'Balance Sheet', 'Consolidated Balance Sheet',
# 'Statement of Financial Position' — the agent shouldn't have to guess
# which surface form the parser captured. When the agent asks
# get_section('balance sheet') we expand to ALL aliases and match cells
# whose section_header overlaps any of them.
#
# Each canonical key maps to the surface forms we accept from EITHER side
# (the agent's query or the document's section_header). Order inside each
# list doesn't matter — every alias is compared symmetrically.
_SECTION_ALIASES: dict[str, list[str]] = {
    "balance_sheet": [
        "balance sheet", "balance sheets",
        "consolidated balance sheet", "consolidated balance sheets",
        "statement of financial position", "statements of financial position",
        "consolidated statement of financial position",
        "assets", "liabilities", "equity",                # short names users say
        "total assets", "total liabilities",
        "current assets", "non-current assets", "noncurrent assets",
        "current liabilities", "non-current liabilities", "noncurrent liabilities",
        "shareholders equity", "shareholders' equity",
        "stockholders equity", "stockholders' equity",
        "members equity", "members' equity",
        "property plant and equipment", "ppe",
    ],
    "income_statement": [
        "income statement", "income statements",
        "consolidated income statement", "consolidated statement of operations",
        "statement of operations", "statements of operations",
        "profit and loss", "profit & loss", "p&l",
        "results of operations",
        "revenue", "revenues", "sales",
        "operating expenses",
    ],
    "cash_flow": [
        "cash flow statement", "cash flow statements",
        "statement of cash flows", "statements of cash flows",
        "consolidated statement of cash flows",
        "cash flows from operating activities",
        "operating activities", "investing activities", "financing activities",
    ],
    "comprehensive_income": [
        "comprehensive income", "statement of comprehensive income",
        "other comprehensive income", "oci",
    ],
    "changes_in_equity": [
        "changes in equity", "statement of changes in equity",
        "statement of changes in members' equity",
        "statement of stockholders' equity",
        "retained earnings", "soce",
    ],
    "notes": [
        "notes", "notes to financial statements",
        "notes to the financial statements",
        "notes to consolidated financial statements",
        "accounting policies", "summary of significant accounting policies",
    ],
}


def _expand_section_aliases(name: str) -> list[str]:
    """Return surface forms for a section name. Same two-pass strategy as
    line-item alias expansion: exact match wins, longest substring fallback.
    """
    key = _normalise(name)
    # Pass 1: exact alias match.
    for canon, aliases in _SECTION_ALIASES.items():
        if any(_normalise(a) == key for a in aliases):
            return aliases
    # Pass 2: longest matching alias.
    best_canon: str | None = None
    best_len = 0
    for canon, aliases in _SECTION_ALIASES.items():
        for a in aliases:
            na = _normalise(a)
            if (na in key or key in na):
                length = min(len(na), len(key))
                if length > best_len:
                    best_len = length
                    best_canon = canon
    if best_canon is not None:
        return list(_SECTION_ALIASES[best_canon])
    return [name]


def _expand_aliases(line_item: str) -> list[str]:
    """Return all known surface forms for a line-item name.

    Resolution order — specificity matters here:
      1. EXACT match against any alias — if the user / agent typed
         'cash from operations', the bucket whose alias list literally
         contains 'cash from operations' wins, even though shorter
         aliases in OTHER buckets (e.g. 'cash' in the cash bucket) are
         substring-overlapping.
      2. Longest-alias substring fallback — for partial / synonym
         matches. Pick the canonical bucket whose LONGEST matching
         alias is the longest overall (i.e. the most specific). Stops
         'cash from operations' resolving to the 'cash' bucket because
         'cash' is a 4-char substring while 'cash from operations'
         exact-matches and 'cash generated from operations' is a
         19-char substring of itself.
    Returns [line_item] verbatim when no canonical match found.
    """
    key = _normalise(line_item)

    # Pass 1: exact-match wins.
    for canon, aliases in _LINE_ITEM_SYNONYMS.items():
        if any(_normalise(a) == key for a in aliases):
            return aliases

    # Pass 2: longest-alias substring fallback.
    best_canon: str | None = None
    best_match_len = 0
    for canon, aliases in _LINE_ITEM_SYNONYMS.items():
        for a in aliases:
            na = _normalise(a)
            if (na in key or key in na):
                length = min(len(na), len(key))
                if length > best_match_len:
                    best_match_len = length
                    best_canon = canon
    if best_canon is not None:
        return list(_LINE_ITEM_SYNONYMS[best_canon])
    return [line_item]


# ────────────────────────────────────────────────────────────────────────────
# TOOL 1 — lookup_value
# ────────────────────────────────────────────────────────────────────────────
def lookup_value(ctx: DocContext, args: LookupValueArgs) -> ToolResult:
    """Find the value of a specific line item, optionally for a specific
    period. Returns one or more matching cells with their row labels and
    column headers.
    """
    t0 = time.time()
    aliases = _expand_aliases(args.line_item)
    target_period = _normalise(args.period) if args.period else None

    matches: list[dict[str, Any]] = []
    citations: list[CitationRef] = []
    for cid, text in ctx.cell_lookup.items():
        # Skip header-row cells (they're column labels like "2024", not data).
        if _is_header_cell(ctx, cid):
            continue
        # Skip cells with no resolvable row label — the value isn't
        # attributable to a line item; don't surface it.
        row_label = _row_label_for_cell(ctx, cid)
        if not row_label:
            continue
        # Skip if THIS cell is the row label cell (column-0 of its row);
        # the row label of column-0 IS the same string we're comparing.
        if _normalise(text or "") == _normalise(row_label):
            continue
        rl_norm = _normalise(row_label)
        # Match if any alias is a substring of the row label OR exactly equal
        # to it. Strictly one-directional: a row label like "Cash" must NOT
        # match the alias "cash from operations" — that's how the wrong cells
        # leaked into the accrual-quality red-flag detector.
        if not any(_normalise(a) == rl_norm or _normalise(a) in rl_norm for a in aliases):
            continue
        # column header / period
        col_header = _col_header_for_cell(ctx, cid)
        if target_period:
            ch_norm = _normalise(col_header)
            if target_period not in ch_norm and ch_norm not in target_period:
                continue
        # value text — skip empty/label cells
        v = (text or "").strip()
        if not v or _normalise(v) == _normalise(row_label):
            continue
        matches.append({
            "cell_id":       cid,
            "row_label":     row_label,
            "period":        col_header or None,
            "value":         v,
            "section":       ctx.cell_section_map.get(cid, ""),
        })
        cit = _make_citation(ctx, cid, label=f"{row_label} {col_header or ''}".strip())
        if cit:
            citations.append(cit)

    matches = matches[:20]  # cap payload
    citations = citations[:20]

    ok = len(matches) > 0
    summary = (
        f"Found {len(matches)} value(s) for '{args.line_item}'"
        + (f" in {args.period}" if args.period else "")
    ) if ok else f"No value found for '{args.line_item}'" + (f" in {args.period}" if args.period else "")

    return ToolResult(
        tool_name="lookup_value",
        ok=ok,
        summary=summary,
        payload={"line_item": args.line_item, "period": args.period, "matches": matches},
        citations=citations,
        latency_ms=int((time.time() - t0) * 1000),
    )


# ────────────────────────────────────────────────────────────────────────────
# TOOL 2 — get_section
# ────────────────────────────────────────────────────────────────────────────
def get_section(ctx: DocContext, args: GetSectionArgs) -> ToolResult:
    """Return every cell whose section_header matches the given name.
    Useful when the user asks for an overview/summary of a named section.

    Section matching is alias-aware: get_section('balance sheet') also
    matches sections labelled 'Statement of Financial Position',
    'Consolidated Balance Sheet', etc. Without this the agent would have
    to guess the exact surface form the parser captured — and silently
    fail when the guess was wrong.
    """
    t0 = time.time()
    aliases = _expand_section_aliases(args.name)
    alias_norms = [_normalise(a) for a in aliases]
    rows: list[dict[str, Any]] = []
    citations: list[CitationRef] = []
    seen_cells: set[str] = set()
    for cid, sec in ctx.cell_section_map.items():
        if cid in seen_cells:
            continue
        if not sec:
            continue
        sn = _normalise(sec)
        # Match when any alias is a substring of the section header OR
        # exactly equal. One-directional: avoids 'cash' (alias) matching
        # 'cash flow' (section) when the agent asked for the cash-flow
        # statement specifically.
        if not any(a == sn or a in sn for a in alias_norms):
            continue
        text = ctx.cell_lookup.get(cid, "")
        if not text.strip():
            continue
        rl = _row_label_for_cell(ctx, cid)
        ch = _col_header_for_cell(ctx, cid)
        # Skip pure label cells (the row label IS the value)
        if rl and _normalise(rl) == _normalise(text):
            continue
        rows.append({
            "cell_id":   cid,
            "row_label": rl,
            "period":    ch or None,
            "value":     text,
            "section":   sec,
        })
        seen_cells.add(cid)
        cit = _make_citation(ctx, cid, label=f"{rl} {ch or ''}".strip() if rl else sec)
        if cit:
            citations.append(cit)

    rows = rows[:60]
    citations = citations[:30]

    ok = len(rows) > 0
    summary = (
        f"Found {len(rows)} line items under '{args.name}'"
        if ok else f"No section matching '{args.name}'"
    )
    return ToolResult(
        tool_name="get_section",
        ok=ok,
        summary=summary,
        payload={"section": args.name, "rows": rows},
        citations=citations,
        latency_ms=int((time.time() - t0) * 1000),
    )


# ────────────────────────────────────────────────────────────────────────────
# TOOL 3 — list_figures
# ────────────────────────────────────────────────────────────────────────────
def list_figures(ctx: DocContext, args: ListFiguresArgs) -> ToolResult:
    """List every parsed figure in the document with a one-line summary
    extracted from the figure's markdown."""
    t0 = time.time()
    items: list[dict[str, Any]] = []
    for ch in ctx.qdrant_chunks:
        if (ch.get("chunk_type") or "").lower() != "figure":
            continue
        md = ch.get("markdown") or ""
        # Extract a one-line caption — first <Figure N: …> or first
        # quoted title we can find.
        title = _extract_figure_title(md)
        items.append({
            "id":     ch.get("chunk_id"),
            "page":   int(ch.get("page", 0) or 0),
            "title":  title,
            "preview": _flatten(md)[:160],
        })
    items.sort(key=lambda x: (x["page"], x["title"]))
    return ToolResult(
        tool_name="list_figures",
        ok=True,
        summary=f"Document contains {len(items)} parsed figure(s)",
        payload={"figures": items},
        citations=[],     # listing itself isn't a citation; read_figure cites
        latency_ms=int((time.time() - t0) * 1000),
    )


def _flatten(md: str) -> str:
    """Strip HTML/wrapper markup so the LLM sees plain text.

    ADE wraps figure descriptions in `<:: ... ::>` markers. These look
    like HTML tags to a naive regex — `<[^>]+>` would match `<::...::>`
    end-to-end and erase the whole figure body. So we peel the ADE
    wrapper FIRST, then strip real HTML tags (which start with a letter
    or `/`, never with `:`).
    """
    s = (md or "").replace("<::", " ").replace("::>", " ")
    s = re.sub(r"<[a-zA-Z/][^>]*>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _extract_figure_title(md: str) -> str:
    """Best-effort extraction of the figure's title for the list view."""
    flat = _flatten(md)
    m = re.search(r"Figure\s+(\d+)\s*[:\-—]\s*([^.]{2,120})", flat, re.IGNORECASE)
    if m:
        return f"Figure {m.group(1)} — {m.group(2).strip()}"
    m = re.search(r"Title:\s*([^.]{2,120})", flat, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    m = re.search(r"\b(bar chart|line chart|pie chart|column chart|scatter plot)\b", flat, re.IGNORECASE)
    if m:
        return m.group(1).title()
    return flat[:80] or "Figure"


# ────────────────────────────────────────────────────────────────────────────
# TOOL 4 — read_figure
# ────────────────────────────────────────────────────────────────────────────
def read_figure(ctx: DocContext, args: ReadFigureArgs) -> ToolResult:
    """Return the full parsed content of a figure matching `query`. The
    query can be a chunk_id, a 'Figure N' string, or a search phrase from
    the title.
    """
    t0 = time.time()
    q = _normalise(args.query)
    # First pass: try exact id match
    for ch in ctx.qdrant_chunks:
        if (ch.get("chunk_type") or "").lower() != "figure":
            continue
        if ch.get("chunk_id") == args.query.strip():
            return _figure_result(ctx, ch, t0)
    # Second pass: try "Figure N" match
    fig_num = re.search(r"figure\s*(\d+)", q)
    if fig_num:
        n = fig_num.group(1)
        for ch in ctx.qdrant_chunks:
            if (ch.get("chunk_type") or "").lower() != "figure":
                continue
            flat = _flatten(ch.get("markdown") or "")
            if re.search(rf"\bFigure\s+{n}\b", flat, re.IGNORECASE):
                return _figure_result(ctx, ch, t0)
    # Third pass: substring match on title/markdown
    best_ch = None
    best_score = 0
    q_tokens = _tokens(q)
    for ch in ctx.qdrant_chunks:
        if (ch.get("chunk_type") or "").lower() != "figure":
            continue
        flat = _flatten(ch.get("markdown") or "").lower()
        title = _extract_figure_title(ch.get("markdown") or "").lower()
        score = sum(1 for t in q_tokens if t in title) * 3 \
              + sum(1 for t in q_tokens if t in flat)
        if score > best_score:
            best_score = score
            best_ch = ch
    if best_ch is not None and best_score > 0:
        return _figure_result(ctx, best_ch, t0)
    return ToolResult(
        tool_name="read_figure",
        ok=False,
        summary=f"No figure matching '{args.query}' found in document",
        payload={"query": args.query},
        citations=[],
        error="not_found",
        latency_ms=int((time.time() - t0) * 1000),
    )


def _figure_result(ctx: DocContext, ch: dict[str, Any], t0: float) -> ToolResult:
    md = ch.get("markdown") or ""
    flat = _flatten(md)
    title = _extract_figure_title(md)
    cid = ch.get("chunk_id") or ""
    cit = _make_citation(ctx, cid, label=title)
    return ToolResult(
        tool_name="read_figure",
        ok=True,
        summary=f"Read figure '{title}' on page {int(ch.get('page', 0) or 0) + 1}",
        payload={
            "id":      cid,
            "title":   title,
            "page":    int(ch.get("page", 0) or 0) + 1,
            "content": flat,            # the LLM-readable parsed chart text
            "raw":     md[:2000],       # original markdown (truncated)
        },
        citations=[cit] if cit else [],
        latency_ms=int((time.time() - t0) * 1000),
    )


# ────────────────────────────────────────────────────────────────────────────
# TOOL 5 — compute_ratio
# ────────────────────────────────────────────────────────────────────────────
# Each ratio is a (numerator-aliases, denominator-aliases) pair. The tool
# looks up the cells for each, picks the most recent period (or the user-
# specified one), and computes value + arithmetic narrative.

_RATIO_DEFS: dict[str, dict[str, Any]] = {
    "current_ratio":           {"num": "current assets",          "den": "current liabilities"},
    "quick_ratio":             {"num": ["cash", "accounts receivable", "short-term investments"], "den": "current liabilities", "fn": "sum_minus_inventory"},
    "cash_ratio":              {"num": "cash",                    "den": "current liabilities"},
    "debt_to_equity":          {"num": "total liabilities",       "den": "total equity"},
    "debt_to_assets":          {"num": "total liabilities",       "den": "total assets"},
    "interest_coverage":       {"num": "operating income",        "den": "interest expense"},
    "roe":                     {"num": "net income",              "den": "total equity",      "as_pct": True},
    "roa":                     {"num": "net income",              "den": "total assets",      "as_pct": True},
    "gross_margin":            {"num": "gross profit",            "den": "revenue",           "as_pct": True},
    "operating_margin":        {"num": "operating income",        "den": "revenue",           "as_pct": True},
    "net_margin":              {"num": "net income",              "den": "revenue",           "as_pct": True},
    "asset_turnover":          {"num": "revenue",                 "den": "total assets"},
    "days_sales_outstanding":  {"num": "accounts receivable",     "den": "revenue",           "fn": "dso"},
    "inventory_days":          {"num": "inventory",               "den": "cost of revenue",   "fn": "days"},
}


def compute_ratio(ctx: DocContext, args: ComputeRatioArgs) -> ToolResult:
    """Compute a standard financial ratio from the underlying cells. Returns
    the ratio AND the citations for every cell used."""
    t0 = time.time()
    defn = _RATIO_DEFS.get(args.ratio)
    if not defn:
        return ToolResult(
            tool_name="compute_ratio",
            ok=False,
            summary=f"Unknown ratio '{args.ratio}'",
            error="unsupported_ratio",
            latency_ms=int((time.time() - t0) * 1000),
        )

    # Resolve numerator + denominator via lookup_value internally.
    num_line = defn["num"]
    den_line = defn["den"]
    citations: list[CitationRef] = []

    def _fetch(line: Any) -> list[dict]:
        if isinstance(line, list):
            out: list[dict] = []
            for ln in line:
                r = lookup_value(ctx, LookupValueArgs(line_item=ln, period=args.period))
                citations.extend(r.citations)
                out.extend(r.payload.get("matches", []))
            return out
        r = lookup_value(ctx, LookupValueArgs(line_item=line, period=args.period))
        citations.extend(r.citations)
        return r.payload.get("matches", [])

    nums = _fetch(num_line)
    dens = _fetch(den_line)

    if not nums or not dens:
        return ToolResult(
            tool_name="compute_ratio",
            ok=False,
            summary=f"Could not find inputs for {args.ratio}",
            payload={"missing": {"numerator": not bool(nums), "denominator": not bool(dens)}},
            citations=citations,
            error="missing_inputs",
            latency_ms=int((time.time() - t0) * 1000),
        )

    n_val = _parse_amount(nums[0]["value"])
    d_val = _parse_amount(dens[0]["value"])
    if n_val is None or d_val is None or d_val == 0:
        return ToolResult(
            tool_name="compute_ratio",
            ok=False,
            summary=f"Inputs for {args.ratio} are non-numeric or zero",
            citations=citations,
            error="bad_inputs",
            latency_ms=int((time.time() - t0) * 1000),
        )

    raw = n_val / d_val
    as_pct = defn.get("as_pct", False)
    value = round(raw * 100, 2) if as_pct else round(raw, 4)
    unit = "%" if as_pct else "x"

    return ToolResult(
        tool_name="compute_ratio",
        ok=True,
        summary=f"{args.ratio} = {value}{unit} (= {n_val}/{d_val})",
        payload={
            "ratio":            args.ratio,
            "period":           nums[0].get("period") or args.period,
            "value":            value,
            "unit":             unit,
            "numerator":        {"label": nums[0]["row_label"], "value": n_val, "cell_id": nums[0]["cell_id"]},
            "denominator":      {"label": dens[0]["row_label"], "value": d_val, "cell_id": dens[0]["cell_id"]},
            "formula":          f"{nums[0]['row_label']} / {dens[0]['row_label']}",
        },
        citations=citations[:10],
        latency_ms=int((time.time() - t0) * 1000),
    )


# ────────────────────────────────────────────────────────────────────────────
# TOOL 6 — compare_periods
# ────────────────────────────────────────────────────────────────────────────
def compare_periods(ctx: DocContext, args: ComparePeriodsArgs) -> ToolResult:
    """Compare one line item across two periods. Returns absolute delta +
    percentage delta + the two cells as citations.

    Implementation note:
        Re-uses `lookup_value` for each side. When multiple matches come
        back for a period (rare but happens with consolidated/segment
        breakouts of the same line name), we pick the first one — the
        same one the user would see in a vanilla lookup — to keep the
        comparison deterministic and consistent with what the analyst
        already saw on screen.
    """
    t0 = time.time()
    citations: list[CitationRef] = []

    def _fetch_one(period: str) -> dict | None:
        r = lookup_value(ctx, LookupValueArgs(line_item=args.line_item, period=period))
        citations.extend(r.citations)
        ms = r.payload.get("matches") or []
        # Prefer the row whose period EXACTLY equals the user-asked period.
        target = _normalise(period)
        for m in ms:
            if _normalise(m.get("period") or "") == target:
                return m
        return ms[0] if ms else None

    a = _fetch_one(args.period_a)
    b = _fetch_one(args.period_b)
    if not a or not b:
        missing = []
        if not a: missing.append(args.period_a)
        if not b: missing.append(args.period_b)
        return ToolResult(
            tool_name="compare_periods",
            ok=False,
            summary=f"Could not find '{args.line_item}' for period(s): {', '.join(missing)}",
            payload={"line_item": args.line_item, "missing": missing},
            citations=citations,
            error="missing_periods",
            latency_ms=int((time.time() - t0) * 1000),
        )

    va = _parse_amount(a["value"])
    vb = _parse_amount(b["value"])
    if va is None or vb is None:
        return ToolResult(
            tool_name="compare_periods",
            ok=False,
            summary=f"Non-numeric value for '{args.line_item}'",
            payload={"a": a, "b": b},
            citations=citations,
            error="non_numeric",
            latency_ms=int((time.time() - t0) * 1000),
        )

    absolute = round(va - vb, 4)
    # Percentage change from period_b to period_a. Undefined when the base
    # is zero — return None rather than +/- infinity. Pattern follows
    # GAAP/IFRS analyst conventions where "n/m" (not meaningful) is used.
    pct = round((absolute / vb) * 100, 2) if vb != 0 else None
    direction = "increase" if absolute > 0 else "decrease" if absolute < 0 else "unchanged"

    return ToolResult(
        tool_name="compare_periods",
        ok=True,
        summary=(
            f"{args.line_item}: {args.period_b} → {args.period_a} = "
            f"{vb} → {va}  ({direction} {absolute:+,.0f}"
            + (f", {pct:+.2f}%" if pct is not None else ", n/m")
            + ")"
        ),
        payload={
            "line_item":      args.line_item,
            "period_a":       a.get("period") or args.period_a,
            "period_b":       b.get("period") or args.period_b,
            "value_a":        va,
            "value_b":        vb,
            "absolute_delta": absolute,
            "percent_delta":  pct,         # may be None when base is zero
            "direction":      direction,
            "cell_a":         a["cell_id"],
            "cell_b":         b["cell_id"],
        },
        citations=citations[:6],
        latency_ms=int((time.time() - t0) * 1000),
    )


# ────────────────────────────────────────────────────────────────────────────
# TOOL 7 — decompose_change
# ────────────────────────────────────────────────────────────────────────────
def decompose_change(ctx: DocContext, args: DecomposeChangeArgs) -> ToolResult:
    """Explain a change in an aggregate by ranking sibling line items.

    The 'sibling' definition is: any line item that lives in the SAME
    section_header as the parent, has values in both requested periods,
    and is not the parent itself. For each sibling we compute the delta;
    the result is ranked by absolute magnitude.

    Why this approximates an analyst's mental model:
        Real chart-of-accounts hierarchies aren't in the parsed
        document — there's no machine-readable "Operating Expenses ⊃
        SG&A + R&D + ...". But the section header IS in every parsed
        chunk, and in practice the line items that roll into a parent
        live under the same section. Restricting siblings to same-section
        avoids the false-positive of attributing a change in Income
        Statement Revenue to a change in Balance Sheet PPE.

    The tool does NOT claim that the siblings sum to the parent's delta
    (some line items are netted in the parent in non-obvious ways) — it
    surfaces the largest movers as candidates the analyst should examine.
    """
    t0 = time.time()
    parent_norm = _normalise(args.parent_line_item)
    citations: list[CitationRef] = []

    # First, locate the parent — we need its section, and we want to
    # exclude it from the ranking.
    parent_lookup = lookup_value(
        ctx, LookupValueArgs(line_item=args.parent_line_item, period=args.period_a),
    )
    parent_matches = parent_lookup.payload.get("matches") or []
    if not parent_matches:
        return ToolResult(
            tool_name="decompose_change",
            ok=False,
            summary=f"Parent line item '{args.parent_line_item}' not found in {args.period_a}",
            citations=parent_lookup.citations,
            error="parent_not_found",
            latency_ms=int((time.time() - t0) * 1000),
        )
    parent_section = parent_matches[0].get("section") or ""
    if not parent_section:
        return ToolResult(
            tool_name="decompose_change",
            ok=False,
            summary=f"Parent '{args.parent_line_item}' has no section header — cannot identify siblings",
            citations=parent_lookup.citations,
            error="no_parent_section",
            latency_ms=int((time.time() - t0) * 1000),
        )
    citations.extend(parent_lookup.citations)

    # Walk every cell in the same section. For each unique row label,
    # find a value cell in period_a and period_b. Compute delta.
    target_a = _normalise(args.period_a)
    target_b = _normalise(args.period_b)
    parent_section_norm = _normalise(parent_section)

    # Group cells by row label within the target section.
    by_row: dict[str, dict[str, dict]] = {}  # {row_label: {period: cell_dict}}
    for cid, sec in ctx.cell_section_map.items():
        if _normalise(sec) != parent_section_norm:
            continue
        if _is_header_cell(ctx, cid):
            continue
        text = (ctx.cell_lookup.get(cid) or "").strip()
        if not text:
            continue
        row_label = _row_label_for_cell(ctx, cid)
        if not row_label:
            continue
        if _normalise(text) == _normalise(row_label):
            continue
        if _normalise(row_label) == parent_norm:
            continue  # skip the parent itself
        col = _normalise(_col_header_for_cell(ctx, cid))
        bucket = by_row.setdefault(_normalise(row_label), {"_row_label": row_label})
        if target_a in col or col in target_a:
            bucket["a"] = {"cell_id": cid, "value": text, "period": _col_header_for_cell(ctx, cid)}
        elif target_b in col or col in target_b:
            bucket["b"] = {"cell_id": cid, "value": text, "period": _col_header_for_cell(ctx, cid)}

    # Compute deltas where we have both periods.
    contributors: list[dict] = []
    for key, info in by_row.items():
        a = info.get("a"); b = info.get("b")
        if not a or not b:
            continue
        va = _parse_amount(a["value"]); vb = _parse_amount(b["value"])
        if va is None or vb is None:
            continue
        absolute = va - vb
        if absolute == 0:
            continue
        pct = round((absolute / vb) * 100, 2) if vb != 0 else None
        contributors.append({
            "row_label":      info["_row_label"],
            "value_a":        va,
            "value_b":        vb,
            "absolute_delta": round(absolute, 4),
            "percent_delta":  pct,
            "cell_a":         a["cell_id"],
            "cell_b":         b["cell_id"],
        })
        cit_a = _make_citation(ctx, a["cell_id"], label=f"{info['_row_label']} {args.period_a}")
        cit_b = _make_citation(ctx, b["cell_id"], label=f"{info['_row_label']} {args.period_b}")
        if cit_a: citations.append(cit_a)
        if cit_b: citations.append(cit_b)

    contributors.sort(key=lambda c: abs(c["absolute_delta"]), reverse=True)
    contributors = contributors[:args.top_n]

    return ToolResult(
        tool_name="decompose_change",
        ok=True,
        summary=(
            f"Found {len(contributors)} sibling line item(s) in section "
            f"'{parent_section}' with movement between {args.period_b} and {args.period_a}"
        ),
        payload={
            "parent":   args.parent_line_item,
            "section":  parent_section,
            "period_a": args.period_a,
            "period_b": args.period_b,
            "contributors": contributors,
        },
        citations=citations[:30],
        latency_ms=int((time.time() - t0) * 1000),
    )


# ────────────────────────────────────────────────────────────────────────────
# TOOL 8 — detect_red_flags
# ────────────────────────────────────────────────────────────────────────────
# Each check is a small function: (ctx) → list[dict] of flag entries. The
# top-level `detect_red_flags` runs the subset matching the requested
# category and merges the results. Pure detection; the agent decides
# how to present them.

def _flag_dict(
    *,
    name:     str,
    category: str,
    severity: str,
    explanation: str,
    citations: list[CitationRef],
    measurements: dict[str, Any] | None = None,
) -> dict:
    return {
        "name":     name,
        "category": category,
        "severity": severity,                # "high" | "medium" | "low"
        "explanation": explanation,
        "measurements": measurements or {},
        "citation_chunk_ids": [c.chunk_id for c in citations],
    }


def _flag_accrual_divergence(ctx: DocContext, sink: list) -> list[CitationRef]:
    """High-severity flag: net income up, operating cash flow down (or vice
    versa). Classic earnings-quality red flag (Sloan accruals factor).
    Two-period delta of NI vs OCF — if the signs diverge or the magnitude
    gap is large, flag.
    """
    cits: list[CitationRef] = []
    # Find two periods for both NI and OCF.
    ni  = lookup_value(ctx, LookupValueArgs(line_item="net income"))
    ocf = lookup_value(ctx, LookupValueArgs(line_item="cash from operations"))
    cits.extend(ni.citations + ocf.citations)
    ni_matches  = ni.payload.get("matches") or []
    ocf_matches = ocf.payload.get("matches") or []
    if len(ni_matches) < 2 or len(ocf_matches) < 2:
        return cits
    # Use the two most-recent periods (matches are already ordered by
    # whatever order cell_lookup iterates — accept any two).
    ni_a = _parse_amount(ni_matches[0]["value"])
    ni_b = _parse_amount(ni_matches[1]["value"])
    ocf_a = _parse_amount(ocf_matches[0]["value"])
    ocf_b = _parse_amount(ocf_matches[1]["value"])
    if None in (ni_a, ni_b, ocf_a, ocf_b):
        return cits
    ni_delta  = ni_a - ni_b
    ocf_delta = ocf_a - ocf_b
    # Sign divergence is the strongest signal.
    if ni_delta * ocf_delta < 0:
        flag_cits = []
        for m in (ni_matches[:2] + ocf_matches[:2]):
            c = _make_citation(ctx, m["cell_id"], label=m["row_label"])
            if c: flag_cits.append(c)
        sink.append(_flag_dict(
            name="Net income / operating cash flow divergence",
            category="earnings_quality",
            severity="high",
            explanation=(
                f"Net income moved {ni_delta:+,.0f} while operating cash flow moved "
                f"{ocf_delta:+,.0f} — opposite directions. Earnings-quality "
                f"divergence; high accruals or working-capital effects suggest "
                f"earnings may not be cash-backed."
            ),
            citations=flag_cits,
            measurements={"ni_delta": ni_delta, "ocf_delta": ocf_delta},
        ))
        cits.extend(flag_cits)
    return cits


def _flag_ar_outpacing_revenue(ctx: DocContext, sink: list) -> list[CitationRef]:
    """Receivables growing materially faster than revenue is a classic
    'pull-forward' / channel-stuffing flag (Beneish DSRI cousin)."""
    cits: list[CitationRef] = []
    rev = lookup_value(ctx, LookupValueArgs(line_item="revenue"))
    ar_lookup = lookup_value(ctx, LookupValueArgs(line_item="accounts receivable"))
    cits.extend(rev.citations + ar_lookup.citations)
    rev_m = rev.payload.get("matches") or []
    ar_m  = ar_lookup.payload.get("matches") or []
    if len(rev_m) < 2 or len(ar_m) < 2:
        return cits
    rev_a, rev_b = _parse_amount(rev_m[0]["value"]), _parse_amount(rev_m[1]["value"])
    ar_a,  ar_b  = _parse_amount(ar_m[0]["value"]),  _parse_amount(ar_m[1]["value"])
    if None in (rev_a, rev_b, ar_a, ar_b) or rev_b == 0 or ar_b == 0:
        return cits
    rev_growth = (rev_a - rev_b) / rev_b * 100
    ar_growth  = (ar_a  - ar_b)  / ar_b  * 100
    # 5pp threshold: AR materially outpacing revenue. Chosen because <5pp
    # is within the noise of timing and customer mix; >5pp warrants flag.
    if ar_growth - rev_growth > 5.0:
        flag_cits = []
        for m in (rev_m[:2] + ar_m[:2]):
            c = _make_citation(ctx, m["cell_id"], label=m["row_label"])
            if c: flag_cits.append(c)
        sink.append(_flag_dict(
            name="Accounts receivable growing faster than revenue",
            category="earnings_quality",
            severity="medium",
            explanation=(
                f"Receivables grew {ar_growth:+.1f}% vs revenue growth of "
                f"{rev_growth:+.1f}% — a {ar_growth - rev_growth:+.1f}pp gap. "
                f"Indicates loosening credit terms, pulled-forward sales, or "
                f"deteriorating collections; check days-sales-outstanding."
            ),
            citations=flag_cits,
            measurements={"revenue_growth_pct": rev_growth, "ar_growth_pct": ar_growth},
        ))
        cits.extend(flag_cits)
    return cits


def _flag_goodwill_concentration(ctx: DocContext, sink: list) -> list[CitationRef]:
    """Goodwill > 20% of total assets — impairment-test sensitivity."""
    cits: list[CitationRef] = []
    gw = lookup_value(ctx, LookupValueArgs(line_item="goodwill"))
    ta = lookup_value(ctx, LookupValueArgs(line_item="total assets"))
    cits.extend(gw.citations + ta.citations)
    gw_m = gw.payload.get("matches") or []
    ta_m = ta.payload.get("matches") or []
    if not gw_m or not ta_m:
        return cits
    gv = _parse_amount(gw_m[0]["value"])
    tv = _parse_amount(ta_m[0]["value"])
    if gv is None or tv is None or tv == 0:
        return cits
    pct = gv / tv * 100
    if pct > 20.0:
        flag_cits = []
        for m in (gw_m[:1] + ta_m[:1]):
            c = _make_citation(ctx, m["cell_id"], label=m["row_label"])
            if c: flag_cits.append(c)
        sink.append(_flag_dict(
            name="Goodwill concentration > 20% of total assets",
            category="balance_sheet_quality",
            severity="medium",
            explanation=(
                f"Goodwill is {pct:.1f}% of total assets ({gv:,.0f} / {tv:,.0f}). "
                f"Significant impairment risk in a downturn; verify the goodwill "
                f"impairment-test disclosure in Critical Audit Matters."
            ),
            citations=flag_cits,
            measurements={"goodwill": gv, "total_assets": tv, "pct_of_assets": pct},
        ))
        cits.extend(flag_cits)
    return cits


def _flag_negative_working_capital(ctx: DocContext, sink: list) -> list[CitationRef]:
    """Current liabilities > current assets = liquidity risk (unless this
    is a business model that legitimately runs negative WC like Walmart)."""
    cits: list[CitationRef] = []
    ca = lookup_value(ctx, LookupValueArgs(line_item="current assets"))
    cl = lookup_value(ctx, LookupValueArgs(line_item="current liabilities"))
    cits.extend(ca.citations + cl.citations)
    ca_m = ca.payload.get("matches") or []
    cl_m = cl.payload.get("matches") or []
    if not ca_m or not cl_m:
        return cits
    cav = _parse_amount(ca_m[0]["value"]); clv = _parse_amount(cl_m[0]["value"])
    if cav is None or clv is None:
        return cits
    if cav < clv:
        flag_cits = []
        for m in (ca_m[:1] + cl_m[:1]):
            c = _make_citation(ctx, m["cell_id"], label=m["row_label"])
            if c: flag_cits.append(c)
        sink.append(_flag_dict(
            name="Negative working capital",
            category="liquidity_risk",
            severity="medium",
            explanation=(
                f"Current liabilities ({clv:,.0f}) exceed current assets "
                f"({cav:,.0f}). Deficit of {clv - cav:,.0f}. May indicate "
                f"short-term liquidity pressure unless the business model "
                f"legitimately runs negative WC (retail, fast-cycle services)."
            ),
            citations=flag_cits,
            measurements={"current_assets": cav, "current_liabilities": clv, "deficit": clv - cav},
        ))
        cits.extend(flag_cits)
    return cits


# Phrase-based text scans. Each pattern looks for unambiguous regulator-
# / auditor-grade language. Matching is case-insensitive on plain text.
_TEXT_RED_FLAG_PATTERNS: list[tuple[str, str, str, str, str]] = [
    # (category, severity, name, regex, explanation_template)
    ("audit_signals",         "high",   "Going-concern language",
        r"\b(going\s+concern|substantial\s+doubt|material\s+uncertainty\s+related\s+to\s+(its\s+)?ability\s+to\s+continue)\b",
        "Auditor / management language flags going-concern risk. Read the full passage in context."),
    ("audit_signals",         "high",   "Material weakness in internal controls",
        r"\bmaterial\s+weakness(es)?\b",
        "Material weakness in internal control disclosed — possible misstatement risk."),
    ("audit_signals",         "medium", "Restatement of prior financials",
        r"\b(restated|restatement|prior-period\s+adjustment)\b",
        "Prior financial statements restated — historical figures cannot be compared at face value."),
    ("balance_sheet_quality", "medium", "Related-party transactions",
        r"\b(related[- ]part(y|ies)|key\s+management\s+personnel\s+transactions)\b",
        "Related-party transactions disclosed — verify amounts, terms, and recurring nature."),
    ("balance_sheet_quality", "medium", "Off-balance-sheet arrangement",
        r"\b(off[- ]balance[- ]sheet|variable\s+interest\s+entity|VIE)\b",
        "Off-balance-sheet exposure disclosed — may not appear in headline leverage ratios."),
    ("earnings_quality",       "medium", "Non-recurring / one-time gain language",
        r"\b(one[- ]time\s+gain|non[- ]recurring|extraordinary\s+item|gain\s+on\s+sale)\b",
        "Non-recurring item language — verify whether prior-period comparisons are like-for-like."),
]


def _flag_text_patterns(ctx: DocContext, sink: list) -> list[CitationRef]:
    """Scan text chunks for known regulator/auditor red-flag phrases."""
    cits: list[CitationRef] = []
    for ch in ctx.qdrant_chunks:
        ctype = (ch.get("chunk_type") or "").lower()
        if "text" not in ctype and ctype not in ("title", "key_value"):
            continue
        body = _flatten(ch.get("markdown") or "")
        if not body:
            continue
        for cat, sev, name, pattern, expl in _TEXT_RED_FLAG_PATTERNS:
            if re.search(pattern, body, re.IGNORECASE):
                cit = _make_citation(ctx, ch.get("chunk_id") or "", label=name)
                clist = [cit] if cit else []
                sink.append(_flag_dict(
                    name=name, category=cat, severity=sev,
                    explanation=expl + f" Source page {int(ch.get('page', 0) or 0) + 1}.",
                    citations=clist,
                ))
                if cit:
                    cits.append(cit)
                # one flag per chunk per pattern — avoid spamming the same hit
                break
    return cits


# Category → list of detector functions.
_RED_FLAG_DETECTORS: dict[str, list[Any]] = {
    "earnings_quality":       [_flag_accrual_divergence, _flag_ar_outpacing_revenue],
    "balance_sheet_quality":  [_flag_goodwill_concentration],
    "liquidity_risk":         [_flag_negative_working_capital],
    "audit_signals":          [],   # handled by _flag_text_patterns below
}


def detect_red_flags(ctx: DocContext, args: DetectRedFlagsArgs) -> ToolResult:
    """Scan the document for analyst-grade red flags. Returns a list of
    triggered flags with severity + explanation + supporting cells.

    The flags are derived from the same data the agent already has access
    to — running this proactively is cheaper than asking the agent to
    cobble together five separate lookup_value + compute_ratio calls. The
    agent should call this when the user asks anything about quality of
    earnings, audit concerns, going concern, accounting risk, or any
    open-ended 'what should I worry about' style question.
    """
    t0 = time.time()
    flags: list[dict] = []
    citations: list[CitationRef] = []

    categories = (
        ("earnings_quality", "balance_sheet_quality", "liquidity_risk", "audit_signals")
        if (args.category or "all") == "all"
        else (args.category,)
    )
    for cat in categories:
        for detector in _RED_FLAG_DETECTORS.get(cat, []):
            try:
                cits = detector(ctx, flags)
                citations.extend(cits)
            except Exception as e:
                logger.warning(f"red-flag detector {detector.__name__} raised: {e}")
        if cat == "audit_signals" or args.category == "all":
            # audit_signals = pattern-based text scan; also run when 'all'
            try:
                cits = _flag_text_patterns(ctx, flags)
                citations.extend(cits)
            except Exception as e:
                logger.warning(f"text-pattern scan raised: {e}")

    # Dedupe flags by (name) — text scans can fire the same pattern
    # across multiple chunks; keep the first hit.
    seen_names: set[str] = set()
    deduped: list[dict] = []
    for f in flags:
        key = f["name"]
        if key in seen_names:
            continue
        seen_names.add(key)
        deduped.append(f)

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    deduped.sort(key=lambda f: severity_rank.get(f["severity"], 9))

    # Dedupe citations by chunk_id
    seen_cits: set[str] = set()
    cit_out: list[CitationRef] = []
    for c in citations:
        if c.chunk_id and c.chunk_id not in seen_cits:
            seen_cits.add(c.chunk_id)
            cit_out.append(c)

    return ToolResult(
        tool_name="detect_red_flags",
        ok=True,
        summary=(
            f"Found {len(deduped)} flag(s)"
            + (f" in category '{args.category}'" if args.category and args.category != "all" else "")
            + (" — none triggered" if not deduped else "")
        ),
        payload={
            "category": args.category or "all",
            "flags": deduped,
        },
        citations=cit_out[:30],
        latency_ms=int((time.time() - t0) * 1000),
    )


# ────────────────────────────────────────────────────────────────────────────
# TOOL 9 — query_freeform  (safety-net retrieval)
# ────────────────────────────────────────────────────────────────────────────
# When the structured tools come up empty, the agent should reach for this
# tool before declaring 'not found'. It scores every loaded chunk against
# the question's tokens (overlap + light section-keyword boosting) and
# returns the top-K chunks with their text + citations. Pure-Python — no
# embedding call, no Qdrant round-trip — because the agent already has
# the chunks loaded in DocContext. Fast, deterministic, doesn't burn
# extra OpenAI / Qdrant quota.

_FREEFORM_STOP_TOKENS = {
    "the", "a", "an", "of", "in", "on", "at", "to", "for", "is", "are",
    "was", "were", "be", "been", "being", "and", "or", "but", "if", "as",
    "by", "with", "this", "that", "these", "those", "what", "which",
    "who", "whom", "whose", "where", "when", "why", "how", "do", "does",
    "did", "has", "have", "had", "can", "could", "would", "should",
    "show", "tell", "give", "me", "us", "i", "you", "your", "our",
    "about", "from", "into",
}


def query_freeform(ctx: DocContext, args: QueryFreeformArgs) -> ToolResult:
    """Free-form keyword search over every loaded chunk. Use as a fallback
    when structured tools return nothing.
    """
    t0 = time.time()
    q_tokens = {
        t for t in _tokens(args.question)
        if t not in _FREEFORM_STOP_TOKENS
    }
    if not q_tokens:
        return ToolResult(
            tool_name="query_freeform",
            ok=False,
            summary="Question contained no scorable content tokens",
            error="empty_query",
            latency_ms=int((time.time() - t0) * 1000),
        )

    scored: list[tuple[float, dict[str, Any]]] = []
    for ch in ctx.qdrant_chunks:
        text = _flatten(ch.get("markdown") or "")
        if not text:
            continue
        body_tokens = _tokens(text)
        if not body_tokens:
            continue
        overlap = q_tokens & body_tokens
        if not overlap:
            continue
        # Score: number of distinct overlapping tokens, weighted slightly
        # higher for tokens that appear in the section header (means the
        # chunk is in a topically relevant section of the document).
        score = float(len(overlap))
        sec_tokens = _tokens(ch.get("section_header") or "")
        score += 1.5 * len(q_tokens & sec_tokens)
        # Boost figure chunks marginally — they're often the most
        # information-dense per token and easy to miss in a flat scan.
        if (ch.get("chunk_type") or "").lower() == "figure":
            score += 0.5
        scored.append((score, ch))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:args.top_k]

    chunks_out: list[dict[str, Any]] = []
    citations: list[CitationRef] = []
    for sc, ch in top:
        text = _flatten(ch.get("markdown") or "")
        chunks_out.append({
            "chunk_id":   ch.get("chunk_id"),
            "chunk_type": ch.get("chunk_type") or "text",
            "page":       int(ch.get("page", 0) or 0) + 1,
            "section":    ch.get("section_header") or "",
            "score":      round(sc, 2),
            # Cap the text to keep the LLM context tight. The agent can
            # call read_figure or lookup_value if it wants more.
            "text":       text[:800],
        })
        cit = _make_citation(
            ctx, ch.get("chunk_id") or "",
            label=(ch.get("section_header") or (text[:40] if text else ch.get("chunk_type") or "chunk")),
        )
        if cit:
            citations.append(cit)

    return ToolResult(
        tool_name="query_freeform",
        ok=len(chunks_out) > 0,
        summary=(
            f"Found {len(chunks_out)} chunk(s) relevant to {args.question!r}"
            if chunks_out else f"No chunks matched {args.question!r}"
        ),
        payload={
            "question": args.question,
            "chunks":   chunks_out,
        },
        citations=citations[:15],
        latency_ms=int((time.time() - t0) * 1000),
    )


# ─── Tool registry (name → callable + args model) ───────────────────────────
TOOL_REGISTRY: dict[str, tuple[Any, Any]] = {
    "lookup_value":      (lookup_value,      LookupValueArgs),
    "get_section":       (get_section,       GetSectionArgs),
    "list_figures":      (list_figures,      ListFiguresArgs),
    "read_figure":       (read_figure,       ReadFigureArgs),
    "compute_ratio":     (compute_ratio,     ComputeRatioArgs),
    "compare_periods":   (compare_periods,   ComparePeriodsArgs),
    "decompose_change":  (decompose_change,  DecomposeChangeArgs),
    "detect_red_flags":  (detect_red_flags,  DetectRedFlagsArgs),
    "query_freeform":    (query_freeform,    QueryFreeformArgs),
}


def get_tool_specs() -> list[dict[str, Any]]:
    """Return OpenAI-format tool descriptors for all registered tools.

    The Pydantic model's `.model_json_schema()` provides the args schema,
    and the function's docstring + the Args model's docstring become the
    description the LLM sees.
    """
    specs: list[dict[str, Any]] = []
    for name, (fn, args_model) in TOOL_REGISTRY.items():
        # Docstring → description; first paragraph wins.
        doc = (fn.__doc__ or "").strip().split("\n\n")[0].replace("\n", " ")
        # Strip Pydantic JSON-schema cruft that confuses the model.
        schema = args_model.model_json_schema()
        schema.pop("title", None)
        specs.append({
            "type": "function",
            "function": {
                "name":        name,
                "description": doc,
                "parameters":  schema,
            },
        })
    return specs
