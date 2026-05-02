# Chat Section & Visual Reference — Complete Design
> Date: 2026-03-15
> Scope: End-to-end chat pipeline from user question to highlighted PDF cell

---

## 1. Overview

The Chat tab lets users ask questions about uploaded financial documents. The system:
1. Answers using the document content (RAG or full-context)
2. Highlights the **exact cell(s)** in the PDF that contain the answer value

This doc covers the complete data flow, the visual reference algorithm, and every edge case.

---

## 2. End-to-End Data Flow

```
USER types: "What were Total foreign currency assets in 2018?"
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND: ChatPanel.tsx                                      │
│  POST /api/documents/{doc_id}/chat                           │
│  Body: { message, history[] }                                 │
└──────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│  BACKEND: chat_document() — SSE streaming endpoint            │
│                                                               │
│  ┌─ Phase A: Prepare ────────────────────────────────────┐   │
│  │  1. Fetch grounding dict from DB                       │   │
│  │     { "0-5": {page:0, type:"tableCell", bbox:{...}} }  │   │
│  │                                                        │   │
│  │  2. Download processed.json from Storage               │   │
│  │     { markdown: "full doc text", grounding: {...} }    │   │
│  │                                                        │   │
│  │  3. Fetch ALL Qdrant chunks for this doc               │   │
│  │     [{chunk_id, chunk_type, section_header,            │   │
│  │       page, markdown, bbox}, ...]                      │   │
│  │                                                        │   │
│  │  4. Build context (full-doc or RAG):                   │   │
│  │     Small doc (<30k tokens) → full markdown with IDs   │   │
│  │     Large doc → embed query → Qdrant top-10 → context  │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─ Phase B: LLM Stream ─────────────────────────────────┐   │
│  │  5. System prompt + context + question → GPT-4o-mini   │   │
│  │  6. Stream tokens via SSE: {"type":"delta","text":"…"} │   │
│  │  7. Extract [[cell_id]] citations, strip from output   │   │
│  │  8. Collect full_answer text                           │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─ Phase C: Visual Reference Resolution ─────────────────┐  │
│  │  9.  Analyze question → qualifiers + section hint      │  │
│  │  10. Build cell_lookup (HTML or plain-text path)       │  │
│  │  11. Build cell_section_map                            │  │
│  │  12. Match answer values → cell IDs (scoped + gated)   │  │
│  │  13. Emit SSE: {"type":"sources","chunks":[...]}       │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  14. Emit SSE: {"type":"done"}                               │
└──────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND: ChatPanel.tsx                                      │
│                                                               │
│  15. resolveChips(answerText, sources[])                      │
│      → max 4 chips, each with cellId for bbox overlay        │
│                                                               │
│  16. User clicks chip → DocViewer highlights that cell's bbox │
│      on the correct PDF page                                  │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Context Building (Phase A, Step 4)

### 3.1 Full-Context Mode (small docs < 30k tokens)

The entire document markdown is sent to the LLM. ADE markdown contains:

**HTML-table documents** (challans, simple balance sheets):
```
<a id='chunk-uuid-1'></a>
Some paragraph text here.

<table id="0-1">
<tr><td id="0-2">Particulars</td><td id="0-3">2018</td><td id="0-4">2019</td></tr>
<tr><td id="0-5">Revenue</td><td id="0-6">500,000</td><td id="0-7">650,000</td></tr>
</table>
```

`_build_full_context()` converts this to:
```
[chunk-uuid-1] Some paragraph text here.

[Table 0-1]
| Particulars [0-2] | 2018 [0-3] | 2019 [0-4] |
| Revenue [0-5] | 500,000 [0-6] | 650,000 [0-7] |
```

**Plain-text documents** (complex PDFs like IMF central bank):
ADE returns markdown with NO `<td>` tags — just plain text tables:
```
Cash and cash equivalents  3.1  19,671,825  19,067,867
Total assets               3.2  47,204,137  46,285,988
```

`_build_full_context()` detects no `[id]` markers and rebuilds from Qdrant chunks:
```
=== Statement of Financial Position ===
[chunk-uuid-1] Cash and cash equivalents  3.1  19,671,825  19,067,867
[chunk-uuid-2] Total assets               3.2  47,204,137  46,285,988

=== Statement of Changes in Equity ===
[chunk-uuid-3] Balance as at Jan 1, 2018   800,000  2,000,000
```

This gives the LLM section context and chunk IDs to cite.

### 3.2 RAG Mode (large docs > 30k tokens)

Query is embedded via `text-embedding-3-small` and searched against Qdrant. Top-10 chunks returned, formatted as:
```
[Source chunk-uuid-1, Section: Income Statement, Page 3]
Revenue grew 15% year-over-year to $5.2 billion.

[Table on Page 3]
| Revenue [3-5] | 5,200,000 [3-6] | 4,500,000 [3-7] |
```

---

## 4. Visual Reference Algorithm (Phase C) — The Core

### 4.1 Step 9: Analyze the Question

```python
_analyze_question("What were Total foreign currency assets in 2018?")
→ {
    qualifiers: {"2018"},           # years/numbers FROM the question
    section_hint: None,             # no explicit section mentioned
  }

_analyze_question("Balance in Statement of Changes in Equity?")
→ {
    qualifiers: set(),
    section_hint: "changes in equity",
  }
```

**Rule:** Any number or year that appears IN THE QUESTION is a **filter**, not an answer target. It will never be matched against cells.

### 4.2 Step 10: Build Cell Lookup

Two paths depending on document type:

**Path A — HTML tables:**
```python
_build_cell_text_lookup(full_markdown)
# Scans <td id="0-6">500,000</td> → {"0-6": "500,000", ...}
```

**Path B — Plain-text (no `<td>` tags):**
```python
_build_plaintext_cell_lookup(full_markdown, grounding_dict, qdrant_chunks)
# Cross-references grounding cell bboxes with parsed table text
# Returns: {"0-10": "76,871,204", ...}
```

Plain-text algorithm:
1. Get table-type Qdrant chunks sorted by (page, bbox.top)
2. For each table chunk, parse markdown into rows/columns
3. Find grounding cells (type="tableCell") on same page overlapping chunk bbox
4. Sort cells by (bbox.top, bbox.left) → row-major order
5. Group into rows by bbox.top proximity
6. Align cell rows with text rows (right-aligned for financial tables)
7. Result: same `{cell_id: text}` format as HTML path

### 4.3 Step 11: Build Cell Section Map

```python
_build_cell_section_map(grounding_dict, qdrant_chunks)
# For each grounding cell, find parent Qdrant table chunk via bbox containment
# Returns: {"0-5": "Statement of Financial Position", "5-20": "Statement of Changes in Equity"}
```

### 4.4 Step 12: Match Answer Values to Cells

This is the critical step. The algorithm:

```
INPUT:
  answer_text = "Total foreign currency assets in 2018 were 76,871,204."
  question_qualifiers = {"2018"}
  cell_lookup = {"0-5": "2018", "0-10": "76,871,204", "0-11": "80,000,000", ...}
  cell_section_map = {"0-5": "Financial Position", "0-10": "Financial Position", ...}
  question_text = "What were Total foreign currency assets in 2018?"

STEP A — Extract answer values:
  Raw: ["76,871,204", "2018"]
  After qualifier filter: ["76,871,204"]    ← "2018" removed!

STEP B — Narrow search scope:
  No section_hint in question → search all cells
  (If question had "Statement of Changes in Equity" →
   only search cells where section_map matches "equity")

STEP C — Value match:
  For "76871204":
    Cell "0-10" text "76,871,204" → normalise → "76871204" → EXACT MATCH (score 100)
    Cell "0-5" text "2018" → "2018" ≠ "76871204" → no match
  Result: [("0-10", "76,871,204", 100)]

STEP D — Section scoring:
  If section_hint exists, adjust scores:
    +10 for matching section, -20 for wrong section
  (No section_hint here, so scores unchanged)

STEP E — Confidence gate:
  Drop matches with score < 80
  Keep max 1 match per table instance

STEP F — Fallback (only if zero matches):
  1. LLM-cited [[id]] references
  2. Adjacent cell scan (±1,±2 in same row)
  3. Text chunk IDs
  4. Top-3 RAG results

OUTPUT:
  [("0-10", "76,871,204", 100)]
  → SSE: {"type":"sources","chunks":[{chunk_id:"0-10", chunk_type:"table_cell",
           page:0, bbox:{...}, section_header:"Financial Position",
           markdown:"76,871,204", score:1.0}]}
```

### 4.5 Why Each Step Matters

| Step | What It Prevents |
|------|-----------------|
| Qualifier filter | "2018" column header being highlighted instead of the value |
| Section scope | "800,000" from Balance Sheet being shown when question asks about Equity |
| Confidence gate | Partial numeric matches (e.g., "150" matching "1,500,000") |
| Table-instance dedup | Same value in 3 unrelated tables showing 3 wrong references |
| Fallback chain | Non-numeric questions ("Summarize findings") still getting references |

---

## 5. Frontend Chip Resolution

After backend sends `sources[]`, the frontend `resolveChips()` function:

1. **Separates** table_cell sources (priority) from text sources (fallback)
2. **Direct cell refs** (`chunk_type="table_cell"`, `chunk_id="0-10"`) → use directly as overlay ID
3. **Table chunk refs** → parse HTML, find cell matching answer value
4. **Sorts** by document reading order (page → top → left)
5. **Deduplicates** by resolved cellId
6. **Returns** max 4 chips

Each chip shows: `Page 3.table, cell | 76,871,204`

When clicked → `DocViewer` highlights that cell's bbox on the PDF page.

---

## 6. The Smart Year Rule (Key Design Decision)

**Scenario:** User asks "What was revenue in 2019?"

```
Question: "What was revenue in 2019?"
Answer:   "Revenue in 2019 was 650,000."

Question qualifiers: {"2019"}
Answer values after filtering: ["650,000"]    ← "2019" removed

Cell lookup:
  "0-3": "2019"      ← year header
  "0-7": "650,000"   ← the actual value

Match result: "0-7" (the value cell)
Highlighted on PDF: the cell showing "650,000"
```

**The user already knows it's from 2019 — they asked the question.** The reference should confirm WHAT the value is, not WHEN it's from.

**Edge case — when the answer IS a year:**
```
Question: "When was the company incorporated?"
Answer:   "The company was incorporated in 2015."

Question qualifiers: {}  ← no year in the question!
Answer values: ["2015"]  ← treated as target value

Match result: cell containing "2015" → correctly highlighted
```

---

## 7. Document Type Handling

### 7.1 HTML-Table Documents (Simple)

Examples: School fee challans, basic balance sheets, invoices

**Characteristics:**
- ADE returns `<table id="X"><td id="Y">text</td></table>` markup
- Every cell has an `id` attribute → direct cell_lookup
- Grounding has `type: "tableCell"` for each cell with precise bbox
- Multiple identical tables (4 invoice copies) → 4 chips, one per copy

**Reference flow:** `_build_cell_text_lookup()` → scan `<td>` tags → direct value match

### 7.2 Plain-Text Documents (Complex)

Examples: IMF central bank reports, government financial statements

**Characteristics:**
- ADE returns plain markdown (no `<td>` tags at all)
- Tables rendered as whitespace-aligned text
- Grounding still has `type: "tableCell"` entries with bboxes (ADE detects cells visually)
- But NO cell text mapping exists from markup alone

**Reference flow:** `_build_plaintext_cell_lookup()` → cross-reference grounding bboxes with Qdrant chunk text → reconstruct `{cell_id: text}` → then same value match

### 7.3 Mixed Documents

Some documents have both HTML tables and plain-text sections:
- `_build_cell_text_lookup()` handles the HTML parts
- If it returns empty AND `<td` not found → switch to plain-text path
- Section map works for both via bbox containment

---

## 8. SSE Event Sequence

```
← data: {"type":"delta","text":"Total"}
← data: {"type":"delta","text":" foreign"}
← data: {"type":"delta","text":" currency"}
← data: {"type":"delta","text":" assets in 2018 were 76,871,204."}
← data: {"type":"sources","chunks":[
    {
      "chunk_id": "0-10",
      "chunk_type": "table_cell",
      "page": 0,
      "bbox": {"left":0.65,"top":0.32,"right":0.82,"bottom":0.35},
      "section_header": "Statement of Financial Position",
      "markdown": "76,871,204",
      "score": 1.0
    }
  ]}
← data: {"type":"done"}
```

**Key guarantees:**
- `[[0-10]]` citations are NEVER leaked into delta text — stripped during streaming
- Sources event always comes AFTER all deltas (answer must be complete for value matching)
- Done event is always last

---

## 9. System Prompt

```
You are a financial document analyst. Answer questions based strictly on
the document context provided. Be precise and cite specific figures where
relevant. If the information is not in the context, say so clearly.
Keep responses concise.

When citing information, reference the source element ID in double brackets
like [[element_id]]. For table cell values, cite the cell ID (e.g., [[0-5]]).
For text sections, cite the chunk ID (e.g., [[7d58c5cf-...]]).
Always cite the specific source.

Pay attention to section headers (e.g., 'Statement of Financial Position',
'Statement of Changes in Equity'). Cite elements from the section that
matches the user's question context.
```

---

## 10. Error Handling & Edge Cases

| Scenario | Behavior |
|----------|----------|
| No grounding data in DB | Merge from processed.json cache; if both empty, no references shown |
| processed.json missing | Full-context mode unavailable; fall back to RAG |
| Qdrant empty/unreachable | Error SSE event sent; user sees error message |
| LLM returns no citations | Value matching still works (doesn't depend on LLM citations) |
| Answer has no numeric values | Falls back to LLM-cited chunks → text chunks → RAG top-3 |
| Question has no qualifiers | All answer values searched (no filtering needed) |
| All matches below confidence | No sources returned; chips area empty (better than wrong refs) |
| Very large document | RAG mode; section headers in context help LLM cite correctly |

---

## 11. Performance Considerations

| Operation | Cost | Mitigation |
|-----------|------|-----------|
| Fetch all Qdrant chunks | ~100ms for 500 chunks | Cached per request; only fetched once |
| Download processed.json | ~200ms from Storage | Already downloaded for context building |
| Cell lookup scan | O(cells × values) ≈ O(1000 × 5) | Fast in-memory; no I/O |
| Section map build | O(cells × table_chunks) | Typically < 50 table chunks |
| Value matching | O(scope_cells × answer_values) | Scope narrows to ~100 cells with section hint |

Total overhead for visual reference resolution: **< 50ms** after LLM streaming completes.

---

## 12. Verification Strategy

### 12.1 Unit Tests (`backend/tests/test_visual_references.py`)

26 tests covering:
- Question qualifier extraction (years, numbers)
- Answer value extraction and filtering
- Year filtering in matching (Bug 1 fix)
- Section-aware scoring (Bug 2 fix)
- Duplicate table handling (challan case)
- Confidence gating (no false positives)
- Multiple values in answer
- Fallback chain (LLM citations, adjacent cells, text chunks)
- Section keyword extraction
- Value normalisation

### 12.2 Integration Tests (`backend/tests/test_chat_live.py`)

Direct function-call test that bypasses HTTP auth and runs the full pipeline:

```
python tests/test_chat_live.py                # test all docs
python tests/test_chat_live.py --doc balance   # test balance sheet only
python tests/test_chat_live.py --doc 9781513   # test IMF doc only
```

### 12.3 HTTP Integration Tests (`backend/tests/test_chat_integration.py`)

SSE endpoint test (requires auth token):

```
python tests/test_chat_integration.py --api http://localhost:8001 \
  --token <jwt> --doc-id <doc_id>
```

### 12.4 Verified Results (2026-03-15)

**Balance_Sheet_Example.pdf (HTML tables):** ALL TESTS PASSED
- "What is the total of assets?" → answer "6,858,029", source cell `0-12` score 1.00
- Year qualifier "2018" correctly filtered — not in sources
- All sources score >= 0.90

**9781513563602-mod01.pdf (IMF central bank, plain-text):** 4/5 PASSED
- Plain-text cell lookup built 701 cells from grounding+chunks (no `<td>` tags)
- "Total foreign currency assets in 2018?" → answer "76,871,204", source cell `1-N` score 1.00, year "2018" NOT in sources
- Known issue: section_header not always populated in RAG mode cell_section_map
