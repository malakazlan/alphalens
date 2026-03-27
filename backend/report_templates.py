"""Report template configurations — section prompts, extract keys, and RAG queries."""

from typing import Optional

# ── Section definitions ───────────────────────────────────────────────────────

SECTION_CONFIGS = {
    "executive_summary": {
        "title": "Executive Summary",
        "system": (
            "You are a senior financial analyst writing a concise executive summary. "
            "Highlight the most important financial facts: revenue, profitability, key ratios, "
            "and any significant risks or strengths. Be direct and data-driven. "
            "Use markdown: **bold** key figures, - for bullet lists. Keep it 150-250 words."
        ),
        "extract_keys": [
            "company_name", "fiscal_year", "fiscal_period", "currency", "doc_type",
            "income_statement", "key_metrics", "auditor_opinion", "red_flags",
        ],
        "rag_query": "company overview financial highlights key metrics summary",
        "max_tokens": 600,
        "rag_top_k": 10,
    },
    "financial_performance": {
        "title": "Financial Performance",
        "system": (
            "You are analyzing income statement performance for a financial report. "
            "Focus on: revenue and revenue growth, cost structure, gross/operating/net margins, "
            "EBITDA, EPS, and profitability trends. Compare figures where prior-year data exists. "
            "Present a markdown table of key income statement metrics. "
            "Use markdown: ## for header, **bold** key figures, | for tables. Keep it 250-400 words."
        ),
        "extract_keys": ["income_statement", "currency", "key_metrics", "fiscal_year", "fiscal_period"],
        "rag_query": "revenue profit income operating expenses margins growth EBITDA earnings",
        "max_tokens": 800,
        "rag_top_k": 15,
    },
    "balance_sheet_liquidity": {
        "title": "Balance Sheet & Liquidity",
        "system": (
            "You are analyzing balance sheet health and liquidity position. "
            "Cover: total assets vs liabilities, equity position, cash and equivalents, "
            "debt levels, current ratio, debt-to-equity. Assess solvency and liquidity risk. "
            "Present a summary table of balance sheet items. "
            "Use markdown: ## for header, **bold** key figures, | for tables. Keep it 250-350 words."
        ),
        "extract_keys": ["balance_sheet", "currency", "key_metrics", "fiscal_year"],
        "rag_query": "assets liabilities equity debt cash liquidity solvency current ratio",
        "max_tokens": 700,
        "rag_top_k": 15,
    },
    "cash_flow": {
        "title": "Cash Flow Analysis",
        "system": (
            "You are analyzing cash flow patterns and capital allocation. "
            "Cover: operating cash flow quality, investing activities (capex, acquisitions), "
            "financing activities (debt, dividends, buybacks), and free cash flow. "
            "Assess cash conversion and sustainability. "
            "Use markdown: ## for header, **bold** key figures. Keep it 200-300 words."
        ),
        "extract_keys": ["cash_flow", "currency", "fiscal_year"],
        "rag_query": "operating cash flow investing financing capex free cash flow dividends",
        "max_tokens": 600,
        "rag_top_k": 12,
    },
    "ratios_metrics": {
        "title": "Key Ratios & Metrics",
        "system": (
            "You are presenting and interpreting key financial ratios for a professional report. "
            "Present all available ratios in a clean markdown table with interpretation. "
            "Cover: profitability (ROE, ROA, margins), leverage (debt-to-equity), "
            "liquidity (current ratio), and valuation (P/E if available). "
            "Briefly interpret what each ratio indicates about company health. "
            "Use markdown: ## for header, | for tables, **bold** for standout values. Keep it 200-350 words."
        ),
        "extract_keys": ["key_metrics", "income_statement", "balance_sheet"],
        "rag_query": "return on equity assets ratio margin efficiency leverage",
        "max_tokens": 600,
        "rag_top_k": 10,
    },
    "red_flags_risks": {
        "title": "Red Flags & Risks",
        "system": (
            "You are a risk analyst identifying concerns and red flags in a financial report. "
            "Analyze: identified red flags, audit opinion implications, declining metrics, "
            "high leverage, low liquidity, negative cash flows, or other warning signs. "
            "If no significant risks exist, state that the financial position appears sound "
            "and note any areas to monitor. Be factual and balanced — don't manufacture risks. "
            "Use markdown: ## for header, **bold** key concerns, - for bullet lists. Keep it 200-300 words."
        ),
        "extract_keys": ["red_flags", "auditor_opinion", "key_metrics", "balance_sheet", "cash_flow"],
        "rag_query": "risk concern going concern debt leverage decline warning audit qualified",
        "max_tokens": 600,
        "rag_top_k": 12,
    },
    "analyst_conclusion": {
        "title": "Analyst Conclusion",
        "system": (
            "You are writing a balanced conclusion for a financial analysis report. "
            "Summarize the overall financial health, key strengths, primary concerns, "
            "and forward-looking considerations. This is an educational/analytical perspective, "
            "NOT investment advice. Do not recommend buy/sell/hold. "
            "Use markdown: ## for header, **bold** key points. Keep it 150-250 words."
        ),
        "extract_keys": None,  # receives full extract
        "rag_query": "outlook summary conclusion financial position overall assessment",
        "max_tokens": 500,
        "rag_top_k": 8,
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
        "word_target": "~3,000 words",
    },
    "executive_brief": {
        "label": "Executive Brief",
        "description": "Quick 3-section overview for stakeholders",
        "sections": [
            "executive_summary",
            "ratios_metrics",
            "analyst_conclusion",
        ],
        "word_target": "~800 words",
    },
    "risk_report": {
        "label": "Risk Report",
        "description": "Compliance & risk focused analysis",
        "sections": [
            "executive_summary",
            "balance_sheet_liquidity",
            "red_flags_risks",
            "analyst_conclusion",
        ],
        "word_target": "~1,500 words",
    },
    "investor_memo": {
        "label": "Investor Memo",
        "description": "Investment committee format with growth analysis",
        "sections": [
            "executive_summary",
            "financial_performance",
            "ratios_metrics",
            "red_flags_risks",
            "analyst_conclusion",
        ],
        "word_target": "~2,000 words",
    },
}


def get_template_sections(template_id: str) -> list[str]:
    """Return ordered section IDs for a template."""
    t = TEMPLATES.get(template_id)
    if not t:
        return TEMPLATES["full_analysis"]["sections"]
    return t["sections"]


def get_section_config(section_id: str) -> dict:
    """Return config for a single section."""
    return SECTION_CONFIGS.get(section_id, SECTION_CONFIGS["executive_summary"])


def build_section_extract(extract: dict, extract_keys: Optional[list[str]]) -> dict:
    """Filter extract_data to only the keys relevant for a section."""
    if extract_keys is None:
        # Full extract (strip internal keys)
        return {k: v for k, v in extract.items() if not k.startswith("_")}
    return {k: extract[k] for k in extract_keys if k in extract}
