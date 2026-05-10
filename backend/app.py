"""Alpha Lens v2 — FastAPI Backend"""
import asyncio
import uuid
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import logging

import json
import re
import openai
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from config import settings
from auth import sign_up, sign_in, sign_out, get_user, reset_password, verify_jwt_local
from schemas import (
    SignUpRequest, SignInRequest, AuthResponse, ForgotPasswordRequest,
    HashCheckRequest, ChatRequest, ReportGenerateRequest, RegenerateSectionRequest,
)
import db
import storage_client
import qdrant_store
import embeddings
from observability import init_sentry

# Initialize Sentry before any FastAPI / external client code so its
# integrations can hook in. No-op when SENTRY_DSN_BACKEND is unset.
init_sentry()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── OpenAI singleton ──────────────────────────────────────────────────────────
_oai = openai.OpenAI(api_key=settings.OPENAI_API_KEY)

# ── processed.json in-memory cache (keyed by doc_id, 10-min TTL) ─────────────
import time as _time
_DOC_CACHE: dict[str, tuple[float, str, dict]] = {}  # doc_id → (expires, markdown, grounding)
_DOC_CACHE_TTL = 600  # seconds

def _get_doc_cache(doc_id: str):
    entry = _DOC_CACHE.get(doc_id)
    if entry and _time.time() < entry[0]:
        return entry[1], entry[2]
    return None, None

def _set_doc_cache(doc_id: str, markdown: str, grounding: dict):
    _DOC_CACHE[doc_id] = (_time.time() + _DOC_CACHE_TTL, markdown, grounding)
    now = _time.time()
    stale = [k for k, v in _DOC_CACHE.items() if v[0] < now]
    for k in stale:
        del _DOC_CACHE[k]


# ── Qdrant chunk cache (keyed by doc_id, same 10-min TTL) ────────────────────
_CHUNK_CACHE: dict[str, tuple[float, list]] = {}

def _get_chunk_cache(doc_id: str):
    entry = _CHUNK_CACHE.get(doc_id)
    if entry and _time.time() < entry[0]:
        return entry[1]
    return None

def _set_chunk_cache(doc_id: str, chunks: list):
    _CHUNK_CACHE[doc_id] = (_time.time() + _DOC_CACHE_TTL, chunks)
    now = _time.time()
    stale = [k for k, v in _CHUNK_CACHE.items() if v[0] < now]
    for k in stale:
        del _CHUNK_CACHE[k]


def _get_user_key(request: Request) -> str:
    """Rate-limit key: user_id from VERIFIED JWT, else client IP.

    Uses verify_jwt_local so an attacker cannot forge a `sub` claim to
    impersonate another user's rate-limit bucket. If the JWT secret is not
    yet configured, fall back to IP — never trust an unverified token.
    """
    token = request.cookies.get("access_token") or \
            request.headers.get("Authorization", "").replace("Bearer ", "")
    if token:
        payload = verify_jwt_local(token)
        if payload and payload.get("sub"):
            return payload["sub"]
    return get_remote_address(request)


limiter = Limiter(key_func=_get_user_key)

app = FastAPI(title="Alpha Lens v2", version="2.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Qdrant collection bootstrap is now lazy — see qdrant_store.py.
# The web service does not WRITE to Qdrant; the worker does, and the worker
# already calls ensure_collection() at the appropriate step. Removing the
# startup hook means Qdrant downtime no longer takes the whole API offline
# (auth, document listing, FinBot all keep working).

_MAX_JSON_BODY = 1 * 1024 * 1024  # 1 MB cap on JSON bodies


@app.middleware("http")
async def limit_json_body_size(request: Request, call_next):
    """Reject oversized JSON requests before reading them into memory.
    Skips multipart (file uploads have their own 50 MB check)."""
    cl = request.headers.get("content-length")
    ct = request.headers.get("content-type", "")
    if cl and ct.startswith("application/json") and int(cl) > _MAX_JSON_BODY:
        return JSONResponse(status_code=413, content={"error": "Payload too large"})
    return await call_next(request)


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Citation helpers ────────────────────────────────────────────────────────────

# Regex patterns for parsing ADE markdown
_ANCHOR_RE = re.compile(r"<a\s+id=['\"]([^'\"]+)['\"]\s*/?\s*>\s*</a>", re.IGNORECASE)
_TABLE_OPEN_RE = re.compile(r"<table\s+id=['\"]([^'\"]+)['\"]>", re.IGNORECASE)
_TD_WITH_ID_RE = re.compile(
    r"<td\s+id=['\"]([^'\"]+)['\"](?:\s+colspan=['\"]?\d+['\"]?)?\s*>(.*?)</td>",
    re.DOTALL | re.IGNORECASE,
)
_TR_RE = re.compile(r"<tr>(.*?)</tr>", re.DOTALL | re.IGNORECASE)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_CITATION_RE = re.compile(r"\[\[([^\]]+)\]\]")
_FULL_CONTEXT_TOKEN_LIMIT = 28000

# Section heading + year detection for table grid builder
_HEADING_RE   = re.compile(r'(?:^|\n)#{1,3}\s+([^\n]+)', re.MULTILINE)
_YEAR_RE_4    = re.compile(r'\b(19|20)\d{2}\b')
_DASH_ONLY_RE = re.compile(r'^[\s\-–—]*$')

# Extract section — unit detection + numeric parsing
_UNIT_RE  = re.compile(r'in\s+(thousands?|000s|millions?|billions?)', re.IGNORECASE)
_UNIT_MAP = {
    "thousand": 1_000, "thousands": 1_000, "000s": 1_000,
    "million":  1_000_000, "millions":  1_000_000,
    "billion":  1_000_000_000, "billions": 1_000_000_000,
}


def _keyword_search_fallback(markdown: str, query: str, top_k: int = 5) -> str:
    """Keyword search on raw markdown — used when Qdrant is unreachable."""
    if not markdown:
        return "No document context available."
    paragraphs = [p.strip() for p in re.split(r'\n{2,}', markdown) if len(p.strip()) > 50]
    if not paragraphs:
        return markdown[:8000]
    query_words = set(re.sub(r'[^\w\s]', '', query.lower()).split())
    scored = [(sum(1 for w in query_words if w in p.lower()), p) for p in paragraphs]
    scored.sort(key=lambda x: x[0], reverse=True)
    top = [p for score, p in scored[:top_k] if score > 0] or paragraphs[:3]
    return "\n\n---\n\n".join(top)


def _build_full_context(markdown_text: str, qdrant_chunks: list = None):
    """Convert ADE markdown into compact LLM-readable text with inline IDs.

    Returns None if markdown is unavailable or exceeds the token limit,
    signalling the caller to fall back to RAG.

    For plain-text documents (no HTML elements), rebuilds context from Qdrant
    chunks with section headers and chunk IDs.
    """
    raw_md = (markdown_text or "").strip()
    if not raw_md:
        return None

    est_tokens = len(raw_md) // 2  # financial docs tokenise at ~2 chars/token (numbers, symbols)
    if est_tokens > _FULL_CONTEXT_TOKEN_LIMIT:
        return None

    parts = []
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

    result = "\n\n".join(parts)

    # If no [id] markers were produced and we have Qdrant chunks, this is a
    # plain-text document. Rebuild context from chunks with section headers.
    if qdrant_chunks and '[' not in result:
        section_parts = []
        current_section = ""
        for chunk in sorted(qdrant_chunks, key=lambda c: (c.get("page", 0), (c.get("bbox") or {}).get("top", 0))):
            sec = chunk.get("section_header", "")
            if sec and sec != current_section:
                current_section = sec
                section_parts.append(f"\n=== {sec} ===")
            chunk_id = chunk.get("chunk_id", "")
            md = chunk.get("markdown", "")
            plain = re.sub(r"<[^>]+>", "", md).strip()
            if plain and chunk_id:
                section_parts.append(f"[{chunk_id}] {plain}")
            elif plain:
                section_parts.append(plain)
        if section_parts:
            result = "\n".join(section_parts)

    return result


def _build_rag_context(search_results) -> str:
    """Build LLM context from Qdrant search results with inline element IDs."""
    context_parts = []
    for r in search_results:
        p = r.payload
        if not p:
            continue
        chunk_id = p.get("chunk_id", "")
        chunk_type = p.get("chunk_type", "")
        page = p.get("page", 0)
        section_header = p.get("section_header", "")
        markdown = p.get("markdown", "")
        source_label = f"[Source {chunk_id}, Section: {section_header}, Page {page + 1}]" if section_header else f"[Source {chunk_id}, Page {page + 1}]"

        if chunk_type == "table":
            # Try to preserve cell IDs inside table HTML
            table_lines = [f"[Table on Page {page + 1}]"]
            for tr_m in _TR_RE.finditer(markdown):
                cells = _TD_WITH_ID_RE.findall(tr_m.group(1))
                if not cells:
                    # Plain row — strip HTML
                    row_text = _HTML_TAG_RE.sub("", tr_m.group(1)).strip()
                    if row_text:
                        table_lines.append(f"| {row_text} |")
                    continue
                row_parts = []
                for cell_id, cell_html in cells:
                    cell_text = re.sub(r"<[^>]+>", "", cell_html).strip()
                    if cell_text:
                        row_parts.append(f"{cell_text} [{cell_id}]")
                    else:
                        row_parts.append(f"[{cell_id}]")
                table_lines.append("| " + " | ".join(row_parts) + " |")
            if len(table_lines) > 1:
                context_parts.append("\n".join(table_lines))
            else:
                # Fallback: strip HTML entirely
                plain = _HTML_TAG_RE.sub("", markdown).strip()
                context_parts.append(f"{source_label} {plain}")
        else:
            plain = _HTML_TAG_RE.sub("", markdown).strip()
            if plain:
                context_parts.append(f"{source_label} {plain}")

    return "\n\n---\n\n".join(context_parts)


def _parse_citations(answer_text: str, grounding_dict: dict):
    """Extract [[id]] markers from answer, resolve to grounding bboxes.

    Returns (clean_answer, cited_ids_list).
    """
    cited_ids = []
    seen = set()
    for m in _CITATION_RE.finditer(answer_text or ""):
        ref_id = m.group(1).strip()
        if ref_id and ref_id not in seen:
            seen.add(ref_id)
            cited_ids.append(ref_id)

    # Clean the answer text
    clean = _CITATION_RE.sub("", answer_text or "").strip()
    clean = re.sub(r"(\s*,\s*)+", ", ", clean)
    clean = re.sub(r",\s*\.", ".", clean)
    clean = re.sub(r"\s+\.", ".", clean)
    clean = re.sub(r"\s{2,}", " ", clean)
    clean = clean.strip(" ,")

    return clean, cited_ids


# ─── Application-level value matching (Landing.AI approach) ──────────────────

_CELL_EXTRACT_RE = re.compile(
    r"<td\s+id=['\"]([^'\"]+)['\"](?:\s+[^>]*)?\s*>(.*?)</td>",
    re.DOTALL | re.IGNORECASE,
)


def _build_cell_text_lookup(markdown_text: str) -> dict:
    """Scan ALL <td id="X-Y">text</td> in the full markdown.

    Returns {cell_id: cell_text} for every cell in the document.
    """
    lookup = {}
    if not markdown_text:
        return lookup
    for cell_id, cell_html in _CELL_EXTRACT_RE.findall(markdown_text):
        text = re.sub(r"<[^>]+>", "", cell_html).strip()
        lookup[cell_id] = text  # keep even empty cells — needed for adjacency
    return lookup


def _build_plaintext_cell_lookup(
    full_markdown: str, grounding_dict: dict, qdrant_chunks: list
) -> tuple:
    """For plain-text documents, build {cell_id: text} by cross-referencing
    grounding cell bboxes with parsed table text from Qdrant chunks.

    Returns (cell_lookup, cell_section_map).
    """
    cell_lookup = {}
    cell_section_map = {}

    # Get all table-type chunks, sorted by (page, bbox.top)
    table_chunks = [
        c for c in qdrant_chunks
        if c.get("chunk_type") == "table"
    ]
    table_chunks.sort(key=lambda c: (c.get("page", 0), (c.get("bbox") or {}).get("top", 0)))

    # Get all grounding cells, sorted by (page, bbox.top, bbox.left)
    grounding_cells = []
    for eid, g in grounding_dict.items():
        g_type = (g.get("type", "") or "").lower()
        if "cell" in g_type:
            bbox = g.get("bbox", {})
            grounding_cells.append((eid, g.get("page", 0), bbox))

    if not table_chunks or not grounding_cells:
        return cell_lookup, cell_section_map

    PAGE_HEIGHT_TOLERANCE = 0.015  # tolerance for grouping cells into rows

    for chunk in table_chunks:
        chunk_page = chunk.get("page", 0)
        chunk_bbox = chunk.get("bbox") or {}
        chunk_top = chunk_bbox.get("top", 0)
        chunk_bottom = chunk_bbox.get("bottom", 1)
        chunk_left = chunk_bbox.get("left", 0)
        chunk_right = chunk_bbox.get("right", 1)
        section_header = chunk.get("section_header", "")
        markdown = chunk.get("markdown", "")

        # Parse markdown into rows: split on newlines, each row split on 2+ spaces
        raw_lines = [l.strip() for l in markdown.split("\n") if l.strip()]
        # Skip lines that are purely HTML tags or separators
        text_rows = []
        for line in raw_lines:
            clean = re.sub(r"<[^>]+>", "", line).strip()
            if clean and not re.match(r'^[-|=+]+$', clean):
                # Split on 2+ whitespace to get column values
                cols = re.split(r'\s{2,}', clean)
                text_rows.append(cols)

        # Find grounding cells on the same page whose bbox overlaps this chunk's bbox
        chunk_cells = []
        for eid, page, bbox in grounding_cells:
            if page != chunk_page:
                continue
            cell_top = bbox.get("top", 0)
            cell_bottom = bbox.get("bottom", 0)
            cell_left = bbox.get("left", 0)
            cell_right = bbox.get("right", 0)
            # Check overlap with chunk bbox
            if (cell_top >= chunk_top - PAGE_HEIGHT_TOLERANCE and
                    cell_bottom <= chunk_bottom + PAGE_HEIGHT_TOLERANCE and
                    cell_left >= chunk_left - 0.01 and
                    cell_right <= chunk_right + 0.01):
                chunk_cells.append((eid, bbox))
                cell_section_map[eid] = section_header

        if not chunk_cells:
            continue

        # Sort cells by (top, left) for row-major order
        chunk_cells.sort(key=lambda x: (x[1].get("top", 0), x[1].get("left", 0)))

        # Group cells into rows by bbox.top proximity
        cell_rows = []
        current_row = [chunk_cells[0]]
        for i in range(1, len(chunk_cells)):
            prev_top = current_row[-1][1].get("top", 0)
            curr_top = chunk_cells[i][1].get("top", 0)
            if abs(curr_top - prev_top) < PAGE_HEIGHT_TOLERANCE:
                current_row.append(chunk_cells[i])
            else:
                cell_rows.append(current_row)
                current_row = [chunk_cells[i]]
        cell_rows.append(current_row)

        # Sort each row left-to-right
        for row in cell_rows:
            row.sort(key=lambda x: x[1].get("left", 0))

        # Align cell rows with text rows (right-aligned: financial tables have
        # label left, numbers right)
        for row_idx, cell_row in enumerate(cell_rows):
            if row_idx >= len(text_rows):
                break
            text_cols = text_rows[row_idx]
            n_cells = len(cell_row)
            n_cols = len(text_cols)

            if n_cells == n_cols:
                # Perfect alignment
                for i, (eid, _) in enumerate(cell_row):
                    cell_lookup[eid] = text_cols[i]
            elif n_cols > n_cells:
                # More text columns than cells — right-align
                offset = n_cols - n_cells
                for i, (eid, _) in enumerate(cell_row):
                    cell_lookup[eid] = text_cols[offset + i]
            else:
                # More cells than text columns — right-align
                offset = n_cells - n_cols
                for i, col_text in enumerate(text_cols):
                    if offset + i < n_cells:
                        eid = cell_row[offset + i][0]
                        cell_lookup[eid] = col_text

    return cell_lookup, cell_section_map


def _build_cell_section_map(grounding_dict: dict, qdrant_chunks: list) -> dict:
    """Map each grounding cell to its parent chunk's section_header using bbox containment.

    Works for both HTML and plain-text docs.
    """
    section_map = {}
    table_chunks = [
        c for c in qdrant_chunks
        if c.get("chunk_type") == "table"
    ]
    if not table_chunks:
        return section_map

    for eid, g in grounding_dict.items():
        g_type = (g.get("type", "") or "").lower()
        if "cell" not in g_type:
            continue
        cell_page = g.get("page", 0)
        cell_bbox = g.get("bbox", {})
        cell_top = cell_bbox.get("top", 0)
        cell_bottom = cell_bbox.get("bottom", 0)
        cell_left = cell_bbox.get("left", 0)
        cell_right = cell_bbox.get("right", 0)

        for chunk in table_chunks:
            if chunk.get("page", 0) != cell_page:
                continue
            cb = chunk.get("bbox") or {}
            if (cell_top >= cb.get("top", 0) - 0.015 and
                    cell_bottom <= cb.get("bottom", 1) + 0.015 and
                    cell_left >= cb.get("left", 0) - 0.01 and
                    cell_right <= cb.get("right", 1) + 0.01):
                section_map[eid] = chunk.get("section_header", "")
                break

    return section_map


def _normalise_for_match(s: str) -> str:
    """Normalise a string for value comparison: strip whitespace, commas,
    currency symbols, parentheses, and lowercase."""
    return re.sub(r"[\s,$%()₹£€¥]", "", s).lower().replace(",", "")


def _build_table_grids(markdown_text: str) -> dict:
    """Parse ADE HTML tables from full markdown → {table_id: grid_dict}.

    Each grid_dict:
      table_id         – ADE table element id
      year_label       – 4-digit year in the header row's first cell (e.g. "2018", "2019")
                         Handles the SOCE two-table pattern where each sub-table starts with
                         a year cell instead of a column-header row.
      rows             – list[list[str]]: rows[i][j] = cell_id at grid position (i, j)
      header_row       – row index of the column-header row (usually 0)
      label_col        – column index of the row-label column (usually 0)
      group_header_rows – row indexes whose value columns are all empty/dash
                          (sub-group headers like "Foreign currency financial assets")
    """
    if not markdown_text:
        return {}

    grids: dict = {}
    pos = 0

    # Pre-build heading list for O(N) lookup of nearest heading above each table
    heading_positions: list[tuple[int, str]] = [
        (m.start(), m.group(1).strip())
        for m in _HEADING_RE.finditer(markdown_text)
    ]

    while pos < len(markdown_text):
        table_m = _TABLE_OPEN_RE.search(markdown_text, pos)
        if not table_m:
            break

        table_id = table_m.group(1)
        table_close = markdown_text.find("</table>", table_m.end())
        if table_close == -1:
            table_close = len(markdown_text) - len("</table>")
        table_html = markdown_text[table_m.start(): table_close + len("</table>")]

        # Parse rows: list[list[str]] of cell IDs, plus a text map for analysis
        rows: list[list[str]] = []
        cell_texts: dict[str, str] = {}
        for tr_m in _TR_RE.finditer(table_html):
            row_cells = _TD_WITH_ID_RE.findall(tr_m.group(1))
            if not row_cells:
                continue
            row_ids: list[str] = []
            for cell_id, cell_html in row_cells:
                text = re.sub(r"<[^>]+>", "", cell_html).strip()
                cell_texts[cell_id] = text
                row_ids.append(cell_id)
            if row_ids:
                rows.append(row_ids)

        if not rows:
            pos = table_close + len("</table>")
            continue

        header_row = 0
        label_col  = 0

        # year_label: first cell of header row contains a bare 4-digit year
        # This is the ADE pattern for SOCE where "2018" / "2019" heads each sub-table.
        year_label: str | None = None
        if rows and rows[header_row]:
            first_text = cell_texts.get(rows[header_row][0], "")
            ym = _YEAR_RE_4.match(first_text.strip())
            if ym and first_text.strip() == ym.group():
                year_label = ym.group()

        # group_header_rows: data rows where ALL value columns are empty or dash
        # These are section sub-headers inside the table (e.g. "ASSETS", "Foreign currency …")
        group_header_rows: list[int] = []
        for ri, row in enumerate(rows):
            if ri == header_row:
                continue
            value_ids = row[label_col + 1:] if len(row) > label_col + 1 else []
            if not value_ids:
                continue
            label_text = cell_texts.get(row[label_col] if row else "", "")
            all_empty = all(
                _DASH_ONLY_RE.match(cell_texts.get(cid, "") or "") is not None
                for cid in value_ids
            )
            if all_empty and label_text.strip():
                group_header_rows.append(ri)

        grids[table_id] = {
            "table_id":          table_id,
            "year_label":        year_label,
            "rows":              rows,
            "header_row":        header_row,
            "label_col":         label_col,
            "group_header_rows": group_header_rows,
            "_cell_texts":       cell_texts,   # kept for internal use only
        }

        pos = table_close + len("</table>")

    return grids


def _find_grid_for_cell(cell_id: str, grids: dict):
    """Return the grid dict that contains cell_id, or None."""
    for grid in grids.values():
        for row in grid["rows"]:
            if cell_id in row:
                return grid
    return None


def _get_cross_cells(grid: dict, value_cell_id: str) -> dict:
    """Given a value cell, return context cell IDs.

    Returns:
      row_label_id   – cell at (same row, label_col)
      group_label_id – cell at (nearest group-header row above, label_col)
      col_header_id  – cell at (header_row, same col)
    All values are None when not applicable (e.g. the value cell IS the label).
    """
    rows        = grid["rows"]
    header_row  = grid["header_row"]
    label_col   = grid["label_col"]
    group_rows  = grid["group_header_rows"]

    for ri, row in enumerate(rows):
        for ci, cid in enumerate(row):
            if cid != value_cell_id:
                continue

            row_label_id = row[label_col] if ci != label_col and label_col < len(row) else None

            col_header_id = None
            if ri != header_row and header_row < len(rows):
                hrow = rows[header_row]
                if ci < len(hrow):
                    col_header_id = hrow[ci]

            group_label_id = None
            for prev_ri in range(ri - 1, -1, -1):
                if prev_ri in group_rows:
                    prev_row = rows[prev_ri]
                    if label_col < len(prev_row):
                        group_label_id = prev_row[label_col]
                    break

            return {
                "row_label_id":   row_label_id,
                "group_label_id": group_label_id,
                "col_header_id":  col_header_id,
            }

    return {"row_label_id": None, "group_label_id": None, "col_header_id": None}


def _parse_numeric(text: str):
    """Parse a cell value string to float, or None if not numeric.
    Handles: commas, parentheses for negatives, currency symbols, trailing dashes.
    """
    if not text:
        return None
    t = text.strip()
    if _DASH_ONLY_RE.match(t):
        return None
    negative = t.startswith("(") and t.endswith(")")
    t = re.sub(r"[^\d.\-]", "", t.replace("(", "-").replace(")", ""))
    try:
        val = float(t)
        return -abs(val) if negative else val
    except ValueError:
        return None


def _detect_unit_scale(texts: list[str]) -> tuple[int, str]:
    """Scan a list of strings (title, section, first rows) for unit qualifiers.
    Returns (scale_multiplier, label_string).
    """
    for text in texts:
        m = _UNIT_RE.search(text or "")
        if m:
            key = m.group(1).lower()
            scale = _UNIT_MAP.get(key, 1)
            return scale, f"in {m.group(1)}"
    return 1, ""


def _compute_yoy(cells: list[dict], year_col_indices: list[int]):
    """Compute YoY % change between the last two year columns.
    Returns float or None.
    """
    if len(year_col_indices) < 2:
        return None
    prev_idx = year_col_indices[-2]
    curr_idx = year_col_indices[-1]
    prev_cell = cells[prev_idx] if prev_idx < len(cells) else None
    curr_cell = cells[curr_idx] if curr_idx < len(cells) else None
    if not prev_cell or not curr_cell:
        return None
    prev_val = _parse_numeric(prev_cell.get("value_text", ""))
    curr_val = _parse_numeric(curr_cell.get("value_text", ""))
    if prev_val is None or curr_val is None or prev_val == 0:
        return None
    return round((curr_val - prev_val) / abs(prev_val) * 100, 1)


def _extract_doc_name(markdown_text: str) -> str:
    """Return the first heading found in markdown, stripped of markup."""
    for m in _HEADING_RE.finditer(markdown_text):
        text = m.group(1).strip()
        # Strip any inline HTML/anchor tags  e.g. <a id='...'></a>
        text = re.sub(r'<[^>]+>', '', text).strip()
        if text:
            return text
    return ""


def _build_all_tables(markdown_text: str, grounding_dict: dict) -> list:
    """Build a structured list of ExtractTable dicts from all <table> elements.

    Reuses _build_table_grids() for HTML parsing, then enriches each grid
    with: col headers, year columns, unit scale, per-cell grounding (bbox/page),
    YoY delta, and nearest section heading.

    Used exclusively by get_extract() — not by the chat pipeline.
    """
    if not markdown_text:
        return []

    grids = _build_table_grids(markdown_text)
    if not grids:
        return []

    # Pre-build heading positions for section lookup
    heading_positions: list[tuple[int, str]] = [
        (m.start(), m.group(1).strip())
        for m in _HEADING_RE.finditer(markdown_text)
    ]

    # Build a table-start position map for section lookup
    table_positions: dict[str, int] = {}
    for m in re.finditer(r'<table\s+id=["\']?(\w[\w-]*)["\']?', markdown_text, re.IGNORECASE):
        table_positions[m.group(1)] = m.start()

    result = []

    for table_id, grid in grids.items():
        rows_ids       = grid["rows"]            # list[list[cell_id]]
        header_row_idx = grid["header_row"]      # int (always 0)
        label_col      = grid["label_col"]       # int (always 0)
        group_rows     = set(grid["group_header_rows"])
        cell_texts     = grid["_cell_texts"]     # {cell_id: text}

        if not rows_ids or header_row_idx >= len(rows_ids):
            continue

        header_ids = rows_ids[header_row_idx]

        # ── Column headers ────────────────────────────────────────────────────
        col_headers: list[str] = [cell_texts.get(cid, "") for cid in header_ids]

        # ── Detect year columns (index into col_headers) ──────────────────────
        year_col_indices: list[int] = [
            i for i, h in enumerate(col_headers)
            if i != label_col and _YEAR_RE_4.search(h)
        ]

        # ── Section heading for this table ───────────────────────────────────
        tbl_pos = table_positions.get(table_id, 0)
        section_name = ""
        for hpos, htitle in reversed(heading_positions):
            if hpos < tbl_pos:
                section_name = htitle
                break

        # ── Unit detection: check section name + col headers + first data row ─
        first_row_texts = []
        if len(rows_ids) > header_row_idx + 1:
            first_data_row = rows_ids[header_row_idx + 1]
            first_row_texts = [cell_texts.get(cid, "") for cid in first_data_row]
        unit_scale, unit_label = _detect_unit_scale(
            [section_name] + col_headers + first_row_texts
        )

        # ── Page + bbox for the whole table (from first resolved cell) ────────
        table_page = 0
        table_bbox: dict = {}
        for row_ids_row in rows_ids:
            for cid in row_ids_row:
                g = grounding_dict.get(cid)
                if g:
                    table_page = g.get("page", 0)
                    b = g.get("bbox") or g.get("box") or {}
                    if isinstance(b, dict) and b:
                        table_bbox = b
                    break
            if table_bbox:
                break

        # ── Build rows ────────────────────────────────────────────────────────
        extract_rows: list[dict] = []

        for ri, row_ids in enumerate(rows_ids):
            if ri == header_row_idx:
                continue  # skip header row — it becomes col_headers

            row_label_id  = row_ids[label_col] if label_col < len(row_ids) else ""
            row_label_txt = cell_texts.get(row_label_id, "")
            is_group      = ri in group_rows

            # Build cells list (one per non-label column)
            cells: list[dict] = []
            for ci, cid in enumerate(row_ids):
                if ci == label_col:
                    continue
                col_hdr   = col_headers[ci] if ci < len(col_headers) else ""
                val_text  = cell_texts.get(cid, "")
                g         = grounding_dict.get(cid) or {}
                cell_page = g.get("page", table_page)
                raw_bbox  = g.get("bbox") or g.get("box") or {}
                cell_bbox = raw_bbox if isinstance(raw_bbox, dict) else {}
                cells.append({
                    "col_header": col_hdr,
                    "value_text": val_text,
                    "cell_id":    cid,
                    "page":       cell_page,
                    "bbox":       cell_bbox,
                })

            # YoY delta — adjust indices: cells[] has label col removed
            # map year_col_indices (in original col space) → cells[] index
            cells_year_indices = []
            cells_ci = 0
            for ci in range(len(row_ids)):
                if ci == label_col:
                    continue
                if ci in year_col_indices:
                    cells_year_indices.append(cells_ci)
                cells_ci += 1

            yoy = None if is_group else _compute_yoy(cells, cells_year_indices)

            extract_rows.append({
                "row_label":       row_label_txt,
                "row_label_id":    row_label_id,
                "is_group_header": is_group,
                "cells":           cells,
                "yoy_delta_pct":   yoy,
            })

        result.append({
            "table_id":    table_id,
            "title":       section_name,
            "section":     section_name,
            "page":        table_page,
            "bbox":        table_bbox,
            "col_headers": col_headers,
            "year_cols":   year_col_indices,
            "unit_scale":  unit_scale,
            "unit_label":  unit_label,
            "rows":        extract_rows,
        })

    return result


def _extract_question_qualifiers(question: str) -> set:
    """Values in the question are filters, not answers. E.g., '2018' in 'assets in 2018?'"""
    norms = set()
    # 4-digit years
    for m in re.finditer(r'\b(19|20)\d{2}\b', question):
        norms.add(_normalise_for_match(m.group()))
    # Any numbers 3+ digits in the question
    for m in re.finditer(r'\b\d{3,}(?:,\d{3})*(?:\.\d+)?\b', question):
        norms.add(_normalise_for_match(m.group()))
    return norms


def _extract_answer_values(answer_text: str) -> list:
    """Extract matchable values from the LLM answer text.

    Returns a list of (original, normalised) tuples, longest first.
    Captures:
    - Numbers with thousands separators: 143,990  1,501,908  548,642
    - Decimal numbers: 15.4  3.14
    - Currency amounts: Rs. 143,990  $1,234
    - Dates: Friday, October 10, 2025  10/15/2025  2025-10-15
    - Percentages: 15.4%
    """
    values = []
    seen_norm = set()
    matched_spans = []  # track character spans to avoid overlapping extractions

    def _overlaps_existing(start: int, end: int) -> bool:
        for s, e in matched_spans:
            if start < e and end > s:
                return True
        return False

    # 1. Numbers (with optional thousands separators and decimals)
    for m in re.finditer(r'\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b', answer_text):
        v = m.group()
        n = _normalise_for_match(v)
        if n not in seen_norm and len(n) >= 3:
            seen_norm.add(n)
            values.append((v, n))
            matched_spans.append((m.start(), m.end()))

    # 2. Plain numbers (no commas) — at least 3 digits to avoid noise
    # Skip matches that overlap with already-extracted comma-separated numbers
    for m in re.finditer(r'\b\d{3,}(?:\.\d+)?\b', answer_text):
        if _overlaps_existing(m.start(), m.end()):
            continue
        v = m.group()
        n = _normalise_for_match(v)
        if n not in seen_norm:
            seen_norm.add(n)
            values.append((v, n))

    # 3. Full date patterns — "Friday, October 10, 2025" etc.
    for m in re.finditer(
        r'(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)'
        r',?\s+\w+\s+\d{1,2},?\s+\d{4}',
        answer_text, re.IGNORECASE
    ):
        v = m.group().strip()
        n = _normalise_for_match(v)
        if n not in seen_norm:
            seen_norm.add(n)
            values.append((v, n))

    # 4. Numeric date patterns — 10/15/2025, 2025-10-15
    for m in re.finditer(r'\b\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}\b', answer_text):
        v = m.group()
        n = _normalise_for_match(v)
        if n not in seen_norm:
            seen_norm.add(n)
            values.append((v, n))

    # Sort longest normalised first — longer matches are more specific
    values.sort(key=lambda x: -len(x[1]))
    return values


def _extract_section_keywords(text: str) -> set:
    """Extract section-related keywords from text for section matching."""
    keywords = set()
    section_patterns = [
        r'statement\s+of\s+[\w\s]+',
        r'balance\s+sheet',
        r'cash\s+flow',
        r'income\s+statement',
        r'profit\s+(?:and|&)\s+loss',
        r'changes?\s+in\s+equity',
        r'financial\s+position',
        r'comprehensive\s+income',
        r'notes?\s+to\s+(?:the\s+)?financial',
    ]
    text_lower = text.lower()
    for pat in section_patterns:
        m = re.search(pat, text_lower)
        if m:
            keywords.add(m.group().strip())
    return keywords


def _find_parent_table(cell_id: str, grounding_dict: dict, table_index: list) -> int:
    """Find which table instance a cell belongs to. Returns index or -1."""
    for idx, tbl in enumerate(table_index):
        if cell_id in tbl["cell_ids"]:
            return idx
    return -1


def _build_table_index(grounding_dict: dict, cell_section_map: dict) -> list:
    """Group cells into table instances by page + bbox proximity.

    Returns [{page, bbox_top, section, cell_ids: set}, ...]
    """
    # Collect all table cells with their page and top coordinate
    cells_by_page = {}
    for eid, g in grounding_dict.items():
        g_type = (g.get("type", "") or "").lower()
        if "cell" not in g_type:
            continue
        page = g.get("page", 0)
        bbox = g.get("bbox", {})
        top = bbox.get("top", 0)
        cells_by_page.setdefault(page, []).append((eid, top))

    tables = []
    for page, cells in cells_by_page.items():
        cells.sort(key=lambda x: x[1])
        # Group cells into tables by gap between consecutive cells.
        # Rows within a table are ~0.02-0.04 apart; gap between tables is ~0.08+
        TABLE_GAP_THRESHOLD = 0.06
        current_table_cells = {cells[0][0]}
        current_min_top = cells[0][1]
        prev_top = cells[0][1]

        for i in range(1, len(cells)):
            eid, top = cells[i]
            if top - prev_top > TABLE_GAP_THRESHOLD:
                # Gap detected — start new table
                tables.append({
                    "page": page,
                    "bbox_top": current_min_top,
                    "section": cell_section_map.get(next(iter(current_table_cells)), ""),
                    "cell_ids": current_table_cells,
                })
                current_table_cells = {eid}
                current_min_top = top
            else:
                current_table_cells.add(eid)
            prev_top = top

        tables.append({
            "page": page,
            "bbox_top": current_min_top,
            "section": cell_section_map.get(next(iter(current_table_cells)), ""),
            "cell_ids": current_table_cells,
        })

    return tables


def _find_all_matching_cells(
    answer_text: str,
    cell_lookup: dict,
    grounding_dict: dict,
    llm_cited_ids: list,
    question_qualifiers: set = None,
    cell_section_map: dict = None,
    question_text: str = "",
) -> list:
    """Find ALL cells matching the answer values — Landing.AI approach.

    Three-stage algorithm:
    1. Extract values from the LLM answer, filter out question qualifiers
    2. Scope search by section if question mentions one
    3. Value-match within scope, dedup by table instance, gate on confidence
    4. Fall back to LLM-cited IDs only if value matching found nothing
    """
    # Strip [[cell-id]] citations before value extraction — digits inside
    # citation markers (e.g. [[0-800]]) would otherwise be falsely extracted
    # as answer values and produce spurious high-confidence cell matches.
    clean_answer = _CITATION_RE.sub("", answer_text)
    answer_values = _extract_answer_values(clean_answer)

    # Filter out question qualifiers — these are filters, not answer targets
    if question_qualifiers:
        answer_values = [
            (o, n) for o, n in answer_values if n not in question_qualifiers
        ]

    # ── Build table index for dedup ──
    table_index = _build_table_index(grounding_dict, cell_section_map or {})

    # ── Determine search scope: section-scoped or full ──
    q_sections = set()
    if cell_section_map and question_text:
        q_sections = _extract_section_keywords(question_text)

    if q_sections and cell_section_map:
        # Narrow to cells in matching sections only
        scope_cells = {}
        for cid, text in cell_lookup.items():
            sec = cell_section_map.get(cid, "")
            if sec:
                sec_kw = _extract_section_keywords(sec)
                if sec_kw & q_sections:
                    scope_cells[cid] = text
            else:
                # No section info — include as candidate (don't exclude unknowns)
                scope_cells[cid] = text
        # If scoping eliminated everything, fall back to full search
        if not scope_cells:
            scope_cells = cell_lookup
    else:
        scope_cells = cell_lookup

    matched_cells = []
    seen_ids = set()

    # ── Phase 1: Value matching within scope ──
    for cell_id, cell_text in scope_cells.items():
        if not cell_text or cell_id in seen_ids:
            continue
        cell_norm = _normalise_for_match(cell_text)
        if not cell_norm:
            continue

        for orig_val, norm_val in answer_values:
            score = 0
            # Exact normalised match
            if cell_norm == norm_val:
                score = 100
            # Cell contains the value (e.g. cell "Rs. 143,990" contains "143990")
            elif len(norm_val) >= 3 and norm_val in cell_norm:
                score = 90
            # Value contains the cell text (e.g. answer "Friday, October 10, 2025")
            elif len(cell_norm) >= 5 and cell_norm in norm_val:
                score = 80

            if score > 0:
                seen_ids.add(cell_id)
                matched_cells.append((cell_id, cell_text, score, norm_val))
                break

    # ── Section scoring: bonus/penalty for section match ──
    if q_sections and cell_section_map:
        rescored = []
        for cell_id, cell_text, score, val in matched_cells:
            sec = cell_section_map.get(cell_id, "")
            if sec:
                sec_keywords = _extract_section_keywords(sec)
                if sec_keywords & q_sections:
                    score += 10  # correct section bonus
                else:
                    score -= 20  # wrong section penalty
            rescored.append((cell_id, cell_text, score, val))
        matched_cells = rescored

    # ── Table-instance dedup: keep best match per (table, value) ──
    # This allows different values in the same table (compare case) while
    # deduplicating same value within a table instance.
    if table_index:
        best_per_key = {}  # key: (table_idx, matched_value)
        ungrouped = []
        for cell_id, cell_text, score, val in matched_cells:
            tbl_idx = _find_parent_table(cell_id, grounding_dict, table_index)
            if tbl_idx >= 0:
                key = (tbl_idx, val)
                if key not in best_per_key or score > best_per_key[key][2]:
                    best_per_key[key] = (cell_id, cell_text, score)
            else:
                ungrouped.append((cell_id, cell_text, score))
        matched_cells_3 = list(best_per_key.values()) + ungrouped
    else:
        matched_cells_3 = [(cid, txt, sc) for cid, txt, sc, _ in matched_cells]

    # ── Confidence gate: drop low-score matches ──
    matched_cells_3 = [(cid, txt, sc) for cid, txt, sc in matched_cells_3 if sc >= 60]
    matched_cells = matched_cells_3

    # ── Phase 2: LLM-cited IDs as fallback (only if Phase 1 found nothing) ──
    if not matched_cells:
        for cid in llm_cited_ids:
            if cid in seen_ids:
                continue
            if cid not in grounding_dict:
                continue
            cell_text = cell_lookup.get(cid, "")
            if cell_text.strip():
                seen_ids.add(cid)
                matched_cells.append((cid, cell_text, 70))
            else:
                # Empty cell — check adjacent cells for answer values
                parts = cid.rsplit("-", 1)
                if len(parts) == 2 and parts[1].isdigit():
                    prefix, seq = parts[0], int(parts[1])
                    for offset in [1, -1, 2, -2]:
                        adj_id = f"{prefix}-{seq + offset}"
                        if adj_id in seen_ids:
                            continue
                        adj_text = cell_lookup.get(adj_id, "")
                        if not adj_text.strip():
                            continue
                        adj_norm = _normalise_for_match(adj_text)
                        for _, norm_val in answer_values:
                            if adj_norm == norm_val or (len(norm_val) >= 3 and norm_val in adj_norm):
                                seen_ids.add(adj_id)
                                matched_cells.append((adj_id, adj_text, 60))
                                break

    # ── Phase 3: Text chunk fallback (only if still nothing) ──
    if not matched_cells:
        for cid in llm_cited_ids:
            if cid in seen_ids:
                continue
            g = grounding_dict.get(cid)
            if not g:
                continue
            g_type = (g.get("type", "") or "").lower()
            if "cell" not in g_type and "table" not in g_type:
                seen_ids.add(cid)
                matched_cells.append((cid, "", 50))

    # Sort by score desc, then by page order
    matched_cells.sort(key=lambda x: (-x[2], grounding_dict.get(x[0], {}).get("page", 0)))
    return matched_cells


# ─── Request logger ──────────────────────────────────────────────────────────────

@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f">>> {request.method} {request.url.path}")
    response = await call_next(request)
    logger.info(f"<<< {request.method} {request.url.path} → {response.status_code}")
    return response


# ─── Auth dependency ──────────────────────────────────────────────────────────────

async def get_current_user(request: Request) -> dict:
    token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = await asyncio.to_thread(get_user, token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


# ─── Health ──────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    """Render's default health probe. Always 200 — process is alive."""
    return {"status": "ok", "version": "2.0.0"}


@app.get("/livez")
async def livez():
    """Liveness — the process is up. Always 200. Use for orchestrator restarts."""
    return {"status": "ok"}


_HEALTH_TIMEOUT = 3.0  # seconds per dependency check


async def _check_supabase() -> str:
    """Cheap read against documents table."""
    try:
        await asyncio.wait_for(
            asyncio.to_thread(
                lambda: db.get_client().table("documents").select("id").limit(1).execute()
            ),
            timeout=_HEALTH_TIMEOUT,
        )
        return "ok"
    except asyncio.TimeoutError:
        return "timeout"
    except Exception as e:
        logger.warning(f"health: supabase failed: {e}")
        return f"error: {type(e).__name__}"


async def _check_qdrant() -> str:
    try:
        await asyncio.wait_for(
            asyncio.to_thread(lambda: qdrant_store.get_client().get_collections()),
            timeout=_HEALTH_TIMEOUT,
        )
        return "ok"
    except asyncio.TimeoutError:
        return "timeout"
    except Exception as e:
        logger.warning(f"health: qdrant failed: {e}")
        return f"error: {type(e).__name__}"


# Module-level Redis client — reused across health checks so we don't pay the
# TLS handshake on every call. Upstash cold handshake can exceed 2s.
_health_redis_client = None


async def _check_redis() -> str:
    global _health_redis_client
    try:
        if _health_redis_client is None:
            import redis.asyncio as aioredis
            _health_redis_client = aioredis.from_url(
                settings.UPSTASH_REDIS_URL,
                socket_connect_timeout=_HEALTH_TIMEOUT,
                socket_timeout=_HEALTH_TIMEOUT,
            )
        await asyncio.wait_for(
            _health_redis_client.ping(), timeout=_HEALTH_TIMEOUT,
        )
        return "ok"
    except asyncio.TimeoutError:
        return "timeout"
    except Exception as e:
        logger.warning(f"health: redis failed: {e}")
        # Reset so next call gets a fresh connection
        _health_redis_client = None
        return f"error: {type(e).__name__}"


@app.get("/health")
async def health():
    """Readiness probe — pings Supabase, Qdrant, Redis with 2s timeouts.

    Returns 200 only if all dependencies respond. Render's healthCheckPath
    pulls the container out of rotation on 503, so a downstream outage
    triggers a real failover instead of routing requests to a dead app.
    Use /livez (always 200) if you only want process-alive semantics.
    """
    checks = await asyncio.gather(
        _check_supabase(), _check_qdrant(), _check_redis(),
    )
    body = {
        "status":  "ok" if all(c == "ok" for c in checks) else "degraded",
        "version": "2.0.0",
        "checks":  {"supabase": checks[0], "qdrant": checks[1], "redis": checks[2]},
    }
    code = 200 if body["status"] == "ok" else 503
    return JSONResponse(status_code=code, content=body)


# ─── Auth endpoints ───────────────────────────────────────────────────────────────

def _set_auth_cookie(response: JSONResponse, token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=not settings.DEBUG,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
    )


@app.post("/api/auth/signup")
async def signup_user(body: SignUpRequest):
    result = await asyncio.to_thread(sign_up, body.email, body.password)
    if not result["success"]:
        return JSONResponse({"success": False, "error": result.get("error", "Sign up failed")})

    session = result.get("session")
    if not session:
        return JSONResponse({
            "success": False,
            "error": "Please check your email to confirm your account before signing in."
        })

    token = getattr(session, "access_token", None)
    if not token:
        return JSONResponse({"success": False, "error": "Failed to get access token."})

    user_data = {"id": result["user"].id, "email": result["user"].email}
    response = JSONResponse({"success": True, "message": "Account created", "user": user_data, "access_token": token})
    _set_auth_cookie(response, token)
    return response


@app.post("/api/auth/login")
async def login_user(body: SignInRequest):
    result = await asyncio.to_thread(sign_in, body.email, body.password)
    if not result["success"]:
        return JSONResponse({"success": False, "error": result.get("error", "Invalid credentials")})

    session = result.get("session")
    if not session:
        return JSONResponse({"success": False, "error": "Failed to create session."})

    token = getattr(session, "access_token", None)
    if not token:
        return JSONResponse({"success": False, "error": "Failed to get access token."})

    user_data = {"id": result["user"].id, "email": result["user"].email}
    response = JSONResponse({"success": True, "message": "Login successful", "user": user_data, "access_token": token})
    _set_auth_cookie(response, token)
    return response


@app.post("/api/auth/logout")
async def logout_user(request: Request):
    token = request.cookies.get("access_token") or \
            request.headers.get("Authorization", "").replace("Bearer ", "")
    await asyncio.to_thread(sign_out, token)
    response = JSONResponse({"success": True})
    response.delete_cookie("access_token")
    return response


@app.get("/api/auth/session")
async def get_session(current_user: dict = Depends(get_current_user)):
    return {"success": True, "user": current_user}


@app.post("/api/auth/forgot-password")
async def forgot_password(body: ForgotPasswordRequest):
    result = await asyncio.to_thread(reset_password, body.email)
    return result


# ─── Documents ───────────────────────────────────────────────────────────────────

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".html", ".htm", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".webp"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_QUERY_LENGTH = 2000           # characters — chat + finbot messages


@app.get("/api/documents")
async def list_documents(current_user: dict = Depends(get_current_user)):
    docs = await asyncio.to_thread(db.list_documents, current_user["id"])
    return {"success": True, "documents": docs}


@app.post("/api/documents/check-hash")
async def check_hash(body: HashCheckRequest, current_user: dict = Depends(get_current_user)):
    existing = await asyncio.to_thread(db.check_hash, current_user["id"], body.sha256_hash)
    if existing:
        return {"exists": True, "document_id": existing["id"], "filename": existing["filename"], "status": existing["status"]}
    return {"exists": False}


@app.post("/api/documents/upload")
async def upload_document(
    current_user: dict = Depends(get_current_user),
    file: UploadFile = File(...),
    sha256_hash: str = Form(...),
    action: str = Form("parse"),
):
    import os
    ext = os.path.splitext(file.filename or "")[-1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return JSONResponse(status_code=400, content={"success": False, "error": f"File type '{ext}' not supported"})

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        return JSONResponse(status_code=400, content={"success": False, "error": "File too large (max 50 MB)"})

    # Dedup check
    existing = await asyncio.to_thread(db.check_hash, current_user["id"], sha256_hash)
    if existing:
        return JSONResponse(status_code=409, content={
            "success": False, "error": "Duplicate document", "existing_document_id": existing["id"]
        })

    doc_id = str(uuid.uuid4())
    user_id = current_user["id"]

    # Upload to Supabase Storage
    try:
        storage_path = await asyncio.to_thread(
            storage_client.upload_file, user_id, doc_id, file_bytes, file.filename
        )
    except Exception as e:
        logger.error(f"Storage upload failed: {e}")
        return JSONResponse(status_code=500, content={"success": False, "error": "Failed to store file"})

    # Insert document row
    doc = {
        "id": doc_id,
        "user_id": user_id,
        "filename": file.filename,
        "file_path": storage_path,
        "sha256_hash": sha256_hash,
        "status": "queued",
        "progress": 0,
        "status_message": "Waiting for processing",
        "metadata": {"action": action},
    }
    await asyncio.to_thread(db.insert_document, doc)

    # Enqueue ARQ processing job. If Redis is unreachable, mark the doc
    # as error rather than leaving it in "queued" forever — otherwise the
    # user sees a permanent loading spinner with no way to recover.
    try:
        from worker import get_arq_pool
        pool = await get_arq_pool()
        await pool.enqueue_job("process_document", doc_id, user_id, storage_path)
        await pool.aclose()
    except Exception as e:
        logger.error(f"Failed to enqueue job for doc {doc_id}: {e}", exc_info=True)
        await asyncio.to_thread(db.update_document, doc_id, {
            "status": "error",
            "progress": 0,
            "status_message": "Could not queue for processing — please retry.",
        })
        return JSONResponse(status_code=503, content={
            "success": False,
            "error": "Processing queue unavailable. Please retry shortly.",
            "document_id": doc_id,
        })

    return JSONResponse(status_code=201, content={
        "success": True,
        "document_id": doc_id,
        "filename": file.filename,
        "status": "queued",
        "message": "Document uploaded and queued for processing.",
    })


@app.get("/api/documents/{doc_id}/status")
async def get_document_status(doc_id: str, current_user: dict = Depends(get_current_user)):
    doc = await asyncio.to_thread(db.get_document, doc_id, current_user["id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return {
        "document_id": doc_id,
        "status": doc["status"],
        "progress": doc.get("progress", 0),
        "status_message": doc.get("status_message", ""),
        "metadata": doc.get("metadata", {}),
    }


@app.get("/api/documents/{doc_id}")
async def get_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    doc = await asyncio.to_thread(db.get_document, doc_id, current_user["id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"success": True, "document": doc}


@app.get("/api/documents/{doc_id}/file-url")
async def get_file_url(doc_id: str, current_user: dict = Depends(get_current_user)):
    doc = await asyncio.to_thread(db.get_document, doc_id, current_user["id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    url = await asyncio.to_thread(storage_client.get_signed_url, doc["file_path"], 3600)
    return {"success": True, "url": url}


@app.get("/api/documents/{doc_id}/chunks/overlays")
async def get_chunk_overlays(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Lightweight endpoint — returns only chunk_id, chunk_type, page, bbox. No markdown."""
    doc = await asyncio.to_thread(db.get_document, doc_id, current_user["id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    chunks = await asyncio.to_thread(qdrant_store.get_chunk_overlays_by_doc, doc_id, current_user["id"])
    return {"success": True, "chunks": chunks}


@app.get("/api/documents/{doc_id}/chunks")
async def get_chunks(doc_id: str, current_user: dict = Depends(get_current_user)):
    doc = await asyncio.to_thread(db.get_document, doc_id, current_user["id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    chunks = await asyncio.to_thread(qdrant_store.get_chunks_by_doc, doc_id, current_user["id"])
    return {"success": True, "chunks": chunks}


@app.get("/api/documents/{doc_id}/grounding")
async def get_grounding(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Return table-cell level grounding data for a document."""
    rows = await asyncio.to_thread(db.get_grounding, doc_id, current_user["id"])
    # Reshape into a lookup dict: element_id → {page, bbox, type}
    grounding: dict = {}
    for row in rows:
        grounding[row["element_id"]] = {
            "page": row["page"],
            "type": row["type"],
            "bbox": {
                "left":   row["bbox_left"],
                "top":    row["bbox_top"],
                "right":  row["bbox_right"],
                "bottom": row["bbox_bottom"],
            },
        }
    return {"success": True, "grounding": grounding}


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]

    # Verify ownership first — 404 if not found or belongs to another user
    doc = await asyncio.to_thread(db.get_document, doc_id, user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Mark as deleting so in-flight worker jobs abort their final upsert
    await asyncio.to_thread(db.update_document, doc_id, {"status": "deleting"})

    # External systems — best-effort; failures must not block DB cleanup,
    # but we log them so orphaned points / files are diagnosable.
    try:
        await asyncio.to_thread(qdrant_store.delete_doc_chunks, doc_id, user_id)
    except Exception as e:
        logger.warning(f"delete: qdrant cleanup failed for doc {doc_id}: {e}")
    try:
        await asyncio.to_thread(storage_client.delete_folder, user_id, doc_id)
    except Exception as e:
        logger.warning(f"delete: storage cleanup failed for doc {doc_id}: {e}")

    # DB — children first, then parent (preserves referential integrity)
    await asyncio.to_thread(db.delete_document, doc_id, user_id)
    return {"success": True}


@app.post("/api/documents/{doc_id}/retry")
async def retry_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    doc = await asyncio.to_thread(db.get_document, doc_id, user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("status") != "error":
        raise HTTPException(status_code=400, detail="Only failed documents can be retried")
    file_path = doc.get("file_path")
    if not file_path:
        raise HTTPException(status_code=400, detail="Document has no stored file path — cannot retry")

    await asyncio.to_thread(db.update_document, doc_id, {
        "status": "queued",
        "progress": 0,
        "status_message": "Retrying...",
    })
    try:
        from worker import get_arq_pool
        pool = await get_arq_pool()
        await pool.enqueue_job("process_document", doc_id, user_id, file_path)
        await pool.aclose()
    except Exception as e:
        logger.error(f"Failed to enqueue retry for doc {doc_id}: {e}", exc_info=True)
        await asyncio.to_thread(db.update_document, doc_id, {
            "status": "error",
            "status_message": "Could not queue for retry — try again shortly.",
        })
        raise HTTPException(status_code=503, detail="Processing queue unavailable.")

    return {"success": True}


@app.get("/api/documents/{doc_id}/extract")
async def get_extract(doc_id: str, current_user: dict = Depends(get_current_user)):
    doc = await asyncio.to_thread(db.get_document, doc_id, current_user["id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # ── Existing structured fields (unchanged) ────────────────────────────────
    extract = doc.get("extract_data") or {}

    # ── Build table list from processed.json (cache → Storage) ───────────────
    tables: list = []
    try:
        user_id = current_user["id"]
        markdown, grounding = _get_doc_cache(doc_id)
        if not markdown:
            # Try the correct path first, then fall back to the legacy mis-named path
            for try_path in [
                f"{user_id}/{doc_id}/processed.json",
                f"{user_id}/{doc_id}/original.json",
            ]:
                try:
                    cache_bytes = await asyncio.to_thread(
                        lambda p=try_path: storage_client.get_client().storage
                            .from_(storage_client.BUCKET).download(p)
                    )
                    if cache_bytes:
                        cached    = json.loads(cache_bytes)
                        markdown  = cached.get("markdown", "")
                        grounding = cached.get("grounding", {})
                        _set_doc_cache(doc_id, markdown, grounding)
                        break
                except Exception:
                    continue

        if markdown:
            tables = await asyncio.to_thread(_build_all_tables, markdown, grounding or {})
            # Fill company_name from markdown if ADE extract left it blank
            if not extract.get("company_name") and markdown:
                doc_name = _extract_doc_name(markdown)
                if doc_name:
                    extract = {**extract, "company_name": doc_name}
    except Exception as e:
        logger.warning(f"extract tables build failed for {doc_id}: {e}")
        # tables stays [] — UI handles empty state gracefully

    # Last resort: use document filename
    if not extract.get("company_name"):
        raw_name = doc.get("filename") or doc.get("metadata", {}).get("filename") or ""
        if raw_name:
            extract = {**extract, "company_name": re.sub(r'\.[^.]+$', '', raw_name).replace("_", " ").replace("-", " ").strip()}

    return {"success": True, "extract": extract, "tables": tables}


# ── Report endpoints (section-by-section generation) ─────────────────────────
from report_templates import (
    get_template_sections, get_section_config, build_section_extract, TEMPLATES, SECTION_CONFIGS,
)


def _build_section_chunks(all_chunks: list, rag_query: str, top_k: int) -> str:
    """Build context string from chunks, preferring those matching the rag_query keywords."""
    keywords = set(rag_query.lower().split())
    scored = []
    for c in all_chunks:
        if c.get("chunk_type") not in ("text", "title", "key_value", "table"):
            continue
        md = c.get("markdown", "")
        lower_md = md.lower()
        score = sum(1 for kw in keywords if kw in lower_md)
        scored.append((score, c.get("page", 0), md))
    scored.sort(key=lambda x: (-x[0], x[1]))
    lines = [f"[p{s[1]+1}] {s[2]}" for s in scored[:top_k]]
    return "\n\n".join(lines)[:5000]


@app.post("/api/documents/{doc_id}/report")
@limiter.limit("5/hour")
async def generate_report(
    doc_id: str,
    request: Request,
    body: ReportGenerateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Generate a multi-section report. Streams SSE events per section."""
    doc = await asyncio.to_thread(db.get_document, doc_id, current_user["id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    template_id = body.template if body.template in TEMPLATES else "full_analysis"

    user_id = current_user["id"]
    extract = doc.get("extract_data") or {}
    section_ids = get_template_sections(template_id)

    # Create report row upfront
    report_id = str(uuid.uuid4())
    initial_sections = {sid: {"markdown": "", "status": "pending"} for sid in section_ids}
    await asyncio.to_thread(db.insert_report, {
        "id": report_id,
        "doc_id": doc_id,
        "user_id": user_id,
        "template": template_id,
        "sections": initial_sections,
        "status": "generating",
        "word_count": 0,
    })

    async def generate():
        # Fetch all chunks once, reuse per section
        try:
            all_chunks = await asyncio.to_thread(qdrant_store.get_chunks_by_doc, doc_id, user_id, 120)
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'text': str(e)})}\n\n"
            return

        yield f"data: {json.dumps({'type': 'report_start', 'report_id': report_id, 'template': template_id, 'sections': section_ids})}\n\n"


        total_words = 0

        for idx, section_id in enumerate(section_ids):
            cfg = get_section_config(section_id)
            yield f"data: {json.dumps({'type': 'section_start', 'section': section_id, 'index': idx, 'title': cfg['title']})}\n\n"

            section_extract = build_section_extract(extract, cfg["extract_keys"])
            context_text = _build_section_chunks(all_chunks, cfg["rag_query"], cfg["rag_top_k"])

            extract_json = json.dumps(section_extract, indent=2) if section_extract else "No data available for this section."

            user_msg = (
                f"Structured financial data for this section:\n```json\n{extract_json}\n```\n\n"
                f"Relevant document excerpts:\n{context_text}\n\n---\n\n"
                f"Write the **{cfg['title']}** section now. "
                f"Start with ## {cfg['title']} as the header. Be precise, cite specific figures."
            )

            section_md = ""
            try:
                stream = _oai.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": cfg["system"]},
                        {"role": "user", "content": user_msg},
                    ],
                    stream=True,
                    temperature=0.2,
                    max_tokens=cfg["max_tokens"],
                )
                client_gone = False
                for chunk in stream:
                    # Bail out if user closed the tab — saves OpenAI tokens
                    # for sections the user will never see.
                    if await request.is_disconnected():
                        client_gone = True
                        stream.close()
                        break
                    delta = chunk.choices[0].delta.content if chunk.choices else None
                    if delta:
                        section_md += delta
                        yield f"data: {json.dumps({'type': 'delta', 'section': section_id, 'text': delta})}\n\n"

                if client_gone:
                    # Persist whatever we got, mark partial, stop the report
                    await asyncio.to_thread(db.update_report_section, report_id, section_id, {
                        "markdown": section_md,
                        "status": "error",
                        "error": "client_disconnected",
                    })
                    logger.info(f"report {report_id}: client disconnected during {section_id}")
                    return

                word_count = len(section_md.split())
                total_words += word_count

                # Persist this section
                await asyncio.to_thread(db.update_report_section, report_id, section_id, {
                    "markdown": section_md,
                    "status": "done",
                    "word_count": word_count,
                })
                yield f"data: {json.dumps({'type': 'section_done', 'section': section_id, 'word_count': word_count})}\n\n"

            except openai.RateLimitError:
                await asyncio.to_thread(db.update_report_section, report_id, section_id, {
                    "markdown": section_md,
                    "status": "error",
                    "error": "rate_limit",
                })
                yield f"data: {json.dumps({'type': 'section_error', 'section': section_id, 'error': 'Rate limit reached. Please retry this section in a moment.'})}\n\n"
            except Exception as e:
                await asyncio.to_thread(db.update_report_section, report_id, section_id, {
                    "markdown": section_md,
                    "status": "error",
                    "error": str(e),
                })
                yield f"data: {json.dumps({'type': 'section_error', 'section': section_id, 'error': str(e)})}\n\n"

        # Mark report complete
        await asyncio.to_thread(db.update_report, report_id, {
            "status": "complete",
            "word_count": total_words,
        })
        yield f"data: {json.dumps({'type': 'report_done', 'report_id': report_id, 'word_count': total_words})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/documents/{doc_id}/reports")
async def list_doc_reports(doc_id: str, current_user: dict = Depends(get_current_user)):
    """List all reports for a document (metadata only, no section content)."""
    reports = await asyncio.to_thread(db.list_reports, doc_id, current_user["id"])
    return {"success": True, "reports": reports}


@app.get("/api/reports/{report_id}")
async def get_report(report_id: str, current_user: dict = Depends(get_current_user)):
    """Get a full report with all sections."""
    report = await asyncio.to_thread(db.get_report, report_id, current_user["id"])
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"success": True, "report": report}


@app.delete("/api/reports/{report_id}")
async def delete_report(report_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a report."""
    deleted = await asyncio.to_thread(db.delete_report, report_id, current_user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"success": True}


@app.post("/api/reports/{report_id}/regenerate-section")
@limiter.limit("10/hour")
async def regenerate_section(
    report_id: str,
    request: Request,
    body: RegenerateSectionRequest,
    current_user: dict = Depends(get_current_user),
):
    """Regenerate a single section of an existing report."""
    report = await asyncio.to_thread(db.get_report, report_id, current_user["id"])
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    section_id = body.section
    if section_id not in SECTION_CONFIGS:
        raise HTTPException(status_code=400, detail="Invalid section ID")

    doc_id = report["doc_id"]
    user_id = current_user["id"]
    doc = await asyncio.to_thread(db.get_document, doc_id, user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    extract = doc.get("extract_data") or {}

    async def generate():
        try:
            all_chunks = await asyncio.to_thread(qdrant_store.get_chunks_by_doc, doc_id, user_id, 120)
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'text': str(e)})}\n\n"
            return

        cfg = get_section_config(section_id)
        yield f"data: {json.dumps({'type': 'section_start', 'section': section_id, 'title': cfg['title']})}\n\n"

        section_extract = build_section_extract(extract, cfg["extract_keys"])
        context_text = _build_section_chunks(all_chunks, cfg["rag_query"], cfg["rag_top_k"])
        extract_json = json.dumps(section_extract, indent=2) if section_extract else "No data available."

        user_msg = (
            f"Structured financial data:\n```json\n{extract_json}\n```\n\n"
            f"Relevant document excerpts:\n{context_text}\n\n---\n\n"
            f"Rewrite the **{cfg['title']}** section. "
            f"Start with ## {cfg['title']}. Be precise, cite specific figures."
        )

        section_md = ""
        try:
            stream = _oai.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": cfg["system"]},
                    {"role": "user", "content": user_msg},
                ],
                stream=True,
                temperature=0.2,
                max_tokens=cfg["max_tokens"],
            )
            for chunk in stream:
                if await request.is_disconnected():
                    stream.close()
                    logger.info(f"regenerate-section {section_id}: client disconnected")
                    return
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    section_md += delta
                    yield f"data: {json.dumps({'type': 'delta', 'section': section_id, 'text': delta})}\n\n"

            word_count = len(section_md.split())
            await asyncio.to_thread(db.update_report_section, report_id, section_id, {
                "markdown": section_md,
                "status": "done",
                "word_count": word_count,
            })
            yield f"data: {json.dumps({'type': 'section_done', 'section': section_id, 'word_count': word_count})}\n\n"
        except Exception as e:
            await asyncio.to_thread(db.update_report_section, report_id, section_id, {
                "markdown": section_md,
                "status": "error",
                "error": str(e),
            })
            yield f"data: {json.dumps({'type': 'section_error', 'section': section_id, 'error': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/report-templates")
async def get_templates(current_user: dict = Depends(get_current_user)):
    """Return available report templates."""
    templates = []
    for tid, t in TEMPLATES.items():
        templates.append({
            "id": tid,
            "label": t["label"],
            "description": t["description"],
            "section_count": len(t["sections"]),
            "word_target": t["word_target"],
            "sections": [SECTION_CONFIGS[s]["title"] for s in t["sections"]],
        })
    return {"success": True, "templates": templates}


@app.post("/api/documents/{doc_id}/chat")
@limiter.limit("20/minute")
async def chat_document(
    doc_id: str,
    request: Request,
    body: ChatRequest,
    current_user: dict = Depends(get_current_user),
):
    message = body.message.strip()
    history = [h.model_dump() for h in body.history]

    doc = await asyncio.to_thread(db.get_document, doc_id, current_user["id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    user_id = current_user["id"]

    async def generate():
        # 1. Fetch grounding data for citation resolution
        try:
            grounding_rows = await asyncio.to_thread(db.get_grounding, doc_id, user_id)
        except Exception:
            grounding_rows = []
        grounding_dict = {}
        for row in grounding_rows:
            grounding_dict[row["element_id"]] = {
                "page": row["page"],
                "type": row["type"],
                "bbox": {
                    "left":   row["bbox_left"],
                    "top":    row["bbox_top"],
                    "right":  row["bbox_right"],
                    "bottom": row["bbox_bottom"],
                },
            }

        # 2. Try full-context mode: load processed.json (memory cache → Supabase Storage)
        full_markdown, grounding_from_cache = _get_doc_cache(doc_id)
        if full_markdown is None:
            full_markdown = ""
            grounding_from_cache = {}
            cache_path = f"{user_id}/{doc_id}/processed.json"
            try:
                cache_bytes = await asyncio.to_thread(
                    lambda: storage_client.get_client().storage.from_(storage_client.BUCKET).download(cache_path)
                )
                cached = json.loads(cache_bytes)
                full_markdown = cached.get("markdown", "")
                grounding_from_cache = cached.get("grounding", {})
                _set_doc_cache(doc_id, full_markdown, grounding_from_cache)
            except Exception:
                full_markdown = ""
                grounding_from_cache = {}

        # Merge cache grounding into grounding_dict (DB takes precedence)
        if grounding_from_cache:
            for eid, g in grounding_from_cache.items():
                if eid not in grounding_dict:
                    grounding_dict[eid] = g

        # 2b. Fetch ALL chunks — serve from cache on subsequent turns (zero Qdrant I/O)
        all_chunks = _get_chunk_cache(doc_id)
        if all_chunks is None:
            try:
                all_chunks = await asyncio.to_thread(qdrant_store.get_chunks_by_doc, doc_id, user_id)
                _set_chunk_cache(doc_id, all_chunks)
            except Exception:
                all_chunks = []

        # 3. Decide: full-context or RAG
        context = None
        results = []  # Qdrant results, only populated in RAG mode
        use_full_context = False

        full_ctx = _build_full_context(full_markdown, qdrant_chunks=all_chunks)
        if full_ctx is not None:
            context = full_ctx
            use_full_context = True
        else:
            # RAG fallback: embed query and search Qdrant
            try:
                query_vec = await asyncio.to_thread(embeddings.embed_query, message)
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'text': str(e)})}\n\n"
                return

            try:
                results = await asyncio.to_thread(qdrant_store.search, query_vec, user_id, doc_id, 10)
                context = _build_rag_context(results)
            except Exception:
                # Qdrant unreachable — fall back to keyword search on cached markdown
                logger.warning("Qdrant search failed — using keyword fallback")
                context = _keyword_search_fallback(full_markdown, message)
                results = []

        # 4. Build messages with citation instructions
        system_msg = (
            "You are a financial document analyst reasoning with a structured financial document.\n"
            "Give precise, evidence-grounded answers — not generic financial knowledge.\n\n"
            "Rules:\n"
            "1. Answer only from the document context provided. If absent, say 'not available in this document.'\n"
            "2. Match response depth to the question:\n"
            "   - Direct lookup ('what is X'): one value, one or two sentences.\n"
            "   - Comparison ('compare X vs Y' / 'difference'): both values, absolute + % change.\n"
            "   - Analytical ('why did X change'): decompose into contributing line items.\n"
            "   - Section overview ('tell me about X'): key figures for ALL available periods.\n"
            "3. Preserve exact values — do not round, abbreviate, or paraphrase numbers.\n"
            "4. Parenthetical values like (880,843) are negative — label them as losses/expenses.\n"
            "5. When a section has multiple year-tables (e.g. Statement of Changes in Equity has\n"
            "   separate 2018 and 2019 tables), include figures from ALL year-tables unless the\n"
            "   user specifies a single year. Label each figure with its year.\n"
            "6. Never guess. If a value is not in the context, say so explicitly.\n\n"
            "Citation: append the cell ID in double brackets immediately after every figure you cite.\n"
            "  Table cell: 1,529,797 [[cell-id]]   Text chunk: noted in audit [[uuid]]\n"
            "Do not cite the same ID twice. Cite every unique figure you mention.\n\n"
            "Section awareness: always cite from the section that matches the question "
            "(e.g. 'Statement of Financial Position', 'Statement of Changes in Equity', 'Cash Flows')."
        )
        messages = [{"role": "system", "content": system_msg}]
        for h in history[-6:]:
            if h.get("role") in ("user", "assistant") and h.get("content"):
                messages.append({"role": h["role"], "content": h["content"]})
        messages.append({
            "role": "user",
            "content": f"Document context:\n\n{context}\n\n---\n\nQuestion: {message}",
        })

        # 5. Stream LLM response with citation stripping
        full_answer = ""
        cited_ids = []
        pending = ""  # buffer for potential citation markers

        try:
            stream = _oai.chat.completions.create(
                model="gpt-4.1",
                messages=messages,
                stream=True,
                temperature=0.1,
                max_tokens=2048,
            )
            for chunk in stream:
                if await request.is_disconnected():
                    stream.close()
                    logger.info(f"chat {doc_id}: client disconnected mid-stream")
                    return
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if not delta:
                    continue
                full_answer += delta
                pending += delta

                # Process pending buffer — strip [[id]] citations before sending
                clean_out = ""
                while pending:
                    bracket_start = pending.find('[[')
                    if bracket_start == -1:
                        # No citation start found
                        if pending.endswith('['):
                            # Might be start of '[[' — hold back
                            clean_out += pending[:-1]
                            pending = '['
                            break
                        else:
                            clean_out += pending
                            pending = ""
                    else:
                        # Emit everything before the citation
                        clean_out += pending[:bracket_start]
                        # Check if citation is complete
                        bracket_end = pending.find(']]', bracket_start + 2)
                        if bracket_end != -1:
                            # Complete citation — extract ID, don't emit
                            cited_id = pending[bracket_start + 2:bracket_end].strip()
                            if cited_id:
                                cited_ids.append(cited_id)
                            pending = pending[bracket_end + 2:]
                        else:
                            # Citation not complete — wait for more tokens
                            pending = pending[bracket_start:]
                            break

                if clean_out:
                    yield f"data: {json.dumps({'type': 'delta', 'text': clean_out})}\n\n"
        except openai.RateLimitError:
            yield f"data: {json.dumps({'type': 'error', 'text': 'Rate limit reached. Please wait a moment and try again.'})}\n\n"
            return
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'text': str(e)})}\n\n"
            return

        # Flush any remaining pending text
        if pending:
            yield f"data: {json.dumps({'type': 'delta', 'text': pending})}\n\n"

        # 6. Application-level value matching (Landing.AI approach)
        cell_lookup = _build_cell_text_lookup(full_markdown)
        cell_section_map: dict = {}

        if not cell_lookup and full_markdown and '<td' not in full_markdown.lower():
            cell_lookup, cell_section_map = _build_plaintext_cell_lookup(
                full_markdown, grounding_dict, all_chunks
            )
        elif cell_lookup:
            cell_section_map = _build_cell_section_map(grounding_dict, all_chunks)

        if not cell_lookup and results:
            for r in results:
                p = r.payload
                if p and p.get("chunk_type") == "table":
                    md = p.get("markdown", "")
                    for cid, chtml in _CELL_EXTRACT_RE.findall(md):
                        text = re.sub(r"<[^>]+>", "", chtml).strip()
                        cell_lookup[cid] = text
            if not cell_section_map:
                cell_section_map = _build_cell_section_map(grounding_dict, [r.payload for r in results if r.payload])

        # Build table grids for row/col/group cross-reference resolution
        table_grids = _build_table_grids(full_markdown)

        question_qualifiers = _extract_question_qualifiers(message)

        matched = _find_all_matching_cells(
            full_answer, cell_lookup, grounding_dict, cited_ids,
            question_qualifiers=question_qualifiers,
            cell_section_map=cell_section_map,
            question_text=message,
        )

        # Build source chunks with full cross-cell context
        source_chunks = []
        for cell_id, cell_text, score in matched:
            g = grounding_dict.get(cell_id)
            if not g:
                continue
            g_type = (g.get("type", "") or "").lower()

            # Cross-cell resolution: row label, sub-group header, column header
            cross = {"row_label_id": None, "group_label_id": None, "col_header_id": None}
            year_label: str | None = None
            grid = _find_grid_for_cell(cell_id, table_grids)
            if grid:
                cross     = _get_cross_cells(grid, cell_id)
                year_label = grid["year_label"]

            row_label_text   = cell_lookup.get(cross["row_label_id"]   or "", "")
            group_label_text = cell_lookup.get(cross["group_label_id"] or "", "")
            col_header_text  = cell_lookup.get(cross["col_header_id"]  or "", "")

            source_chunks.append({
                "chunk_id":        cell_id,
                "chunk_type":      "table_cell" if ("cell" in g_type or re.match(r'^\d+-\d+$', cell_id)) else g.get("type", "text"),
                "page":            g.get("page", 0),
                "bbox":            g.get("bbox") or {},
                "section_header":  cell_section_map.get(cell_id, ""),
                "markdown":        cell_text,
                "score":           score / 100.0,
                # Cross-cell references (IDs for highlight, texts for chip label)
                "row_label_id":    cross["row_label_id"],
                "row_label_text":  row_label_text,
                "group_label_id":  cross["group_label_id"],
                "group_label_text": group_label_text,
                "col_header_id":   cross["col_header_id"],
                "col_header_text": col_header_text,
                "year_label":      year_label,
            })

        # Fallback: if no matches found at all, use top 3 RAG results
        if not source_chunks and results:
            for r in results[:3]:
                p = r.payload
                if p:
                    source_chunks.append({
                        "chunk_id": p.get("chunk_id", ""),
                        "chunk_type": p.get("chunk_type", ""),
                        "section_header": p.get("section_header", ""),
                        "page": p.get("page", 0),
                        "markdown": p.get("markdown", ""),
                        "bbox": p.get("bbox") or {},
                        "score": round(r.score, 4),
                    })

        yield f"data: {json.dumps({'type': 'sources', 'chunks': source_chunks})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── FinBot ───────────────────────────────────────────────────────────────────

@app.post("/api/finbot/chat")
@limiter.limit("20/minute")
async def finbot_chat(
    request: Request,
    body: ChatRequest,
    current_user: dict = Depends(get_current_user),
):
    import finbot as fb

    message = body.message.strip()
    history = [h.model_dump() for h in body.history]

    async def generate():
        system_msg = (
            "You are FinBot, an expert financial markets assistant. "
            "You have access to live market data tools: stock quotes, fundamentals, price history, news, and comparisons. "
            "Always use the tools to fetch real data before answering — never guess prices or figures. "
            "Be concise and precise. Format numbers clearly (e.g. $1.23T, 15.4%, $234.56). "
            "When showing multiple data points, use a clean structured format."
        )

        messages = [{"role": "system", "content": system_msg}]
        for h in history[-8:]:
            if h.get("role") in ("user", "assistant") and h.get("content"):
                messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": message})



        try:
            # Agentic loop: allow up to 4 tool call rounds
            for _ in range(4):
                if await request.is_disconnected():
                    logger.info("finbot: client disconnected before tool round")
                    return
                try:
                    response = await asyncio.to_thread(
                        lambda: _oai.chat.completions.create(
                            model="gpt-4o-mini",
                            messages=messages,
                            tools=fb.TOOLS,
                            tool_choice="auto",
                            temperature=0.2,
                            max_tokens=1024,
                        )
                    )
                except openai.RateLimitError:
                    yield f"data: {json.dumps({'type': 'error', 'text': 'Rate limit reached. Please wait a moment and try again.'})}\n\n"
                    return
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'text': str(e)})}\n\n"
                    return

                choice = response.choices[0]
                messages.append(choice.message)

                # No tool calls → stream final answer
                if not choice.message.tool_calls:
                    content = choice.message.content or ""
                    # Stream word-by-word for smooth UX
                    for word in content.split(" "):
                        if await request.is_disconnected():
                            return
                        yield f"data: {json.dumps({'type': 'delta', 'text': word + ' '})}\n\n"
                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                    return

                # Execute all tool calls — failures continue loop with error result
                for tc in choice.message.tool_calls:
                    fn_name = tc.function.name
                    try:
                        fn_args = json.loads(tc.function.arguments)
                    except Exception:
                        fn_args = {}
                    fn = fb.TOOL_MAP.get(fn_name)
                    try:
                        tool_result = await asyncio.to_thread(fn, **fn_args) if fn else {"error": f"Unknown tool: {fn_name}"}
                    except Exception as te:
                        logger.warning(f"FinBot tool {fn_name} failed: {te}")
                        tool_result = {"error": str(te)}

                    yield f"data: {json.dumps({'type': 'tool', 'name': fn_name, 'args': fn_args})}\n\n"

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps(tool_result),
                    })

            # Safety fallback if loop exhausted
            yield f"data: {json.dumps({'type': 'delta', 'text': 'Sorry, I could not complete the request.'})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'text': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── FinBot News Feed ─────────────────────────────────────────────────────────

@app.get("/api/finbot/news")
async def finbot_news(current_user: dict = Depends(get_current_user)):
    """Fetch recent market news from popular tickers for the sidebar."""
    import finbot as fb
    MARKET_TICKERS = ["SPY", "AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "META", "GOOGL"]
    seen_titles: set = set()
    combined = []
    for ticker in MARKET_TICKERS:
        result = await asyncio.to_thread(fb.get_news, ticker)
        for item in result.get("news", []):
            title = (item.get("title") or "").strip()
            if not title or title in seen_titles:
                continue
            seen_titles.add(title)
            combined.append({
                "title":    title,
                "source":   item.get("publisher", ""),
                "date":     item.get("published", ""),
                "url":      item.get("link", "#"),
                "image":    item.get("image"),
                "ticker":   ticker,
                "category": "market",
            })
        if len(combined) >= 12:
            break
    return {"success": True, "news": combined[:10]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host=settings.HOST, port=settings.PORT, reload=True)
