"""Agent orchestrator — runs the tool-calling loop.

Public surface:
    `await handle_chat_turn(...)` is the single entry point. It yields SSE-
    ready event dicts. The caller (the /chat route in app.py) wraps each
    yield in `data: {json.dumps(event)}\\n\\n` and returns a StreamingResponse.

Internals:
    1. Build DocContext (chunk_lookup, grounding, table grids, sections).
    2. Compose system prompt from prompt.build_system_prompt(doc_facts).
    3. Call the LLM with tools=get_tool_specs().
    4. If the model emits tool_calls: execute in parallel (one round),
       append results as `role=tool` messages, recurse.
    5. When the model returns a plain assistant message, stream its text
       via SSE delta events.
    6. Aggregate citations from every tool's result; emit one `sources`
       event at the end.

Budgets:
    - max 6 tool rounds
    - max 30k tokens total
    - max 20s wall-clock
    Hit any → break out and let the model produce a best-effort answer.

Trace:
    Every turn yields a `trace` event with the per-tool latency + token
    breakdown. Useful for ops + debugging without a separate logging
    pipeline.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import asdict
from typing import Any, AsyncIterator

import openai

from . import prompt as agent_prompt
from .schemas import (
    CitationRef,
    ToolResult,
    LookupValueArgs,
    GetSectionArgs,
    ListFiguresArgs,
    ReadFigureArgs,
    ComputeRatioArgs,
)
from .tools import DocContext, TOOL_REGISTRY, get_tool_specs

logger = logging.getLogger(__name__)


# ─── Budgets ────────────────────────────────────────────────────────────────
MAX_TOOL_ROUNDS = 6
MAX_WALL_MS     = 20_000
MAX_TOKENS_OUT  = 4_096   # per LLM call; total is bounded by rounds × this

# Model routing: tool-dispatch uses the cheaper model; final synthesis can
# stay with the same model because synthesis happens INSIDE the same loop
# (the last LLM response with no tool_calls is the answer).
AGENT_MODEL = "gpt-4o"   # adjust if you have prompt-cache-friendly variants


# ─── Tool execution (sync — wraps the per-tool callable) ────────────────────
def _execute_tool(ctx: DocContext, tool_name: str, raw_args: str) -> ToolResult:
    """Look up the tool, parse args via Pydantic, invoke. Errors return a
    structured ToolResult with ok=False — never raise."""
    if tool_name not in TOOL_REGISTRY:
        return ToolResult(
            tool_name=tool_name, ok=False,
            summary=f"Unknown tool '{tool_name}'",
            error="unknown_tool",
        )
    fn, args_model = TOOL_REGISTRY[tool_name]
    try:
        parsed_args = json.loads(raw_args or "{}")
    except json.JSONDecodeError as e:
        return ToolResult(
            tool_name=tool_name, ok=False,
            summary=f"Invalid JSON in tool args: {e}",
            error="bad_args_json",
        )
    try:
        args = args_model(**parsed_args)
    except Exception as e:
        return ToolResult(
            tool_name=tool_name, ok=False,
            summary=f"Args validation failed: {e}",
            error="bad_args_schema",
        )
    try:
        return fn(ctx, args)
    except Exception as e:
        logger.exception("tool %s raised", tool_name)
        return ToolResult(
            tool_name=tool_name, ok=False,
            summary=f"Tool execution failed: {e}",
            error="exception",
        )


def _serialise_tool_result_for_llm(r: ToolResult) -> str:
    """The tool-message content the model reads back. Keep it tight — the
    full citations list bubbles up to the chip UI separately."""
    body: dict[str, Any] = {
        "ok":      r.ok,
        "summary": r.summary,
        "payload": r.payload,
    }
    if r.error:
        body["error"] = r.error
    return json.dumps(body, default=str)


# ─── The main loop ──────────────────────────────────────────────────────────
async def handle_chat_turn(
    *,
    question:         str,
    history:          list[dict[str, str]],       # prior chat turns (role+content)
    doc_ctx:          DocContext,
    aoai_client:      openai.AsyncOpenAI,
) -> AsyncIterator[dict[str, Any]]:
    """Run one chat turn through the agent. Yields SSE-ready events."""
    t_start = time.time()
    system_msg = agent_prompt.build_system_prompt(doc_ctx.doc_metadata)
    tool_specs = get_tool_specs()

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_msg},
    ]
    for h in history[-6:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": question})

    aggregated_citations: list[CitationRef] = []
    seen_cit_ids: set[str] = set()
    tool_calls_made: list[dict[str, Any]] = []

    for round_i in range(MAX_TOOL_ROUNDS + 1):
        # Budget check
        elapsed_ms = int((time.time() - t_start) * 1000)
        if elapsed_ms > MAX_WALL_MS:
            yield {"type": "thinking", "text": "(budget exhausted — finalising)"}
            break

        # Last round: don't allow further tool calls; force final answer.
        allow_tools = round_i < MAX_TOOL_ROUNDS

        try:
            resp = await aoai_client.chat.completions.create(
                model=AGENT_MODEL,
                messages=messages,
                tools=tool_specs if allow_tools else None,
                tool_choice="auto" if allow_tools else None,
                temperature=0.1,
                max_tokens=MAX_TOKENS_OUT,
            )
        except openai.RateLimitError:
            yield {"type": "error", "text": "Rate limit reached. Please retry in a moment."}
            return
        except Exception as e:
            logger.exception("agent LLM call failed")
            yield {"type": "error", "text": str(e)}
            return

        choice = resp.choices[0]
        msg = choice.message

        # ── Branch A: model wants to call tools ──
        if allow_tools and getattr(msg, "tool_calls", None):
            # Echo the assistant turn (with tool_calls) into messages so the
            # next API call sees the proper history.
            messages.append({
                "role":       "assistant",
                "content":    msg.content or "",
                "tool_calls": [
                    {
                        "id":   tc.id,
                        "type": "function",
                        "function": {
                            "name":      tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in msg.tool_calls
                ],
            })

            # Execute tools in PARALLEL within this round. asyncio.to_thread
            # because the tool fns are sync (CPU-bound, no network).
            async def _run(tc):
                r = await asyncio.to_thread(
                    _execute_tool, doc_ctx, tc.function.name, tc.function.arguments,
                )
                return tc, r

            results = await asyncio.gather(*[_run(tc) for tc in msg.tool_calls])

            for tc, r in results:
                tool_calls_made.append({
                    "name":       tc.function.name,
                    "args":       tc.function.arguments,
                    "summary":    r.summary,
                    "ok":         r.ok,
                    "latency_ms": r.latency_ms,
                })
                # Stream a "tool" event so the frontend can show progress.
                yield {
                    "type":       "tool",
                    "name":       tc.function.name,
                    "summary":    r.summary,
                    "ok":         r.ok,
                }
                # Aggregate citations (dedupe).
                for c in r.citations:
                    if c.chunk_id and c.chunk_id not in seen_cit_ids:
                        seen_cit_ids.add(c.chunk_id)
                        aggregated_citations.append(c)
                # Append the tool's result as a tool-role message.
                messages.append({
                    "role":         "tool",
                    "tool_call_id": tc.id,
                    "content":      _serialise_tool_result_for_llm(r),
                })
            # Loop continues — next iteration the model decides next step.
            continue

        # ── Branch B: model produced the final answer ──
        final = msg.content or ""
        # Strip any [[…]] markers the model emitted — they're for the chip
        # layer, not the user. Same regex used elsewhere.
        clean = _strip_citations(final)
        if clean:
            yield {"type": "delta", "text": clean}
        # Citation chips come from the tool results, not from [[id]] markers
        # in this architecture — each tool emitted its own citations.
        yield {
            "type":   "sources",
            "chunks": [_citation_to_payload(c) for c in aggregated_citations],
        }
        # Trace event for ops.
        yield {
            "type":  "trace",
            "rounds": round_i,
            "tools":  tool_calls_made,
            "elapsed_ms": int((time.time() - t_start) * 1000),
            "citations": len(aggregated_citations),
        }
        yield {"type": "done"}
        return

    # If we exit the loop without returning, force a final synthesis call
    # with tools disabled (so the model MUST produce text).
    try:
        resp = await aoai_client.chat.completions.create(
            model=AGENT_MODEL,
            messages=messages + [{
                "role": "user",
                "content": "Tool budget exhausted. Produce your best answer from what you have, citing the relevant chunks.",
            }],
            tools=None,
            temperature=0.1,
            max_tokens=MAX_TOKENS_OUT,
        )
        final = (resp.choices[0].message.content or "").strip()
        clean = _strip_citations(final)
        if clean:
            yield {"type": "delta", "text": clean}
    except Exception:
        yield {"type": "error", "text": "Unable to produce final answer."}

    yield {
        "type":   "sources",
        "chunks": [_citation_to_payload(c) for c in aggregated_citations],
    }
    yield {"type": "done"}


# ─── Helpers ────────────────────────────────────────────────────────────────
_CITATION_INLINE_RE = re.compile(r"\[\[.*?\]\]", re.DOTALL)


def _strip_citations(text: str) -> str:
    """Remove inline [[id|label]] markers. Citations in this architecture
    come from tool results, not from inline markers."""
    if not text:
        return text
    s = _CITATION_INLINE_RE.sub("", text)
    s = re.sub(r"[ \t]+(?=[.,;:!?])", "", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


def _citation_to_payload(c: CitationRef) -> dict[str, Any]:
    """Convert a CitationRef into the chip-payload shape the frontend
    already understands (matches the existing /chat `sources` event)."""
    return {
        "chunk_id":     c.chunk_id,
        "chunk_type":   c.chunk_type,
        "page":         c.page,
        "bbox":         c.bbox or {},
        "section_header": "",
        "markdown":     "",
        "score":        1.0,
        "llm_label":    c.label or "",
        # The existing chip resolver also reads these — leave empty so it
        # falls through to llm_label.
        "row_label_id":     None,
        "row_label_text":   "",
        "group_label_id":   None,
        "group_label_text": "",
        "col_header_id":    None,
        "col_header_text":  "",
        "year_label":       None,
    }
