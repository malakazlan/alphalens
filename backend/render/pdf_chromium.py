"""Headless-Chromium HTML→PDF renderer.

One instance per worker process (created at ARQ startup); each `render`
call creates a fresh `BrowserContext` so renders don't share cookies,
storage, or service workers. Network is fully blocked — the HTML we pass
in MUST inline every asset (font, logo) as a base64 data URI or be
served from a `data:`/inline `<style>`. The renderer will abort any
outbound request rather than silently fall back to a system font.

Why Playwright and not WeasyPrint:
    Two-line CSS like `display: flex` or modern table styles render
    perfectly in Chromium and break in WeasyPrint. For a fintech-grade
    deliverable, Chromium's rendering fidelity is the real product.

Playwright is a heavy dependency (~300 MB with Chromium). The web image
should not install it; only the worker image does. See
`deploy/Dockerfile.worker`.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class PdfOptions:
    """PDF generation knobs.

    These mirror the small subset of Playwright's `page.pdf()` options we
    actually use. Defaults match A4 print with safe margins for a header
    + footer band.
    """
    format:                 str  = "A4"
    margin_top:             str  = "20mm"
    margin_right:           str  = "16mm"
    margin_bottom:          str  = "20mm"
    margin_left:            str  = "16mm"
    print_background:       bool = True
    prefer_css_page_size:   bool = True
    display_header_footer:  bool = False
    header_template:        str  = ""
    footer_template:        str  = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def to_playwright(self) -> dict[str, Any]:
        opts: dict[str, Any] = {
            "format":              self.format,
            "print_background":    self.print_background,
            "prefer_css_page_size":self.prefer_css_page_size,
            "margin": {
                "top":    self.margin_top,
                "right":  self.margin_right,
                "bottom": self.margin_bottom,
                "left":   self.margin_left,
            },
        }
        if self.display_header_footer:
            opts["display_header_footer"] = True
            opts["header_template"]       = self.header_template
            opts["footer_template"]       = self.footer_template
        opts.update(self.extra)
        return opts


class PdfRenderer:
    """Lifecycle:
        renderer = PdfRenderer()
        await renderer.start()                    # spawns the Playwright + Chromium
        bytes_ = await renderer.render(html, options=PdfOptions())
        await renderer.stop()                     # on worker shutdown

    Reusing the same Browser across renders is the main win — cold start
    is ~1.5 s; subsequent renders are <500 ms.
    """

    def __init__(self) -> None:
        self._pw:      Any | None = None   # playwright instance
        self._browser: Any | None = None   # Browser
        self._started: bool = False

    async def start(self) -> None:
        if self._started:
            return
        try:
            # Lazy import — keeps this module importable on machines where
            # playwright isn't installed (e.g. the web container). The
            # actual error surfaces at job time, where it's logged and
            # written to `pdf_status_message`.
            from playwright.async_api import async_playwright  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "playwright is not installed. Install with `pip install playwright` "
                "and then `playwright install chromium`."
            ) from e

        self._pw = await async_playwright().start()
        # `--no-sandbox` is required when running as root in a container;
        # we drop privileges in the image so it's a no-op there, but keep
        # it for dev where running as the Docker host user is common.
        self._browser = await self._pw.chromium.launch(
            args=["--no-sandbox", "--disable-dev-shm-usage"],
            headless=True,
        )
        self._started = True
        logger.info("PdfRenderer started (chromium)")

    async def stop(self) -> None:
        if self._browser is not None:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None
        if self._pw is not None:
            try:
                await self._pw.stop()
            except Exception:
                pass
            self._pw = None
        self._started = False

    async def render(self, html: str, *, options: Optional[PdfOptions] = None) -> bytes:
        if not self._started or self._browser is None:
            await self.start()
        assert self._browser is not None  # for type-checkers

        opts = options or PdfOptions()

        # Fresh context per render. JS is allowed (some markdown→HTML
        # paths use it indirectly), but network is fully blocked — every
        # asset must be inline. This kills any chance of a tracker pixel
        # or an external font fetch ever making it into a customer PDF.
        context = await self._browser.new_context(
            java_script_enabled=True,
            bypass_csp=True,
        )
        try:
            page = await context.new_page()
            await page.route("**/*", lambda route, request: route.abort())
            # `load` vs `networkidle`: with all network aborted, networkidle
            # never resolves cleanly. `load` is the right signal.
            await page.set_content(html, wait_until="load")
            pdf_bytes = await page.pdf(**opts.to_playwright())
            return pdf_bytes
        finally:
            try:
                await context.close()
            except Exception:
                pass
