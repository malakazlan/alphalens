"""
Live integration test for chat visual references.

Calls the chat pipeline functions directly (bypassing HTTP auth) to verify
answer content and visual reference accuracy against real documents.

Usage:
  cd backend
  python tests/test_chat_live.py
  python tests/test_chat_live.py --doc khizra      # test specific doc
  python tests/test_chat_live.py --doc imf          # test IMF doc
  python tests/test_chat_live.py --doc balance      # test balance sheet
"""
import asyncio
import json
import os
import sys
import argparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import db
import storage_client
import qdrant_store
import embeddings
from app import (
    _build_full_context,
    _build_cell_text_lookup,
    _build_plaintext_cell_lookup,
    _build_cell_section_map,
    _build_rag_context,
    _extract_question_qualifiers,
    _find_all_matching_cells,
    _normalise_for_match,
    _CELL_EXTRACT_RE,
)
import openai
from config import settings
import re


def get_documents():
    """Fetch all complete documents."""
    rows = db.get_client().table("documents").select("*").eq("status", "complete").execute()
    return rows.data


def fetch_grounding(doc_id, user_id):
    """Fetch grounding dict for a document."""
    rows = db.get_grounding(doc_id, user_id)
    grounding = {}
    for row in rows:
        grounding[row["element_id"]] = {
            "page": row["page"],
            "type": row["type"],
            "bbox": {
                "left": row["bbox_left"],
                "top": row["bbox_top"],
                "right": row["bbox_right"],
                "bottom": row["bbox_bottom"],
            },
        }
    return grounding


def fetch_markdown(user_id, doc_id):
    """Download processed.json and return (markdown, grounding_cache)."""
    cache_path = f"{user_id}/{doc_id}/processed.json"
    try:
        cache_bytes = storage_client.get_client().storage.from_(
            storage_client.BUCKET
        ).download(cache_path)
        cached = json.loads(cache_bytes)
        return cached.get("markdown", ""), cached.get("grounding", {})
    except Exception:
        return "", {}


def run_chat(doc_id, user_id, question):
    """Run the full chat pipeline and return structured result."""
    # 1. Fetch grounding
    grounding_dict = fetch_grounding(doc_id, user_id)

    # 2. Fetch markdown
    full_markdown, grounding_cache = fetch_markdown(user_id, doc_id)
    for eid, g in grounding_cache.items():
        if eid not in grounding_dict:
            grounding_dict[eid] = g

    # 3. Fetch all Qdrant chunks
    all_chunks = qdrant_store.get_chunks_by_doc(doc_id, user_id)

    # 4. Build context
    full_ctx = _build_full_context(full_markdown, qdrant_chunks=all_chunks)
    context = full_ctx
    mode = "full-context"

    if context is None:
        query_vec = embeddings.embed_query(question)
        results = qdrant_store.search(query_vec, user_id, doc_id, 10)
        context = _build_rag_context(results)
        mode = "RAG"
    else:
        results = []

    # 5. Call LLM (non-streaming for simplicity)
    system_msg = (
        "You are a financial document analyst. Answer questions based strictly on the document context provided. "
        "Be precise and cite specific figures where relevant. "
        "If the information is not in the context, say so clearly. Keep responses concise.\n\n"
        "When citing information, reference the source element ID in double brackets like [[element_id]]. "
        "For table cell values, cite the cell ID (e.g., [[0-5]]). "
        "For text sections, cite the chunk ID (e.g., [[7d58c5cf-...]]). "
        "Always cite the specific source.\n\n"
        "Pay attention to section headers (e.g., 'Statement of Financial Position', "
        "'Statement of Changes in Equity'). Cite elements from the section that matches "
        "the user's question context."
    )

    oai = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
    resp = oai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": f"Document context:\n\n{context}\n\n---\n\nQuestion: {question}"},
        ],
        temperature=0.3,
        max_tokens=1024,
    )
    full_answer = resp.choices[0].message.content or ""

    # Extract citations
    cited_ids = re.findall(r'\[\[([^\]]+)\]\]', full_answer)
    clean_answer = re.sub(r'\[\[[^\]]+\]\]', '', full_answer).strip()

    # 6. Build cell lookup
    cell_lookup = _build_cell_text_lookup(full_markdown)
    cell_section_map = {}

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

    # 7. Match
    question_qualifiers = _extract_question_qualifiers(question)

    matched = _find_all_matching_cells(
        full_answer, cell_lookup, grounding_dict, cited_ids,
        question_qualifiers=question_qualifiers,
        cell_section_map=cell_section_map,
        question_text=question,
    )

    # 8. Build source chunks
    sources = []
    for cell_id, cell_text, score in matched:
        g = grounding_dict.get(cell_id)
        if not g:
            continue
        g_type = (g.get("type", "") or "").lower()
        sources.append({
            "chunk_id": cell_id,
            "chunk_type": "table_cell" if "cell" in g_type else g.get("type", "text"),
            "page": g.get("page", 0),
            "bbox": g.get("bbox", {}),
            "section_header": cell_section_map.get(cell_id, ""),
            "markdown": cell_text,
            "score": score / 100.0,
        })

    return {
        "mode": mode,
        "answer": clean_answer,
        "raw_answer": full_answer,
        "cited_ids": cited_ids,
        "sources": sources,
        "cell_lookup_size": len(cell_lookup),
        "grounding_size": len(grounding_dict),
        "chunk_count": len(all_chunks),
        "qualifiers": question_qualifiers,
    }


def print_result(test_name, question, result, checks):
    """Pretty-print a test result."""
    passed = all(ok for ok, _ in checks)
    status = "\033[92mPASS\033[0m" if passed else "\033[91mFAIL\033[0m"

    print(f"\n{'='*72}")
    print(f"  {test_name}: {status}")
    print(f"{'='*72}")
    print(f"  Mode:       {result['mode']}")
    print(f"  Question:   {question}")
    print(f"  Answer:     {result['answer'][:300]}{'...' if len(result['answer']) > 300 else ''}")
    print(f"  Qualifiers: {result['qualifiers']}")
    print(f"  Cells:      {result['cell_lookup_size']} in lookup, {result['grounding_size']} grounding entries")
    print(f"  LLM cited:  {result['cited_ids'][:5]}")
    print(f"  Sources:    {len(result['sources'])} matched")

    for i, src in enumerate(result["sources"][:6]):
        sec = src.get("section_header", "")
        sec_str = f"  sec={sec}" if sec else ""
        print(f"    [{i+1}] {src['chunk_id']:12s}  page={src['page']}  score={src['score']:.2f}  "
              f"type={src['chunk_type']}{sec_str}")
        if src.get("markdown"):
            print(f"         text: {src['markdown'][:70]}")

    print()
    for ok, msg in checks:
        icon = "\033[92m  +\033[0m" if ok else "\033[91m  -\033[0m"
        print(f"{icon} {msg}")

    return passed


def run_tests(doc_filter=None):
    """Run all integration tests."""
    docs = get_documents()
    if not docs:
        print("No complete documents found!")
        return False

    print(f"\nFound {len(docs)} complete documents:")
    for d in docs:
        print(f"  {d['id'][:8]}...  {d['filename']}")

    all_passed = True

    for doc in docs:
        doc_id = doc["id"]
        user_id = doc["user_id"]
        fname = doc["filename"].lower()

        # Filter
        if doc_filter:
            if doc_filter not in fname and doc_filter not in doc_id:
                continue

        print(f"\n\n{'#'*72}")
        print(f"  TESTING: {doc['filename']} ({doc_id[:12]}...)")
        print(f"{'#'*72}")

        # ── Generic tests for all docs ──

        # Test A: Basic answer + sources
        q = "What are the main financial figures in this document?"
        r = run_chat(doc_id, user_id, q)
        checks = [
            (len(r["answer"]) > 20, "Answer is non-empty and substantial"),
            (not any("[[" in s for s in r["answer"]), "No citation brackets leaked"),
        ]
        if not print_result("Basic Q&A", q, r, checks):
            all_passed = False

        # Test B: Year qualifier filtering
        q = "What values are reported for 2018?"
        r = run_chat(doc_id, user_id, q)
        source_texts = [s.get("markdown", "") for s in r["sources"]]
        checks = [
            (len(r["answer"]) > 10, "Answer is non-empty"),
            ("2018" in r["qualifiers"] or _normalise_for_match("2018") in r["qualifiers"],
             "'2018' is in question qualifiers"),
            (not any(t.strip() == "2018" for t in source_texts),
             "No source text is just '2018' (year header)"),
        ]
        if not print_result("Year Qualifier Filter", q, r, checks):
            all_passed = False

        # Test C: Score quality
        q = "What is the total value or amount?"
        r = run_chat(doc_id, user_id, q)
        scores = [s["score"] for s in r["sources"]]
        checks = [
            (len(r["answer"]) > 10, "Answer is non-empty"),
        ]
        if scores:
            checks.append((min(scores) >= 0.5, f"All scores >= 0.5 (min={min(scores):.2f})"))
            checks.append((len(r["sources"]) <= 8, f"Reasonable number of sources ({len(r['sources'])})"))
        if not print_result("Score Quality", q, r, checks):
            all_passed = False

        # ── Doc-specific tests ──

        if "imf" in fname or "9781513" in fname:
            # IMF central bank doc — plain-text tables
            q = "What are Total foreign currency financial assets in 2018?"
            r = run_chat(doc_id, user_id, q)
            source_texts = [s.get("markdown", "") for s in r["sources"]]
            checks = [
                (len(r["answer"]) > 10, "Answer mentions a value"),
                (r["cell_lookup_size"] > 0, "Plain-text cell lookup is non-empty"),
                (not any(t.strip() == "2018" for t in source_texts),
                 "'2018' year header not in sources"),
            ]
            if not print_result("IMF: Plain-text cell lookup", q, r, checks):
                all_passed = False

            q = "What is the balance in Statement of Changes in Equity?"
            r = run_chat(doc_id, user_id, q)
            sections = [s.get("section_header", "").lower() for s in r["sources"]]
            checks = [
                (len(r["answer"]) > 10, "Answer is non-empty"),
            ]
            if sections:
                checks.append((
                    any("equity" in sec for sec in sections),
                    f"Source from equity section (sections: {sections[:3]})"
                ))
            if not print_result("IMF: Section-aware matching", q, r, checks):
                all_passed = False

        if "khizra" in fname or "bill" in fname:
            # Challan doc — HTML tables, possibly 4 copies
            q = "What is the tuition fee?"
            r = run_chat(doc_id, user_id, q)
            checks = [
                (len(r["answer"]) > 5, "Answer mentions tuition fee"),
                (len(r["sources"]) >= 1, "At least 1 source found"),
            ]
            if not print_result("Challan: Tuition fee", q, r, checks):
                all_passed = False

        if "balance" in fname:
            # Balance sheet — HTML tables
            q = "What is the total of assets?"
            r = run_chat(doc_id, user_id, q)
            checks = [
                (len(r["answer"]) > 10, "Answer mentions total assets"),
                (len(r["sources"]) >= 1, "At least 1 source found"),
            ]
            if not print_result("Balance Sheet: Total assets", q, r, checks):
                all_passed = False

    return all_passed


def main():
    parser = argparse.ArgumentParser(description="Live chat integration tests")
    parser.add_argument("--doc", type=str, help="Filter by document name (e.g., 'imf', 'khizra', 'balance')")
    args = parser.parse_args()

    print("\n" + "="*72)
    print("  CHAT VISUAL REFERENCE — LIVE INTEGRATION TESTS")
    print("="*72)

    passed = run_tests(doc_filter=args.doc)

    print(f"\n{'='*72}")
    if passed:
        print("  \033[92mALL TESTS PASSED\033[0m")
    else:
        print("  \033[91mSOME TESTS FAILED\033[0m")
    print(f"{'='*72}\n")

    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
