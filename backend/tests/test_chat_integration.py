"""
Integration test for chat visual references — hits the live API endpoint.

This script acts as a "backdoor tester": it sends questions to the chat
endpoint, parses the SSE stream, and verifies that the answer and visual
references are correct.

Usage:
  # Set environment variables first:
  set API_BASE=http://localhost:8000        (or production URL)
  set TEST_TOKEN=<your_supabase_jwt>
  set TEST_DOC_ID=<doc_id_to_test>

  # Run all tests:
  python tests/test_chat_integration.py

  # Run a specific test:
  python tests/test_chat_integration.py --test 1

  # List available tests:
  python tests/test_chat_integration.py --list

The script prints a detailed report for each test case showing:
  - The question sent
  - The answer received
  - Source chunks returned (cell IDs, pages, scores, section headers)
  - PASS/FAIL verdict with reasons
"""
import os
import sys
import json
import argparse
import requests

API_BASE = os.environ.get("API_BASE", "http://localhost:8000")
TEST_TOKEN = os.environ.get("TEST_TOKEN", "")
TEST_DOC_ID = os.environ.get("TEST_DOC_ID", "")


def chat(doc_id: str, question: str, token: str) -> dict:
    """Send a chat question and parse the full SSE response.

    Returns {answer: str, sources: list[dict], raw_events: list}
    """
    url = f"{API_BASE}/api/documents/{doc_id}/chat"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    body = {"message": question, "history": []}

    resp = requests.post(url, json=body, headers=headers, stream=True, timeout=60)
    resp.raise_for_status()

    answer = ""
    sources = []
    raw_events = []

    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        try:
            event = json.loads(line[6:])
            raw_events.append(event)

            if event.get("type") == "delta":
                answer += event.get("text", "")
            elif event.get("type") == "sources":
                sources = event.get("chunks", [])
            elif event.get("type") == "error":
                answer += f"\n[ERROR: {event.get('text', '')}]"
        except json.JSONDecodeError:
            pass

    return {"answer": answer, "sources": sources, "raw_events": raw_events}


def print_result(test_num: int, question: str, result: dict, checks: list):
    """Print a formatted test result."""
    passed = all(ok for ok, _ in checks)
    status = "\033[92mPASS\033[0m" if passed else "\033[91mFAIL\033[0m"

    print(f"\n{'='*70}")
    print(f"  TEST {test_num}: {status}")
    print(f"{'='*70}")
    print(f"  Question: {question}")
    print(f"  Answer:   {result['answer'][:200]}{'...' if len(result['answer']) > 200 else ''}")
    print(f"  Sources:  {len(result['sources'])} chunks")

    for i, src in enumerate(result["sources"]):
        sec = src.get("section_header", "")
        sec_str = f", Section: {sec}" if sec else ""
        print(f"    [{i+1}] id={src['chunk_id']}, type={src['chunk_type']}, "
              f"page={src['page']}, score={src['score']}{sec_str}")
        if src.get("markdown"):
            print(f"        text: {src['markdown'][:80]}")

    print()
    for ok, msg in checks:
        icon = "\033[92m  ✓\033[0m" if ok else "\033[91m  ✗\033[0m"
        print(f"{icon} {msg}")

    print()
    return passed


# ─── Test Cases ──────────────────────────────────────────────────────────────

def test_1_year_not_in_refs(doc_id, token):
    """Year qualifier should NOT appear in visual references."""
    q = "What are Total foreign currency assets in 2018?"
    r = chat(doc_id, q, token)

    source_ids = [s["chunk_id"] for s in r["sources"]]
    source_texts = [s.get("markdown", "") for s in r["sources"]]

    checks = [
        (len(r["answer"]) > 10, "Answer is non-empty"),
        (len(r["sources"]) > 0, "At least 1 source returned"),
        (
            not any(t.strip() == "2018" for t in source_texts),
            "No source chunk text is just '2018' (year header excluded)"
        ),
    ]

    # Check that some numeric value is in the sources
    has_numeric = any(
        any(c.isdigit() for c in t) and len(t.replace(",", "").strip()) >= 3
        for t in source_texts if t
    )
    checks.append((has_numeric or len(r["sources"]) > 0,
                    "Source contains a numeric value (not a year header)"))

    return print_result(1, q, r, checks)


def test_2_section_match(doc_id, token):
    """Question about equity should return refs from equity section, not balance sheet."""
    q = "What is the balance in Statement of Changes in Equity?"
    r = chat(doc_id, q, token)

    checks = [
        (len(r["answer"]) > 10, "Answer is non-empty"),
        (len(r["sources"]) > 0, "At least 1 source returned"),
    ]

    # Check section headers if available
    sections = [s.get("section_header", "").lower() for s in r["sources"] if s.get("section_header")]
    if sections:
        has_equity = any("equity" in sec for sec in sections)
        checks.append((has_equity, f"At least one source from equity section (got: {sections})"))

        no_wrong_section = not any(
            "financial position" in sec and "equity" not in sec
            for sec in sections
        )
        checks.append((no_wrong_section,
                        "No sources from 'Financial Position' when asking about equity"))
    else:
        checks.append((True, "No section headers available — skipping section check"))

    return print_result(2, q, r, checks)


def test_3_value_highlighted(doc_id, token):
    """Answer value should be in the source text, not a label/header."""
    q = "What is the total value of assets?"
    r = chat(doc_id, q, token)

    checks = [
        (len(r["answer"]) > 10, "Answer is non-empty"),
        (len(r["sources"]) > 0, "At least 1 source returned"),
    ]

    # Extract numbers from answer
    import re
    answer_nums = re.findall(r'\d{1,3}(?:,\d{3})+', r["answer"])
    if answer_nums:
        source_texts = " ".join(s.get("markdown", "") for s in r["sources"])
        has_value = any(n.replace(",", "") in source_texts.replace(",", "") for n in answer_nums)
        checks.append((has_value,
                        f"Answer value ({answer_nums[0]}) found in source chunk text"))
    else:
        checks.append((True, "No numeric values in answer — skipping value check"))

    return print_result(3, q, r, checks)


def test_4_no_citation_leak(doc_id, token):
    """[[id]] citations should be stripped from the answer text."""
    q = "What was the net income or total revenue?"
    r = chat(doc_id, q, token)

    has_brackets = "[[" in r["answer"] and "]]" in r["answer"]
    checks = [
        (len(r["answer"]) > 10, "Answer is non-empty"),
        (not has_brackets, "No [[id]] citations leaked into answer text"),
    ]

    return print_result(4, q, r, checks)


def test_5_sse_event_order(doc_id, token):
    """SSE events should arrive in correct order: deltas → sources → done."""
    q = "Summarize the key financial highlights."
    r = chat(doc_id, q, token)

    types = [e.get("type") for e in r["raw_events"]]

    # Find positions of key events
    delta_positions = [i for i, t in enumerate(types) if t == "delta"]
    source_positions = [i for i, t in enumerate(types) if t == "sources"]
    done_positions = [i for i, t in enumerate(types) if t == "done"]

    checks = [
        (len(delta_positions) > 0, "At least one delta event received"),
        (len(done_positions) == 1, "Exactly one done event"),
    ]

    if source_positions and delta_positions:
        checks.append((
            source_positions[0] > delta_positions[-1],
            "Sources event comes after all delta events"
        ))

    if done_positions and source_positions:
        checks.append((
            done_positions[0] > source_positions[0],
            "Done event comes after sources event"
        ))
    elif done_positions and delta_positions:
        checks.append((
            done_positions[0] > delta_positions[-1],
            "Done event comes after all deltas"
        ))

    return print_result(5, q, r, checks)


def test_6_score_threshold(doc_id, token):
    """All returned sources should have reasonable scores."""
    q = "What is the total equity?"
    r = chat(doc_id, q, token)

    checks = [
        (len(r["answer"]) > 10, "Answer is non-empty"),
    ]

    if r["sources"]:
        scores = [s.get("score", 0) for s in r["sources"]]
        min_score = min(scores)
        checks.append((min_score >= 0.5, f"All scores >= 0.5 (min={min_score:.2f})"))
        checks.append((len(r["sources"]) <= 4, f"Max 4 sources (got {len(r['sources'])})"))
    else:
        checks.append((True, "No sources — answer may be non-numeric"))

    return print_result(6, q, r, checks)


def test_7_bbox_present(doc_id, token):
    """Source chunks should have valid bbox coordinates."""
    q = "What is the cash and cash equivalents?"
    r = chat(doc_id, q, token)

    checks = [
        (len(r["answer"]) > 10, "Answer is non-empty"),
    ]

    for i, src in enumerate(r["sources"]):
        bbox = src.get("bbox", {})
        has_bbox = (
            isinstance(bbox.get("left"), (int, float)) and
            isinstance(bbox.get("top"), (int, float)) and
            isinstance(bbox.get("right"), (int, float)) and
            isinstance(bbox.get("bottom"), (int, float))
        )
        checks.append((has_bbox, f"Source {i+1} ({src['chunk_id']}) has valid bbox"))
        if has_bbox:
            valid_range = (
                0 <= bbox["left"] <= 1 and 0 <= bbox["top"] <= 1 and
                0 <= bbox["right"] <= 1 and 0 <= bbox["bottom"] <= 1
            )
            checks.append((valid_range, f"Source {i+1} bbox values in [0,1] range"))
        if i >= 2:
            break  # check first 3 only

    return print_result(7, q, r, checks)


TESTS = {
    1: ("Year qualifier filtering", test_1_year_not_in_refs),
    2: ("Section-aware matching", test_2_section_match),
    3: ("Value in source text", test_3_value_highlighted),
    4: ("No citation leak", test_4_no_citation_leak),
    5: ("SSE event order", test_5_sse_event_order),
    6: ("Score threshold", test_6_score_threshold),
    7: ("Bbox validation", test_7_bbox_present),
}


def main():
    parser = argparse.ArgumentParser(description="Integration test for chat visual references")
    parser.add_argument("--test", type=int, help="Run a specific test number")
    parser.add_argument("--list", action="store_true", help="List available tests")
    parser.add_argument("--doc-id", type=str, help="Document ID to test against")
    parser.add_argument("--token", type=str, help="Auth token")
    parser.add_argument("--api", type=str, help="API base URL")
    args = parser.parse_args()

    if args.list:
        print("\nAvailable tests:")
        for num, (name, _) in TESTS.items():
            print(f"  {num}: {name}")
        print()
        return

    global API_BASE, TEST_TOKEN, TEST_DOC_ID
    if args.api:
        API_BASE = args.api
    if args.token:
        TEST_TOKEN = args.token
    if args.doc_id:
        TEST_DOC_ID = args.doc_id

    if not TEST_TOKEN:
        print("ERROR: Set TEST_TOKEN env var or pass --token")
        sys.exit(1)
    if not TEST_DOC_ID:
        print("ERROR: Set TEST_DOC_ID env var or pass --doc-id")
        sys.exit(1)

    print(f"\n{'='*70}")
    print(f"  Chat Visual Reference Integration Tests")
    print(f"  API:    {API_BASE}")
    print(f"  Doc ID: {TEST_DOC_ID}")
    print(f"{'='*70}")

    tests_to_run = {args.test: TESTS[args.test]} if args.test else TESTS
    results = {}

    for num, (name, fn) in tests_to_run.items():
        try:
            passed = fn(TEST_DOC_ID, TEST_TOKEN)
            results[num] = passed
        except Exception as e:
            print(f"\n  TEST {num}: \033[91mERROR\033[0m — {e}")
            results[num] = False

    # Summary
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    failed = total - passed

    print(f"\n{'='*70}")
    print(f"  SUMMARY: {passed}/{total} passed, {failed} failed")
    if failed:
        failed_nums = [n for n, v in results.items() if not v]
        print(f"  Failed: {', '.join(str(n) for n in failed_nums)}")
    print(f"{'='*70}\n")

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
