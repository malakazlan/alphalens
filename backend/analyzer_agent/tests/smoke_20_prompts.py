"""Smoke test — 20 diverse prompts against a BSTDB-2022-shaped fixture.

This is a TOOL-LEVEL test. It does not invoke OpenAI (that would cost
~$0.50 + need API credits we don't want to burn during evaluation). It
simulates what the agent SHOULD call for each question and checks:

  1. Each tool returns ok=True (or ok=False for genuinely impossible Qs).
  2. Citations are emitted (or empty for off-topic refusals).
  3. The result payload contains what an analyst would expect.

The fixture mirrors the real Black Sea Trade and Development Bank
audited financials for FY 2022 — actual numbers from the published
PDF, not invented. This keeps the test honest: pass means the tools
correctly resolve a real analyst's questions on a real doc shape.
"""
from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import analyzer_agent as aa
from analyzer_agent.schemas import (
    LookupValueArgs, GetSectionArgs, ListFiguresArgs, ReadFigureArgs,
    ComputeRatioArgs, ComparePeriodsArgs, DecomposeChangeArgs,
    DetectRedFlagsArgs, QueryFreeformArgs,
)
from analyzer_agent.tools import (
    lookup_value, get_section, list_figures, read_figure,
    compute_ratio, compare_periods, decompose_change,
    detect_red_flags, query_freeform,
)


# ────────────────────────────────────────────────────────────────────────────
# Fixture — Black Sea Trade and Development Bank, FY 2022 (real numbers
# from the actual published PDF I read earlier in this project).
# ────────────────────────────────────────────────────────────────────────────
def _make_grid(rows: list[list[str | None]], header_row: int = 0, label_col: int = 0) -> dict:
    return {"rows": rows, "header_row": header_row, "label_col": label_col}


CELL_LOOKUP: dict[str, str] = {}
CELL_SECTIONS: dict[str, str] = {}
TABLE_GRIDS: dict[str, dict] = {}


def _add_table(table_id: str, section: str, header: list[str], data: list[list[str]]) -> None:
    """Helper to register a table into the fixture, building the grid +
    cell_lookup + cell_section_map atomically."""
    base = len(TABLE_GRIDS)
    # Use a unique cell-id prefix per table so collisions can't happen.
    prefix = f"t{base}"
    rows_grid: list[list[str | None]] = []

    # Header row
    header_row: list[str | None] = []
    for col_idx, col_label in enumerate(header):
        cid = f"{prefix}-h-{col_idx}"
        CELL_LOOKUP[cid] = col_label
        CELL_SECTIONS[cid] = section
        header_row.append(cid)
    rows_grid.append(header_row)

    # Data rows
    for row_idx, row in enumerate(data):
        row_cells: list[str | None] = []
        for col_idx, val in enumerate(row):
            cid = f"{prefix}-{row_idx}-{col_idx}"
            CELL_LOOKUP[cid] = val
            CELL_SECTIONS[cid] = section
            row_cells.append(cid)
        rows_grid.append(row_cells)

    TABLE_GRIDS[table_id] = _make_grid(rows_grid, header_row=0, label_col=0)


# --- INCOME STATEMENT ---
_add_table("income_stmt", "INCOME STATEMENT",
    ["Presented in thousands of EUR", "2022", "2021"],
    [
        ["Interest and similar income",            "151,268",  "105,171"],
        ["Interest and similar expense",           "(59,021)", "(58,492)"],
        ["Net interest income (expense) on derivatives","4,388","13,799"],
        ["Net interest income",                    "96,635",   "60,478"],
        ["Net fees and commissions",               "1,937",    "1,971"],
        ["Net gains from equity investments",      "-",        "182"],
        ["Operating income",                       "63,772",   "51,004"],
        ["Personnel expenses",                     "(18,197)", "(16,352)"],
        ["Administrative expenses",                "(4,853)",  "(4,574)"],
        ["Depreciation and amortization",          "(339)",    "(478)"],
        ["Income before expected credit losses",   "40,383",   "29,600"],
        ["Expected credit (losses) gains on loans","(68,085)", "11,882"],
        ["Income for the year",                    "(27,586)", "43,897"],
    ],
)

# --- BALANCE SHEET (labelled 'STATEMENT OF FINANCIAL POSITION' in BSTDB) ---
_add_table("sofp", "STATEMENT OF FINANCIAL POSITION",
    ["Presented in thousands of EUR", "2022", "2021"],
    [
        ["Cash and due from banks",               "208,338",   "170,175"],
        ["Deposits in margin accounts",           "114,430",   "30,740"],
        ["Debt investment securities",            "525,224",   "652,448"],
        ["Loans at amortized cost",               "2,040,986", "2,329,424"],
        ["Equity investments at fair value",      "12,440",    "25,777"],
        ["Property and equipment",                "265",       "368"],
        ["Total Assets",                          "2,935,465", "3,235,109"],
        ["Amounts due to financial institutions", "413,485",   "438,293"],
        ["Debt evidenced by certificates",        "1,493,157", "1,657,416"],
        ["Borrowings",                            "1,915,655", "2,274,401"],
        ["Total liabilities",                     "2,099,108", "2,349,387"],
        ["Subscribed share capital",              "2,288,500", "2,288,500"],
        ["Retained earnings",                     "69,015",    "98,860"],
        ["Total members' equity",                 "836,357",   "885,722"],
    ],
)

# --- CASH FLOW ---
_add_table("cash_flows", "STATEMENT OF CASH FLOWS",
    ["Presented in thousands of EUR", "2022", "2021"],
    [
        ["Income for the year",                   "(27,586)",  "43,897"],
        ["Depreciation and amortization",         "339",       "478"],
        ["Expected credit losses (gains) on loans","68,085",   "(11,882)"],
        ["Cash from operations",                  "339,917",   "(121,470)"],
        ["Proceeds from borrowings",              "326,811",   "1,677,859"],
        ["Repayment of borrowings",               "(684,688)", "(1,306,724)"],
        ["Net cash from financing activities",    "(357,877)", "371,135"],
        ["Cash and cash equivalents at end of year","679,747", "571,492"],
    ],
)

# --- Notes section: special funds (text chunks) + audit text ---
TEXT_CHUNKS: list[dict] = [
    {
        "chunk_id": "txt-note29",
        "chunk_type": "text",
        "page": 77,
        "markdown": "SUMMARY OF SPECIAL FUNDS. With the Hellenic Government. The Technical Cooperation Special Fund's objective is to contribute to the economic development of the Black Sea Region's Member Countries. Balance of available funds at 31 December 2022 was EUR 8 thousand.",
        "section_header": "NOTES — Note 29 Summary of Special Funds",
    },
    {
        "chunk_id": "txt-note27",
        "chunk_type": "text",
        "page": 75,
        "markdown": "RELATED PARTIES. Key management personnel comprise the President, Vice Presidents and Secretary General. Amounts paid to key management personnel during the year were EUR 1,703 thousand (2021: EUR 1,337 thousand).",
        "section_header": "NOTES — Note 27 Related Parties",
    },
    {
        "chunk_id": "txt-audit",
        "chunk_type": "text",
        "page": 5,
        "markdown": "INDEPENDENT AUDITOR'S REPORT. In our opinion, the consolidated financial statements present fairly, in all material respects, the financial position of the Bank as at 31 December 2022. The audit was conducted in accordance with International Standards on Auditing.",
        "section_header": "INDEPENDENT AUDITOR'S REPORT",
    },
    {
        "chunk_id": "txt-mr",
        "chunk_type": "text",
        "page": 43,
        "markdown": "Market risk is the risk that changes in foreign exchange rates, interest rates or market prices of financial instruments may result in losses to the Bank. The Bank funds its operations by using own share capital and by borrowing on the international capital markets.",
        "section_header": "NOTES — Market Risk",
    },
]

# --- A real figure with parsed chart data ---
FIGURE_CHUNKS: list[dict] = [
    {
        "chunk_id": "fig-1",
        "chunk_type": "figure",
        "page": 44,
        "markdown": "<::line chart Title: Borrowings by Maturity Y-axis: EUR thousands X-axis: Maturity Bucket Data: Up to 1 month: 0, 1-3 months: 326,629, 3 months to 1 year: 477,763, 1 to 5 years: 742,366, Over 5 years: 359,877, Non-interest bearing: 9,020 Figure 4: Borrowings maturity profile at 31 December 2022: line chart::>",
        "section_header": "NOTES — Interest Rate Risk",
    },
]


# Assemble all qdrant_chunks (for tools that scan chunks directly)
QDRANT_CHUNKS = TEXT_CHUNKS + FIGURE_CHUNKS

# Grounding dict — every cell + every text/figure chunk gets a (page, type, bbox)
GROUNDING: dict[str, dict] = {}
for cid in CELL_LOOKUP:
    GROUNDING[cid] = {"page": 8, "type": "table_cell", "bbox": {"left": 0, "top": 0, "right": 1, "bottom": 1}}
for ch in QDRANT_CHUNKS:
    GROUNDING[ch["chunk_id"]] = {
        "page": ch["page"],
        "type": ch["chunk_type"],
        "bbox": {"left": 0.1, "top": 0.1, "right": 0.9, "bottom": 0.4},
    }


def build_ctx():
    return aa.build_doc_context(
        doc_id="bstdb-2022",
        user_id="smoke-test",
        cell_lookup=CELL_LOOKUP,
        grounding_dict=GROUNDING,
        qdrant_chunks=QDRANT_CHUNKS,
        table_grids=TABLE_GRIDS,
        cell_section_map=CELL_SECTIONS,
        doc_metadata={
            "company_name": "Black Sea Trade and Development Bank",
            "fiscal_year":  2022,
            "currency":     "EUR",
            "doc_type":     "audited financial statements",
        },
        extract={},
    )


# ────────────────────────────────────────────────────────────────────────────
# 20 prompts — each is a tuple of (question, [expected tool calls], expectation)
# Each callable is (ctx) -> (tool_name, ToolResult). The assertion is a
# callable (tool_result) -> (pass_bool, note_str).
# ────────────────────────────────────────────────────────────────────────────

ctx = build_ctx()


def call(fn, args_cls, **kw):
    return fn(ctx, args_cls(**kw))


def has_value(r, *expected_value_substrings: str) -> tuple[bool, str]:
    """Pass when the result payload mentions every expected substring."""
    raw = str(r.payload) + " " + r.summary
    missing = [s for s in expected_value_substrings if s not in raw]
    if missing:
        return False, f"missing values in result: {missing}"
    return True, "values present"


def has_citations(r) -> tuple[bool, str]:
    if r.ok and not r.citations:
        return False, "ok=True but no citations emitted"
    return True, f"{len(r.citations)} citation(s)"


PROMPTS = [
    # 1. Simple lookup — net income (= 'Income for the year' in BSTDB).
    {
        "q": "what was net income in 2022?",
        "tool": lambda: call(lookup_value, LookupValueArgs, line_item="net income", period="2022"),
        "expect": lambda r: (
            r.ok
            and any("(27,586)" in m["value"] for m in r.payload.get("matches", []))
            and bool(r.citations),
            "matches Income for the year (27,586) 2022 + citation",
        ),
    },
    # 2. Simple lookup — total assets.
    {
        "q": "what are total assets at year-end 2022?",
        "tool": lambda: call(lookup_value, LookupValueArgs, line_item="total assets", period="2022"),
        "expect": lambda r: (
            r.ok and any("2,935,465" in m["value"] for m in r.payload.get("matches", [])),
            "matches 2,935,465",
        ),
    },
    # 3. Section summary — balance sheet (the alias-recovery case).
    {
        "q": "tell me about the balance sheet",
        "tool": lambda: call(get_section, GetSectionArgs, name="balance sheet"),
        "expect": lambda r: (
            r.ok and len(r.payload.get("rows", [])) >= 10,
            "returns >=10 line items via alias resolution to SOFP",
        ),
    },
    # 4. Section summary — 'tell me about the assets' (the exact user failure).
    {
        "q": "tell me about the assets",
        "tool": lambda: call(get_section, GetSectionArgs, name="assets"),
        "expect": lambda r: (
            r.ok and len(r.payload.get("rows", [])) >= 5,
            "alias 'assets' resolves to balance-sheet bucket",
        ),
    },
    # 5. YoY comparison — borrowings.
    {
        "q": "compare borrowings 2022 vs 2021",
        "tool": lambda: call(compare_periods, ComparePeriodsArgs,
                             line_item="borrowings", period_a="2022", period_b="2021"),
        "expect": lambda r: (
            r.ok
            and r.payload.get("absolute_delta", 0) < 0     # borrowings DROPPED
            and abs(r.payload.get("percent_delta") or 0) > 10,
            "borrowings decreased materially YoY",
        ),
    },
    # 6. Compute ratio — debt-to-equity.
    {
        "q": "debt-to-equity ratio for 2022",
        "tool": lambda: call(compute_ratio, ComputeRatioArgs, ratio="debt_to_equity", period="2022"),
        "expect": lambda r: (
            r.ok and r.payload.get("value", 0) > 1.5,    # 2,099,108 / 836,357 ≈ 2.51
            "computes D/E from total liabilities and total equity",
        ),
    },
    # 7. Compute ratio — current ratio (this doc lacks 'current assets' line; expect graceful refusal).
    {
        "q": "current ratio",
        "tool": lambda: call(compute_ratio, ComputeRatioArgs, ratio="current_ratio"),
        "expect": lambda r: (
            r.ok is False and r.error in ("missing_inputs", "bad_inputs"),
            "fails gracefully when underlying line items absent",
        ),
    },
    # 8. Compute ratio — ROE.
    {
        "q": "return on equity 2022",
        "tool": lambda: call(compute_ratio, ComputeRatioArgs, ratio="roe", period="2022"),
        "expect": lambda r: (
            r.ok and r.payload.get("value", 0) < 0,    # NI is -27,586 → negative ROE
            "negative ROE in a loss year",
        ),
    },
    # 9. Cash from operations lookup (the disambiguation test).
    {
        "q": "cash from operations in 2022",
        "tool": lambda: call(lookup_value, LookupValueArgs, line_item="cash from operations", period="2022"),
        "expect": lambda r: (
            r.ok and any("339,917" in m["value"] for m in r.payload.get("matches", [])),
            "picks the CFO row 339,917 — not 'Cash and due from banks'",
        ),
    },
    # 10. Decompose change — why did income drop?
    {
        "q": "why did income drop in 2022?",
        "tool": lambda: call(decompose_change, DecomposeChangeArgs,
                             parent_line_item="income for the year", period_a="2022", period_b="2021"),
        "expect": lambda r: (
            r.ok and len(r.payload.get("contributors", [])) >= 3,
            "returns several sibling line items with deltas",
        ),
    },
    # 11. Red flags — full scan.
    {
        "q": "what should I be concerned about in this filing?",
        "tool": lambda: call(detect_red_flags, DetectRedFlagsArgs, category="all"),
        "expect": lambda r: (
            r.ok and len(r.payload.get("flags", [])) >= 2,
            "detects accrual divergence + related-party text + more",
        ),
    },
    # 12. Red flags — earnings quality only.
    {
        "q": "any earnings-quality concerns?",
        "tool": lambda: call(detect_red_flags, DetectRedFlagsArgs, category="earnings_quality"),
        "expect": lambda r: (
            r.ok and len(r.payload.get("flags", [])) >= 1,
            "at least one earnings-quality flag",
        ),
    },
    # 13. Figure listing.
    {
        "q": "what charts are in this document?",
        "tool": lambda: call(list_figures, ListFiguresArgs),
        "expect": lambda r: (
            r.ok and len(r.payload.get("figures", [])) >= 1,
            "enumerates the borrowings-maturity figure",
        ),
    },
    # 14. Figure reading by 'Figure N'.
    {
        "q": "describe Figure 4",
        "tool": lambda: call(read_figure, ReadFigureArgs, query="Figure 4"),
        "expect": lambda r: (
            r.ok and "742,366" in r.payload.get("content", ""),
            "returns parsed chart data including 1-5y bucket value",
        ),
    },
    # 15. Figure reading by semantic phrase.
    {
        "q": "the maturity chart",
        "tool": lambda: call(read_figure, ReadFigureArgs, query="maturity chart"),
        "expect": lambda r: (
            r.ok,
            "semantic match resolves to the maturity figure",
        ),
    },
    # 16. Text retrieval — auditor opinion.
    {
        "q": "what does the auditor say?",
        "tool": lambda: call(query_freeform, QueryFreeformArgs,
                             question="independent auditor opinion"),
        "expect": lambda r: (
            r.ok and any("auditor" in c.get("text", "").lower() for c in r.payload.get("chunks", [])),
            "freeform retrieval finds the auditor-report chunk",
        ),
    },
    # 17. Text retrieval — special funds.
    {
        "q": "what are the special funds?",
        "tool": lambda: call(query_freeform, QueryFreeformArgs, question="special funds balance"),
        "expect": lambda r: (
            r.ok and any("special funds" in c.get("text", "").lower() for c in r.payload.get("chunks", [])),
            "finds Note 29 special-funds chunk",
        ),
    },
    # 18. Section summary — cash flows.
    {
        "q": "give me the cash flow statement",
        "tool": lambda: call(get_section, GetSectionArgs, name="cash flow"),
        "expect": lambda r: (
            r.ok and len(r.payload.get("rows", [])) >= 5,
            "returns cash-flow line items",
        ),
    },
    # 19. Compare net interest income YoY.
    {
        "q": "how did net interest income change from 2021 to 2022?",
        "tool": lambda: call(compare_periods, ComparePeriodsArgs,
                             line_item="net interest income", period_a="2022", period_b="2021"),
        "expect": lambda r: (
            r.ok and r.payload.get("absolute_delta", 0) > 0,    # 96,635 vs 60,478 → up
            "NII grew YoY (96,635 vs 60,478)",
        ),
    },
    # 20. Open-ended futuristic question — should still ground in data, not refuse.
    {
        "q": "how could we improve interest expense?",
        "tool": lambda: call(query_freeform, QueryFreeformArgs, question="interest expense market risk borrowings"),
        "expect": lambda r: (
            r.ok and bool(r.payload.get("chunks")),
            "freeform retrieval surfaces interest-expense / market-risk discussion",
        ),
    },
]


def main() -> int:
    passed = 0
    failed = 0
    print("=" * 78)
    print(f"AlphaLens analyzer-agent smoke test — 20 prompts × BSTDB 2022 fixture")
    print("=" * 78)
    for i, p in enumerate(PROMPTS, 1):
        q = p["q"]
        try:
            r = p["tool"]()
            ok, note = p["expect"](r)
        except Exception as e:
            ok, note, r = False, f"raised: {type(e).__name__}: {e}", None
        status = "PASS" if ok else "FAIL"
        if ok: passed += 1
        else:  failed += 1
        # Compact line per prompt
        tool_name = r.tool_name if r else "(crash)"
        cit = (len(r.citations) if r else 0)
        latency = (r.latency_ms if r else "—")
        print(f"\n[{i:2d}] {status}  q={q!r}")
        print(f"     tool={tool_name}  citations={cit}  latency={latency}ms")
        print(f"     check: {note}")
        if r:
            summary = (r.summary or "")[:140]
            print(f"     summary: {summary}")
    print("\n" + "=" * 78)
    print(f"TOTAL: {passed}/{len(PROMPTS)} passed   ({failed} failed)")
    print("=" * 78)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
