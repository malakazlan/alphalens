"""All Pydantic schemas for Alpha Lens v2 — API models + financial data models."""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Any


# ─── Auth ──────────────────────────────────────────────────────────────────────

class SignUpRequest(BaseModel):
    email: EmailStr
    password: str

class SignInRequest(BaseModel):
    email: EmailStr
    password: str

class AuthResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    user: Optional[dict] = None
    access_token: Optional[str] = None
    error: Optional[str] = None

class ForgotPasswordRequest(BaseModel):
    email: EmailStr


# ─── Documents ─────────────────────────────────────────────────────────────────

class HashCheckRequest(BaseModel):
    sha256_hash: str = Field(..., min_length=64, max_length=64)


class ChatHistoryItem(BaseModel):
    role: str = Field(..., pattern=r"^(user|assistant)$")
    content: str = Field(..., max_length=8000)


class ChatRequest(BaseModel):
    """Body for POST /api/documents/{doc_id}/chat and /api/finbot/chat."""
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[ChatHistoryItem] = Field(default_factory=list, max_length=40)
    # Optional: target a specific analyzer-side conversation thread. When
    # omitted, the chat endpoint falls back to get_or_create_conversation
    # (most-recent for this user+doc, create one if none exist).
    conversation_id: Optional[str] = None


class AnalyzerConversationCreate(BaseModel):
    """Body for POST /api/documents/{doc_id}/conversations — title optional.
    Untitled threads show up as 'New chat' until renamed."""
    title: Optional[str] = Field(default=None, max_length=120)


class AnalyzerConversationUpdate(BaseModel):
    """Body for PATCH /api/documents/{doc_id}/conversations/{id}."""
    title: str = Field(..., min_length=1, max_length=120)


class ReportGenerateRequest(BaseModel):
    template: str = Field("full_analysis", max_length=64)


class RegenerateSectionRequest(BaseModel):
    section: str = Field(..., min_length=1, max_length=64)


# ─── FinBot — Holdings (Phase 2 / Slice 1) ───────────────────────────────────

# `account_type` is enforced by a CHECK constraint at the DB layer; we mirror
# it here for early-fail validation + autocompletion in clients.
_ACCOUNT_TYPES = ("taxable", "retirement", "isa", "other")


class HoldingCreate(BaseModel):
    """Body for POST /api/finbot/holdings."""
    ticker:       str   = Field(..., min_length=1, max_length=10)
    quantity:     float = Field(..., gt=0)
    cost_basis:   float = Field(..., ge=0,
                                description="Total dollars invested in this lot (price × qty + fees).")
    currency:     str   = Field("USD", min_length=3, max_length=3)
    account_type: str   = Field(..., pattern=f"^({'|'.join(_ACCOUNT_TYPES)})$")
    opened_at:    str   = Field(..., min_length=10, max_length=10,
                                description="ISO date YYYY-MM-DD.")
    note:         Optional[str] = Field(None, max_length=500)


class HoldingUpdate(BaseModel):
    """Body for PATCH /api/finbot/holdings/{id}. All fields optional."""
    ticker:       Optional[str]   = Field(None, min_length=1, max_length=10)
    quantity:     Optional[float] = Field(None, gt=0)
    cost_basis:   Optional[float] = Field(None, ge=0)
    currency:     Optional[str]   = Field(None, min_length=3, max_length=3)
    account_type: Optional[str]   = Field(None, pattern=f"^({'|'.join(_ACCOUNT_TYPES)})$")
    opened_at:    Optional[str]   = Field(None, min_length=10, max_length=10)
    closed_at:    Optional[str]   = Field(None, min_length=10, max_length=10)
    note:         Optional[str]   = Field(None, max_length=500)


# ─── FinBot — Profile + Watchlist (Phase 2 / Slice 2) ────────────────────────

_RISK_TOLERANCE = ("conservative", "moderate", "aggressive")
_TIME_HORIZON   = ("short", "medium", "long")
_GOAL_VALUES    = ("retirement", "income", "growth", "preservation")


class ProfileUpsert(BaseModel):
    """Body for PUT /api/finbot/profile. All fields required at upsert time."""
    risk_tolerance:      str = Field(..., pattern=f"^({'|'.join(_RISK_TOLERANCE)})$")
    time_horizon:        str = Field(..., pattern=f"^({'|'.join(_TIME_HORIZON)})$")
    goals:               list[str] = Field(default_factory=list, max_length=4)
    liquidity_needs:     Optional[str] = Field(None, max_length=500)
    tax_country:         Optional[str] = Field(None, min_length=2, max_length=2)
    currency_preference: str = Field("USD", min_length=3, max_length=3)


class WatchlistCreate(BaseModel):
    ticker:      str = Field(..., min_length=1, max_length=10)
    alert_above: Optional[float] = Field(None, ge=0)
    alert_below: Optional[float] = Field(None, ge=0)
    note:        Optional[str]   = Field(None, max_length=500)


class WatchlistUpdate(BaseModel):
    ticker:      Optional[str]   = Field(None, min_length=1, max_length=10)
    alert_above: Optional[float] = Field(None, ge=0)
    alert_below: Optional[float] = Field(None, ge=0)
    note:        Optional[str]   = Field(None, max_length=500)


# ─── FinBot — Conversations + Messages (Phase 2 / Slice 4) ───────────────────

class ConversationCreate(BaseModel):
    """Body for POST /api/finbot/conversations."""
    title: Optional[str] = Field(None, min_length=1, max_length=120)


class ConversationUpdate(BaseModel):
    """Body for PATCH /api/finbot/conversations/{id}."""
    title:    Optional[str]  = Field(None, min_length=1, max_length=120)
    pinned:   Optional[bool] = None
    archived: Optional[bool] = None  # True → archive, False → unarchive


class FinBotMessageSend(BaseModel):
    """Body for POST /api/finbot/conversations/{id}/messages."""
    message: str = Field(..., min_length=1, max_length=2000)


class FinBotActiveDocRequest(BaseModel):
    """Body for PATCH /api/finbot/conversations/{id}/active-doc.

    `doc_id=None` clears the pin. When set, FinBot's system prompt for
    this conversation is enriched with the doc's filename and ID, so
    every doc-related question is answered against that document
    without the user re-stating which one."""
    doc_id: Optional[str] = None


# ─── Financial Schemas (for ADE extract()) ─────────────────────────────────────

class IncomeStatement(BaseModel):
    revenue: Optional[float] = Field(None, description="Total revenue or net sales from the Income Statement")
    gross_profit: Optional[float] = Field(None, description="Gross profit = Revenue minus Cost of Goods Sold")
    operating_income: Optional[float] = Field(None, description="Operating income (EBIT) = Gross Profit minus Operating Expenses")
    net_income: Optional[float] = Field(None, description="Net income (bottom-line profit) after all expenses and taxes")
    ebitda: Optional[float] = Field(None, description="Earnings Before Interest, Taxes, Depreciation and Amortization")
    eps: Optional[float] = Field(None, description="Earnings Per Share (basic or diluted)")
    revenue_yoy_growth: Optional[float] = Field(None, description="Year-over-year revenue growth as a percentage")


class BalanceSheet(BaseModel):
    total_assets: Optional[float] = Field(None, description="Total assets from the Balance Sheet as of the reporting date")
    total_liabilities: Optional[float] = Field(None, description="Total liabilities (current + non-current)")
    equity: Optional[float] = Field(None, description="Total shareholders' equity")
    cash: Optional[float] = Field(None, description="Cash and cash equivalents")
    debt: Optional[float] = Field(None, description="Total debt (short-term + long-term)")
    current_assets: Optional[float] = Field(None, description="Total current assets")
    current_liabilities: Optional[float] = Field(None, description="Total current liabilities")


class CashFlowStatement(BaseModel):
    operating: Optional[float] = Field(None, description="Net cash from operating activities")
    investing: Optional[float] = Field(None, description="Net cash from investing activities")
    financing: Optional[float] = Field(None, description="Net cash from financing activities")
    free_cash_flow: Optional[float] = Field(None, description="Free cash flow = Operating cash flow minus CapEx")
    capital_expenditures: Optional[float] = Field(None, description="Capital expenditures")


class KeyMetrics(BaseModel):
    roe: Optional[float] = Field(None, description="Return on Equity = Net Income / Shareholders' Equity (as percentage)")
    roa: Optional[float] = Field(None, description="Return on Assets = Net Income / Total Assets (as percentage)")
    current_ratio: Optional[float] = Field(None, description="Current Ratio = Current Assets / Current Liabilities")
    debt_to_equity: Optional[float] = Field(None, description="Debt-to-Equity Ratio = Total Debt / Total Equity")
    profit_margin: Optional[float] = Field(None, description="Net Profit Margin = Net Income / Revenue (as percentage)")
    gross_margin: Optional[float] = Field(None, description="Gross Margin = Gross Profit / Revenue (as percentage)")
    revenue_growth: Optional[float] = Field(None, description="Revenue growth rate year-over-year (as percentage)")
    pe_ratio: Optional[float] = Field(None, description="Price-to-Earnings ratio if mentioned in the document")


class FinancialDocument(BaseModel):
    doc_type: str = Field(
        description="Type: 'annual_report', '10-K', 'earnings_release', 'balance_sheet', "
                    "'income_statement', 'cash_flow_statement', 'prospectus', or 'other'"
    )
    company_name: str = Field(description="Full legal name of the company")
    fiscal_year: Optional[int] = Field(None, description="Fiscal year (4-digit, e.g. 2024)")
    fiscal_period: Optional[str] = Field(None, description="'FY', 'Q1', 'Q2', 'Q3', 'Q4', 'H1', or 'H2'")
    currency: str = Field(description="ISO 4217 currency code, e.g. 'USD', 'EUR', 'PKR'")
    reporting_date: Optional[str] = Field(None, description="Balance sheet date (YYYY-MM-DD)")
    income_statement: Optional[IncomeStatement] = Field(None, description="Income statement data")
    balance_sheet: Optional[BalanceSheet] = Field(None, description="Balance sheet data")
    cash_flow: Optional[CashFlowStatement] = Field(None, description="Cash flow statement data")
    key_metrics: Optional[KeyMetrics] = Field(None, description="Key financial ratios and metrics")
    red_flags: list[str] = Field(
        default_factory=list,
        description="List of financial red flags or risks identified. Empty list if none found."
    )
    auditor_opinion: Optional[str] = Field(
        None,
        description="'Unqualified/Clean', 'Qualified', 'Adverse', 'Disclaimer of Opinion', or 'Not Present'"
    )
