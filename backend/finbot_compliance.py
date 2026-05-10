"""FinBot compliance pre-filter.

We are NOT a registered investment advisor. The pre-filter intercepts
prompts that ask for advice we shouldn't give (specific buy/sell timing,
leverage strategies, options strategies for unverified users, etc.) and
returns a refusal before the LLM is invoked.

Patterns are intentionally conservative — false positives are recoverable
(user rephrases), false negatives are not (regulator letter).

Per-pattern policy:
  - 'refuse'    → return a stock refusal; no LLM call.
  - 'disclaim' → run the LLM normally but force a disclaimer footer in the
                 system prompt for that turn (handled in caller).
"""
from __future__ import annotations

import re
from typing import Literal, NamedTuple


class ComplianceCheck(NamedTuple):
    action:  Literal["allow", "refuse", "disclaim"]
    reason:  str | None
    message: str | None  # the user-facing refusal text, when action == "refuse"


# Refusal copy. Friendly, non-judgmental, points to the help we *can* give.
_REFUSAL_BUY_SELL = (
    "I can't tell you whether to buy or sell a specific stock right now — that "
    "depends on your full situation and falls outside what FinBot can responsibly "
    "say. I'm happy to pull data that helps you decide: current quote, "
    "fundamentals, recent news, technical indicators, your portfolio impact, or "
    "what your uploaded filings say.\n\n"
    "_Not investment advice — do your own research._"
)

_REFUSAL_LEVERAGE = (
    "I won't recommend specific leverage levels or short positions — those need "
    "broker-side risk checks I don't have. I can explain how leverage works in "
    "general terms or pull live data on a ticker if that helps.\n\n"
    "_Not investment advice — do your own research._"
)


# Regex patterns. `re.IGNORECASE` is added at compile time. Patterns are
# anchored loosely so they catch typical phrasings without being too tight.
_RULES: list[tuple[re.Pattern, str, str]] = [
    # (pattern, policy, refusal_copy)
    (
        re.compile(
            r"\b(should i|do i|would you|recommend(?: i)?)\s+"
            r"(buy|sell|short|sell short|dump|hold)\b",
            re.IGNORECASE,
        ),
        "refuse",
        _REFUSAL_BUY_SELL,
    ),
    (
        re.compile(
            r"\b(is\s+(?:now|today|this)\s+a?\s*good\s+time\s+to)\b",
            re.IGNORECASE,
        ),
        "refuse",
        _REFUSAL_BUY_SELL,
    ),
    (
        re.compile(
            r"\b(buy|sell|short)\s+(?:at|for|with|using)\s+\d+\s*x\s+leverage\b",
            re.IGNORECASE,
        ),
        "refuse",
        _REFUSAL_LEVERAGE,
    ),
    (
        re.compile(
            r"\b(\d+\s*x\s+leverage|margin\s+(?:account|trading)|short\s+sell|naked\s+(?:short|put|call))\b",
            re.IGNORECASE,
        ),
        "disclaim",  # discuss generally with disclaimer, don't refuse outright
        "",
    ),
    (
        re.compile(
            r"\b(iron\s+condor|covered\s+call|cash\s+secured\s+put|"
            r"strangle|straddle|butterfly\s+spread|credit\s+spread|"
            r"calendar\s+spread)\b",
            re.IGNORECASE,
        ),
        "disclaim",
        "",
    ),
    (
        re.compile(
            r"\b(give me|what's|whats)\s+(?:your\s+)?(?:hot|next|best)\s+"
            r"(?:stock|tip|pick|trade)\b",
            re.IGNORECASE,
        ),
        "refuse",
        _REFUSAL_BUY_SELL,
    ),
]


def check_user_message(text: str) -> ComplianceCheck:
    """Run pre-filter on a user message. Returns the policy decision."""
    if not text:
        return ComplianceCheck("allow", None, None)

    for pattern, policy, refusal in _RULES:
        m = pattern.search(text)
        if m:
            if policy == "refuse":
                return ComplianceCheck(
                    action="refuse",
                    reason=f"matched_rule: {m.group(0).lower()!r}",
                    message=refusal,
                )
            if policy == "disclaim":
                return ComplianceCheck(
                    action="disclaim",
                    reason=f"matched_rule: {m.group(0).lower()!r}",
                    message=None,
                )
    return ComplianceCheck("allow", None, None)


# A small disclaimer the system prompt can opt-in for "disclaim" turns.
DISCLAIMER_FOOTER = (
    "End your reply with this exact line on its own paragraph: "
    "*Not investment advice — do your own research.*"
)
