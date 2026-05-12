"""Pydantic types for tool I/O.

Every tool consumes a Pydantic args model and produces a `ToolResult`. The
orchestrator never sees raw dicts — making the I/O typed gives us:
  - free validation on what the LLM emits as tool arguments
  - one place to evolve the contract (add a field → ripple via mypy)
  - testable units (golden inputs vs golden outputs per tool)
"""
from __future__ import annotations

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


# ─── Citation (the chunk reference that bubbles up to the chip UI) ──────────
class CitationRef(BaseModel):
    """A reference back to one chunk in Qdrant + its grounding.

    Carried in every ToolResult so the orchestrator can dedupe across tools
    and emit a single, V2.6-compatible `sources` payload to the frontend.
    """
    chunk_id:    str
    chunk_type:  str                          # "table_cell" | "table" | "figure" | "text" | ...
    page:        int
    label:       Optional[str] = None          # short human label (e.g. "Total Revenue 2024")
    bbox:        Optional[dict[str, float]] = None  # carried through for the viewer highlight


# ─── ToolResult — the shape every tool must return ──────────────────────────
class ToolResult(BaseModel):
    """The single envelope every tool returns. Tools never return raw data;
    the orchestrator interprets only this shape."""
    tool_name:    str
    ok:           bool
    summary:      str                            # one-line outcome for the trace + UI
    payload:      dict[str, Any] = Field(default_factory=dict)
                                                  # tool-specific result body (LLM-facing)
    citations:    list[CitationRef] = Field(default_factory=list)
                                                  # chunks that backed the result
    error:        Optional[str] = None            # populated only when ok=False
    latency_ms:   Optional[int] = None


# ─── Tool argument schemas ──────────────────────────────────────────────────
# Each must match the JSON-schema the LLM gets in `tools=[...]`. We
# generate the schema from the Pydantic model via `.model_json_schema()`
# so the LLM and the executor stay in lockstep.

class LookupValueArgs(BaseModel):
    """Args for `lookup_value`.

    `line_item` is matched against row labels in the parsed tables
    (case-insensitive substring, plus synonyms). `period` is matched
    against column headers / year labels."""
    line_item: str = Field(..., min_length=1, max_length=120,
                            description="Row/line-item name, e.g. 'Total revenue', 'Cash and cash equivalents', 'Borrowings'. Synonyms accepted (revenue ≡ sales ≡ turnover).")
    period:    Optional[str] = Field(default=None, max_length=40,
                                      description="Period label as it appears in the document, e.g. '2024', 'FY 2025', 'Q1 2026', 'As at 31 December 2022'. Omit to return all available periods.")


class GetSectionArgs(BaseModel):
    """Args for `get_section`."""
    name: str = Field(..., min_length=1, max_length=120,
                       description="Section name, e.g. 'income statement', 'balance sheet', 'cash flows', 'statement of changes in equity', 'borrowings', 'special funds'.")


class ListFiguresArgs(BaseModel):
    """No args — lists all parsed figures in this document."""
    pass


class ReadFigureArgs(BaseModel):
    """Args for `read_figure`."""
    query: str = Field(..., min_length=1, max_length=200,
                        description="Figure id, figure number ('Figure 3'), or a search phrase from the figure's title/caption ('capital structure pie chart', 'NIM trend').")


class ComparePeriodsArgs(BaseModel):
    """Args for `compare_periods`.

    Fetches the same line item for two periods and computes the YoY (or
    QoQ, or any-vs-any) delta in both absolute and percentage terms. The
    tool emits citations for both source cells.
    """
    line_item: str = Field(..., min_length=1, max_length=120,
                            description="Line item name (synonyms accepted, same vocabulary as lookup_value).")
    period_a:  str = Field(..., min_length=1, max_length=40,
                            description="First period label, e.g. '2024', 'Q1 2026'.")
    period_b:  str = Field(..., min_length=1, max_length=40,
                            description="Second period label. The delta is computed as period_a − period_b unless the LLM clearly intends the reverse from context.")


class DecomposeChangeArgs(BaseModel):
    """Args for `decompose_change`.

    Given a parent line item that changed between two periods, finds the
    sibling line items (same section) that ALSO changed between those
    periods and ranks them by the magnitude of their contribution. Useful
    for answering 'why did X change'.
    """
    parent_line_item: str = Field(..., min_length=1, max_length=120,
                                   description="The aggregate line item whose change you want to explain (e.g. 'Operating Expenses', 'Total Liabilities', 'Net Income').")
    period_a: str = Field(..., min_length=1, max_length=40,
                          description="The more-recent period, e.g. '2024'.")
    period_b: str = Field(..., min_length=1, max_length=40,
                          description="The base period to compare against, e.g. '2023'.")
    top_n:    int = Field(default=8, ge=1, le=20,
                           description="How many top contributors to return, ranked by absolute delta.")


class DetectRedFlagsArgs(BaseModel):
    """Args for `detect_red_flags`.

    Runs the analyst's forensic checks across the document. Returns a list
    of triggered flags, each with severity, the rule that fired, the
    underlying numbers, and citations to the cells/chunks that triggered
    it. Pure pattern detection — does NOT advise.
    """
    category: Optional[Literal[
        "earnings_quality",
        "balance_sheet_quality",
        "liquidity_risk",
        "audit_signals",
        "all",
    ]] = Field(default="all",
               description="Restrict scan to one category. 'all' (default) runs every check.")


class ComputeRatioArgs(BaseModel):
    """Args for `compute_ratio`. Ratio name is from a fixed list — the
    executor maps it to a definition (numerator + denominator line items)
    and fetches the cells.
    """
    ratio: Literal[
        "current_ratio", "quick_ratio", "cash_ratio",
        "debt_to_equity", "debt_to_assets",
        "interest_coverage",
        "roe", "roa",
        "gross_margin", "operating_margin", "net_margin",
        "asset_turnover",
        "days_sales_outstanding", "inventory_days",
    ] = Field(...,
              description="Which standard ratio to compute. Definitions are built in; the tool returns the ratio value AND the underlying cells used.")
    period: Optional[str] = Field(default=None, max_length=40,
                                   description="Period label. Omit for the most-recent period available.")
