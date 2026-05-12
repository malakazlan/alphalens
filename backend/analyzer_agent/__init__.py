"""Analyzer expert-agent package.

Public surface:
    handle_chat_turn(...)    — main entry, yields SSE events
    build_doc_context(...)   — one-shot per-doc cache the orchestrator needs
    ANALYZER_AGENT_ENABLED   — reads settings flag for the FastAPI route
"""
from __future__ import annotations

import logging
from typing import Any

from config import settings
from .orchestrator import handle_chat_turn  # noqa: F401  (public re-export)
from .tools import DocContext

logger = logging.getLogger(__name__)


# Re-export the feature flag at package level so the route handler can
# check `analyzer_agent.ANALYZER_AGENT_ENABLED` without importing config.
ANALYZER_AGENT_ENABLED = settings.ANALYZER_AGENT_ENABLED


def build_doc_context(
    *,
    doc_id:           str,
    user_id:          str,
    cell_lookup:      dict[str, str],
    grounding_dict:   dict[str, dict[str, Any]],
    qdrant_chunks:    list[dict[str, Any]],
    table_grids:      dict[str, dict[str, Any]],
    cell_section_map: dict[str, str],
    doc_metadata:     dict[str, Any],
    extract:          dict[str, Any],
) -> DocContext:
    """Bundle the per-doc working set the tools need into one DocContext.

    This adapter exists so the route handler (app.py) doesn't need to
    import the tools module directly. Keeping the assembly here means
    DocContext-shape changes only ripple one direction.
    """
    return DocContext(
        doc_id=doc_id,
        user_id=user_id,
        cell_lookup=cell_lookup,
        grounding_dict=grounding_dict,
        qdrant_chunks=qdrant_chunks,
        table_grids=table_grids,
        cell_section_map=cell_section_map,
        doc_metadata=doc_metadata,
        extract=extract,
    )


__all__ = [
    "handle_chat_turn",
    "build_doc_context",
    "ANALYZER_AGENT_ENABLED",
    "DocContext",
]