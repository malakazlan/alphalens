import os
import json
import re
from typing import Dict, Any, List

from vector_store import similarity_search
from llm_service import llm_service

MAX_CONTEXT_CHARS = 8000
CITATION_PATTERN = re.compile(r"\[\[([^\]]+)\]\]")


def get_answer_from_document(
    query: str,
    vector_store_path: str,
    financial_data: Dict[str, Any] = None
) -> Dict[str, Any]:
    """Return a finance-grounded answer plus citation metadata."""
    if not financial_data:
        financial_data_path = os.path.join(vector_store_path, "financial_data.json")
        if os.path.exists(financial_data_path):
            with open(financial_data_path, "r") as f:
                financial_data = json.load(f)
        else:
            financial_data = {}
    
    relevant_chunks = similarity_search(query, vector_store_path, top_k=8)
    context_blocks = build_context_blocks(relevant_chunks, financial_data)
    
    answer_text = llm_service.generate_finance_response(
        query=query,
        metadata=financial_data.get("metadata", {}),
        key_metrics=financial_data.get("key_metrics", []),
        context_blocks=context_blocks
    )
    
    if not answer_text:
        fallback_context = build_fallback_context(financial_data, relevant_chunks)
        fallback_answer = llm_service.generate_response(query, fallback_context, financial_data)
        if not fallback_answer:
            fallback_answer = "I couldn't find information related to that question in the document."
        return {
            "answer": fallback_answer,
            "sources": [],
            "source": "local_llm"
        }
    
    clean_answer, citations = extract_citations(answer_text, context_blocks)
    return {
        "answer": clean_answer or answer_text,
        "sources": citations,
        "source": "gpt-3.5-turbo"
    }


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
            "text": text[:2000]
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
    return clean_text, citations


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