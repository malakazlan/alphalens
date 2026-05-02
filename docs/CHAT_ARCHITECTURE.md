# Chat System — Architecture & Design
> AlphaLens V2 | Date: 2026-03-29
> Goal: Document reasoning at FAANG level — accurate, fast, correct visual references.

---

## 1. What This System Is

Users talk to their financial documents. Not keyword search — actual reasoning.

- "What was revenue growth from 2018 to 2019?"
- "Compare operating costs across all three years"
- "Was there a significant change in equity?"

The system answers and highlights the **exact cells** that contain the evidence.

---

## 2. Current State — Honest Assessment

### What works
- Full-context mode sends entire doc to LLM (accurate for small docs)
- Value matching finds the answer cell (e.g. "150,000" → cell 0-7)
- Qualifier filter removes year from question so "2019" column header is not highlighted
- Section scope narrows search when question mentions "income statement" etc.
- Streaming SSE pipeline is correct

### What is missing or wrong

| Gap | Impact |
|-----|--------|
| Only value cell highlighted — no row label or column header | User sees "150,000" chip but not what row it's in or what year |
| `resolveChips()` runs on every streaming delta (DOMParser × 200 calls) | Sluggish UI during streaming |
| Qdrant chunks re-fetched from DB on every chat message | Extra 100-200ms per turn |
| No stream abort when user sends new message | Previous stream runs to completion, wastes tokens |
| Token estimate `len // 4` wrong for numeric/multilingual content | Large docs silently overflow context |
| Citation buffer holds back `[` in normal list text | Micro-stutter on every bulleted answer |

---

## 3. Architecture — Target State

```
┌──────────────────────────────────────────────────────────────────┐
│  FRONTEND                                                         │
│                                                                   │
│  ChatPanel                                                        │
│   ├── Message history (capped at 20 turns in state)              │
│   ├── AbortController per request                                 │
│   ├── useMemo for chip resolution (not inline in render)         │
│   └── Chip: row label | year | value (3 cells per answer)        │
│                                                                   │
│  DocViewer                                                        │
│   └── Highlight: exact cell bbox from grounding                  │
└──────────────────────────────────────────────────────────────────┘
              │  POST /api/documents/{doc_id}/chat
              │  SSE response stream
              ▼
┌──────────────────────────────────────────────────────────────────┐
│  BACKEND — chat_document()                                        │
│                                                                   │
│  Cache layer (in-memory, 10-min TTL):                            │
│   ├── processed.json → (markdown, raw_grounding)                 │
│   └── qdrant chunks  → all_chunks                                │
│                                                                   │
│  Phase A — Context (once per doc, cached)                        │
│   ├── Full-context: entire markdown with [cell_id] inline         │
│   └── RAG fallback: embed query → Qdrant top-10                  │
│                                                                   │
│  Phase B — LLM (gpt-4.1, temp=0.1, max_tokens=2048)             │
│   ├── System prompt: reasoning-focused, cite every figure        │
│   ├── History: last 6 turns (user+assistant content only)        │
│   └── Stream tokens → strip [[id]] citations                     │
│                                                                   │
│  Phase C — Visual Reference Resolution                            │
│   ├── Build table grid (row × col structure per table)           │
│   ├── Match answer values → value cells                          │
│   ├── Walk table grid → find row label + column header           │
│   └── Emit sources: [{value_cell, row_label, col_header}]        │
│                                                                   │
│  SSE events: delta → sources → done                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. The Core Problem — Visual Reference

### Current behavior
Question: "What was sales in 2019?"
Table:
```
             | 2018    | 2019    | 2020    |
| Sales      | 100,000 | 150,000 | 200,000 |
| COGS       | 60,000  | 80,000  | 110,000 |
```

System today returns: **cell `0-8` (150,000)** → 1 chip

### Target behavior
System should return: **3 cells**
- `0-8` — the value (150,000) — primary chip
- `0-5` — the row label (Sales) — context chip
- `0-4` — the column header (2019) — context chip

User clicks chip → PDF highlights that exact cell.

For "What was in 2019 vs 2020?":
- `0-8` (Sales 2019: 150,000)
- `0-5` (Sales row label)
- `0-4` (2019 header)
- `0-9` (Sales 2020: 200,000)

---

## 5. Table Grid Builder — The Key Addition

The existing code matches value cells but has no awareness of table structure. The fix:

### 5.1 `_build_table_grid(markdown_text)` — new function

```python
# Input: full ADE markdown
# Output: {table_id: TableGrid}

@dataclass
class TableGrid:
    table_id: str
    section_name: str | None     # nearest heading above the table, e.g. "Statement of Changes in Equity"
    year_label: str | None       # year extracted from header[0][0] if present, e.g. "2018" or "2019"
    rows: list[list[str]]        # row[i][j] = cell_id at position (i,j)
    header_row: int              # index of the header row (usually 0)
    label_col: int               # index of the label column (usually 0)
    group_header_rows: list[int] # row indexes that are sub-group headers (no value cells, e.g. "Foreign currency financial assets")
```

Algorithm:
1. Walk markdown top-to-bottom; track the most recent heading text (h1/h2/h3 before each `<table>`)
2. Find each `<table id="X">` in markdown
3. For each `<tr>`, collect all `<td id="Y">` in order → one row of cell IDs
4. Detect header row: first row where cells contain years/dates/strings not numbers
5. If header row first cell contains a 4-digit year → store as `year_label` (handles equity statement's "2018"/"2019" tables)
6. Detect label column: leftmost column where cells contain strings not numbers
7. Detect sub-group header rows: rows where ALL value columns (col > label_col) are empty or "–"

### 5.2 `_get_cross_cells(table_grid, value_cell_id)` — new function

```python
# Given a matched value cell, return:
#   - its direct row label
#   - its nearest sub-group header (if the table has sub-groups)
#   - its column header cell ID

def _get_cross_cells(grid: TableGrid, value_cell_id: str) -> dict:
    for ri, row in enumerate(grid.rows):
        for ci, cid in enumerate(row):
            if cid == value_cell_id:
                row_label_id = grid.rows[ri][grid.label_col] if ci != grid.label_col else None
                col_header_id = grid.rows[grid.header_row][ci] if ri != grid.header_row else None
                # Walk upward to find nearest sub-group header row
                group_label_id = None
                for prev_ri in range(ri - 1, -1, -1):
                    if prev_ri in grid.group_header_rows:
                        group_label_id = grid.rows[prev_ri][grid.label_col]
                        break
                return {
                    "row_label_id": row_label_id,
                    "group_label_id": group_label_id,   # e.g. "Foreign currency financial assets"
                    "col_header_id": col_header_id,
                }
    return {"row_label_id": None, "group_label_id": None, "col_header_id": None}
```

**Why `group_label_id` matters:** The Statement of Financial Position has "Cash and cash equivalents" appearing twice — once under "Foreign currency financial assets" and once under "Local currency financial assets." Without the group label, both chips show identical text. With it:
- `Foreign Currency · Cash and Cash Equivalents · 2019 → 19,671,825`
- `Local Currency · Cash and Cash Equivalents · 2019 → 657,756`

### 5.3 Integration into `_find_all_matching_cells`

After finding value cells (existing logic), extend each match:

```python
table_grids = _build_table_grid(full_markdown)

for cell_id, cell_text, score in matched_value_cells:
    # Find which table this cell belongs to
    table_grid = _find_table_for_cell(cell_id, table_grids)
    if table_grid:
        row_label_id, col_header_id = _get_cross_cells(table_grid, cell_id)
    else:
        row_label_id, col_header_id = None, None

    yield {
        "value_cell_id": cell_id,
        "value_text": cell_text,
        "row_label_id": row_label_id,        # new
        "col_header_id": col_header_id,      # new
        "score": score,
    }
```

### 5.4 Source chunk format (extended)

```json
{
  "chunk_id": "0-8",
  "chunk_type": "table_cell",
  "page": 0,
  "bbox": {"left": 0.45, "top": 0.32, "right": 0.62, "bottom": 0.35},
  "markdown": "150,000",
  "score": 1.0,
  "row_label_id": "0-5",
  "group_label_id": "0-2",
  "col_header_id": "0-4",
  "section_name": "Statement of Changes in Equity",
  "year_label": "2019"
}
```

Frontend builds chip label from: `section (if present) · group (if present) · row_label · year_label → value`

---

## 6. Frontend Chip Design — Target

### 6.1 Chip layout

Single table, simple case:
```
┌────────────────────────────────────────────────────┐
│  Sales  ·  2019  →  150,000                       │
└────────────────────────────────────────────────────┘
   row label  col header   value
```

With sub-group (Statement of Financial Position):
```
┌────────────────────────────────────────────────────┐
│  Foreign Currency  ·  Cash & Cash Equiv  ·  2019  →  19,671,825  │
└────────────────────────────────────────────────────────────────────┘
   group label           row label          col header    value
```

Multi-year section (Statement of Changes in Equity — two chips for one answer):
```
┌─────────────────────────────────────────────────────────┐
│  Changes in Equity · 2018 · Total Comprehensive Income → (1,636,205)  │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│  Changes in Equity · 2019 · Total Comprehensive Income → 4,170,953   │
└─────────────────────────────────────────────────────────┘
```

Click → highlights value cell in PDF (primary), row label, group label, and column header get a softer highlight.

### 6.2 resolveChips — moved to useMemo

```tsx
// NOT inline in JSX — runs only when sources change, not on every delta
const chips = useMemo(
  () => resolveChips(msg.content, msg.sources),
  [msg.sources]  // NOT msg.content — sources don't change during streaming
);
```

Sources arrive after streaming ends (single event), so this runs once per answer.

### 6.3 Chip click — triple highlight

When user clicks a chip:
1. `onChunkSelect(value_cell_id)` — primary highlight (full color)
2. If `row_label_id` exists → secondary highlight (dimmer)
3. If `col_header_id` exists → secondary highlight (dimmer)

DocViewer already handles active state per `chunk_id`. Extend to support `secondaryChunkIds: string[]`.

### 6.4 Streaming — abort on new message

```tsx
const abortRef = useRef<AbortController | null>(null);

async function handleSend() {
  // Abort any in-flight request
  abortRef.current?.abort();
  abortRef.current = new AbortController();

  const res = await fetch(url, {
    signal: abortRef.current.signal,
    ...
  });
}
```

---

## 7. Cache Architecture

Two in-memory caches in `app.py`, 10-minute TTL each:

```python
# Already implemented:
_DOC_CACHE: dict[str, tuple[float, str, dict]]
# doc_id → (expires, markdown, grounding)

# To add:
_CHUNK_CACHE: dict[str, tuple[float, list]]
# doc_id → (expires, all_chunks)
```

On first message for a doc:
1. Download processed.json → cache markdown + grounding
2. Fetch Qdrant chunks → cache all_chunks
3. Build table grids → cache table_grids (same TTL)

On subsequent messages: everything served from memory. Zero I/O for context.

Invalidate on document delete (already done via `_DOC_CACHE` eviction).

---

## 8. Behavioral Design — Never Ask, Always Infer

**The core rule: never ask the user to disambiguate. The system must figure it out.**

When a user says "tell me about Statement of Changes in Equity", they don't know the document has two year-tables. They should not have to. The system:

1. Detects "Statement of Changes in Equity" → finds all `TableGrid` entries where `section_name` matches
2. Finds that there are two tables: `year_label="2018"` and `year_label="2019"`
3. Returns data from both, clearly labeled
4. Produces two chip groups — one per year

**Conversation narrows context naturally:**
```
User:  "Tell me about Statement of Changes in Equity"
Bot:   [answers with 2018 and 2019 data, two chip groups]

User:  "What about the Revaluation Reserve?"
Bot:   [still in equity context from history — shows revaluation for both years]

User:  "Just 2019"
Bot:   [history shows user wants 2019 equity — narrows to 2019 table only]
```

Conversation history is already sent to the LLM (last 6 turns). The LLM uses it to understand narrowing intent. No special state machine needed.

**Same value in multiple places → show all, let user decide:**
- "What is Total Comprehensive Income?" when it appears in both Income Statement and Equity Statement → cite both, labeled by section
- "What is Cash and Cash Equivalents?" when it appears twice in Balance Sheet → two chips with group labels distinguishing them

**When truly ambiguous (no section mentioned, value in 5 places):**
- Do NOT ask the user. Include all matches, ordered by relevance (section closest to the question's context in history comes first).

---

## 9. Query Intent → Response Format

The LLM should match depth and format to what was asked:

| Intent | Signal phrases | Response format |
|--------|---------------|-----------------|
| **Direct lookup** | "what is", "what was", "give me" | One value, one sentence, one chip |
| **Comparative** | "compare", "vs", "difference between", "change" | Both values + absolute change + % change, two chips |
| **Trend / period** | "over the years", "across periods", "trend" | All available periods, direction statement |
| **Analytical** | "why", "explain", "what drove", "reason" | Decompose into components, cite all contributing figures |
| **Cross-statement** | "reconcile", "confirm", "match", "consistent with" | Show both sources, state if they agree or flag discrepancy |
| **Section overview** | "tell me about", "summarize", "what is in" | Key figures from the section, all periods |

Updated system prompt:

```
You are a financial document analyst reasoning with a structured financial document.
Your job is to give precise, accurate answers grounded in the document — not generic financial knowledge.

Rules:
1. Answer from the document context only. If information is absent, say so explicitly.
2. Match your response depth to the question:
   - Direct lookup ("what is X"): one value, one sentence.
   - Comparison ("compare X vs Y"): both values, absolute + % change.
   - Analytical ("why did X change"): decompose into contributing line items.
   - Section overview ("tell me about X"): key figures for ALL available periods.
3. Preserve exact values — do not round, abbreviate, or paraphrase numbers.
4. Parenthetical values like (880,843) are negative — treat them as such.
5. Never guess. If a value is not in the context, say "not available in this document."

Citation: cite every figure immediately after with its cell ID in double brackets.
  Table cell: 1,529,797 [[cell-id]]
  Text: stated in the notes [[uuid]]
Do not cite the same ID twice. Cite every unique figure you use.

When a section has multiple year-tables (e.g. Statement of Changes in Equity has 2018 and 2019 tables):
- Include figures from ALL year-tables unless the user specified a single year.
- Label each figure with its year clearly.
```

---

## 10. Edge Cases — Design Decisions

---

### EC-1: Section Heading → Multiple Tables

**Scenario:** "Statement of Changes in Equity" has two `<table>` blocks — one for 2018, one for 2019.

**Detection:** `_build_table_grid()` assigns `section_name` from the nearest preceding heading. Both tables get `section_name = "Statement of Changes in Equity"`. Year is detected from header row first cell ("2018" / "2019").

**Behavior:** When question mentions the section name (or LLM cites cells from both tables), Phase C returns sources from both tables. Frontend renders two chip groups, labeled by year.

---

### EC-2: Duplicate Row Labels in Same Table

**Scenario:** Statement of Financial Position has "Cash and cash equivalents" twice:
- Under "Foreign currency financial assets" → 19,671,825 (2019)
- Under "Local currency financial assets" → 657,756 (2019)

**Detection:** `group_header_rows` identifies rows where all value columns are empty/dash. "Foreign currency financial assets" is such a row.

**Behavior:** Chip includes the group label. User sees two distinct chips, not two identical ones.

---

### EC-3: Same Value Across Multiple Statements

**Scenario:** Total Equity 21,085,228 appears in both Statement of Financial Position and Statement of Changes in Equity (closing balance 2019).

**Behavior:** LLM in full-context mode sees both occurrences with their cell IDs. It cites both `[[cell-A]] [[cell-B]]`. Phase C resolves both → frontend shows two chips, one per statement. This is correct — it tells the user the values reconcile.

**Fallback (no cell ID cited):** Value matcher finds both occurrences. Both are returned as sources, ordered by page.

---

### EC-4: Parenthetical Negative Values

**Scenario:** Values like `(880,843)`, `(1,637,005)` are negative (financial convention).

**Matching normalization:**
```python
def _normalize_value(text: str) -> str:
    # "(880,843)" → "-880843", "880,843" → "880843"
    t = text.strip()
    if t.startswith("(") and t.endswith(")"):
        t = "-" + t[1:-1]
    return re.sub(r"[,\s]", "", t)
```
LLM output `-880,843` or `(880,843)` both match the cell containing `(880,843)`.

---

### EC-5: Dash / Nil Values ("–")

**Scenario:** Many cells contain "–" (not applicable). If the LLM answers "Capital had no contribution to Total Comprehensive Income (–)", there is no numeric value to match.

**Behavior:** When the LLM response contains no matchable figure for a cited `[[cell-id]]`, Phase C resolves the cell directly from the cell ID — no value matching needed. The chip shows the cell's content ("–") with its position context. This still highlights the correct cell in the PDF.

---

### EC-6: Note Column Values

**Scenario:** Statement of Financial Position has a "Note" column (values: 3.1, 3.2, 6, 5, etc.). A user might ask "What does Note 3.1 cover?" — this is a cross-reference to the notes section, not a data value.

**Behavior:** LLM is given full context including note numbers. It answers from the notes section text (which is also in the markdown). The note number cell (3.1) can be highlighted as a source chip alongside the data cell it annotates.

---

## 11. SSE Event Contract

Backend guarantees this sequence, always:

```
data: {"type": "delta", "text": "Sales in 2019 were "}
data: {"type": "delta", "text": "150,000."}
... (N delta events, citations stripped)
data: {"type": "sources", "chunks": [...]}   ← always after all deltas
data: {"type": "done"}                        ← always last
```

On error:
```
data: {"type": "error", "text": "Rate limit reached."}
```
No `sources` or `done` event after error.

---

## 12. Token Budget

Current estimate `len(raw_md) // 4` is wrong for financial documents (numbers, symbols tokenize at 1-2 chars/token).

Fix:
```python
# Use 2 chars/token as safe estimate for mixed financial content
est_tokens = len(raw_md) // 2
_FULL_CONTEXT_TOKEN_LIMIT = 28000  # leave 4K headroom for system + history + answer
```

This correctly classifies docs that were silently overflowing.

---

## 13. Implementation Order

These are the changes needed, in priority order:

| # | Change | File | Impact |
|---|--------|------|--------|
| 1 | `_build_table_grid()` with `section_name`, `year_label`, `group_header_rows` | `app.py` | Full table structure awareness |
| 2 | `_get_cross_cells()` returning `row_label_id`, `group_label_id`, `col_header_id` | `app.py` | Correct chip for sub-grouped tables |
| 3 | Extend source chunk with all label fields + `section_name` + `year_label` | `app.py` | Frontend has complete context |
| 4 | Negative value normalization in matcher (`(880,843)` ↔ `-880,843`) | `app.py` | Correct matching of financial negatives |
| 5 | Nil-value cell resolution — resolve by `cell_id` when no numeric match | `app.py` | "–" cells can still be highlighted |
| 6 | Cache Qdrant chunks (alongside existing doc cache) | `app.py` | Eliminates Qdrant call per turn |
| 7 | Fix token estimate (`// 2`, limit 28K) | `app.py` | Correct context mode decision |
| 8 | Update system prompt with intent-aware rules | `app.py` | Response depth matches question type |
| 9 | `resolveChips` → `useMemo` keyed on `msg.sources` | `ChatPanel.tsx` | No DOMParser thrash during streaming |
| 10 | Chip label: `section · group · row · year → value` | `ChatPanel.tsx` | Full context visible in chip |
| 11 | Chip click → multi-highlight (value + row + group + col header) | `ChatPanel.tsx` + `DocViewer.tsx` | All related cells highlighted |
| 12 | `AbortController` on new message | `ChatPanel.tsx` | Stops abandoned streams |
| 13 | Cap history at 20 messages in state | `ChatPanel.tsx` | Prevents unbounded growth |

---

## 14. What This Does NOT Cover

- WebSocket upgrade (SSE is sufficient, no round-trip latency issue)
- Server-side chat history (stateless is fine, frontend manages history)
- Multi-document chat (out of scope for V2)
- Streaming partial sources (sources require complete answer for value matching)
- OCR fallback (ADE handles this)

---

## 15. Test Suite — `9781513563602-mod01.pdf` (IMF Central Bank Model Statements)

Document structure: Statement of Financial Position (p.6), Statement of Profit or Loss and OCI (p.8), Statement of Changes in Equity — 2018 table + 2019 table (p.10), Statement of Cash Flows (p.12). All figures in thousands of Utopian local currency.

### T1 — Direct Lookup (one value, one chip)
| # | Question | Expected answer | Expected chip |
|---|----------|----------------|---------------|
| 1.1 | "What is Total Assets in 2019?" | 85,098,647 | `Financial Position · Total Assets · 2019` |
| 1.2 | "What was Net Profit for the Year in 2018?" | (1,637,005) — a loss | `P&L · Net Profit for Year · 2018` |
| 1.3 | "What is Cash at end of year in the Cash Flow statement for 2019?" | 20,329,581 | `Cash Flows · Cash Equivalents at End of Year · 2019` |
| 1.4 | "What is Total Equity in 2019?" | 21,085,228 | `Financial Position · Total Equity · 2019` |
| 1.5 | "What was Currency Production Cost in 2019?" | (75,987) | `P&L · Currency Production Cost · 2019` |

### T2 — Comparative (two values, delta, percentage)
| # | Question | Expected |
|---|----------|---------|
| 2.1 | "Compare Total Assets between 2018 and 2019" | 79,909,298 → 85,098,647, +5,189,349 (+6.5%) |
| 2.2 | "How did Net Interest Income change?" | 1,346,609 → 1,529,797, +183,188 (+13.6%) |
| 2.3 | "Compare Total Operating Expenses both years" | (317,909) → (332,377), increase of 14,468 |
| 2.4 | "What changed in Total Equity from 2018 to 2019?" | 18,013,207 → 21,085,228, +3,072,021 |

### T3 — Section with Multiple Year-Tables (hard case, no asking user)
| # | Question | Expected behavior |
|---|----------|------------------|
| 3.1 | "Tell me about Statement of Changes in Equity" | Overview of BOTH 2018 and 2019 tables — capital, movements, closing balance for each year. Two chip groups. |
| 3.2 | "What was Total Comprehensive Income in the equity statement?" | BOTH: 2018 → (1,636,205) and 2019 → 4,170,953. Two chips, labeled by year. |
| 3.3 | "What was Total Comprehensive Income in the equity statement in 2019?" | Only 2019: 4,170,953. One chip. (Year specified → narrows.) |
| 3.4 | "What was the closing balance of Revaluation Reserve in the equity statement?" | BOTH: 2018 → 13,551,032 and 2019 → 16,132,386. |
| 3.5 | "Does the opening 2019 equity balance match the closing 2018 balance?" | Yes — both 18,013,207. Cite cells from both tables. |
| 3.6 | "What was Distribution of Profit to Government in the equity statement?" | BOTH: 2018 → (880,843) and 2019 → (1,098,932). |

### T4 — Duplicate Row Labels (sub-group disambiguation)
| # | Question | Expected behavior |
|---|----------|------------------|
| 4.1 | "What was Cash and Cash Equivalents in 2019?" | TWO chips: `Foreign Currency · Cash & Cash Equiv · 2019 → 19,671,825` and `Local Currency · Cash & Cash Equiv · 2019 → 657,756` |
| 4.2 | "What was Interest Income on local currency assets in 2019?" | 12,552 — chip shows `Local Currency Interest · Interest Income · 2019` |
| 4.3 | "What was Interest Expense on foreign currency liabilities?" | (519,706) for 2019, (539,127) for 2018 |

### T5 — Negative Values (parenthetical convention)
| # | Question | Expected |
|---|----------|---------|
| 5.1 | "What was Distribution of Profit to Government in 2018?" | (880,843) — negative, match parenthetical cell |
| 5.2 | "What is Net Local Currency Income in 2019?" | (237,448) — a loss, not a gain |
| 5.3 | "Was Total Comprehensive Income in 2018 a gain or loss?" | Loss of 1,636,205 (parenthetical in document) |
| 5.4 | "What were interest expenses on foreign currency liabilities in 2019?" | (519,706) |

### T6 — Cross-Statement Reconciliation
| # | Question | Expected behavior |
|---|----------|------------------|
| 6.1 | "Does the closing equity in the equity statement match the balance sheet?" | Both show 21,085,228. System cites both cells, confirms they agree. |
| 6.2 | "What is Total Comprehensive Income and where does it appear?" | Appears in P&L (4,170,954) and Changes in Equity (4,170,953) — note the 1-unit rounding difference. Should flag this. |
| 6.3 | "Confirm Cash at beginning of 2019 from the cash flow statement" | 19,585,920 — which equals Cash at end of 2018 (19,585,920). System confirms. |

### T7 — Analytical / Reasoning
| # | Question | Expected behavior |
|---|----------|------------------|
| 7.1 | "Why did Total Comprehensive Income swing from negative to positive?" | 2018: loss driven by foreign exchange revaluation (2,735,115 loss). 2019: gain driven by FX revaluation (2,905,581 gain). Cites both years' FX lines. |
| 7.2 | "What drove the increase in Total Assets from 2018 to 2019?" | Break down: Foreign currency assets +4,017,624 (mainly deposits decrease but securities increase); Local currency +134,293; Non-financial +37,433. |
| 7.3 | "Explain the movement in Revaluation Reserves in the equity statement" | 2018: 16,286,969 → 13,551,032 (decline of 2,735,937 due to revaluation losses). 2019: 13,551,032 → 16,132,386 (increase of 2,581,354). Cite cells across both tables. |

### T8 — Nil Values ("–") Still Highlight Correct Cell
| # | Question | Expected behavior |
|---|----------|------------------|
| 8.1 | "What was Capital's contribution to Total Comprehensive Income in 2019?" | "–" (no contribution). System highlights the "–" cell in the 2019 equity table. |
| 8.2 | "What was Gold Revaluation for Distribution of Profit in 2018?" | "–". Cell still highlighted. |

### T9 — Not In Document
| # | Question | Expected behavior |
|---|----------|------------------|
| 9.1 | "What was revenue in Q3 2019?" | "Quarterly breakdown not available in this document." No chips. |
| 9.2 | "How many employees does the bank have?" | "Not disclosed in this document." |
| 9.3 | "What is the corporate tax rate?" | "Not specified in this document." |

---

## 16. Definition of Done

The system is complete when ALL of the following pass against `9781513563602-mod01.pdf`:

1. T1.1 — T1.5: direct lookups return correct value with correct chip label
2. T2.1 — T2.4: comparisons return both values + change + % change
3. T3.1 — T3.6: equity statement questions return data from BOTH year-tables without asking the user; when year is specified, correctly narrows
4. T4.1 — T4.3: duplicate row labels produce distinct chips with sub-group labels
5. T5.1 — T5.4: parenthetical negatives are matched correctly and described as losses
6. T6.1 — T6.3: cross-statement reconciliations cite both sources and state whether they agree
7. T7.1 — T7.3: analytical questions decompose into contributing components with all relevant chips
8. T8.1 — T8.2: nil-value cells produce a chip that highlights the correct cell
9. T9.1 — T9.3: out-of-document questions say so clearly, no hallucinated figures
10. Second message while streaming → first stream aborts cleanly
11. Subsequent messages on same doc → zero Qdrant calls (cache hit)
