"""Report rendering pipeline (Phase 3 commit 8).

Public surface:
    PdfRenderer        — headless-Chromium HTML→PDF
    render_report_html — Jinja template renderer for the report HTML
"""

from .pdf_chromium import PdfRenderer, PdfOptions
from .report_html  import render_report_html

__all__ = ["PdfRenderer", "PdfOptions", "render_report_html"]
