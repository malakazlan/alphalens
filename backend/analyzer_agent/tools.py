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


def _expand_aliases(line_item: str) -> list[str]:
    """Return all known surface forms for a line-item name."""
    key = _normalise(line_item)
    for canon, aliases in _LINE_ITEM_SYNONYMS.items():
        if key in aliases or any(key in a or a in key for a in aliases):
            return aliases
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
        # match if any alias appears in the row label
        if not any(_normalise(a) in rl_norm or rl_norm in _normalise(a) for a in aliases):
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
    """
    t0 = time.time()
    q = _normalise(args.name)
    rows: list[dict[str, Any]] = []
    citations: list[CitationRef] = []
    seen_cells: set[str] = set()
    for cid, sec in ctx.cell_section_map.items():
        if cid in seen_cells:
            continue
        if not sec:
            continue
        sn = _normalise(sec)
        # match if section name contains the query or vice versa
        if q not in sn and sn not in q:
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

    def _num(s: str) -> float | None:
        s = (s or "").strip()
        if not s:
            return None
        # Parenthetical = negative
        neg = s.startswith("(") and s.endswith(")")
        s = s.strip("()").replace(",", "").replace("$", "").replace("£", "").replace("€", "").replace("%", "")
        try:
            v = float(s)
            return -v if neg else v
        except ValueError:
            return None

    n_val = _num(nums[0]["value"])
    d_val = _num(dens[0]["value"])
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


# ─── Tool registry (name → callable + args model) ───────────────────────────
TOOL_REGISTRY: dict[str, tuple[Any, Any]] = {
    "lookup_value":    (lookup_value,    LookupValueArgs),
    "get_section":     (get_section,     GetSectionArgs),
    "list_figures":    (list_figures,    ListFiguresArgs),
    "read_figure":     (read_figure,     ReadFigureArgs),
    "compute_ratio":   (compute_ratio,   ComputeRatioArgs),
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
