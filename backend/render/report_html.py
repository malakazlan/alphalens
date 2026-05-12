"""Render the report HTML that gets fed into the Chromium renderer.

The template + this wrapper are deliberately the only path that produces
the print HTML — so any styling tweak (cover layout, footer wording,
section header treatment) lives in one place.
"""
from __future__ import annotations

import os
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import markdown as md_lib
from jinja2 import Environment, FileSystemLoader, select_autoescape

logger = logging.getLogger(__name__)

# Templates live next to backend code. Worker container copies the whole
# backend/ tree so the path is the same in prod as in dev.
_TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")

_env = Environment(
    loader=FileSystemLoader(_TEMPLATE_DIR),
    autoescape=select_autoescape(enabled_extensions=("html", "j2")),
    trim_blocks=True,
    lstrip_blocks=True,
)


def _markdown_to_html(text: str) -> str:
    """Render a section's markdown to HTML.

    `tables` lifts our pipe-table notation. `fenced_code` is on so code
    fences from regenerated sections survive (they shouldn't appear in
    normal financial prose, but we don't strip them either).
    """
    if not text:
        return ""
    return md_lib.markdown(
        text,
        extensions=["tables", "fenced_code", "sane_lists"],
        output_format="html5",
    )


def render_report_html(
    *,
    report:          dict[str, Any],
    doc:             dict[str, Any],
    sections_ordered: list[dict[str, Any]],
    template_label:  Optional[str] = None,
) -> str:
    """Render report.html.j2 with a report row + ordered sections.

    `sections_ordered` is a list of {id, title, markdown, word_count}.
    The template renders them in order; ordering is the caller's
    responsibility (not the template's).
    """
    meta      = (doc.get("metadata") or {})
    company   = meta.get("company_name") or doc.get("filename") or "Document"
    doc_type  = meta.get("doc_type")     or "Financial document"
    fy        = meta.get("fiscal_year")
    currency  = meta.get("currency")

    rendered_sections = [{
        "id":         s["id"],
        "title":      s.get("title") or s["id"].replace("_", " ").title(),
        "html":       _markdown_to_html(s.get("markdown") or ""),
        "word_count": s.get("word_count") or 0,
    } for s in sections_ordered]

    total_words = sum(int(s.get("word_count") or 0) for s in sections_ordered)

    ctx = {
        "report": {
            "id":             report.get("id"),
            "template_label": template_label or "Report",
            "word_count":     total_words,
            "section_count":  len(rendered_sections),
            "generated_at":   datetime.now(timezone.utc).strftime("%B %d, %Y · %H:%M UTC"),
            "sections":       rendered_sections,
        },
        "doc": {
            "filename":  doc.get("filename") or "",
            "company":   company,
            "doc_type":  doc_type,
            "fiscal_year": fy,
            "currency":  currency,
        },
    }

    template = _env.get_template("report.html.j2")
    return template.render(**ctx)
