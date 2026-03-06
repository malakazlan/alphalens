import os
import json
import numpy as np
from typing import Dict, Any, List, Tuple, Optional
import re

try:
    import openai
    from config import settings
    _OPENAI_KEY = (settings.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY") or "").strip()
except Exception:
    openai = None
    _OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "").strip()

EMBEDDING_MODEL = "text-embedding-3-small"
_EMBED_BATCH_LIMIT = 2048

DEFAULT_CHUNK_SIZE = 1000
DEFAULT_CHUNK_OVERLAP = 200


def _embed_texts(texts: List[str]) -> Optional[List[List[float]]]:
    """Batch-embed a list of texts via OpenAI. Returns None on failure."""
    if not openai or not _OPENAI_KEY or not texts:
        return None
    try:
        client = openai.OpenAI(api_key=_OPENAI_KEY)
        cleaned = [t[:8000] if t else " " for t in texts]
        all_embeddings: List[List[float]] = [None] * len(cleaned)
        for start in range(0, len(cleaned), _EMBED_BATCH_LIMIT):
            batch = cleaned[start:start + _EMBED_BATCH_LIMIT]
            resp = client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
            for item in resp.data:
                all_embeddings[start + item.index] = item.embedding
        return all_embeddings
    except Exception as exc:
        print(f"[vector_store] Embedding failed (falling back to keyword): {exc}")
        return None


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)

def create_vector_store(
    financial_data: Dict[str, Any],
    pdf_text: str,
    vector_store_path: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP
) -> None:
    """
    Create a simple vector store from financial data and PDF text
    
    Args:
        financial_data: Extracted financial data
        pdf_text: Raw text from PDF
        vector_store_path: Path to store vectors
        chunk_size: Size of text chunks
        chunk_overlap: Overlap between chunks
    """
    try:
        # Create vector store directory if it doesn't exist
        os.makedirs(vector_store_path, exist_ok=True)
        
        # Save financial data for quick retrieval
        financial_data_path = os.path.join(vector_store_path, "financial_data.json")
        with open(financial_data_path, "w") as f:
            json.dump(financial_data, f)
        
        # Split PDF text into chunks
        # IMPORTANT: Rename the function call to split_text to avoid name collision
        pdf_chunks = split_text(pdf_text, chunk_size, chunk_overlap)
        
        # Create vectors from chunks (simplified for MVP)
        vectors = []
        for i, chunk in enumerate(pdf_chunks):
            # In a real implementation, we'd use a proper embedding model here
            # For MVP, we'll just store the raw text
            vector_entry = {
                "id": f"chunk-{i}",
                "text": chunk,
                "metadata": {
                    "source": "pdf",
                    "index": i,
                    "chunk_id": f"chunk-{i}",
                    "page": None
                }
            }
            vectors.append(vector_entry)
        
        # Add financial data as chunks too
        # Metadata
        metadata_text = json.dumps(financial_data.get("metadata", {}), indent=2)
        vector_entry = {
            "id": "metadata",
            "text": metadata_text,
            "metadata": {
                "source": "metadata",
                "chunk_id": "metadata",
                "page": None
            }
        }
        vectors.append(vector_entry)
        
        # Income statement
        if financial_data.get("income_statement"):
            income_text = json.dumps(financial_data.get("income_statement", {}), indent=2)
            vector_entry = {
                "id": "income_statement",
                "text": "Income Statement: " + income_text,
                "metadata": {
                    "source": "income_statement",
                    "chunk_id": "income_statement",
                    "page": None
                }
            }
            vectors.append(vector_entry)
        
        # Balance sheet
        if financial_data.get("balance_sheet"):
            balance_text = json.dumps(financial_data.get("balance_sheet", {}), indent=2)
            vector_entry = {
                "id": "balance_sheet",
                "text": "Balance Sheet: " + balance_text,
                "metadata": {
                    "source": "balance_sheet",
                    "chunk_id": "balance_sheet",
                    "page": None
                }
            }
            vectors.append(vector_entry)
        
        # Cash flow
        if financial_data.get("cash_flow"):
            cash_text = json.dumps(financial_data.get("cash_flow", {}), indent=2)
            vector_entry = {
                "id": "cash_flow",
                "text": "Cash Flow: " + cash_text,
                "metadata": {
                    "source": "cash_flow",
                    "chunk_id": "cash_flow",
                    "page": None
                }
            }
            vectors.append(vector_entry)
        
        # Key metrics
        if financial_data.get("key_metrics"):
            for i, metric in enumerate(financial_data.get("key_metrics", [])):
                metric_text = json.dumps(metric, indent=2)
                vector_entry = {
                    "id": f"metric-{i}",
                    "text": f"Key Metric: {metric.get('name', 'Unknown')}: {metric_text}",
                    "metadata": {
                        "source": "key_metrics",
                        "metric": metric.get("name", "Unknown"),
                        "chunk_id": f"metric-{i}",
                        "page": None
                    }
                }
                vectors.append(vector_entry)
        
        # Include summary if available
        if financial_data.get("summary"):
            vectors.append({
                "id": "summary",
                "text": f"Document Summary: {financial_data['summary']}",
                "metadata": {
                    "source": "summary",
                    "chunk_id": "summary",
                    "page": None
                }
            })
        
        # Include tables (whole-table vector for broad matching)
        for idx, table in enumerate(financial_data.get("tables", [])):
            header = table.get("header") or []
            rows = table.get("rows") or []
            title = table.get("title") or f"Table {idx + 1}"
            page = table.get("page")
            table_id = table.get("id") or f"table-{idx}"
            
            table_text = f"{title} (Page {page + 1 if isinstance(page, int) else 'n/a'}):\n"
            if header:
                table_text += " | ".join(header) + "\n"
            for row in rows[:15]:
                row_values = []
                for col in header or row.keys():
                    row_values.append(str(row.get(col, "")).strip())
                table_text += " | ".join(row_values) + "\n"
            if len(rows) > 15:
                table_text += f"... (+{len(rows) - 15} more rows)\n"
            
            vectors.append({
                "id": table_id,
                "text": table_text,
                "metadata": {
                    "source": "table",
                    "chunk_id": table_id,
                    "page": page,
                    "title": title
                }
            })

        # --- Context-enriched cell vectors from detected_chunks ---
        # A cell "500" alone is semantically meaningless. By embedding
        # "Table: Fee Bill | Column: Amount in Pak Rs. | Row: Disciplinary Fine | Value: 500"
        # the embedding captures the full row-column relationship so
        # "how much is disciplinary fine?" matches the right cell.

        # Build a lookup: parent_table_id → (header, {row_index → row_dict})
        _table_lookup: Dict[str, Dict[str, Any]] = {}
        for tbl in financial_data.get("tables", []):
            tid = tbl.get("id", "")
            if tid:
                _table_lookup[tid] = {
                    "title": tbl.get("title", "Table"),
                    "header": tbl.get("header") or [],
                    "rows": tbl.get("rows") or [],
                }

        # Group cells by (parent_table_id, row) so we can pair label ↔ value
        _cells_by_table_row: Dict[str, Dict[int, List[Dict]]] = {}
        for chunk in financial_data.get("detected_chunks", []):
            if chunk.get("type") == "table_cell":
                ptid = chunk.get("parent_table_id", "")
                row_idx = chunk.get("row")
                if ptid and row_idx is not None:
                    _cells_by_table_row.setdefault(ptid, {}).setdefault(row_idx, []).append(chunk)

        for chunk in financial_data.get("detected_chunks", []):
            if chunk.get("type") == "table_cell":
                cell_text = chunk.get("text", "").strip()
                if not cell_text:
                    continue

                ptid = chunk.get("parent_table_id", "")
                row_idx = chunk.get("row")
                col_idx = chunk.get("col")
                tbl_info = _table_lookup.get(ptid, {})
                header = tbl_info.get("header") or []
                title = tbl_info.get("title", "Table")

                col_header = header[col_idx] if header and col_idx is not None and col_idx < len(header) else ""
                row_siblings = _cells_by_table_row.get(ptid, {}).get(row_idx, [])
                row_label = ""
                for sib in row_siblings:
                    sib_col = sib.get("col")
                    sib_text = (sib.get("text") or "").strip()
                    if sib_col is not None and sib_col == 0 and sib_text and sib_text != cell_text:
                        row_label = sib_text
                        break

                parts = [f"Table: {title}"]
                if col_header:
                    parts.append(f"Column: {col_header}")
                if row_label:
                    parts.append(f"Row: {row_label}")
                parts.append(f"Value: {cell_text}")
                enriched_text = " | ".join(parts)

                vectors.append({
                    "id": chunk["id"],
                    "text": enriched_text,
                    "metadata": {
                        "source": "table_cell",
                        "chunk_id": chunk["id"],
                        "parent_table_id": ptid,
                        "page": chunk.get("page"),
                        "row": row_idx,
                        "col": col_idx,
                    }
                })
            elif chunk.get("type") in ("figure", "chart", "graph"):
                description = chunk.get("description", "").strip()
                if description:
                    vectors.append({
                        "id": chunk["id"],
                        "text": description,
                        "metadata": {
                            "source": "figure",
                            "chunk_id": chunk["id"],
                            "page": chunk.get("page"),
                            "subtype": chunk.get("subtype", ""),
                        }
                    })
        
        # ── Compute embeddings for all vectors ──
        texts = [v.get("text", "") for v in vectors]
        embeddings = _embed_texts(texts)
        if embeddings:
            for idx, vec in enumerate(vectors):
                vec["embedding"] = embeddings[idx]
            print(f"[OK] Embedded {len(vectors)} chunks via {EMBEDDING_MODEL}")
        else:
            for vec in vectors:
                vec["embedding"] = None
            print("[WARN] Embeddings unavailable -- keyword search will be used as fallback")

        # Save vectors to file
        vectors_path = os.path.join(vector_store_path, "vectors.json")
        with open(vectors_path, "w") as f:
            json.dump(vectors, f)
    
    except Exception as e:
        print(f"Error creating vector store: {str(e)}")
        import traceback
        traceback.print_exc()
        os.makedirs(vector_store_path, exist_ok=True)
        financial_data_path = os.path.join(vector_store_path, "financial_data.json")
        with open(financial_data_path, "w") as f:
            json.dump(financial_data, f)

# IMPORTANT: Rename chunk_text function to split_text to avoid name collision
def split_text(text: str, chunk_size: int = DEFAULT_CHUNK_SIZE, chunk_overlap: int = DEFAULT_CHUNK_OVERLAP) -> List[str]:
    """
    Split text into chunks of specified size with overlap
    
    Args:
        text: Text to split
        chunk_size: Size of each chunk
        chunk_overlap: Overlap between chunks
    
    Returns:
        List of text chunks
    """
    if not text:
        return []
    
    # Split by paragraphs first
    paragraphs = [p for p in text.split('\n\n') if p.strip()]
    
    chunks = []
    current_chunk = ""
    
    for paragraph in paragraphs:
        # If the paragraph itself is too big, split it by sentences
        if len(paragraph) > chunk_size:
            sentences = [s for s in re.split(r'(?<=[.!?])\s+', paragraph) if s.strip()]
            
            for sentence in sentences:
                # If adding this sentence exceeds the chunk size, start a new chunk
                if len(current_chunk) + len(sentence) > chunk_size and current_chunk:
                    chunks.append(current_chunk)
                    # Keep some overlap
                    current_chunk = current_chunk[-chunk_overlap:] if chunk_overlap > 0 else ""
                
                current_chunk += " " + sentence
        else:
            # If adding this paragraph exceeds the chunk size, start a new chunk
            if len(current_chunk) + len(paragraph) > chunk_size and current_chunk:
                chunks.append(current_chunk)
                # Keep some overlap
                current_chunk = current_chunk[-chunk_overlap:] if chunk_overlap > 0 else ""
            
            current_chunk += " " + paragraph
    
    # Add the last chunk if not empty
    if current_chunk:
        chunks.append(current_chunk)
    
    # Clean up the chunks
    chunks = [chunk.strip() for chunk in chunks]
    
    return chunks

def _keyword_search(query: str, vectors: List[Dict[str, Any]], top_k: int) -> List[Dict[str, Any]]:
    """Legacy keyword-based search used as fallback when embeddings are unavailable."""
    query_keywords = set(query.lower().split())
    scored = []
    for chunk in vectors:
        chunk_text = chunk.get("text", "").lower()
        score = sum(1 for kw in query_keywords if kw in chunk_text)
        if query_keywords:
            score /= len(query_keywords)
        scored.append((score, chunk))
    scored.sort(reverse=True, key=lambda x: x[0])
    return [c for s, c in scored[:top_k] if s > 0]


_RRF_K = 60


def _semantic_ranked(query_emb: List[float], vectors: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return vectors sorted by cosine similarity (descending)."""
    scored = []
    for chunk in vectors:
        emb = chunk.get("embedding")
        if emb:
            score = _cosine_similarity(query_emb, emb)
            if score > 0.10:
                scored.append((score, chunk))
    scored.sort(reverse=True, key=lambda x: x[0])
    return [c for _, c in scored]


def _keyword_ranked(query: str, vectors: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return vectors sorted by keyword overlap score (descending)."""
    query_lower = query.lower()
    query_keywords = set(query_lower.split())
    scored = []
    for chunk in vectors:
        text = chunk.get("text", "").lower()
        word_hits = sum(1 for kw in query_keywords if kw in text)
        phrase_bonus = 2.0 if query_lower in text else 0.0
        score = (word_hits / max(len(query_keywords), 1)) + phrase_bonus
        if score > 0:
            scored.append((score, chunk))
    scored.sort(reverse=True, key=lambda x: x[0])
    return [c for _, c in scored]


def similarity_search(
    query: str,
    vector_store_path: str,
    top_k: int = 3
) -> List[Dict[str, Any]]:
    """Hybrid retrieval: semantic + keyword search merged via Reciprocal Rank Fusion.

    1. Semantic pass  — cosine similarity on OpenAI embeddings
    2. Keyword pass   — term overlap + phrase bonus
    3. Merge          — RRF score = 1/(k + rank_semantic) + 1/(k + rank_keyword)

    Falls back to keyword-only for stores without embeddings.
    """
    try:
        vectors_path = os.path.join(vector_store_path, "vectors.json")
        if not os.path.exists(vectors_path):
            return []

        with open(vectors_path, "r") as f:
            vectors = json.load(f)

        if not vectors:
            return []

        has_embeddings = any(v.get("embedding") for v in vectors)

        sem_ranked: List[Dict[str, Any]] = []
        if has_embeddings:
            query_emb_list = _embed_texts([query])
            if query_emb_list and query_emb_list[0]:
                sem_ranked = _semantic_ranked(query_emb_list[0], vectors)

        kw_ranked = _keyword_ranked(query, vectors)

        if not sem_ranked and not kw_ranked:
            return _keyword_search(query, vectors, top_k)

        if not sem_ranked:
            return kw_ranked[:top_k]

        sem_rank_map: Dict[str, int] = {}
        for rank, chunk in enumerate(sem_ranked):
            cid = chunk.get("id", "")
            if cid:
                sem_rank_map[cid] = rank

        kw_rank_map: Dict[str, int] = {}
        for rank, chunk in enumerate(kw_ranked):
            cid = chunk.get("id", "")
            if cid:
                kw_rank_map[cid] = rank

        all_ids = set(sem_rank_map.keys()) | set(kw_rank_map.keys())
        chunk_by_id = {}
        for chunk in vectors:
            cid = chunk.get("id", "")
            if cid in all_ids:
                chunk_by_id[cid] = chunk

        rrf_scores: List[tuple] = []
        big_rank = len(vectors) + 1
        for cid in all_ids:
            sr = sem_rank_map.get(cid, big_rank)
            kr = kw_rank_map.get(cid, big_rank)
            score = 1.0 / (_RRF_K + sr) + 1.0 / (_RRF_K + kr)
            rrf_scores.append((score, cid))

        rrf_scores.sort(reverse=True, key=lambda x: x[0])
        results = []
        for _, cid in rrf_scores[:top_k]:
            chunk = chunk_by_id.get(cid)
            if chunk:
                results.append(chunk)

        return results

    except Exception as e:
        print(f"Error in similarity search: {str(e)}")
        import traceback
        traceback.print_exc()
        return []