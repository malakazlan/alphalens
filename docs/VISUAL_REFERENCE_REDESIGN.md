# Visual Reference Pipeline — Redesign Spec
> Status: APPROVED
> Date: 2026-03-15

---

## 1. Problem Statement

The visual reference system highlights the **wrong cells** or gives **extra incorrect references** across document types:

| Bug | Example | Root Cause |
|-----|---------|------------|
| **Year headers matched** | Q: "Total foreign currency assets in 2018?" highlights "2018" column header, not `76,871,204` | Value matcher treats "2018" in the question as a target instead of a filter |
| **Wrong section** | Q about "Statement of Changes in Equity" returns cells from "Statement of Financial Position" | No section awareness — every cell with the same number matches |
| **Extra incorrect refs** | 4 chips shown when only 1 is relevant; cells from unrelated tables | Blind value scan across ALL cells returns too many false positives |
| **Plain-text docs broken** | Complex PDFs (IMF central bank) have zero `<td>` tags — `cell_lookup = {}` | Entire pipeline assumes HTML `<td id="X-Y">` markup |

**Core insight:** Landing.AI's own UI works because it shows **one** reference per answer — the exact cell. We show up to 4 and often pick wrong ones because we scan blindly.

---

## 2. Design Principles

1. **The answer IS the pointer.** The LLM answer contains the value (e.g., `76,871,204`). That value exists in exactly one cell per table instance. Match the value, find the cell.
2. **Question values are filters, not targets.** If the user asks "in 2018", `2018` is context — never highlight it.
3. **Section context narrows the search.** "equity" in the question means only search "Statement of Changes in Equity" tables.
4. **One reference per table instance.** Even if a value appears in 4 identical invoice copies, show 4 chips — one per copy, each pointing to the correct cell in that copy.
5. **Confidence gating.** Don't show a chip unless confidence is high. Showing nothing is better than showing wrong cells.

---

## 3. Architecture: Three-Stage Pipeline

```
┌─────────────────────────────────────────────────────────┐
│                   STAGE 1: CONTEXT                       │
│              (runs BEFORE LLM call)                      │
│                                                          │
│  ┌─────────────────┐  ┌─────────────────────────────┐   │
│  │ Question         │  │ Document Intelligence        │   │
│  │ Analyzer         │  │                              │   │
│  │                  │  │  • cell_lookup: {id: text}   │   │
│  │  • qualifiers:   │  │  • section_map: {id: header} │   │
│  │    {"2018"}      │  │  • table_index:              │   │
│  │  • section_hint: │  │    [{page,bbox,section,      │   │
│  │    "equity"      │  │      cell_ids:[...]}]        │   │
│  └─────────────────┘  └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   STAGE 2: LLM                           │
│              (stream answer + extract citations)         │
│                                                          │
│  • System prompt includes section awareness instruction  │
│  • Stream response, extract [[id]] citations             │
│  • Collect full_answer text for value extraction          │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   STAGE 3: MATCH                         │
│              (runs AFTER LLM response)                   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Step 3a: Extract answer values                   │   │
│  │    "76,871,204" → normalise → "76871204"          │   │
│  │    Filter out question qualifiers (e.g. "2018")   │   │
│  └──────────────────────────────────────────────────┘   │
│                         │                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Step 3b: Narrow search scope                     │   │
│  │    If question mentions a section →               │   │
│  │      only search cells in matching tables         │   │
│  │    Else → search all cells                        │   │
│  └──────────────────────────────────────────────────┘   │
│                         │                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Step 3c: Value match within scope                │   │
│  │    For each answer value:                         │   │
│  │      Find cells where normalise(cell) == value    │   │
│  │      Score: exact=100, contains=90, partial=80    │   │
│  └──────────────────────────────────────────────────┘   │
│                         │                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Step 3d: Confidence gate                         │   │
│  │    Drop any match with score < 80                 │   │
│  │    Drop matches where section conflicts           │   │
│  │    Keep max 1 cell per table instance              │   │
│  └──────────────────────────────────────────────────┘   │
│                         │                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Step 3e: LLM citation fallback                   │   │
│  │    Only if Step 3c found zero matches:            │   │
│  │      Use [[id]] citations from LLM                │   │
│  │      Check adjacent cells for answer values       │   │
│  │      Text chunks as last resort                   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
              Frontend: resolveChips()
              Max 4 chips, 1 per table instance
```

---

## 4. Detailed Algorithm

### 4.1 Question Analyzer (`_analyze_question`)

**Input:** Raw question string
**Output:** `{ qualifiers: set, section_hint: str | None, target_keywords: list }`

```
qualifiers:
  - All 4-digit years: /\b(19|20)\d{2}\b/
  - All numbers 3+ digits in the question
  → These are NEVER matched as answer values

section_hint:
  - Pattern match against known financial section names:
    "statement of financial position" → "financial position"
    "changes in equity" → "equity"
    "cash flow" → "cash flow"
    "income statement" / "profit and loss" → "income"
    "balance sheet" → "balance sheet" / "financial position"
  - Used to narrow cell search scope

target_keywords:
  - Non-qualifier, non-stopword terms from the question
  - E.g., "total foreign currency assets" → ["total", "foreign", "currency", "assets"]
  - Used as tiebreaker when multiple cells match the same value
```

### 4.2 Document Intelligence (built once per chat, cached)

#### 4.2a Cell Text Lookup

**For HTML-table docs** (challans, simple balance sheets):
- Scan all `<td id="X-Y">text</td>` in full markdown
- Returns `{ "0-5": "76,871,204", "0-6": "Rs. 143,990", ... }`

**For plain-text docs** (complex PDFs like IMF):
- No `<td>` tags exist → cell_lookup would be empty
- **Solution:** Cross-reference grounding cells with Qdrant table chunks:
  1. Get all `chunk_type=table` chunks from Qdrant
  2. Get all `type=tableCell` entries from grounding
  3. For each table chunk, find grounding cells on the same page whose bbox overlaps
  4. Parse the chunk's markdown into rows (split on `\n`) and columns (split on `\s{2,}`)
  5. Align grounding cells (sorted by bbox position) with parsed text values
  6. Result: `{ cell_id: "76,871,204", ... }` — same format as HTML path

#### 4.2b Cell Section Map

Map every cell to its parent table's section header:
- For each grounding cell, find the Qdrant table chunk whose bbox contains it
- That chunk's `section_header` field tells us the section
- Result: `{ "0-5": "Statement of Financial Position", ... }`

#### 4.2c Table Instance Index

Group cells by their parent table:
```
[
  { page: 0, bbox: {top: 0.1, ...}, section: "Financial Position",
    cell_ids: ["0-1", "0-2", "0-3", ...] },
  { page: 5, bbox: {top: 0.2, ...}, section: "Changes in Equity",
    cell_ids: ["5-1", "5-2", "5-3", ...] },
]
```
This enables "max 1 match per table instance" deduplication.

### 4.3 Value Matching (the core fix)

```python
def match_answer_to_cells(answer_text, question_analysis, cell_lookup,
                          cell_section_map, table_index):

    # 1. Extract values from answer
    answer_values = extract_values(answer_text)

    # 2. Remove question qualifiers (THE KEY FIX FOR BUG 1)
    answer_values = [v for v in answer_values
                     if normalise(v) not in question_analysis.qualifiers]

    # 3. Determine search scope
    if question_analysis.section_hint:
        # Only search cells in tables matching the section hint
        scope_cells = {cid: text for cid, text in cell_lookup.items()
                       if section_matches(cell_section_map.get(cid, ""),
                                         question_analysis.section_hint)}
    else:
        scope_cells = cell_lookup

    # 4. Find matches
    matches = []
    for value in answer_values:
        norm_val = normalise(value)
        for cell_id, cell_text in scope_cells.items():
            norm_cell = normalise(cell_text)
            if norm_cell == norm_val:
                matches.append((cell_id, cell_text, 100))
            elif len(norm_val) >= 3 and norm_val in norm_cell:
                matches.append((cell_id, cell_text, 90))

    # 5. Deduplicate: keep best match per table instance
    best_per_table = {}
    for cell_id, text, score in matches:
        table_key = find_parent_table(cell_id, table_index)
        if table_key not in best_per_table or score > best_per_table[table_key][2]:
            best_per_table[table_key] = (cell_id, text, score)

    # 6. Confidence gate: only return score >= 80
    result = [(cid, txt, sc) for cid, txt, sc in best_per_table.values()
              if sc >= 80]

    return sorted(result, key=lambda x: (-x[2], page_of(x[0])))
```

**Why this fixes all bugs:**

| Bug | Fix |
|-----|-----|
| Year header "2018" matched | Step 2 removes it — it's in `question_analysis.qualifiers` |
| Wrong section referenced | Step 3 narrows scope to only matching section |
| Extra incorrect refs | Step 5 deduplicates to 1 per table; Step 6 gates on confidence |
| Plain-text docs broken | 4.2a builds cell_lookup from grounding+chunks even without HTML |

### 4.4 Fallback Chain

When value matching finds nothing (e.g., question is "summarize the balance sheet" — no specific value in answer):

1. **LLM-cited chunk IDs** → use `[[id]]` citations extracted during streaming
2. **Adjacent cell scan** → if cited cell is empty, check ±1/±2 cells in same row
3. **Text chunk fallback** → for non-table answers, use the text chunk ID directly
4. **RAG top-3** → absolute last resort, show top Qdrant results

Each fallback has a lower confidence score, and ALL go through the confidence gate.

---

## 5. Full-Context Mode Enhancement for Plain-Text Docs

**Current problem:** `_build_full_context()` produces text with no `[id]` markers for plain-text docs, so the LLM can't cite anything useful.

**Fix:** When no HTML elements are detected, rebuild context from Qdrant chunks with section headers:

```
=== Statement of Financial Position ===
[chunk_id_1] Cash and cash equivalents  3.1  19,671,825  19,067,867
[chunk_id_2] Total assets               47,204,137  46,285,988

=== Statement of Changes in Equity ===
[chunk_id_3] Balance as at Jan 1, 2018   800,000  2,000,000  ...
```

This gives the LLM:
- Section context to reason about
- Chunk IDs to cite in `[[chunk_id]]` format
- Clear table structure for accurate answers

---

## 6. Smart Reference Rule: "2019 value" → highlight value, not year

**Rule:** When the user asks "What was X in 2019?":
- The answer will contain the VALUE (e.g., "76,871,204")
- The answer may also contain "2019" as context
- The visual reference should point to the VALUE CELL, never the year header

**Implementation:**
1. `_extract_question_qualifiers()` collects `{"2019"}` from the question
2. Before value matching, filter: `answer_values = [v for v in answer_values if v not in qualifiers]`
3. "2019" is never searched in cells — only "76,871,204" is matched
4. The matched cell's bbox highlights the value, and the chip label shows "76,871,204"
5. The user implicitly knows it's from 2019 because that's what they asked

**Edge case:** If the answer IS a year (e.g., "When was the company founded?" → "2019"), the year appears in the answer but NOT in the question, so it's correctly treated as a target value and matched.

---

## 7. Files to Modify

| File | What Changes |
|------|-------------|
| `backend/app.py` | Refactor `_find_all_matching_cells()` to use scoped search + confidence gating + table-instance dedup. Add `_analyze_question()`. Fix `_build_plaintext_cell_lookup()`. Enhance `_build_full_context()` for plain-text. |
| `frontend/components/analyzer/ChatPanel.tsx` | No changes needed — `resolveChips()` already handles the backend output correctly. The fixes are all backend-side. |
| `backend/worker.py` | No changes needed — grounding and chunk storage already correct. |

---

## 8. Test Plan

### 8.1 Automated Test Script

Create `backend/tests/test_visual_references.py` — a self-contained test that:
1. Calls `_extract_question_qualifiers()` with known inputs
2. Calls `_find_all_matching_cells()` with mock data simulating both HTML and plain-text docs
3. Verifies correct cell IDs are returned (and incorrect ones are NOT)

### 8.2 Test Cases

```
Test Suite: Visual Reference Accuracy
═══════════════════════════════════════════════════════════

TEST 1: Year qualifier filtering
  Question: "What are Total foreign currency assets in 2018?"
  Answer:   "Total foreign currency assets in 2018 were 76,871,204."
  Cell lookup: {"0-5": "2018", "0-6": "2019", "0-10": "76,871,204", "0-11": "80,000,000"}
  Expected: match "0-10" (value 76,871,204), NOT "0-5" (year 2018)
  Verify:   "2018" is in qualifiers set, filtered before matching

TEST 2: Section-scoped matching
  Question: "Balance as at Dec 31 2019 in Statement of Changes in Equity?"
  Answer:   "The balance was 800,000."
  Cell lookup: {"0-10": "800,000", "5-20": "800,000"}
  Section map: {"0-10": "Statement of Financial Position",
                "5-20": "Statement of Changes in Equity"}
  Expected: match "5-20" only (correct section)
  Verify:   "0-10" is excluded because section doesn't match "equity"

TEST 3: One match per table instance (challan dedup)
  Question: "What is the tuition fee?"
  Answer:   "The tuition fee is Rs. 143,990."
  Cell lookup: {"0-5": "143,990", "0-25": "143,990",
                "0-45": "143,990", "0-65": "143,990"}
  Table index: [
    {table_idx: 0, cell_ids: ["0-5", ...]},
    {table_idx: 1, cell_ids: ["0-25", ...]},
    {table_idx: 2, cell_ids: ["0-45", ...]},
    {table_idx: 3, cell_ids: ["0-65", ...]}
  ]
  Expected: 4 matches (one per table copy), all score 100
  Verify:   exactly 4 results, no duplicates within same table

TEST 4: Plain-text document cell resolution
  Question: "How much are total assets?"
  Answer:   "Total assets were 47,204,137."
  Grounding: {"0-10": {page: 0, type: "tableCell", bbox: {top: 0.3, ...}}}
  Qdrant chunk: {page: 0, chunk_type: "table",
                 markdown: "Total assets  3.2  47,204,137  46,285,988",
                 bbox: {top: 0.25, bottom: 0.5, ...}}
  Expected: cell_lookup built from bbox alignment → "0-10": "47,204,137"
            match returns "0-10"

TEST 5: No match → graceful fallback
  Question: "Summarize the key findings."
  Answer:   "The central bank maintained healthy reserves..."
  Cell lookup: {...} (no numeric values in answer)
  LLM cited: ["chunk-uuid-1"]
  Expected: text chunk "chunk-uuid-1" returned as fallback
  Verify:   no table_cell matches, text chunk used, score 50

TEST 6: Confidence gating — no false positives
  Question: "What is the net income?"
  Answer:   "Net income was 150,000."
  Cell lookup: {"0-5": "150", "0-6": "1,500,000", "0-7": "150,000"}
  Expected: match "0-7" (exact), NOT "0-5" (partial "150")
  Verify:   "0-5" doesn't match because "150" != "150000" and "150" is
            too short for substring match (< 3 after normalising)

TEST 7: Edge case — answer value IS a year
  Question: "When was the company incorporated?"
  Answer:   "The company was incorporated in 2015."
  Cell lookup: {"0-3": "2015", "0-4": "Company Name"}
  Expected: "2015" is NOT in qualifiers (it's not in the question),
            so it IS matched → "0-3" returned

TEST 8: Multiple values in answer
  Question: "Compare revenue in 2018 and 2019."
  Answer:   "Revenue was 500,000 in 2018 and 650,000 in 2019."
  Cell lookup: {"0-10": "500,000", "0-11": "650,000",
                "0-5": "2018", "0-6": "2019"}
  Expected: match "0-10" and "0-11" (values), NOT "0-5" or "0-6" (years)
  Verify:   both years in qualifiers, both filtered

TEST 9: Streaming SSE integrity
  Question: any
  Expected: SSE events arrive in order:
    1. Multiple {"type": "delta"} events (answer tokens)
    2. One {"type": "sources"} event (matched cells)
    3. One {"type": "done"} event
  Verify:   no [[id]] brackets leak into delta text
            sources event contains valid cell IDs with bboxes

TEST 10: RAG mode with section headers
  Question: "What was total equity?" (large doc, > 30k tokens)
  Expected: RAG context includes section headers:
    "[Source chunk-1, Section: Balance Sheet, Page 3] ..."
  Verify:   section_header field populated in source chunks
```

### 8.3 Integration Test Approach

Create `backend/tests/test_chat_references.py` that can run against the live backend:

```python
"""
Integration test for visual references.
Run: python -m pytest backend/tests/test_chat_references.py -v

Requires: running backend + a test document already processed.
Set TEST_DOC_ID and TEST_TOKEN env vars.
"""

# For each test case:
# 1. POST /api/documents/{doc_id}/chat with the test question
# 2. Parse SSE stream → collect answer + sources
# 3. Assert correct cell IDs in sources
# 4. Assert incorrect cell IDs NOT in sources
```

---

## 9. Implementation Order

1. **Refactor `_find_all_matching_cells()`** — add section scoping, table-instance dedup, confidence gate
2. **Fix `_extract_question_qualifiers()`** — already implemented, verify edge cases
3. **Fix `_build_plaintext_cell_lookup()`** — already implemented, verify alignment logic
4. **Build table instance index** — group cells by parent table for dedup
5. **Write unit tests** — `test_visual_references.py` covering all 10 cases
6. **Manual verification** — test with challan doc AND IMF doc

---

## 10. What NOT to Change

- **Frontend `resolveChips()`** — already correct, handles backend output properly
- **Worker pipeline** — grounding storage and chunk enrichment are fine
- **Qdrant schema** — no changes needed
- **SSE streaming** — citation stripping works correctly
- **`_build_cell_text_lookup()`** for HTML docs — this path works for simple docs
