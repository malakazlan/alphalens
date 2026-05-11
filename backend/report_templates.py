"""Report template configurations — section prompts, extract keys, RAG queries.

Phase 3 commit 2 — rewrote every section prompt to apply the
chat-phase taxonomy:
  - never refuse with 'not available' for synthesis-type prompts;
    show what IS available and call out the gap inline
  - preserve exact figures (no rounding, abbreviation, paraphrasing)
  - parenthetical values like (1,234) are negative
  - use markdown — ## headings, **bold** key figures, | tables for
    multi-period comparisons, - for bullet lists
  - never include UUIDs, chunk IDs, or other raw identifiers

Each section also carries a `model` hint:
  - "fast"  → gpt-4o-mini (structural / lookup / short synthesis)
  - "smart" → gpt-4o      (analytical / decomposition / risk reasoning)
This is the model-routing knob from commit 2 — ~60% per-report cost cut
without sacrificing the analytical sections.
"""

from typing import Optional

# Cross-section formatting + behaviour bar. Prepended to every section's
# system prompt so the chat-phase contract is shared without duplication.
_SECTION_BASELINE = (
    "Output rules (these apply to every section):\n"
    "- Use markdown formatting: ## for the section header, **bold** for key "
    "figures, | tables for multi-period comparisons, - for bullet lists.\n"
    "- Preserve exact values from the source — do not round, abbreviate, or "
    "paraphrase numbers. Parenthetical values like (880,843) are negative; "
    "label them as losses or expenses.\n"
    "- Never invent figures. If a specific value is not in the structured data "
    "or excerpts, write 'not in the document' for that single value but still "
    "deliver the section using whatever IS available — never refuse the whole "
    "section.\n"
    "- Treat synonyms as the same concept: Revenue ≡ Sales ≡ Turnover ≡ Net "
    "sales; Net income ≡ Profit for the year ≡ Earnings; Operating income ≡ "
    "Profit from operations ≡ EBIT; Cash from operations ≡ Cash generated "
    "from operations ≡ Net cash from operating activities.\n"
    "- Do NOT include raw chunk identifiers, UUIDs, or '[chunk_id: …]' markers "
    "in your output. Reference sections / pages in human-readable form when "
    "useful (e.g. 'per the Cash Flow Statement on page 5').\n"
    "- When two periods are present, label every figure with its period."
)


# ── Section definitions ───────────────────────────────────────────────────────
# Each section carries:
#   title          – display title (UI + markdown header)
#   system         – section-specific instructions appended to baseline
#   extract_keys   – which slices of doc.extract_data to surface (None = all)
#   rag_query      – seed query for per-section Qdrant retrieval; gets
#                    expanded via _expand_query_for_retrieval at call time
#   model          – "fast" (gpt-4o-mini) or "smart" (gpt-4o)
#   max_tokens     – cap on completion tokens
#   rag_top_k      – number of chunks to retrieve and feed to the model

SECTION_CONFIGS = {
    "executive_summary": {
        "title": "Executive Summary",
        "system": (
            "You are a senior financial analyst writing the executive summary. "
            "Open with one sentence naming the company, document type, and "
            "reporting period. Then 5-8 bullets covering: revenue and profit, "
            "year-over-year direction (improving / deteriorating / stable), "
            "balance-sheet strength, cash-flow quality, and the single "
            "biggest standout (positive or negative). Be direct and data-"
            "driven — no narrative filler. Target: 150-220 words."
        ),
        "extract_keys": [
            "company_name", "fiscal_year", "fiscal_period", "currency", "doc_type",
            "income_statement", "key_metrics", "auditor_opinion", "red_flags",
        ],
        "rag_query": "company overview financial highlights revenue profit summary",
        "model":      "fast",
        "max_tokens": 600,
        "rag_top_k":  10,
    },
    "financial_performance": {
        "title": "Financial Performance",
        "system": (
            "Analyse the income statement. Lead with a markdown table of: "
            "Revenue, Cost of sales / COGS, Gross profit, Operating income, "
            "Net income, and EPS — one column per period available. Below the "
            "table: a paragraph each on (a) revenue direction with absolute "
            "and percentage change, (b) margin trajectory (gross / operating "
            "/ net), and (c) one-line interpretation of what changed. Do not "
            "speculate about causes that aren't supported by the document. "
            "Target: 280-400 words."
        ),
        "extract_keys": ["income_statement", "currency", "key_metrics", "fiscal_year", "fiscal_period"],
        "rag_query":   "revenue sales turnover gross profit operating income net income EBITDA EPS margin",
        "model":       "smart",
        "max_tokens":  900,
        "rag_top_k":   12,
    },
    "balance_sheet_liquidity": {
        "title": "Balance Sheet & Liquidity",
        "system": (
            "Assess balance-sheet health and liquidity. Lead with a markdown "
            "table: Total assets, Current assets, Cash & equivalents, Total "
            "liabilities, Current liabilities, Total equity, Total debt — "
            "one column per period. Below: (a) asset composition and key "
            "drivers, (b) liability and debt structure, (c) liquidity "
            "assessment using current ratio and cash position. Flag any "
            "deteriorating ratio explicitly. Target: 260-380 words."
        ),
        "extract_keys": ["balance_sheet", "currency", "key_metrics", "fiscal_year"],
        "rag_query":   "total assets current assets liabilities equity cash debt long-term short-term shareholders",
        "model":       "smart",
        "max_tokens":  800,
        "rag_top_k":   12,
    },
    "cash_flow": {
        "title": "Cash Flow Analysis",
        "system": (
            "Analyse cash generation and allocation. Markdown table of: Cash "
            "from operations, Cash used in investing, Cash used in financing, "
            "Net change in cash, Cash at end of period, Free cash flow if "
            "available — one column per period. Below: (a) quality of "
            "operating cash flow vs. reported net income, (b) capital "
            "allocation (capex, debt repayment, dividends), (c) one-line "
            "verdict on cash-generation sustainability. Target: 220-340 words."
        ),
        "extract_keys": ["cash_flow", "currency", "fiscal_year"],
        "rag_query":   "cash from operations operating investing financing capex dividends free cash flow net decrease increase",
        "model":       "smart",
        "max_tokens":  700,
        "rag_top_k":   10,
    },
    "ratios_metrics": {
        "title": "Key Ratios & Metrics",
        "system": (
            "Present and interpret the key ratios. A single markdown table "
            "with three columns: Ratio name | Value | One-line interpretation. "
            "Include any of these that are present: ROE, ROA, Gross margin, "
            "Operating margin, Net margin, Current ratio, Debt-to-equity, "
            "Revenue growth %, P/E. After the table, a short paragraph "
            "summarising whether the company looks profitable, solvent, "
            "and growing — based ONLY on the ratios shown. Target: 180-300 words."
        ),
        "extract_keys": ["key_metrics", "income_statement", "balance_sheet"],
        "rag_query":   "return on equity assets ratio margin debt-to-equity current ratio earnings per share",
        "model":       "fast",
        "max_tokens":  600,
        "rag_top_k":   8,
    },
    "red_flags_risks": {
        "title": "Red Flags & Risks",
        "system": (
            "Identify financial-statement concerns. Cover each that applies:\n"
            "  - Auditor qualifications or going-concern language\n"
            "  - Declining revenue, margins, or cash flow\n"
            "  - High or rising leverage (debt-to-equity, interest coverage)\n"
            "  - Tight liquidity (current ratio < 1, cash burn)\n"
            "  - Working-capital pressure (receivables / inventory swelling)\n"
            "  - Off-balance-sheet exposures, contingent liabilities, "
            "    related-party transactions mentioned in notes\n"
            "Use - bullets, **bold** the metric or phrase, and quantify with "
            "the source figure. If the document shows no material concerns, "
            "state that plainly and list 1-3 areas worth monitoring next "
            "period. Do not manufacture risks. Target: 220-340 words."
        ),
        "extract_keys": ["red_flags", "auditor_opinion", "key_metrics", "balance_sheet", "cash_flow"],
        "rag_query":   "risk going concern leverage debt decline qualified opinion contingent liabilities",
        "model":       "smart",
        "max_tokens":  700,
        "rag_top_k":   12,
    },
    "analyst_conclusion": {
        "title": "Analyst Conclusion",
        "system": (
            "Write the closing analyst view. Structure: (1) two-sentence "
            "overall verdict on financial health, (2) **bullet** the top "
            "strengths (max 3), (3) **bullet** the top concerns (max 3), "
            "(4) one paragraph on what to monitor next period. This is an "
            "analytical educational perspective — NOT investment advice. Do "
            "NOT recommend buy / sell / hold or speculate on future price. "
            "Target: 180-280 words."
        ),
        "extract_keys": None,  # full extract — synthesis section
        "rag_query":   "outlook conclusion summary financial position overall assessment future",
        "model":       "fast",
        "max_tokens":  600,
        "rag_top_k":   8,
    },
}


# ── Template definitions ──────────────────────────────────────────────────────

TEMPLATES = {
    "full_analysis": {
        "label": "Full Analysis",
        "description": "Comprehensive 7-section financial deep-dive",
        "sections": [
            "executive_summary",
            "financial_performance",
            "balance_sheet_liquidity",
            "cash_flow",
            "ratios_metrics",
            "red_flags_risks",
            "analyst_conclusion",
        ],
        "word_target": "~2,500 words",
    },
    "executive_brief": {
        "label": "Executive Brief",
        "description": "Quick 3-section overview for stakeholders",
        "sections": [
            "executive_summary",
            "ratios_metrics",
            "analyst_conclusion",
        ],
        "word_target": "~700 words",
    },
    "risk_report": {
        "label": "Risk Report",
        "description": "Compliance and risk-focused analysis",
        "sections": [
            "executive_summary",
            "balance_sheet_liquidity",
            "red_flags_risks",
            "analyst_conclusion",
        ],
        "word_target": "~1,300 words",
    },
    "investor_memo": {
        "label": "Investor Memo",
        "description": "Investment-committee format with growth analysis",
        "sections": [
            "executive_summary",
            "financial_performance",
            "ratios_metrics",
            "red_flags_risks",
            "analyst_conclusion",
        ],
        "word_target": "~1,800 words",
    },
}


# Map a section's `model` hint to the actual OpenAI model name. Kept here
# (not at the call site) so the rest of the codebase stays unaware of which
# exact model is in play — easier to A/B or upgrade later.
MODEL_MAP: dict[str, str] = {
    "fast":  "gpt-4o-mini",
    "smart": "gpt-4o",
}


def resolve_model(section_id: str, default: str = "gpt-4o") -> str:
    """Return the OpenAI model to use for a section. Falls back to `default`
    if the section config doesn't carry a model hint (e.g. a user-defined
    custom template)."""
    cfg = SECTION_CONFIGS.get(section_id) or {}
    hint = cfg.get("model")
    if hint and hint in MODEL_MAP:
        return MODEL_MAP[hint]
    return default


def get_template_sections(template_id: str) -> list[str]:
    """Return ordered section IDs for a template."""
    t = TEMPLATES.get(template_id)
    if not t:
        return TEMPLATES["full_analysis"]["sections"]
    return t["sections"]


def get_section_config(section_id: str) -> dict:
    """Return config for a single section. Falls back to executive_summary
    when an unknown id is passed — same shape, safer default."""
    return SECTION_CONFIGS.get(section_id, SECTION_CONFIGS["executive_summary"])


def section_system_prompt(section_id: str) -> str:
    """Compose the baseline + section-specific system prompt. Kept as a
    helper so commit 2.3 can wrap it once and pass to the LLM call."""
    cfg = get_section_config(section_id)
    return f"{cfg['system']}\n\n{_SECTION_BASELINE}"


def build_section_extract(extract: dict, extract_keys: Optional[list[str]]) -> dict:
    """Filter extract_data to only the keys relevant for a section."""
    if extract_keys is None:
        return {k: v for k, v in extract.items() if not k.startswith("_")}
    return {k: extract[k] for k in extract_keys if k in extract}
