# Extract Section — Full Redesign Architecture
> AlphaLens V2 | Date: 2026-03-29
> Author: AI Lead Architect
> Status: APPROVED — Implementation Ready

---

## 1. What This Is

The Extract section must answer one question for every analyst who opens it:

> "Show me everything this document contains — structured, grounded, comparable."

Currently it shows 6 static fields from a narrow corporate schema and goes blank for
any non-corporate document. That is not acceptable.

This document defines the complete redesign: **All-Tables Viewer + Multi-Year
Side-by-Side extraction**, grounded to the PDF, working for every document type.

---

## 2. Honest Current State

| What exists | Problem |
|-------------|---------|
| `ExtractPanel.tsx` with collapsible sections | Only renders when `extract_data` has corporate fields (revenue, net income...) |
| `FinancialDocument` schema in `schemas.py` | Hardcoded to corporate P&L. Blank for central banks, legal, regulatory docs |
| `_build_table_grids()` in `app.py` (Chat) | Already parses multi-year columns — not used by Extract at all |
| `financial_data.json` on disk | Has raw tables with title, header, rows, bbox — completely unused by UI |
| `processed.json` in Storage | Full markdown with all `<table id>` HTML — already cached in `_DOC_CACHE` |
| `extract_data` in Supabase | Stores only the narrow `FinancialDocument.model_dump()` result |
| `/api/documents/{doc_id}/extract` | Returns `doc.get("extract_data") or {}` — one line, no table logic |

**Root cause:** The extract endpoint does zero processing. It just reads a stored blob.
Everything needed to build a rich Extract section already exists in other parts of the system.

---

## 3. Target State

```
┌─────────────────────────────────────────────────────────────────┐
│  EXTRACT TAB                                                      │
│                                                                   │
│  ┌─ Summary Bar (sticky) ──────────────────────────────────────┐ │
│  │  XYZ Corp   FY 2023   PKR   🟢 Unqualified                 │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─ Structured Fields (existing, when available) ──────────────┐ │
│  │  ▼ Income Statement [6 fields]  ▼ Balance Sheet [7 fields]  │ │
│  │  Revenue  142.5M  ████████ 95%  ← click → PDF highlight     │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─ Document Tables (always present) ──────────────────────────┐ │
│  │  ▼ Statement of Financial Position      [Page 4]  [3 years] │ │
│  │  ┌────────────────┬─────────┬─────────┬──────────┬────────┐ │ │
│  │  │                │  2021   │  2022   │  2023    │  Δ%    │ │ │
│  │  ├────────────────┼─────────┼─────────┼──────────┼────────┤ │ │
│  │  │ Cash & Equiv.  │ 12,450  │ 15,820  │ 18,940   │ +19.7% │ │ │
│  │  │ Total Assets   │ 284,100 │ 312,500 │ 341,200  │  +9.2% │ │ │
│  │  └────────────────┴─────────┴─────────┴──────────┴────────┘ │ │
│  │  ▶ Statement of Changes in Equity       [Page 7]  [2 years] │ │
│  │  ▶ Statement of Cash Flows              [Page 9]  [2 years] │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  [⬇ Export JSON]  [⬇ Export CSV]  [⬇ Export Excel]              │
└─────────────────────────────────────────────────────────────────┘
```

**Click any cell → PDF scrolls to that page, bbox highlighted.**
**Click any column header → sorts the table by that column.**
**Hover any value → tooltip shows raw value + unit + source cell ID.**

---

## 4. Architecture

### 4.1 Data Flow

```
User clicks Extract tab
  │
  ▼
ExtractPanel calls GET /api/documents/{doc_id}/extract
  │
  ▼
Backend: get_extract()
  │
  ├─ 1. Read doc from DB → existing extract_data (structured fields)
  │
  ├─ 2. Load processed.json from _DOC_CACHE or Storage
  │       → full_markdown (same cache used by Chat)
  │       → grounding_dict {element_id → {page, bbox, type}}
  │
  ├─ 3. _build_all_tables(full_markdown, grounding_dict)
  │       → List[ExtractTable]
  │       → Each table has: id, title, section, page, bbox,
  │                          col_headers[], rows[], unit_scale
  │
  └─ 4. Return combined response:
          {
            success: true,
            extract: { ...existing structured fields },
            tables: [ ...ExtractTable[] ]
          }
  │
  ▼
Frontend: ExtractPanel renders two zones:
  Zone A — Structured Fields (existing sections, unchanged)
  Zone B — Document Tables (new TableGrid components)
```

### 4.2 Backend: New `_build_all_tables()` Function

Lives in `app.py`. Re-uses `_build_table_grids()` logic from Chat but extends it
for the Extract use case.

**Input:** `full_markdown: str`, `grounding_dict: dict`

**Output:** `list[dict]` — one dict per `<table>` element in the markdown

**Algorithm:**

```
For each <table id="N"> in full_markdown:

  1. Parse header row → col_headers[]
     - Detect year columns: any cell matching \b(19|20)\d{2}\b
     - Detect unit qualifier in table title or first header cell:
         "in thousands" → unit_scale = 1_000
         "in millions"  → unit_scale = 1_000_000
         "in billions"  → unit_scale = 1_000_000_000
         default        → unit_scale = 1

  2. Parse body rows → rows[]
     Each row:
       row_label: first cell text (col 0)
       row_label_id: cell ID from <td id="N-M">
       cells: [
         { col_header, value_raw, value_text, cell_id, page, bbox }
         ...one per non-label column
       ]
       is_group_header: True if all value cells are empty/dash
         (sub-group headers like "Foreign currency assets")

  3. Detect year columns → year_cols[]
     If ≥ 2 year columns exist, compute Δ% between last two years
     for each non-group-header row

  4. Resolve page + bbox for each cell:
     - cell_id format is "N-M" (e.g. "0-15")
     - grounding_dict lookup: grounding_dict.get(cell_id)
     - If not in grounding_dict, fall back to table-level bbox

  5. Resolve section heading for this table:
     Walk markdown backwards from table position to find
     nearest ## or ### heading → section_name

  6. Return:
     {
       table_id:    "0",
       title:       section_name + (table title if different),
       section:     section_name,
       page:        page of first cell,
       bbox:        table-level bbox from grounding_dict,
       col_headers: ["", "2021", "2022", "2023"],
       year_cols:   [1, 2, 3],            ← indices of year columns
       unit_scale:  1000,
       unit_label:  "in thousands",
       rows:        [ ...row dicts ]
     }
```

**Key rule:** This function reads the same `_DOC_CACHE` / `processed.json`
that Chat already loads. Zero extra API calls or storage reads.

### 4.3 Unit Normalization

Detect unit qualifiers from two locations (checked in order):

1. **Table title / section heading** — e.g. "Statement of Financial Position
   (PKR in Thousands)"
2. **First body row** — some documents put "(Amounts in USD millions)" as row 0

Regex patterns:
```python
_UNIT_RE = re.compile(
    r'in\s+(thousands?|000s|millions?|billions?)',
    re.IGNORECASE
)
_UNIT_MAP = {
    "thousand": 1_000, "thousands": 1_000, "000s": 1_000,
    "million":  1_000_000, "millions": 1_000_000,
    "billion":  1_000_000_000, "billions": 1_000_000_000,
}
```

Store `unit_scale` and `unit_label` per table, not per cell.
Frontend shows a toggle: `Raw | ×1K | ×1M` per table.

### 4.4 Multi-Year Delta Calculation

When a table has ≥ 2 year columns (detected via `_YEAR_RE_4`):

```python
def _compute_yoy(row_cells, year_cols):
    """
    Returns Δ% between last two year columns.
    Handles: negative values, zero denominator, non-numeric cells.
    """
    if len(year_cols) < 2:
        return None
    prev_idx = year_cols[-2]
    curr_idx = year_cols[-1]
    prev_val = _parse_numeric(row_cells[prev_idx]["value_text"])
    curr_val = _parse_numeric(row_cells[curr_idx]["value_text"])
    if prev_val is None or curr_val is None:
        return None
    if prev_val == 0:
        return None
    pct = (curr_val - prev_val) / abs(prev_val) * 100
    return round(pct, 1)
```

`_parse_numeric` strips commas, parentheses (negative), currency symbols,
handles `(1,234)` → `-1234`.

---

## 5. API Contract

### `GET /api/documents/{doc_id}/extract`

**Current response:**
```json
{ "success": true, "extract": { ...flat fields } }
```

**New response (backward-compatible — `extract` key unchanged):**
```json
{
  "success": true,
  "extract": {
    "company_name": "State Bank of Pakistan",
    "doc_type": "annual_report",
    "fiscal_year": 2023,
    "currency": "PKR",
    "income_statement": { "revenue": null, ... },
    "_confidence": { ... },
    "_grounding": { ... }
  },
  "tables": [
    {
      "table_id": "0",
      "title": "Statement of Financial Position",
      "section": "Financial Statements",
      "page": 3,
      "bbox": { "left": 0.05, "top": 0.12, "right": 0.95, "bottom": 0.88 },
      "col_headers": ["", "2022", "2023"],
      "year_cols": [1, 2],
      "unit_scale": 1000,
      "unit_label": "PKR in thousands",
      "rows": [
        {
          "row_label": "Cash and cash equivalents",
          "row_label_id": "0-2",
          "is_group_header": false,
          "cells": [
            {
              "col_header": "2022",
              "value_text": "12,450,000",
              "cell_id": "0-3",
              "page": 3,
              "bbox": { "left": 0.45, "top": 0.18, "right": 0.62, "bottom": 0.22 }
            },
            {
              "col_header": "2023",
              "value_text": "18,940,000",
              "cell_id": "0-4",
              "page": 3,
              "bbox": { "left": 0.63, "top": 0.18, "right": 0.80, "bottom": 0.22 }
            }
          ],
          "yoy_delta_pct": 52.1
        },
        {
          "row_label": "Foreign currency assets",
          "row_label_id": "0-6",
          "is_group_header": true,
          "cells": [],
          "yoy_delta_pct": null
        }
      ]
    }
  ]
}
```

**Performance:** `_DOC_CACHE` already holds `processed.json` in memory
after the first Chat or Parse load. Extract endpoint reuses this — no extra
Storage read after warm-up. Cold start adds ~200ms (single Storage read).

---

## 6. Frontend Architecture

### 6.1 Component Tree

```
ExtractPanel (props: { docId, onHighlightChunk })
  │
  ├── SummaryBar (existing — unchanged)
  │
  ├── Zone A: Structured Fields (existing Section cards)
  │     Only rendered when countFields(is|bs|cf|km) > 0
  │     Falls back gracefully for non-corporate docs
  │
  ├── Zone B: DocumentTablesZone (new)
  │     Receives: tables[] from API response
  │     Renders: one TableGrid per table
  │
  │   TableGrid (props: { table, onCellClick, activeCellId })
  │     ├── TableHeader (title + page badge + unit label + year count)
  │     ├── ColHeaderRow (col headers with sort handlers)
  │     ├── TableBody
  │     │     ├── GroupHeaderRow (indented, muted — is_group_header rows)
  │     │     └── DataRow (row_label | cell values | Δ% badge)
  │     │           └── Cell (click → onCellClick(cell_id, page, bbox))
  │     └── TableFooter (unit note if unit_scale > 1)
  │
  └── ExportBar (JSON + CSV + Excel)
```

### 6.2 TableGrid Component Spec

**Props:**
```typescript
interface ExtractTable {
  table_id:    string;
  title:       string;
  section:     string;
  page:        number;
  bbox:        BBox;
  col_headers: string[];
  year_cols:   number[];
  unit_scale:  number;
  unit_label:  string;
  rows:        ExtractRow[];
}

interface ExtractRow {
  row_label:       string;
  row_label_id:    string;
  is_group_header: boolean;
  cells:           ExtractCell[];
  yoy_delta_pct:   number | null;
}

interface ExtractCell {
  col_header:  string;
  value_text:  string;
  cell_id:     string;
  page:        number;
  bbox:        BBox;
}
```

**Behavior:**

- Table starts collapsed if it has > 15 rows. Expanded by default otherwise.
- Clicking a **cell** → calls `onCellClick(cell_id)` → DocViewer scrolls + highlights
- Clicking the **row label** → calls `onCellClick(row_label_id)` → highlights label cell
- Clicking a **column header** → sorts rows by that column (numeric sort, group headers stay in place)
- **Δ% badge:** `+X.X%` in green, `-X.X%` in red. Shown only on year columns.
- **Unit toggle:** button top-right of table: `Raw | ×1K | ×1M`
  - Multiplies displayed value only — `value_text` not modified, tooltip shows raw
- **Active cell:** matches `activeCellId` prop from parent → highlights that cell blue

### 6.3 State in ExtractPanel

```typescript
const [data,          setData]          = useState<ExtractData | null>(null);
const [tables,        setTables]        = useState<ExtractTable[]>([]);
const [loading,       setLoading]       = useState(true);
const [activeCellId,  setActiveCellId]  = useState<string | null>(null);
const [unitOverrides, setUnitOverrides] = useState<Record<string, "raw"|"k"|"m">>({});
```

`activeCellId` is passed to `TableGrid` for visual highlight and also
forwarded to `onHighlightChunk` for the PDF viewer.

### 6.4 Cell Click Flow

```
User clicks cell in TableGrid
  │
  setActiveCellId(cell.cell_id)             ← highlights cell in table
  │
  onHighlightChunk(cell.cell_id, cell.page) ← parent page.tsx
  │
  page.tsx calls setSelectedChunkId(cell_id)
  │
  DocViewer useEffect sees new selectedChunkId
  │
  DocViewer scrolls to page + highlights bbox
```

Same `onHighlightChunk` callback pattern already used by ParsePanel and ExtractPanel
structured rows. No new plumbing needed in `page.tsx`.

---

## 7. Handling the "No Tables" Case

Not every document will have parseable `<table>` HTML. Handle gracefully:

| Condition | UI |
|-----------|-----|
| `tables.length > 0` | Render DocumentTablesZone normally |
| `tables.length === 0` AND `extract` has fields | Render structured fields only — no tables zone |
| `tables.length === 0` AND `extract` is empty | Show empty state: "No structured data found in this document." |
| API error | Error banner + Retry (existing pattern) |

---

## 8. Backend Implementation — Exact Changes

### 8.1 `app.py` — New constants (after existing `_DASH_ONLY_RE`)

```python
_UNIT_RE = re.compile(
    r'in\s+(thousands?|000s|millions?|billions?)',
    re.IGNORECASE
)
_UNIT_MAP = {
    "thousand": 1_000, "thousands": 1_000, "000s": 1_000,
    "million":  1_000_000, "millions":  1_000_000,
    "billion":  1_000_000_000, "billions": 1_000_000_000,
}
_ADE_CELL_ID_RE = re.compile(r'^\d+-\d+$')
```

### 8.2 `app.py` — New `_build_all_tables()` function

Add after `_build_table_grids()`. Takes the same inputs, returns the
`ExtractTable` list for the API response. Reuses `_build_table_grids()`
grid data — does not re-parse tables from scratch.

```python
def _build_all_tables(markdown_text: str, grounding_dict: dict) -> list:
    """
    Build ExtractTable list from all <table> elements in the markdown.
    Used by get_extract() endpoint. Reuses _build_table_grids() internals.
    """
    grids = _build_table_grids(markdown_text)
    result = []

    for table_id, grid in grids.items():
        # ... (detailed implementation in Phase 1)
    return result
```

Full implementation in Phase 1 below.

### 8.3 `app.py` — Updated `get_extract()` endpoint

```python
@app.get("/api/documents/{doc_id}/extract")
async def get_extract(doc_id: str, current_user: dict = Depends(get_current_user)):
    doc = await asyncio.to_thread(db.get_document, doc_id, current_user["id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # ── Existing structured fields (unchanged) ────────────────────────────────
    extract = doc.get("extract_data") or {}

    # ── New: build tables from processed.json ────────────────────────────────
    tables = []
    try:
        markdown, grounding = _get_doc_cache(doc_id)
        if not markdown:
            # Load from Storage (same path as chat_document)
            raw = await asyncio.to_thread(
                storage_client.download_file,
                current_user["id"], doc_id, "processed.json"
            )
            if raw:
                parsed = json.loads(raw)
                markdown   = parsed.get("markdown", "")
                grounding  = parsed.get("grounding", {})
                _set_doc_cache(doc_id, markdown, grounding)

        if markdown:
            tables = _build_all_tables(markdown, grounding or {})
    except Exception as e:
        logger.warning(f"Could not build tables for {doc_id}: {e}")
        # tables stays [] — graceful fallback

    return {"success": True, "extract": extract, "tables": tables}
```

---

## 9. Implementation Phases

### Phase 1 — Backend `_build_all_tables()` (Day 1)

**Goal:** Get the `/extract` endpoint returning `tables[]` with correct structure.

Tasks:
1. Add `_UNIT_RE`, `_UNIT_MAP` constants
2. Write `_parse_numeric(text)` helper (strips commas, parens, currency symbols)
3. Write `_detect_unit_scale(title, first_row_label)` helper
4. Write `_compute_yoy(cells, year_cols)` helper
5. Write `_build_all_tables(markdown, grounding)` using existing `_build_table_grids()` grids
6. Update `get_extract()` to call `_build_all_tables()` and include `tables` in response

**Acceptance criteria:**
- `GET /extract` returns `tables[]` for the IMF Central Bank test document
- Each table has correct `col_headers`, `rows`, `year_cols`, `unit_scale`
- Each cell has correct `cell_id`, `page`, `bbox` from grounding
- YoY Δ% calculated correctly for 2-year tables
- Error in table building does not break the endpoint (graceful fallback)

**Test with curl:**
```
curl http://localhost:8000/api/documents/{doc_id}/extract | jq '.tables[0]'
```

---

### Phase 2 — Frontend `TableGrid` component (Day 2)

**Goal:** Render tables returned from API in ExtractPanel.

Tasks:
1. Add `ExtractTable`, `ExtractRow`, `ExtractCell` TypeScript interfaces to `ExtractPanel.tsx`
2. Build `TableGrid` component (table + collapse/expand + sort + unit toggle)
3. Build `DeltaBadge` sub-component (±% with color)
4. Add `DocumentTablesZone` wrapper that maps `tables[]` → `<TableGrid>` instances
5. Wire `onCellClick` → `onHighlightChunk` prop → `page.tsx` → DocViewer

**Acceptance criteria:**
- All document tables render with correct headers and rows
- Group header rows render indented and muted (no value cells)
- Clicking any value cell highlights the corresponding bbox in the PDF viewer
- YoY Δ% badge shows correct color (green/red)
- Table with > 15 rows starts collapsed
- Empty `tables[]` renders the fallback state cleanly

---

### Phase 3 — Unit Toggle + Sort (Day 3)

**Goal:** Make the tables interactive and analyst-friendly.

Tasks:
1. Add unit toggle button per table (Raw / ×1K / ×1M)
2. Add column sort on header click (numeric sort, group rows pinned in place)
3. Add hover tooltip on cells showing: raw value, unit, source cell ID, page number
4. Update Export CSV to include table data (one sheet per table)

**Acceptance criteria:**
- Unit toggle changes displayed values correctly
- Sorting works numerically (not lexicographic)
- Tooltip appears on hover with raw value
- CSV export includes all tables

---

### Phase 4 — Excel Export (Day 4)

**Goal:** One-click Excel download — the #1 analyst workflow.

**Approach:** Use `xlsx` (SheetJS) in the frontend — no backend change needed.
`npm install xlsx`

**Output:** One `.xlsx` file with:
- Sheet 1: Document Info (company, year, currency, audit)
- Sheet 2+: One sheet per table, preserving column structure
- Column headers bolded, year columns highlighted
- Source page number in a comment on each cell

**Acceptance criteria:**
- Excel file opens correctly in Microsoft Excel and Google Sheets
- Numbers formatted as numbers (not strings)
- Sheet names = table titles (truncated to 31 chars per Excel limit)

---

## 10. What We Are NOT Doing (Scope Boundary)

| Feature | Why deferred |
|---------|-------------|
| Custom field extraction ("extract provisions for loan losses") | Requires new Chat-style AI call — Phase 2 of roadmap |
| Cross-document comparison | Requires multi-doc state architecture — Phase 3 |
| Anomaly / red flag detection | Needs baseline data — Phase 2 |
| Confidence + grounding enrichment in worker | Phase D from original design doc — separate work |
| Narrative extraction | Separate section — not Extract |

These are not forgotten — they are explicitly deferred. The foundation built in
Phases 1-4 above makes all of them straightforward to add later.

---

## 11. Test Plan

| ID | Test | Expected |
|----|------|----------|
| T1 | Load Extract for IMF Central Bank doc | `tables[]` has ≥ 3 tables, each with year columns |
| T2 | Click cell in Statement of Financial Position | PDF viewer scrolls to page 4, cell highlighted |
| T3 | Click row label | Row label cell highlighted in PDF |
| T4 | YoY Δ% for 2-year table | Badge shows correct ±% with correct color |
| T5 | Unit toggle ×1K | Values multiplied by 1000 in display |
| T6 | Column sort | Rows sort numerically, group headers stay anchored |
| T7 | Corporate doc with structured fields | Both Zone A (structured) and Zone B (tables) render |
| T8 | Non-financial doc (legal/certificate) | Zone A empty state + Zone B shows whatever tables ADE found |
| T9 | Doc with no tables | Clean empty state, no crash |
| T10 | Export CSV | File downloads, all tables included, numbers correct |
| T11 | Export Excel | File opens, sheets match tables, numbers formatted |
| T12 | Table with > 15 rows | Starts collapsed, expand works |
| T13 | _DOC_CACHE hit | Second Extract load < 50ms (no Storage read) |
| T14 | Rapid tab switch | No duplicate fetches, no skeleton flash on return |

---

## 12. Files Changed

| File | Change |
|------|--------|
| `backend/app.py` | Add `_UNIT_RE`, `_UNIT_MAP`, `_parse_numeric()`, `_detect_unit_scale()`, `_compute_yoy()`, `_build_all_tables()`. Update `get_extract()`. |
| `frontend/components/analyzer/ExtractPanel.tsx` | Add `ExtractTable`/`ExtractRow`/`ExtractCell` types. Add `TableGrid`, `DeltaBadge`, `DocumentTablesZone` components. Wire `onCellClick`. Update fetch to use `tables` from response. |
| `frontend/app/dashboard/analyzer/page.tsx` | No change needed — `onHighlightChunk` prop already exists and works. |
| `package.json` (frontend) | Add `xlsx` for Excel export (Phase 4 only). |

---

## 13. Definition of Done

- [ ] `GET /extract` returns `tables[]` for every document type
- [ ] Every cell in every table links back to its exact PDF bbox
- [ ] Multi-year tables show YoY Δ% for last two year columns
- [ ] Unit normalization detected and toggleable per table
- [ ] Empty/error/loading states all handled gracefully
- [ ] Export CSV includes table data
- [ ] Export Excel produces valid, correctly formatted file
- [ ] No regression in structured fields (Zone A) for corporate documents
- [ ] TypeScript compiles clean (`npx tsc --noEmit` zero errors)
- [ ] Python syntax valid (`ast.parse` passes)

---

*End of architecture. Implementation starts at Phase 1.*
