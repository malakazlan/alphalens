# FINANCIAL_SCHEMAS.md — Alpha Lens v2 Financial Data Schemas

## 1. Overview

All financial schemas are Pydantic v2 models. They serve three purposes:
1. **ADE extract()** — passed to `pydantic_to_json_schema()` to generate the JSON schema that ADE uses to extract structured data from parsed markdown
2. **API responses** — returned by FastAPI endpoints for the Extract tab display
3. **UI mapping** — each field maps to a labeled row in the Extract panel

All monetary values are in the document's reported currency (stored in `FinancialDocument.currency`).

---

## 2. Core Financial Schema Hierarchy

```
FinancialDocument                  ← Top-level schema passed to ADE extract()
├── doc_type: str
├── company_name: str
├── fiscal_year: int
├── currency: str
├── income_statement: IncomeStatement
├── balance_sheet: BalanceSheet
├── cash_flow: CashFlowStatement
├── key_metrics: KeyMetrics
├── red_flags: list[str]
└── auditor_opinion: str
```

---

## 3. Pydantic Models

```python
# schemas.py
from pydantic import BaseModel, Field
from typing import Optional
from landingai_ade.lib import pydantic_to_json_schema


class IncomeStatement(BaseModel):
    revenue: Optional[float] = Field(
        None,
        description="Total revenue or net sales from the Income Statement (top-line figure)"
    )
    gross_profit: Optional[float] = Field(
        None,
        description="Gross profit = Revenue minus Cost of Goods Sold"
    )
    operating_income: Optional[float] = Field(
        None,
        description="Operating income (EBIT) = Gross Profit minus Operating Expenses"
    )
    net_income: Optional[float] = Field(
        None,
        description="Net income (bottom-line profit) after all expenses and taxes"
    )
    ebitda: Optional[float] = Field(
        None,
        description="Earnings Before Interest, Taxes, Depreciation and Amortization"
    )
    eps: Optional[float] = Field(
        None,
        description="Earnings Per Share (basic or diluted, note which if specified)"
    )
    revenue_yoy_growth: Optional[float] = Field(
        None,
        description="Year-over-year revenue growth as a percentage (e.g., 12.5 for 12.5%)"
    )


class BalanceSheet(BaseModel):
    total_assets: Optional[float] = Field(
        None,
        description="Total assets from the Balance Sheet as of the reporting date"
    )
    total_liabilities: Optional[float] = Field(
        None,
        description="Total liabilities (current + non-current) from the Balance Sheet"
    )
    equity: Optional[float] = Field(
        None,
        description="Total shareholders' equity or stockholders' equity"
    )
    cash: Optional[float] = Field(
        None,
        description="Cash and cash equivalents (most liquid assets)"
    )
    debt: Optional[float] = Field(
        None,
        description="Total debt (short-term + long-term debt and borrowings)"
    )
    current_assets: Optional[float] = Field(
        None,
        description="Total current assets (assets expected to be converted to cash within 1 year)"
    )
    current_liabilities: Optional[float] = Field(
        None,
        description="Total current liabilities (obligations due within 1 year)"
    )


class CashFlowStatement(BaseModel):
    operating: Optional[float] = Field(
        None,
        description="Net cash from operating activities (core business cash generation)"
    )
    investing: Optional[float] = Field(
        None,
        description="Net cash from investing activities (capex, acquisitions, asset sales)"
    )
    financing: Optional[float] = Field(
        None,
        description="Net cash from financing activities (debt, dividends, share issuance)"
    )
    free_cash_flow: Optional[float] = Field(
        None,
        description="Free cash flow = Operating cash flow minus Capital expenditures"
    )
    capital_expenditures: Optional[float] = Field(
        None,
        description="Capital expenditures (property, plant, equipment purchases)"
    )


class KeyMetrics(BaseModel):
    roe: Optional[float] = Field(
        None,
        description="Return on Equity = Net Income / Shareholders' Equity (as percentage)"
    )
    roa: Optional[float] = Field(
        None,
        description="Return on Assets = Net Income / Total Assets (as percentage)"
    )
    current_ratio: Optional[float] = Field(
        None,
        description="Current Ratio = Current Assets / Current Liabilities (liquidity measure)"
    )
    debt_to_equity: Optional[float] = Field(
        None,
        description="Debt-to-Equity Ratio = Total Debt / Total Equity (leverage measure)"
    )
    profit_margin: Optional[float] = Field(
        None,
        description="Net Profit Margin = Net Income / Revenue (as percentage)"
    )
    gross_margin: Optional[float] = Field(
        None,
        description="Gross Margin = Gross Profit / Revenue (as percentage)"
    )
    revenue_growth: Optional[float] = Field(
        None,
        description="Revenue growth rate year-over-year (as percentage)"
    )
    pe_ratio: Optional[float] = Field(
        None,
        description="Price-to-Earnings ratio if mentioned in the document"
    )


class FinancialDocument(BaseModel):
    doc_type: str = Field(
        description="Type of financial document: 'annual_report', '10-K', 'earnings_release', "
                    "'balance_sheet', 'income_statement', 'cash_flow_statement', 'prospectus', or 'other'"
    )
    company_name: str = Field(
        description="Full legal name of the company that issued this document"
    )
    fiscal_year: Optional[int] = Field(
        None,
        description="Fiscal year the document covers (4-digit year, e.g., 2024). "
                    "If document covers multiple years, use the most recent reporting year."
    )
    fiscal_period: Optional[str] = Field(
        None,
        description="Fiscal period: 'FY' for full year, 'Q1'/'Q2'/'Q3'/'Q4' for quarters, "
                    "'H1'/'H2' for half-year"
    )
    currency: str = Field(
        description="ISO 4217 currency code for all monetary values in this document "
                    "(e.g., 'USD', 'EUR', 'GBP', 'PKR', 'INR')"
    )
    reporting_date: Optional[str] = Field(
        None,
        description="Date of the balance sheet or reporting period end date (YYYY-MM-DD format)"
    )
    income_statement: Optional[IncomeStatement] = Field(
        None,
        description="Income statement (profit & loss) data. Extract even if only partial data is available."
    )
    balance_sheet: Optional[BalanceSheet] = Field(
        None,
        description="Balance sheet (statement of financial position) data."
    )
    cash_flow: Optional[CashFlowStatement] = Field(
        None,
        description="Cash flow statement data."
    )
    key_metrics: Optional[KeyMetrics] = Field(
        None,
        description="Key financial ratios and metrics, whether stated explicitly or calculable "
                    "from other extracted values."
    )
    red_flags: list[str] = Field(
        default_factory=list,
        description="List of financial red flags or risks identified in the document. "
                    "Examples: 'Going concern doubt mentioned by auditor', "
                    "'Net losses for 3 consecutive years', "
                    "'Debt-to-equity ratio exceeds 3x', "
                    "'Revenue declined YoY', "
                    "'Negative free cash flow'. "
                    "Leave empty list if no red flags found."
    )
    auditor_opinion: Optional[str] = Field(
        None,
        description="Auditor's opinion from independent auditor's report. "
                    "One of: 'Unqualified/Clean', 'Qualified', 'Adverse', "
                    "'Disclaimer of Opinion', 'Not Present' (if no audit report found)"
    )
```

---

## 4. ADE extract() Usage

```python
# document_processor.py — how extract() is called
from landingai_ade import AsyncLandingAIADE, DefaultAioHttpClient
from landingai_ade.lib import pydantic_to_json_schema
from schemas import FinancialDocument

async def extract_financial_data(markdown: str) -> dict:
    """Extract structured financial data from ADE-parsed markdown."""
    async with AsyncLandingAIADE(http_client=DefaultAioHttpClient()) as client:
        extract_response = await client.extract(
            schema=pydantic_to_json_schema(FinancialDocument),
            markdown=markdown
        )

    # extract_response contains the extracted data conforming to FinancialDocument schema
    # Note: extract() does NOT include bboxes directly.
    # Bboxes come from the parse_response.grounding dict,
    # keyed by chunk_id that ADE returns alongside the extracted value.

    return extract_response.model_dump()
```

**Important:** ADE's `extract()` takes the markdown from `parse_jobs` and a JSON schema. It returns extracted field values. To link extracted values back to their source locations (for grounding/citation), use the `chunk_id` returned alongside each extracted value and look it up in the parse response's `grounding` dictionary.

---

## 5. Schema-to-UI Mapping (Extract Tab)

The Extract panel displays the `FinancialDocument` result in organized sections:

### Section: Document Info
| Field | Label | Format |
|-------|-------|--------|
| `doc_type` | Document Type | Badge (annual_report, 10-K, etc.) |
| `company_name` | Company | Text |
| `fiscal_year` | Fiscal Year | Integer |
| `fiscal_period` | Period | Text (FY, Q1, etc.) |
| `currency` | Currency | ISO code badge |
| `reporting_date` | Report Date | Date string |

### Section: Income Statement
| Field | Label | Format |
|-------|-------|--------|
| `income_statement.revenue` | Total Revenue | Currency formatted |
| `income_statement.gross_profit` | Gross Profit | Currency formatted |
| `income_statement.operating_income` | Operating Income | Currency formatted |
| `income_statement.net_income` | Net Income | Currency formatted + color (green if positive, red if negative) |
| `income_statement.ebitda` | EBITDA | Currency formatted |
| `income_statement.eps` | EPS | Decimal with 2 places |
| `income_statement.revenue_yoy_growth` | Revenue YoY Growth | Percentage + directional arrow |

### Section: Balance Sheet
| Field | Label | Format |
|-------|-------|--------|
| `balance_sheet.total_assets` | Total Assets | Currency formatted |
| `balance_sheet.total_liabilities` | Total Liabilities | Currency formatted |
| `balance_sheet.equity` | Shareholders' Equity | Currency formatted |
| `balance_sheet.cash` | Cash & Equivalents | Currency formatted |
| `balance_sheet.debt` | Total Debt | Currency formatted |
| `balance_sheet.current_assets` | Current Assets | Currency formatted |
| `balance_sheet.current_liabilities` | Current Liabilities | Currency formatted |

### Section: Cash Flow
| Field | Label | Format |
|-------|-------|--------|
| `cash_flow.operating` | Operating Cash Flow | Currency formatted |
| `cash_flow.investing` | Investing Cash Flow | Currency formatted |
| `cash_flow.financing` | Financing Cash Flow | Currency formatted |
| `cash_flow.free_cash_flow` | Free Cash Flow | Currency formatted + color |
| `cash_flow.capital_expenditures` | CapEx | Currency formatted |

### Section: Key Metrics
| Field | Label | Format |
|-------|-------|--------|
| `key_metrics.roe` | Return on Equity (ROE) | Percentage |
| `key_metrics.roa` | Return on Assets (ROA) | Percentage |
| `key_metrics.current_ratio` | Current Ratio | Decimal (e.g., 2.1x) |
| `key_metrics.debt_to_equity` | Debt-to-Equity | Decimal (e.g., 1.5x) |
| `key_metrics.profit_margin` | Net Profit Margin | Percentage |
| `key_metrics.gross_margin` | Gross Margin | Percentage |
| `key_metrics.revenue_growth` | Revenue Growth | Percentage |
| `key_metrics.pe_ratio` | P/E Ratio | Decimal |

### Section: Risk & Audit
| Field | Label | Format |
|-------|-------|--------|
| `red_flags` | Red Flags | Bulleted list, each item as amber warning badge |
| `auditor_opinion` | Auditor Opinion | Colored badge: green=Clean, amber=Qualified, red=Adverse/Disclaimer |

---

## 6. Currency Formatting

Display helper used in the Extract panel:

```typescript
// lib/format.ts
export function formatCurrency(value: number | null, currency: string): string {
  if (value === null || value === undefined) return "—";

  // Scale large numbers
  const abs = Math.abs(value);
  let formatted: string;
  let suffix = "";

  if (abs >= 1_000_000_000_000) {
    formatted = (value / 1_000_000_000_000).toFixed(2);
    suffix = "T";
  } else if (abs >= 1_000_000_000) {
    formatted = (value / 1_000_000_000).toFixed(2);
    suffix = "B";
  } else if (abs >= 1_000_000) {
    formatted = (value / 1_000_000).toFixed(2);
    suffix = "M";
  } else if (abs >= 1_000) {
    formatted = (value / 1_000).toFixed(1);
    suffix = "K";
  } else {
    formatted = value.toFixed(2);
  }

  return `${currency} ${formatted}${suffix}`;
}

export function formatPercentage(value: number | null): string {
  if (value === null || value === undefined) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}
```

---

## 7. Grounding Resolution for Extract Fields

When ADE `extract()` returns a field value, it also returns a `chunk_id` indicating which parsed chunk the value was sourced from. This enables clicking a field in the Extract panel to jump to the source location in the PDF viewer.

```python
# Backend: process extract response to add grounding info per field
def enrich_extract_with_grounding(extract_result: dict, grounding_dict: dict) -> dict:
    """
    ADE extract() returns each field alongside a source chunk_id.
    Map chunk_id → bbox via parse_response.grounding.
    The enriched result allows frontend to highlight the source cell.
    """
    # extract_result structure from ADE:
    # {
    #   "doc_type": {"value": "annual_report", "chunk_id": "uuid-1"},
    #   "company_name": {"value": "Acme Corp", "chunk_id": "uuid-2"},
    #   "income_statement": {
    #     "revenue": {"value": 5000000, "chunk_id": "uuid-3"},
    #     ...
    #   }
    # }

    # For each field with chunk_id, look up grounding dict:
    # grounding_dict["uuid-3"] → {page: 2, box: {left:0.1, top:0.3, right:0.9, bottom:0.45}}

    # Return enriched result:
    # {field_path: {value, chunk_id, page, box}}
    pass  # Full implementation in document_processor.py
```

---

## 8. API Response Schema for Extract Endpoint

```python
# schemas.py — API response models
class ExtractedField(BaseModel):
    value: Optional[Any] = None
    chunk_id: Optional[str] = None  # ADE element ID for grounding
    page: Optional[int] = None
    bbox: Optional[dict] = None  # {left, top, right, bottom} normalized 0-1

class ExtractResponse(BaseModel):
    doc_id: str
    document_info: dict[str, ExtractedField]
    income_statement: dict[str, ExtractedField]
    balance_sheet: dict[str, ExtractedField]
    cash_flow: dict[str, ExtractedField]
    key_metrics: dict[str, ExtractedField]
    red_flags: list[str]
    auditor_opinion: Optional[str]
    extracted_at: str  # ISO timestamp
```
