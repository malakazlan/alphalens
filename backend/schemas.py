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
    sha256_hash: str

class ChatQuery(BaseModel):
    document_id: str
    query: str
    session_id: str = ""

class FinBotMessage(BaseModel):
    session_id: str
    message: str


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
