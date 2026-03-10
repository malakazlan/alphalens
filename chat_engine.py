import os
import json
import re
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime

from vector_store import similarity_search
from llm_service import llm_service

try:
    import openai
except ImportError:
    openai = None

MAX_CONTEXT_CHARS = 16000
CITATION_PATTERN = re.compile(r"\[\[([^\]]+)\]\]")
_FULL_CONTEXT_TOKEN_LIMIT = 30000

# In-memory conversation history (in production, use Redis or database)
# Format: {document_id: [{query: str, answer: str, timestamp: str}, ...]}
conversation_history: Dict[str, List[Dict[str, Any]]] = {}


# ═══════════════════════════════════════════════════════════════════
# Full-context builder -- convert ADE markdown to LLM-readable text
# with inline element IDs the LLM can cite as [[id]]
# ═══════════════════════════════════════════════════════════════════

_ANCHOR_RE = re.compile(r"<a\s+id=['\"]([^'\"]+)['\"]\s*/?\s*>\s*</a>", re.IGNORECASE)
_TABLE_OPEN_RE = re.compile(r"<table\s+id=['\"]([^'\"]+)['\"]>", re.IGNORECASE)
_TD_WITH_ID_RE = re.compile(
    r"<td\s+id=['\"]([^'\"]+)['\"](?:\s+colspan=['\"]?\d+['\"]?)?\s*>(.*?)</td>",
    re.DOTALL | re.IGNORECASE,
)
_TR_RE = re.compile(r"<tr>(.*?)</tr>", re.DOTALL | re.IGNORECASE)
_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _build_full_context(financial_data: Dict[str, Any]) -> Optional[str]:
    """Convert ADE markdown into compact LLM-readable text with inline IDs.

    Returns None if markdown is unavailable or exceeds the token limit,
    signalling the caller to fall back to RAG.
    """
    raw_md = (financial_data.get("markdown") or "").strip()
    if not raw_md:
        return None

    est_tokens = len(raw_md) // 4
    if est_tokens > _FULL_CONTEXT_TOKEN_LIMIT:
        return None

    parts: List[str] = []
    pos = 0

    while pos < len(raw_md):
        anchor_m = _ANCHOR_RE.search(raw_md, pos)
        table_m = _TABLE_OPEN_RE.search(raw_md, pos)

        next_pos = len(raw_md)
        if anchor_m:
            next_pos = min(next_pos, anchor_m.start())
        if table_m:
            next_pos = min(next_pos, table_m.start())

        if next_pos == len(raw_md) and not anchor_m and not table_m:
            trailing = _HTML_TAG_RE.sub("", raw_md[pos:]).strip()
            if trailing:
                parts.append(trailing)
            break

        if anchor_m and anchor_m.start() == next_pos:
            between = _HTML_TAG_RE.sub("", raw_md[pos:anchor_m.start()]).strip()
            if between:
                parts.append(between)

            chunk_id = anchor_m.group(1)
            end_of_anchor = anchor_m.end()
            next_element = _ANCHOR_RE.search(raw_md, end_of_anchor)
            next_table = _TABLE_OPEN_RE.search(raw_md, end_of_anchor)

            text_end = len(raw_md)
            if next_element:
                text_end = min(text_end, next_element.start())
            if next_table:
                text_end = min(text_end, next_table.start())

            text_block = _HTML_TAG_RE.sub("", raw_md[end_of_anchor:text_end]).strip()
            if text_block:
                parts.append(f"[{chunk_id}] {text_block}")
            pos = text_end

        elif table_m and table_m.start() == next_pos:
            between = _HTML_TAG_RE.sub("", raw_md[pos:table_m.start()]).strip()
            if between:
                parts.append(between)

            table_id = table_m.group(1)
            table_close_idx = raw_md.find("</table>", table_m.end())
            if table_close_idx == -1:
                table_close_idx = len(raw_md)
            table_html = raw_md[table_m.start():table_close_idx + len("</table>")]

            table_lines = [f"[Table {table_id}]"]
            for tr_m in _TR_RE.finditer(table_html):
                cells = _TD_WITH_ID_RE.findall(tr_m.group(1))
                if not cells:
                    continue
                row_parts = []
                for cell_id, cell_html in cells:
                    cell_text = re.sub(r"<[^>]+>", "", cell_html).strip()
                    if cell_text:
                        row_parts.append(f"{cell_text} [{cell_id}]")
                    else:
                        row_parts.append(f"[{cell_id}]")
                table_lines.append("| " + " | ".join(row_parts) + " |")
            parts.append("\n".join(table_lines))
            pos = table_close_idx + len("</table>")

        else:
            between = _HTML_TAG_RE.sub("", raw_md[pos:next_pos]).strip()
            if between:
                parts.append(between)
            pos = next_pos

    return "\n\n".join(parts)


_CELL_TEXT_FROM_MD_RE = re.compile(
    r"<td\s+id=['\"]([^'\"]+)['\"](?:\s+colspan=['\"]?\d+['\"]?)?\s*>(.*?)</td>",
    re.DOTALL | re.IGNORECASE,
)


def _build_cell_text_lookup(financial_data: Dict[str, Any]) -> Dict[str, str]:
    """Build {cell_id: cell_text} from ADE markdown for citation display."""
    lookup: Dict[str, str] = {}
    raw_md = financial_data.get("markdown", "")
    if not raw_md:
        return lookup
    for cell_id, cell_html in _CELL_TEXT_FROM_MD_RE.findall(raw_md):
        text = re.sub(r"<[^>]+>", "", cell_html).strip()
        if text:
            lookup[cell_id] = text
    return lookup


def _parse_id_citations(
    answer_text: str,
    grounding: Dict[str, Any],
    detected_chunks: List[Dict[str, Any]],
    financial_data: Dict[str, Any] = None,
) -> Tuple[str, List[Dict[str, Any]]]:
    """Extract [[id]] markers from LLM response, map to grounding bboxes.

    Returns (clean_answer, citations) where citations use the same dict
    schema the frontend already expects.
    """
    chunk_lookup: Dict[str, Dict[str, Any]] = {}
    for ch in detected_chunks:
        cid = ch.get("id")
        if cid:
            chunk_lookup[cid] = ch

    cell_text_lookup = _build_cell_text_lookup(financial_data or {})

    citations: List[Dict[str, Any]] = []
    seen: set = set()

    for match in CITATION_PATTERN.findall(answer_text or ""):
        ref_id = match.strip()
        if ref_id in seen:
            continue
        seen.add(ref_id)

        g = grounding.get(ref_id)
        chunk = chunk_lookup.get(ref_id)
        if not g and not chunk:
            continue

        page = g.get("page", 0) if g else (chunk.get("page", 0) if chunk else 0)
        g_type = (g.get("type", "") if g else "").lower()

        if "cell" in g_type or (chunk and chunk.get("type") == "table_cell"):
            type_label = "table, cell"
            chunk_type = "table_cell"
        elif "table" in g_type or (chunk and chunk.get("type") == "table"):
            type_label = "table"
            chunk_type = "table"
        else:
            type_label = "text"
            chunk_type = "text"

        cell_text = ""
        if chunk:
            cell_text = (chunk.get("text") or chunk.get("markdown") or "").strip()
        if not cell_text:
            cell_text = cell_text_lookup.get(ref_id, "")

        page_label = f"Page {page + 1}" if isinstance(page, int) else "Page 1"
        value_part = f" | {cell_text}" if cell_text and len(cell_text) < 80 else ""
        visual_ref = f"{page_label}.\n{type_label}{value_part}"

        citations.append({
            "chunk_id": ref_id,
            "title": type_label,
            "page": page,
            "text": cell_text[:240] if cell_text else "",
            "type": chunk_type,
            "visual_ref": visual_ref,
            "value": cell_text if len(cell_text) < 80 else "",
        })

    clean_text = CITATION_PATTERN.sub("", answer_text or "").strip()
    clean_text = re.sub(r"(\s*,\s*)+", ", ", clean_text)
    clean_text = re.sub(r",\s*\.", ".", clean_text)
    clean_text = re.sub(r",\s*$", ".", clean_text)
    clean_text = re.sub(r"\s+\.", ".", clean_text)
    clean_text = re.sub(r"\s{2,}", " ", clean_text)
    clean_text = clean_text.strip(" ,")
    return clean_text, citations


# ═══════════════════════════════════════════════════════════════════
# Structured table lookup -- direct row search before RAG
# ═══════════════════════════════════════════════════════════════════
_VALUE_LOOKUP_RE = re.compile(
    r"(?:how much|what is|what's|what are|tell me|show me|find|get|what was|give me)"
    r"\s+(?:the\s+|my\s+|a\s+)?(.+?)(?:\?|$)",
    re.IGNORECASE,
)


_YEAR_RE = re.compile(r'\b(19\d{2}|20\d{2})\b')


def _parse_years_from_query(query: str) -> List[str]:
    """Extract all 4-digit years mentioned in a query (e.g. ['2018', '2019'])."""
    return _YEAR_RE.findall(query)


def _is_note_value(val: str) -> bool:
    """Return True if val looks like a Note/reference cell, not a financial amount.

    Notes look like: "11", "3.1", "7.a", "3.4 (a)", "11, 15.2"
    Amounts always contain a comma (thousands separator) or are longer digit strings.
    """
    v = val.strip()
    if not v or ',' in v:
        return False  # comma → thousands separator → real amount
    if len(v) > 15:
        return False  # too long to be a note reference
    return bool(re.match(r'^\d+([.,]\d+)?(\s*[\(\[a-z,;\s\-.\)\]]+)?$', v, re.IGNORECASE))


def _resolve_column_map(header: List[str], rows: List[Dict]) -> Dict[str, str]:
    """Map semantic names → actual column key for any table (real or generic headers).

    Returns dict with entries like:
        {'2019': 'Column 3', '2018': 'Column 4', 'note': 'Column 2'}

    Works for any number of columns and any years that appear in the table.
    """
    col_map: Dict[str, str] = {}
    _YR = re.compile(r'^(19|20)\d{2}$')

    # Case 1: headers are already real year strings (post parse_table_rows fix)
    for col in header:
        if _YR.match(col.strip()):
            col_map[col.strip()] = col

    # Case 2: generic headers (e.g. "Column 1") — inspect first data row
    if not col_map and rows:
        first = rows[0]
        for col in header:
            cell = str(first.get(col, '')).strip()
            if _YR.match(cell):
                col_map[cell] = col          # '2019' → 'Column 3'
            elif cell.lower() in ('note', 'notes') and 'note' not in col_map:
                col_map['note'] = col
            elif _is_note_value(cell) and cell and 'note' not in col_map:
                col_map['note'] = col        # infer note col from a typical note cell value

    return col_map


def _lookup_single_value(
    financial_data: Dict[str, Any],
    metric: str,
    year_str: Optional[str] = None,
) -> Optional[tuple]:
    """Find the best-matching row for *metric* and return its value for *year_str*.

    Returns (value_str, table_id, page, col_key) or None.
    Skips Note-reference columns; prefers the year column when year_str is given.
    Skips the first row of each table when that row is a pseudo-header (contains years).
    """
    metric_lower = metric.lower().strip()
    if not metric_lower:
        return None
    metric_words = set(w for w in metric_lower.split() if len(w) > 2)
    best_score, best = 0, None
    _YR = re.compile(r'^(19|20)\d{2}$')

    for tbl in financial_data.get('tables', []):
        header = tbl.get('header') or []
        rows = tbl.get('rows') or []
        if not header or not rows:
            continue

        col_map = _resolve_column_map(header, rows)
        note_col = col_map.get('note')

        # Skip pseudo-header first row (row that acts as the real header)
        first_vals = [str(v).strip() for v in rows[0].values()]
        data_rows = rows[1:] if any(_YR.match(v) for v in first_vals) else rows

        for row in data_rows:
            label = str(row.get(header[0], '')).strip()
            if not label:
                continue
            label_lower = label.lower()
            label_words = set(w for w in label_lower.split() if len(w) > 2)
            overlap = metric_words & label_words

            if metric_lower in label_lower:
                score = 100
            elif label_lower in metric_lower:
                score = 90
            elif metric_words and len(overlap) >= max(1, len(metric_words) - 1):
                score = 60 + len(overlap) * 10
            else:
                continue

            # Choose value column
            value_col = None
            if year_str and year_str in col_map:
                value_col = col_map[year_str]
            else:
                for col in (header[1:] if header else list(row.keys())[1:]):
                    if col == note_col:
                        continue
                    cell = str(row.get(col, '')).strip()
                    if cell and not _is_note_value(cell) and re.search(r'\d', cell):
                        value_col = col
                        break

            if value_col and score > best_score:
                best_score = score
                best = (
                    str(row.get(value_col, '')).strip(),
                    tbl.get('id', ''),
                    tbl.get('page', 0),
                    value_col,
                )

    return best


def _extract_query_entity(query: str) -> Optional[str]:

    """Pull the entity from a value-lookup question.

    "how much is disciplinary fine?" → "disciplinary fine"
    "what is the tuition fee?"       → "tuition fee"
    """
    m = _VALUE_LOOKUP_RE.search(query)
    if m:
        entity = m.group(1).strip().rstrip("?. ")
        if entity and len(entity) > 1:
            return entity
    return None


# ── Pattern for section/table name mentions in queries ────────────────────────
_SECTION_HINT_RE = re.compile(
    r'(?:in|from|on|within|under|per|according to)\s+'
    r'(?:the\s+)?'
    r'('
    r'statement of (?:changes|financial position|cash flows?|comprehensive income|equity|operations)|'
    r'balance sheet|income statement|profit (?:and|or) loss|'
    r'cash flow statement|statement of equity|statement of operations|'
    r'changes in equity|changes in net assets|'
    r'notes? (?:to|of) (?:the\s+)?(?:financial\s+)?(?:statements?|accounts?)|'
    r'schedule of \w+|table \d+'
    r')',
    re.IGNORECASE,
)

# Keywords that indicate literal "change" section names (not trend intent)
_SECTION_CHANGE_RE = re.compile(
    r'statement of changes|changes in equity|changes in net assets|changes in capital',
    re.IGNORECASE,
)


def _extract_section_hint(query: str) -> Optional[str]:
    """Return the section/table name the user scoped the question to, or None.

    E.g.: "In the Statement of Changes in Equity, what is X?" → "statement of changes in equity"
    """
    m = _SECTION_HINT_RE.search(query)
    if m:
        return m.group(1).strip().lower()
    return None


def _classify_question_type(query: str) -> str:
    """Classify the core question type from the query text.

    Returns one of: 'value', 'comparison', 'reasoning', 'summary', 'definition', 'calculation'.

    Key fix: section names containing "change" (Statement of Changes in Equity)
    do NOT trigger 'trend' — only pure trend-analysis queries do.
    """
    q = query.lower().strip()
    section_hint = _extract_section_hint(query)

    # Summary
    if any(kw in q for kw in ('summarize', 'summary', 'overview', 'what is this document', 'tell me about')):
        return 'summary'

    # Definition — "what is X" with no year and no financial context signals
    has_year = bool(_YEAR_RE.search(query))
    if not has_year and not section_hint:
        if re.search(r'\b(what is|explain|define|meaning of)\b', q) and not re.search(
            r'\b(how much|the value|the amount|total|assets?|liabilities?|income|revenue|expense)\b', q
        ):
            return 'definition'

    # Calculation / sum
    if any(kw in q for kw in ('sum of', 'total of', 'calculate', 'compute', 'average', 'ratio', 'percent')):
        return 'calculation'

    # Comparison / difference
    if any(kw in q for kw in ('compare', 'difference', 'vs ', 'versus', 'contrast', 'between')) and has_year:
        return 'comparison'

    # Reasoning / analytical
    if re.search(r'\b(why|what drove|what caused|analyze|analyse|explain|how did|what led|impact of)\b', q):
        return 'reasoning'

    # Trend — ONLY when there is no section_hint that contains "change/changes"
    trend_kws = ('trend', 'over time', 'year over year', 'yoy', 'increase', 'decrease', 'growth', 'decline')
    if any(kw in q for kw in trend_kws):
        # Don't misclassify "Statement of Changes in Equity" queries as trend
        if not _SECTION_CHANGE_RE.search(query):
            return 'trend'

    # Default: treat as a value lookup
    return 'value'


def _get_document_years(financial_data: Dict[str, Any]) -> set:
    """Return the set of year strings actually present in the document's tables.

    Scans every table's headers and first row to find 4-digit year values.
    """
    years: set = set()
    _YR = re.compile(r'^(19|20)\d{2}$')
    for tbl in financial_data.get('tables', []):
        header = tbl.get('header') or []
        rows = tbl.get('rows') or []
        col_map = _resolve_column_map(header, rows)
        for k in col_map:
            if _YR.match(k):
                years.add(k)
    return years


def structured_table_lookup(
    query: str,
    financial_data: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Search structured tables for an exact entity match.

    Returns a dict with 'answer', 'rows', 'table_id', 'citations' on match,
    or None if no match found.  This is O(rows) and never calls the LLM.
    """
    entity = _extract_query_entity(query)
    if not entity:
        return None

    entity_lower = entity.lower()
    entity_words = set(entity_lower.split())

    best_match = None
    best_score = 0

    for tbl in financial_data.get("tables", []):
        header = tbl.get("header") or []
        rows = tbl.get("rows") or []
        tbl_id = tbl.get("id", "")
        tbl_page = tbl.get("page", 0)

        # Build column map once per table (year → col key, 'note' → col key)
        col_map = _resolve_column_map(header, rows)
        note_col = col_map.get("note")
        query_years = _parse_years_from_query(query)

        # Detect and skip pseudo-header first row (row that contains year values)
        _YR_RE = re.compile(r'^(19|20)\d{2}$')
        first_row_vals = [str(v).strip() for v in (rows[0].values() if rows else [])]
        skip_first = any(_YR_RE.match(v) for v in first_row_vals)

        for row_idx, row in enumerate(rows):
            # Skip pseudo-header row
            if skip_first and row_idx == 0:
                continue

            label = ""
            if header:
                label = str(row.get(header[0], "")).strip()
            else:
                label = str(next(iter(row.values()), "")).strip()
            if not label:
                continue

            label_lower = label.lower()
            label_words = set(label_lower.split())
            overlap = entity_words & label_words

            if entity_lower in label_lower:
                score = 100
            elif label_lower in entity_lower:
                score = 90
            elif len(overlap) >= max(1, len(entity_words) - 1):
                score = 60 + len(overlap) * 10
            else:
                continue

            if score > best_score:
                # --- Year-aware, Note-skipping column selection ---
                value_col = None

                # 1. Prefer the column whose header matches the requested year
                if query_years:
                    for yr in query_years:
                        if yr in col_map:
                            candidate = col_map[yr]
                            cell = str(row.get(candidate, "")).strip()
                            if cell and re.search(r'\d', cell):
                                value_col = candidate
                                break

                # 2. Fall back: first non-Note column that looks like an amount
                if not value_col:
                    for col in (header[1:] if header else list(row.keys())[1:]):
                        if col == note_col:
                            continue
                        cell = str(row.get(col, "")).strip()
                        if cell and not _is_note_value(cell) and re.search(r'\d', cell):
                            value_col = col
                            break

                if value_col:
                    best_score = score
                    best_match = {
                        "label": label,
                        "value": str(row.get(value_col, "")),
                        "column": value_col,
                        "table_id": tbl_id,
                        "table_title": tbl.get("title", "Table"),
                        "page": tbl_page,
                        "row_idx": row_idx,
                        "full_row": row,
                    }

    if not best_match:
        return None

    val = best_match["value"]
    label = best_match["label"]
    col = best_match["column"]
    page = best_match["page"]

    detected_chunks = financial_data.get("detected_chunks", [])
    cell_citations = []
    val_stripped = val.replace(",", "").strip()

    label_lower = label.lower()
    cells_by_table_row: Dict[str, Dict[int, List[Dict]]] = {}
    for chunk in detected_chunks:
        if chunk.get("type") == "table_cell":
            ptid = chunk.get("parent_table_id", "")
            row_idx = chunk.get("row")
            if ptid and row_idx is not None:
                cells_by_table_row.setdefault(ptid, {}).setdefault(row_idx, []).append(chunk)

    for chunk in detected_chunks:
        if chunk.get("type") != "table_cell":
            continue
        cell_text = (chunk.get("text") or "").replace(",", "").strip()
        if cell_text != val_stripped and val not in (chunk.get("text") or ""):
            continue

        ptid = chunk.get("parent_table_id", "")
        row_idx = chunk.get("row")
        siblings = cells_by_table_row.get(ptid, {}).get(row_idx, [])
        row_has_label = any(label_lower in (s.get("text") or "").lower() for s in siblings)
        if not row_has_label:
            continue

        p = chunk.get("page", 0)
        page_label = f"Page {p + 1}" if isinstance(p, int) else "Page 1"
        cell_citations.append({
            "chunk_id": chunk.get("id", ""),
            "title": "table_cell",
            "page": p,
            "text": (chunk.get("text") or "")[:240],
            "type": "table_cell",
            "visual_ref": f"{page_label}.\ntable, cell | {val}",
            "value": val,
        })

    return {
        "answer": val,
        "label": label,
        "column": col,
        "citations": cell_citations,
        "table_id": best_match["table_id"],
        "table_title": best_match["table_title"],
    }


def is_query_relevant_to_document(query: str, financial_data: Dict[str, Any] = None) -> bool:
    """Check if a query is relevant to the document or is a general question."""
    query_lower = query.lower().strip()
    
    # Check for math questions (simple arithmetic)
    math_patterns = [
        r'^\d+\s*[+\-*/]\s*\d+',  # "2+2", "5-3", "10*2", "8/4"
        r'what is \d+\s*[+\-*/]\s*\d+',  # "what is 2+2"
        r'calculate \d+\s*[+\-*/]\s*\d+',  # "calculate 2+2"
        r'^\d+\s*plus\s*\d+',  # "2 plus 2"
        r'^\d+\s*minus\s*\d+',  # "5 minus 3"
        r'^\d+\s*times\s*\d+',  # "2 times 3"
        r'^\d+\s*divided by\s*\d+',  # "10 divided by 2"
    ]
    for pattern in math_patterns:
        if re.search(pattern, query_lower):
            return False
    
    # Check for general knowledge questions unrelated to documents
    general_questions = [
        'what is the capital of',
        'who is the president of',
        'what is the weather',
        'tell me a joke',
        'what time is it',
        'what day is it',
        'who invented',
        'when was',
        'where is',
        'what is the population of',
        'explain quantum physics',
        'what is gravity',
        'how does photosynthesis work',
    ]
    for gq in general_questions:
        if gq in query_lower:
            return False
    
    # Check if query contains document-related keywords
    doc_keywords = [
        'document', 'doc', 'file', 'statement', 'report', 'financial',
        'table', 'section', 'page', 'registrant', 'company', 'amount',
        'revenue', 'income', 'expense', 'asset', 'liability', 'metric',
        'data', 'submission', 'filing', 'commission', 'xbrl'
    ]
    
    # If query has document keywords, it's likely relevant
    if any(keyword in query_lower for keyword in doc_keywords):
        return True
    
    # Check if query asks about specific document content
    content_questions = [
        'what is', 'what are', 'how much', 'how many', 'when', 'where',
        'who', 'which', 'show me', 'find', 'list', 'explain'
    ]
    
    # If it's a question word but no document context, might be general
    if any(qw in query_lower for qw in content_questions):
        # Check similarity with document content
        if financial_data:
            # Check if query terms appear in document metadata or summary
            doc_text = ""
            if financial_data.get("summary"):
                doc_text += financial_data["summary"].lower()
            if financial_data.get("metadata"):
                doc_text += " " + json.dumps(financial_data["metadata"]).lower()
            
            # If query has terms matching document, it's relevant
            query_words = set(query_lower.split())
            doc_words = set(doc_text.split())
            if query_words.intersection(doc_words):
                return True
    
    # Default: assume relevant (let vector search decide)
    return True

def is_financial_term_question(query: str) -> bool:
    """Check if the query is asking for a financial term definition."""
    query_lower = query.lower().strip()
    
    financial_term_patterns = [
        r'what is (an? )?(.*?)(?:mean|meaning|definition|explain)',
        r'explain (.*?)(?:term|concept)',
        r'what does (.*?) mean',
        r'define (.*?)',
        r'what is (.*?)(?:in finance|financial)',
    ]
    
    financial_terms = [
        'revenue', 'income', 'profit', 'loss', 'asset', 'liability', 'equity',
        'cash flow', 'ebitda', 'eps', 'roe', 'roi', 'debt', 'leverage',
        'margin', 'depreciation', 'amortization', 'balance sheet', 'income statement',
        'cash flow statement', 'working capital', 'current ratio', 'quick ratio',
        'debt to equity', 'price to earnings', 'dividend', 'yield', 'volatility',
        'beta', 'alpha', 'hedge', 'derivative', 'option', 'futures', 'swap',
        'bond', 'stock', 'security', 'portfolio', 'diversification', 'risk',
        'return', 'yield', 'maturity', 'coupon', 'principal', 'interest',
        'inflation', 'deflation', 'recession', 'depression', 'gdp', 'cpi',
        'federal reserve', 'monetary policy', 'fiscal policy', 'tax',
        'deduction', 'credit', 'audit', 'compliance', 'gaap', 'ifrs',
        'accrual', 'cash basis', 'amortization', 'depreciation', 'goodwill',
        'intangible', 'tangible', 'liquidity', 'solvency', 'bankruptcy',
        'merger', 'acquisition', 'ipo', 'secondary offering', 'dividend',
        'stock split', 'reverse split', 'buyback', 'dilution', 'warrant',
        'convertible', 'preferred stock', 'common stock', 'treasury stock'
    ]
    
    # Check if query matches financial term patterns
    for pattern in financial_term_patterns:
        match = re.search(pattern, query_lower)
        if match:
            # Extract the first non-empty captured group safely
            groups = match.groups()
            potential_term = ""
            for g in groups:
                if g:
                    potential_term = g.strip()
                    break
            if not potential_term:
                continue
            # Check if it's a known financial term
            if any(term in potential_term.lower() for term in financial_terms):
                return True
    
    # Direct check for "what is [financial term]"
    for term in financial_terms:
        if f'what is {term}' in query_lower or f'explain {term}' in query_lower or f'define {term}' in query_lower:
            return True
    
    return False

def is_math_question(query: str) -> bool:
    """Check if the query is a math question."""
    query_lower = query.lower().strip()
    
    math_patterns = [
        r'^\d+\s*[+\-*/]\s*\d+',  # "2+2", "5-3"
        r'what is \d+\s*[+\-*/]\s*\d+',  # "what is 2+2"
        r'calculate \d+\s*[+\-*/]\s*\d+',  # "calculate 2+2"
        r'^\d+\s*(plus|minus|times|divided by|multiplied by)\s*\d+',  # "2 plus 2"
        r'solve \d+\s*[+\-*/]\s*\d+',  # "solve 2+2"
        r'\d+\s*[+\-*/]\s*\d+\s*=',  # "2+2="
    ]
    
    for pattern in math_patterns:
        if re.search(pattern, query_lower):
            return True
    
    return False


def classify_query_intent(query: str, financial_data: Dict[str, Any] = None) -> str:
    """Classify the intent of a query to determine how to handle it.

    Uses _classify_question_type for the canonical logic; this function maps
    the result to the legacy intent strings expected by the routing code.
    """
    qt = _classify_question_type(query)
    if qt == 'summary':     return 'summary'
    if qt == 'comparison':  return 'comparison'
    if qt == 'calculation': return 'calculation'
    if qt == 'reasoning':   return 'financial_analysis'
    if qt == 'definition':  return 'financial_analysis'
    if qt == 'trend':       return 'trend'
    # Check for section-name queries that look like "comparison" on the old path
    # but should be value lookups (e.g. "Statement of Changes in Equity")
    if _SECTION_CHANGE_RE.search(query):
        return 'financial_analysis'  # don't route to trend
    return 'financial_analysis'


def get_answer_from_document(
    query: str,
    vector_store_path: str,
    financial_data: Dict[str, Any] = None,
    document_id: Optional[str] = None,
    conversation_history_context: Optional[str] = None
) -> Dict[str, Any]:
    """Return a finance-grounded answer plus citation metadata with visual references."""
    if not financial_data:
        financial_data_path = os.path.join(vector_store_path, "financial_data.json")
        if os.path.exists(financial_data_path):
            with open(financial_data_path, "r") as f:
                financial_data = json.load(f)
        else:
            financial_data = {}
    
    query_lower = query.lower().strip()
    intent = classify_query_intent(query, financial_data)

    # Detect preferred answer style/length from the query
    wants_short_answer = any(
        phrase in query_lower
        for phrase in [
            "short answer",
            "short definition",
            "brief definition",
            "briefly",
            "in two lines",
            "in 2 lines",
            "in two sentences",
            "in 2 sentences",
            "one line",
            "1 line",
            "one sentence",
            "1 sentence",
        ]
    )

    target_sentence_count: Optional[int] = None
    if any(p in query_lower for p in ["two lines", "2 lines", "two sentences", "2 sentences"]):
        target_sentence_count = 2
    elif any(p in query_lower for p in ["one line", "1 line", "one sentence", "1 sentence"]):
        target_sentence_count = 1

    # High-level style hint for the LLM layer
    style_hint = "analysis"
    if wants_short_answer and any(kw in query_lower for kw in ["summary", "summarize", "overview"]):
        style_hint = "short_summary"
    elif wants_short_answer or "definition" in query_lower:
        style_hint = "definition"
    
    # Helper to create result dict
    def create_result(answer: str, source: str, sources: List[Dict] = None, follow_ups: List[str] = None) -> Dict[str, Any]:
        result = {
            "answer": answer,
            "sources": sources or [],
            "source": source,
            "intent": intent,
            "follow_up_suggestions": follow_ups or generate_follow_up_suggestions(query, answer, financial_data, intent)
        }
        if document_id:
            save_conversation(document_id, query, answer)
        return result
    
    # Handle greetings immediately (no RAG needed)
    _GREETINGS = {"hi", "hello", "hey", "greetings", "good morning", "good afternoon",
                  "good evening", "howdy", "sup", "yo", "hola"}
    if query_lower.strip("!. ") in _GREETINGS:
        company = (financial_data.get("metadata", {}).get("company_name") or "").strip()
        if company and company not in ("Unknown", "Unknown Company"):
            greeting = f"Hello! I'm ALPHA LENS. I've analyzed the **{company}** document. What would you like to know?"
        else:
            greeting = "Hello! I'm ALPHA LENS, your financial document assistant. Ask me anything about this document."
        return create_result(greeting, "greeting", follow_ups=[
            "What is the summary of this document?",
            "What are the key metrics?",
            "Who is this document for?",
        ])

    # Handle special question types
    if is_math_question(query):
        return create_result(handle_math_question(query), "math_calculator", follow_ups=[])

    # Skip glossary when query is clearly a value lookup (has a year or value-seeking phrasing)
    _value_lookup_re = re.compile(
        r'\b(19\d{2}|20\d{2})\b|how much|what is the value|what was the amount',
        re.IGNORECASE,
    )
    if not _value_lookup_re.search(query) and is_financial_term_question(query):
        return create_result(handle_financial_term_question(query), "financial_glossary")

    if not is_query_relevant_to_document(query, financial_data):
        return create_result(handle_irrelevant_question(query), "general_knowledge", follow_ups=[])
    
    # Handle intent-based analysis
    if intent == 'trend':
        trend_analysis = analyze_financial_trends(financial_data, query)
        if trend_analysis:
            enhanced = llm_service.enhance_trend_analysis(query, trend_analysis, financial_data)
            answer = enhanced or trend_analysis
            return create_result(answer, "trend_analysis", sources=extract_summary_citations(financial_data)[:3])
    
    if intent == 'comparison':
        comparison_result = compare_financial_metrics(financial_data, query)
        if comparison_result:
            enhanced = llm_service.enhance_comparison(query, comparison_result, financial_data)
            answer = enhanced or comparison_result
            return create_result(answer, "comparison_analysis", sources=extract_summary_citations(financial_data)[:3])
    
    # Handle summary requests
    summary_keywords = ["summarize", "summary", "overview", "what is this document", "tell me about this document"]
    has_summary_request = any(kw in query_lower for kw in summary_keywords)
    # If the user asked for a generic summary (no explicit short/line constraint),
    # keep using the existing document-summary path.
    if has_summary_request and not wants_short_answer:
        summary = llm_service.generate_document_summary(financial_data)
        if not summary or len(summary.strip()) < 10:
            summary = _generate_fallback_summary(financial_data)
        return create_result(summary, "gpt-3.5-turbo", sources=extract_summary_citations(financial_data))
    
    # ── Parse structured query metadata (section, years, question type) ─────
    section_hint = _extract_section_hint(query)
    query_years  = _parse_years_from_query(query)
    question_type = _classify_question_type(query)

    # ── Year availability guard ─────────────────────────────────
    # If the user asked for a specific year that is not in the document at all,
    # return a clear "no data" message instead of silently returning the wrong year.
    if query_years:
        doc_years = _get_document_years(financial_data)
        if doc_years and not any(y in doc_years for y in query_years):
            missing = ', '.join(query_years)
            available = ', '.join(sorted(doc_years))
            return create_result(
                f"The document does not contain data for {missing}. "
                f"Available years in this document: {available}.",
                'year_not_found',
            )

    # ── Sum of metric across two years (before Layer 1) ──────────────────────
    if (intent == 'calculation' or 'sum' in query_lower) and len(query_years) == 2:
        sum_result = _sum_metric_two_years(query, financial_data)
        if sum_result:
            return create_result(sum_result['answer'], 'table_sum', sources=sum_result.get('citations', []))

    # ── Layer 1: Confidence-gated structured table lookup (no LLM) ─────────
    # Skip when:
    #   (a) query mentions a section name — LLM handles in-section lookup better
    #   (b) question is reasoning / analytical — needs the full document
    _skip_layer1 = section_hint is not None or question_type in ('reasoning', 'comparison', 'summary')
    if not _skip_layer1:
        table_hit = structured_table_lookup(query, financial_data)
        if table_hit and table_hit.get('answer'):
            # Confidence gate: verify the year column actually matches what was requested
            if query_years:
                col_map = _resolve_column_map(
                    financial_data.get('tables', [{}])[0].get('header', []),
                    financial_data.get('tables', [{}])[0].get('rows', []),
                ) if financial_data.get('tables') else {}
                # If query asked for year Y but we can't verify the column, trust the hit
                # (the lookup already verifies via col_map internally)
                pass
            return create_result(
                table_hit['answer'],
                'structured_table',
                sources=table_hit.get('citations', []),
            )

    # ── Layer 2: Full-context LLM (primary path) ──
    # Feed the entire ADE markdown with inline element IDs to the LLM.
    # The LLM cites [[id]] which we map deterministically to grounding bboxes.
    full_context = _build_full_context(financial_data)
    grounding = financial_data.get("ade_grounding", {})
    detected_chunks = financial_data.get("detected_chunks", [])

    if full_context:
        answer_text = llm_service.generate_full_context_response(
            query=query,
            full_context=full_context,
            financial_data=financial_data,
            conversation_context=conversation_history_context,
        )

        if target_sentence_count and answer_text:
            answer_text = _truncate_to_sentences(answer_text, target_sentence_count)

        if answer_text and not any(
            phrase in answer_text.lower()
            for phrase in ["i cannot find", "does not contain", "not provided"]
        ):
            clean_answer, citations = _parse_id_citations(
                answer_text, grounding, detected_chunks, financial_data
            )
            return create_result(
                clean_answer or answer_text,
                "full_context",
                sources=citations,
            )

    # ── Layer 3: RAG fallback (large docs or missing markdown) ──
    wants_list_format = any(kw in query_lower for kw in ["in bullets", "in bullet points", "as bullets", "in a list", "list"])
    simple_patterns = [r'what is (my|the) (name|date|amount|value|number)', r'who (am i|is)', r'when (is|was)', r'where (is|was)', r'how much']
    is_simple_question = any(re.search(p, query_lower) for p in simple_patterns)

    relevant_chunks = similarity_search(query, vector_store_path, top_k=10)
    context_blocks = build_context_blocks(relevant_chunks, financial_data)

    if len(context_blocks) < 3 and financial_data:
        if financial_data.get("metadata"):
            context_blocks.append({
                "id": "metadata", "title": "Document Metadata", "page": None,
                "source": "metadata", "text": json.dumps(financial_data.get("metadata", {}), indent=2)
            })
        if financial_data.get("key_metrics"):
            metrics_text = "\n".join([f"{m.get('name', '')}: {m.get('value', '')} {m.get('unit', '')}"
                                      for m in financial_data.get("key_metrics", [])[:5]])
            context_blocks.append({
                "id": "key_metrics", "title": "Key Financial Metrics", "page": None,
                "source": "metrics", "text": metrics_text
            })

    if is_simple_question:
        context_blocks = context_blocks[:6]

    answer_text = llm_service.generate_finance_response(
        query=query,
        metadata=financial_data.get("metadata", {}),
        key_metrics=financial_data.get("key_metrics", []),
        context_blocks=context_blocks,
        financial_data=financial_data,
        is_simple_question=is_simple_question,
        wants_list_format=wants_list_format,
        style=style_hint,
        max_sentences=target_sentence_count,
    )
    if target_sentence_count and answer_text:
        answer_text = _truncate_to_sentences(answer_text, target_sentence_count)

    if not answer_text or any(phrase in answer_text.lower() for phrase in ["i'm sorry", "does not contain", "not provided"]):
        fallback_context = build_fallback_context(financial_data, relevant_chunks)
        fallback_answer = llm_service.generate_response(
            query,
            fallback_context,
            financial_data,
            style=style_hint,
            max_sentences=target_sentence_count,
            conversation_context=conversation_history_context,
        )
        if not fallback_answer or any(phrase in fallback_answer.lower() for phrase in ["i'm sorry", "does not contain"]):
            fallback_answer = _generate_answer_from_financial_data(query, financial_data)
        return create_result(fallback_answer, "local_llm", sources=extract_summary_citations(financial_data)[:3])

    clean_answer, citations = extract_citations_with_visual_refs(answer_text, context_blocks, financial_data, query)
    return create_result(clean_answer or answer_text, "rag_fallback", sources=citations)


def build_context_blocks(relevant_chunks: List[Dict[str, Any]], financial_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Convert retrieved chunks into structured context blocks."""
    blocks: List[Dict[str, Any]] = []
    seen_ids = set()
    
    for chunk in relevant_chunks:
        metadata = chunk.get("metadata", {}) or {}
        chunk_id = metadata.get("chunk_id") or chunk.get("id")
        if not chunk_id or chunk_id in seen_ids:
            continue
        text = (chunk.get("text") or "").strip()
        if not text:
            continue
        seen_ids.add(chunk_id)
        blocks.append({
            "id": chunk_id,
            "title": metadata.get("title") or metadata.get("source") or "Context",
            "page": metadata.get("page"),
            "source": metadata.get("source"),
            "text": text[:3000]
        })
    
    if not blocks and financial_data.get("summary"):
        blocks.append({
            "id": "summary",
            "title": "Executive Summary",
            "page": None,
            "source": "summary",
            "text": financial_data["summary"][:2000]
        })
    
    return blocks[:8]


def extract_citations(answer_text: str, context_blocks: List[Dict[str, Any]]) -> (str, List[Dict[str, Any]]):
    """Strip citation markers from the answer and build citation metadata."""
    block_lookup = {block["id"]: block for block in context_blocks}
    citations = []
    seen = set()
    
    for match in CITATION_PATTERN.findall(answer_text or ""):
        if match in seen:
            continue
        block = block_lookup.get(match)
        if block:
            seen.add(match)
            citations.append({
                "chunk_id": match,
                "title": block.get("title"),
                "page": block.get("page"),
                "text": (block.get("text") or "")[:240]
            })
    
    clean_text = CITATION_PATTERN.sub('', answer_text or '').strip()
    clean_text = re.sub(r'\s+', ' ', clean_text)

    # Reconstruct a \"Visual reference for the answer\" block similar to Landing.AI
    # so the frontend can show human-readable references without extra logic.
    if citations:
        visual_lines = ["Visual reference for the answer:"]
        for c in citations:
            label = c.get("visual_ref")
            if label:
                visual_lines.append(label)
        visual_block = "\n".join(visual_lines)
        if clean_text:
            clean_text = f"{clean_text}\n\n{visual_block}"
        else:
            clean_text = visual_block

    return clean_text, citations


def _truncate_to_sentences(text: str, max_sentences: int) -> str:
    """
    Soft guardrail to keep answers brief when the user explicitly requests
    a short answer (e.g., \"in two lines\").
    """
    if max_sentences <= 0 or not text:
        return text
    
    # Simple sentence split – good enough for short answers
    parts = re.split(r'(?<=[.!?])\s+', text.strip())
    if len(parts) <= max_sentences:
        return text.strip()
    truncated = " ".join(parts[:max_sentences]).strip()
    return truncated


def extract_citations_with_visual_refs(
    answer_text: str,
    context_blocks: List[Dict[str, Any]],
    financial_data: Dict[str, Any],
    query: str
) -> tuple:
    """Extract citations with visual references (page, table/cell, value) in Landing.AI format.

    Priority when searching for a value:
        1. table_cell chunks (exact cell bbox) — Landing.AI-quality cell highlight
        2. table chunks (whole table bbox) — fallback
        3. text chunks

    The chunk_id in each citation is used by viewer.js to highlight the matching
    bounding box on the PDF, so pointing at a cell rather than a table draws a
    tight box around exactly that cell.
    """
    block_lookup = {block["id"]: block for block in context_blocks}
    detected_chunks = financial_data.get("detected_chunks", [])

    # Separate lookups for quick access
    chunk_lookup: Dict[str, Any] = {}
    cell_chunks: List[Dict[str, Any]] = []
    for chunk in detected_chunks:
        cid = chunk.get("id")
        if cid:
            chunk_lookup[cid] = chunk
        if chunk.get("type") == "table_cell":
            cell_chunks.append(chunk)

    answer_value = extract_answer_value(answer_text, query)
    citations: List[Dict[str, Any]] = []
    seen: set = set()

    # ── Pass 1: inline [CIT:xxx] markers embedded by LLM ────────────────────
    for match in CITATION_PATTERN.findall(answer_text or ""):
        if match in seen:
            continue
        block = block_lookup.get(match)
        chunk = chunk_lookup.get(match)

        if block or chunk:
            seen.add(match)
            page = chunk.get("page") if chunk else (block.get("page") if block else None)
            chunk_type = chunk.get("type", "text") if chunk else "text"

            if chunk_type == "table_cell":
                type_label = "table, cell"
            elif chunk_type == "table":
                type_label = "table"
            else:
                type_label = "text"

            value = answer_value
            if not value and chunk:
                chunk_text = chunk.get("text", "") or chunk.get("markdown", "")
                value = extract_numeric_value(chunk_text)

            page_label = f"Page {page + 1}" if isinstance(page, int) else "Page 1"
            value_label = f" | {value}" if value else ""
            visual_ref = f"{page_label}.\n{type_label}{value_label}"

            citations.append({
                "chunk_id": match,
                "title": block.get("title") if block else chunk.get("type", "Reference"),
                "page": page,
                "text": (block.get("text") or chunk.get("text", "") or "")[:240] if block or chunk else "",
                "type": chunk_type,
                "visual_ref": visual_ref,
                "value": value,
            })

    # ── Pass 2: value-match fallback (when LLM did not embed markers) ────────
    _MAX_CITATIONS = 8

    if not citations and answer_value:
        value_str = str(answer_value).replace(",", "").strip()
        value_str_no_dec = _strip_trailing_zeros(value_str)

        def _match_value(txt: str) -> bool:
            plain = txt.replace(",", "")
            return (value_str in plain
                    or value_str_no_dec in plain
                    or answer_value in txt)

        def _cell_display_value(chunk: Dict[str, Any]) -> str:
            """Use the cell's own text as the display value (avoids LLM formatting artefacts)."""
            raw = (chunk.get("text", "") or chunk.get("markdown", "")).strip()
            if raw and len(raw) < 60:
                return raw
            return answer_value

        def _make_citation(chunk: Dict[str, Any], ctype: str) -> Dict[str, Any]:
            page = chunk.get("page", 0)
            if ctype == "table_cell":
                tlabel = "table, cell"
            elif ctype == "table":
                tlabel = "table"
            else:
                tlabel = "text"
            page_label = f"Page {page + 1}" if isinstance(page, int) else "Page 1"
            display_val = _cell_display_value(chunk)
            return {
                "chunk_id": chunk.get("id", ""),
                "title": chunk.get("type", "Reference"),
                "page": page,
                "text": (chunk.get("text", "") or chunk.get("markdown", ""))[:240],
                "type": ctype,
                "visual_ref": f"{page_label}.\n{tlabel} | {display_val}",
                "value": display_val,
            }

        # Priority 1: table_cell (exact cell bbox — best precision)
        for cell in cell_chunks:
            if _match_value(cell.get("text", "") or cell.get("markdown", "")):
                citations.append(_make_citation(cell, "table_cell"))
                if len(citations) >= _MAX_CITATIONS:
                    break

        # Priority 2: whole-table chunks
        if not citations:
            for chunk in detected_chunks:
                if chunk.get("type") == "table":
                    if _match_value(chunk.get("text", "") or chunk.get("markdown", "")):
                        citations.append(_make_citation(chunk, "table"))
                        if len(citations) >= _MAX_CITATIONS:
                            break

        # Priority 3: any other chunk type
        if not citations:
            for chunk in detected_chunks:
                ctype = chunk.get("type", "text")
                if ctype in ("table", "table_cell"):
                    continue
                if _match_value(chunk.get("text", "") or chunk.get("markdown", "")):
                    citations.append(_make_citation(chunk, ctype))
                    if len(citations) >= _MAX_CITATIONS:
                        break

    clean_text = CITATION_PATTERN.sub("", answer_text or "").strip()
    clean_text = re.sub(r"\s+", " ", clean_text)
    return clean_text, citations


def _strip_trailing_zeros(val: str) -> str:
    """'143,990.00' → '143,990', '1,200.50' → '1,200.50' (keeps meaningful decimals)."""
    if "." in val:
        stripped = val.rstrip("0").rstrip(".")
        if stripped:
            return stripped
    return val


def extract_answer_value(answer_text: str, query: str) -> str:
    """Extract numeric value from answer text (e.g., "149,990").

    Strips meaningless trailing zeros so the value matches raw cell text
    (LLM says "$143,990.00" but cell text is "143,990").
    """
    number_pattern = r'\d{1,3}(?:,\d{3})*(?:\.\d+)?'
    matches = re.findall(number_pattern, answer_text)
    if matches:
        return _strip_trailing_zeros(matches[0])

    currency_pattern = r'[\$€£¥]\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)'
    currency_matches = re.findall(currency_pattern, answer_text)
    if currency_matches:
        return _strip_trailing_zeros(currency_matches[0])

    return None


def extract_numeric_value(text: str) -> str:
    """Extract the most prominent numeric value from text."""
    if not text:
        return None
    
    # Look for formatted numbers
    number_pattern = r'\d{1,3}(?:,\d{3})+(?:\.\d+)?'
    matches = re.findall(number_pattern, text)
    if matches:
        # Return the largest number
        return max(matches, key=lambda x: float(x.replace(",", "")))
    
    return None


def generate_document_summary(financial_data: Dict[str, Any]) -> str:
    """Generate a summary of the document - DEPRECATED: Use LLM service instead."""
    # This function is kept for backward compatibility but should use LLM service
    parts = []
    
    metadata = financial_data.get("metadata", {})
    if metadata.get("document_type"):
        parts.append(f"This is a {metadata.get('document_type')} document.")
    
    if metadata.get("company_name"):
        parts.append(f"Company: {metadata.get('company_name')}")
    
    if metadata.get("document_date"):
        parts.append(f"Date: {metadata.get('document_date')}")
    
    key_metrics = financial_data.get("key_metrics", [])
    if key_metrics:
        parts.append("Key metrics:")
        for metric in key_metrics[:5]:
            name = metric.get("name", "")
            value = metric.get("value", "")
            if name and value:
                parts.append(f"- {name}: {value}")
    
    tables = financial_data.get("tables", [])
    if tables:
        parts.append(f"The document contains {len(tables)} table(s) with financial data.")
    
    if not parts:
        return "This document has been processed, but no summary information is available yet."
    
    return " ".join(parts)


def extract_summary_citations(financial_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract citations for summary from key document sections."""
    citations = []
    detected_chunks = financial_data.get("detected_chunks", [])
    
    # Get first few key chunks
    for chunk in detected_chunks[:3]:
        page = chunk.get("page", 0)
        chunk_type = chunk.get("type", "text")
        is_table = chunk_type == "table"
        
        page_label = f"Page {page + 1}" if isinstance(page, int) else "Page 1"
        type_label = "table" if is_table else "text"
        
        citations.append({
            "chunk_id": chunk.get("id", ""),
            "title": chunk.get("type", "Reference"),
            "page": page,
            "text": (chunk.get("text", "") or chunk.get("markdown", ""))[:240],
            "type": chunk_type,
            "visual_ref": f"{page_label}. {type_label}",
            "value": None
        })
    
    return citations


def _generate_answer_from_financial_data(query: str, financial_data: Dict[str, Any]) -> str:
    """Generate an answer directly from financial_data when LLM fails."""
    query_lower = query.lower()
    
    # Check what the user is asking about
    if any(word in query_lower for word in ["component", "section", "structure", "what are", "what is"]):
        # Document structure question
        parts = []
        detected_chunks = financial_data.get("detected_chunks", [])
        if detected_chunks:
            chunk_types = {}
            for chunk in detected_chunks:
                chunk_type = chunk.get("type", "text")
                chunk_types[chunk_type] = chunk_types.get(chunk_type, 0) + 1
            
            parts.append(f"This document contains {len(detected_chunks)} detected sections:")
            for chunk_type, count in chunk_types.items():
                parts.append(f"- {chunk_type.title()}: {count} section(s)")
        
        tables = financial_data.get("tables", [])
        if tables:
            parts.append(f"\nThe document includes {len(tables)} table(s):")
            for i, table in enumerate(tables[:5], 1):
                title = table.get("title", f"Table {i}")
                parts.append(f"- {title}")
        
        metadata = financial_data.get("metadata", {})
        if metadata:
            parts.append("\nDocument Information:")
            if metadata.get("document_type"):
                parts.append(f"- Type: {metadata.get('document_type')}")
            if metadata.get("company_name"):
                parts.append(f"- Company: {metadata.get('company_name')}")
            if metadata.get("document_date"):
                parts.append(f"- Date: {metadata.get('document_date')}")
        
        return "\n".join(parts) if parts else "This document has been processed and contains structured financial data."
    
    # Default: provide general document info
    return _generate_fallback_summary(financial_data)


def _generate_fallback_summary(financial_data: Dict[str, Any]) -> str:
    """Generate a basic summary from available data when LLM fails."""
    parts = []
    
    metadata = financial_data.get("metadata", {})
    if metadata:
        if metadata.get("document_type"):
            parts.append(f"This is a {metadata.get('document_type')} document.")
        if metadata.get("company_name"):
            parts.append(f"Company/Organization: {metadata.get('company_name')}")
        if metadata.get("document_date"):
            parts.append(f"Date: {metadata.get('document_date')}")
    
    key_metrics = financial_data.get("key_metrics", [])
    if key_metrics:
        parts.append("\nKey Financial Metrics:")
        for metric in key_metrics[:8]:
            name = metric.get("name", "")
            value = metric.get("value", "")
            unit = metric.get("unit", "")
            if name and value is not None:
                if isinstance(value, (int, float)):
                    formatted = f"${value:,.2f}" if unit == "USD" else f"{value:,}"
                else:
                    formatted = str(value)
                parts.append(f"- {name}: {formatted} {unit}")
    
    tables = financial_data.get("tables", [])
    if tables:
        parts.append(f"\nThe document contains {len(tables)} table(s) with structured financial data.")
        # Include table titles
        table_titles = [t.get("title", f"Table {i+1}") for i, t in enumerate(tables[:5])]
        if table_titles:
            parts.append(f"Tables include: {', '.join(table_titles)}")
    
    detected_chunks = financial_data.get("detected_chunks", [])
    if detected_chunks:
        chunk_types = {}
        for chunk in detected_chunks:
            chunk_type = chunk.get("type", "text")
            chunk_types[chunk_type] = chunk_types.get(chunk_type, 0) + 1
        if chunk_types:
            parts.append(f"\nDocument Structure: {len(detected_chunks)} detected sections")
            for chunk_type, count in chunk_types.items():
                parts.append(f"- {chunk_type.title()}: {count} section(s)")
    
    document_markdown = financial_data.get("document_markdown", "") or financial_data.get("markdown", "")
    if document_markdown and len(document_markdown) > 100:
        # Extract first few sentences from markdown
        sentences = document_markdown[:500].split('.')
        if len(sentences) > 1:
            preview = '. '.join(sentences[:3]) + '.'
            parts.append(f"\nDocument Content Preview:\n{preview}")
    
    if not parts:
        return "This document has been processed. The document contains financial data, but specific summary details are not available. Please ask specific questions about the document content."
    
    return "\n".join(parts)


def handle_math_question(query: str) -> str:
    """Handle math questions - treat as document-unrelated like Landing.AI."""
    # Landing.AI treats math questions as "cannot find in document"
    # This makes sense for a document-focused system
    return "I cannot find the answer in the provided document."

def handle_financial_term_question(query: str) -> str:
    """Handle financial term definition questions with expert explanation."""
    try:
        if openai:
            from config import settings
            
            api_key = settings.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY")
            if api_key:
                client = openai.OpenAI(api_key=api_key)
                
                # Extract the term being asked about
                term_match = re.search(r'(?:what is|explain|define)\s+(?:an?|the)?\s*([^?]+)', query.lower())
                term = term_match.group(1).strip() if term_match else query
                
                prompt = f"""You are a financial expert and educator. Explain the financial term "{term}" in a very short, professional way.

STRICT REQUIREMENTS:
- Provide a clear definition in **at most 2 sentences total**.
- Use plain text only (NO headings, NO bullet points, NO numbered lists).
- Focus on what the term means and, if space allows, one short phrase about when it is used.
- Do NOT give a long explanation, context section, or examples.
- If the term is not a financial term, say briefly that it is not a standard financial term.

Term to explain: {term}"""
                
                response = client.chat.completions.create(
                    model="gpt-4",
                    messages=[
                        {"role": "system", "content": "You are a financial expert and educator. Explain financial terms clearly, concisely, and professionally. Always provide practical context and examples."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.2,
                    max_tokens=120
                )
                answer = response.choices[0].message.content.strip()
                return f"{answer}\n\n*Note: This explanation is general financial knowledge, not specific to the document.*"
    except Exception as e:
        print(f"Error handling financial term question: {e}")
        pass
    
    return f"I can help explain financial terms, but I need more context. Please rephrase your question about the financial term you'd like explained.\n\n*Note: This question is not related to the document content.*"

def handle_irrelevant_question(query: str) -> str:
    """Handle general knowledge questions that are not related to the document."""
    # Use consistent message like Landing.AI
    return "I cannot find the answer in the provided document."


def build_fallback_context(financial_data: Dict[str, Any], relevant_chunks: List[Dict[str, Any]]) -> str:
    """Assemble a plain-text context string for legacy fallback responses."""
    parts = []
    
    if financial_data.get("summary"):
        parts.append("Summary:\n" + financial_data["summary"])
    
    key_metrics = financial_data.get("key_metrics") or []
    if key_metrics:
        metrics_lines = ["Key Metrics:"]
        for metric in key_metrics[:8]:
            name = metric.get("name")
            value = metric.get("value")
            unit = metric.get("unit") or ""
            if name and value is not None:
                metrics_lines.append(f"- {name}: {value} {unit}")
        parts.append("\n".join(metrics_lines))
    
    total_len = sum(len(p) for p in parts)
    for chunk in relevant_chunks:
        text = (chunk.get("text") or "").strip()
        if not text:
            continue
        parts.append(text)
        total_len += len(text)
        if total_len > MAX_CONTEXT_CHARS:
            break
    
    return "\n\n".join(parts)


def analyze_financial_trends(financial_data: Dict[str, Any], query: str) -> Optional[str]:
    """Analyze financial trends from the document data."""
    # Basic trend analysis implementation
    # This can be enhanced later with more sophisticated analysis
    key_metrics = financial_data.get("key_metrics", [])
    if not key_metrics:
        return None
    
    # Simple trend detection based on query
    query_lower = query.lower()
    trend_info = []
    
    for metric in key_metrics:
        name = metric.get("name", "").lower()
        value = metric.get("value")
        if value and any(term in name for term in query_lower.split()):
            trend_info.append(f"{metric.get('name')}: {value} {metric.get('unit', '')}")
    
    if trend_info:
        return "Trend analysis: " + "; ".join(trend_info[:5])
    return None


def _sum_metric_two_years(query: str, financial_data: Dict[str, Any]) -> Optional[Dict]:
    """If query asks for the sum of a metric across two years, compute and return the answer.

    Returns dict {'answer': str, 'citations': list} or None if not applicable.
    """
    years = _parse_years_from_query(query)
    if len(years) != 2:
        return None

    # Strip sum/year/filler words to get the metric name
    metric = re.sub(
        r'\b(sum|total of|combined|of|and|in|the|what is|give me|show me|find)\b'
        r'|\b(19|20)\d{2}\b',
        ' ', query, flags=re.IGNORECASE,
    ).strip()
    if not metric:
        return None

    r1 = _lookup_single_value(financial_data, metric, years[0])
    r2 = _lookup_single_value(financial_data, metric, years[1])
    if not (r1 and r2):
        return None

    def _to_float(s: str) -> float:
        clean = s.replace(',', '').replace('(', '-').replace(')', '')
        return float(re.sub(r'[^\d.\-]', '', clean))

    try:
        total = _to_float(r1[0]) + _to_float(r2[0])
        return {
            'answer': (
                f"{metric.strip().title()}: {years[0]} = {r1[0]}, "
                f"{years[1]} = {r2[0]}. Sum = {total:,.0f}."
            ),
            'citations': [],
        }
    except (ValueError, TypeError):
        return None


def compare_financial_metrics(financial_data: Dict[str, Any], query: str) -> Optional[str]:
    """Compare financial metrics from the document.

    First attempts a two-year table lookup for queries like
    'difference between X in 2018 and 2019' or 'compare X vs Y'.
    Falls back to the generic key_metrics comparison.
    """
    # ── Two-year diff / compare using direct table lookup ───────────────
    years = _parse_years_from_query(query)
    if len(years) == 2:
        metric = re.sub(
            r'\b(difference|compare|comparison|between|vs\.?|versus|and|of|the|in'
            r'|what is|how much|calculate)\b|\b(19|20)\d{2}\b',
            ' ', query, flags=re.IGNORECASE,
        ).strip()
        if metric:
            r1 = _lookup_single_value(financial_data, metric, years[0])
            r2 = _lookup_single_value(financial_data, metric, years[1])
            if r1 and r2:
                def _f(s: str) -> float:
                    clean = s.replace(',', '').replace('(', '-').replace(')', '')
                    return float(re.sub(r'[^\d.\-]', '', clean))
                try:
                    v1, v2 = _f(r1[0]), _f(r2[0])
                    diff_fmt = f"{abs(v1 - v2):,.0f}"
                    q_lower = query.lower()
                    if any(w in q_lower for w in ('difference', 'between', 'subtract')):
                        return (
                            f"{metric.strip().title()}: {years[0]} = {r1[0]}, "
                            f"{years[1]} = {r2[0]}. Difference = {diff_fmt}."
                        )
                    return (
                        f"{metric.strip().title()}: {years[0]} = {r1[0]}, "
                        f"{years[1]} = {r2[0]}."
                    )
                except (ValueError, TypeError):
                    pass  # fall through

    # ── Generic key_metrics comparison fallback ───────────────────────
    key_metrics = financial_data.get("key_metrics", [])
    if len(key_metrics) < 2:
        return None
    
    # Simple comparison based on query
    query_lower = query.lower()
    metrics_to_compare = []
    
    for metric in key_metrics[:5]:  # Limit to 5 metrics
        name = metric.get("name", "")
        value = metric.get("value")
        if value is not None:
            metrics_to_compare.append(f"{name}: {value} {metric.get('unit', '')}")
    
    if metrics_to_compare:
        return "Comparison: " + " | ".join(metrics_to_compare)
    return None


def generate_follow_up_suggestions(query: str, answer: str, financial_data: Dict[str, Any], intent: str) -> List[str]:
    """Generate follow-up question suggestions based on the query and answer."""
    suggestions = []
    
    # Generate context-aware suggestions
    if intent == "trend":
        suggestions = [
            "What are the key trends in this document?",
            "Show me revenue trends",
            "What changed over time?"
        ]
    elif intent == "comparison":
        suggestions = [
            "Compare revenue and expenses",
            "What are the differences?",
            "Show me comparisons"
        ]
    elif "revenue" in query.lower() or "income" in query.lower():
        suggestions = [
            "What are the expenses?",
            "What is the net income?",
            "Show me the profit margin"
        ]
    elif "asset" in query.lower():
        suggestions = [
            "What are the liabilities?",
            "What is the equity?",
            "Show me the balance sheet"
        ]
    else:
        suggestions = [
            "What is the summary of this document?",
            "What are the key metrics?",
            "Explain the main findings"
        ]
    
    return suggestions[:3]  # Return max 3 suggestions


def get_conversation_context(document_id: str, max_turns: int = 3) -> str:
    """Get conversation history context for a document (last N turns)."""
    if document_id not in conversation_history:
        return ""
    
    history = conversation_history[document_id]
    if not history:
        return ""
    
    # Get last N turns (query-answer pairs)
    recent_turns = history[-max_turns:] if len(history) > max_turns else history
    
    # Format as context string for LLM
    context_parts = []
    for turn in recent_turns:
        context_parts.append(f"Q: {turn.get('query', '')}")
        context_parts.append(f"A: {turn.get('answer', '')[:200]}...")  # Truncate long answers
    
    return "\n".join(context_parts)


def save_conversation(document_id: str, query: str, answer: str) -> None:
    """Save conversation to history."""
    if document_id not in conversation_history:
        conversation_history[document_id] = []
    
    # Add new conversation turn
    conversation_history[document_id].append({
        "query": query,
        "answer": answer,
        "timestamp": datetime.now().isoformat()
    })
    
    # Limit history to last 20 turns per document (prevent memory bloat)
    if len(conversation_history[document_id]) > 20:
        conversation_history[document_id] = conversation_history[document_id][-20:]
    
    print(f"Conversation saved: {document_id} - Q: {query[:50]}...")