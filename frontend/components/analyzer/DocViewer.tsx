"use client";
import { useEffect, useRef, useState } from "react";

// ── Public types ──────────────────────────────────────────────────────────────
export interface ChunkOverlay {
  chunk_id: string;
  chunk_type: string;
  page: number; // 0-indexed
  bbox: { left: number; top: number; right: number; bottom: number };
  label?: string; // e.g. "1.text", "2.table", "tableCell"
}

// Legacy — kept so ChatPanel's onHighlight path still compiles during transition
export interface BboxHighlight {
  element_id: string;
  page: number;
  box: { left: number; top: number; right: number; bottom: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function typeToClass(type: string): string {
  switch (type) {
    case "text": case "title": case "key_value": case "page_header":
    case "page_footer": case "page_number": case "attestation": case "form":
      return "overlay-box--text";
    case "table":      return "overlay-box--table";
    case "table_cell": return "overlay-box--table-cell";
    case "figure": case "card": case "scan_code": case "logo":
      return "overlay-box--figure";
    default:           return "overlay-box--error";
  }
}

const PDFJS_VERSION = "3.11.174";
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

function loadPdfjsScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) { resolve(); return; }
    const existing = document.getElementById("pdfjs-script");
    if (existing) { existing.addEventListener("load", () => resolve()); return; }
    const script = document.createElement("script");
    script.id = "pdfjs-script";
    script.src = `${PDFJS_CDN}/pdf.min.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load PDF.js"));
    document.head.appendChild(script);
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface DocViewerProps {
  signedUrl: string;
  chunks?: ChunkOverlay[];
  selectedChunkId?: string | null;
  onChunkClick?: (chunkId: string | null) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function DocViewer({
  signedUrl,
  chunks = [],
  selectedChunkId,
  onChunkClick,
}: DocViewerProps) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const renderIdRef   = useRef(0);
  const pageWrapsRef  = useRef<HTMLDivElement[]>([]);
  const lazyIoRef     = useRef<IntersectionObserver | null>(null);

  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState("");
  const [numPages,    setNumPages]    = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  // ── 1. Render PDF pages (lazy — only renders pages near the viewport) ────────
  useEffect(() => {
    if (!signedUrl) return;

    // Disconnect any previous lazy observer
    if (lazyIoRef.current) { lazyIoRef.current.disconnect(); lazyIoRef.current = null; }

    const renderId = ++renderIdRef.current;
    setLoading(true);
    setError("");
    pageWrapsRef.current = [];

    const render = async () => {
      try {
        await loadPdfjsScript();
        if (renderIdRef.current !== renderId) return;

        const pdfjsLib = (window as any).pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;

        const pdf = await pdfjsLib.getDocument({ url: signedUrl }).promise;
        if (renderIdRef.current !== renderId) return;

        setNumPages(pdf.numPages);
        if (!containerRef.current) return;

        containerRef.current.innerHTML = "";
        pageWrapsRef.current = [];

        // ── Pass 1: create placeholder wrappers for all pages ────────────────
        // pdf.getPage() is fast — it reads page metadata without rendering.
        // We need each page's viewport to reserve the correct height so
        // IntersectionObserver thresholds are accurate before any rendering.
        for (let i = 1; i <= pdf.numPages; i++) {
          if (renderIdRef.current !== renderId) return;

          const page     = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });

          const wrap = document.createElement("div");
          wrap.className = "page-wrapper";
          // Reserve exact dimensions — prevents layout jump when canvas appears
          wrap.style.cssText = [
            "position:relative",
            "margin-bottom:12px",
            "box-shadow:0 2px 8px rgba(0,0,0,0.13)",
            "background:#d0d0d0",
            `width:${viewport.width}px`,
            `height:${viewport.height}px`,
          ].join(";");
          wrap.setAttribute("data-page-num", String(i - 1));

          const canvas = document.createElement("canvas");
          canvas.width  = viewport.width;
          canvas.height = viewport.height;
          canvas.style.cssText = "width:100%;display:none;";
          wrap.appendChild(canvas);

          const layer = document.createElement("div");
          layer.className = "overlay-layer";
          wrap.appendChild(layer);

          containerRef.current.appendChild(wrap);
          pageWrapsRef.current.push(wrap);
        }

        setLoading(false);

        // ── Pass 2: lazy render via IntersectionObserver ──────────────────────
        const renderedPages = new Set<number>();

        const renderPage = async (pageNum: number) => {
          if (renderedPages.has(pageNum) || renderIdRef.current !== renderId) return;
          renderedPages.add(pageNum);
          const wrap   = pageWrapsRef.current[pageNum - 1];
          const canvas = wrap?.querySelector("canvas") as HTMLCanvasElement | null;
          if (!wrap || !canvas) return;
          const page     = await pdf.getPage(pageNum);
          if (renderIdRef.current !== renderId) return;
          const viewport = page.getViewport({ scale: 1.5 });
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
          if (renderIdRef.current !== renderId) return;
          canvas.style.display = "block";
          wrap.style.height = "";  // let canvas dictate height once rendered
        };

        const io = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const idx     = parseInt((entry.target as HTMLElement).getAttribute("data-page-num") ?? "0", 10);
              const pageNum = idx + 1;
              renderPage(pageNum);
              // Pre-render next page so it's ready before user scrolls to it
              if (pageNum < pdf.numPages) renderPage(pageNum + 1);
            }
          },
          { rootMargin: "400px 0px" },  // start rendering 400px before entering viewport
        );

        lazyIoRef.current = io;
        pageWrapsRef.current.forEach(w => io.observe(w));

        // Render page 1 (and 2) immediately — don't wait for IO
        renderPage(1);
        if (pdf.numPages > 1) renderPage(2);

      } catch (e: any) {
        if (renderIdRef.current !== renderId) return;
        setError(e?.message ?? "Could not load PDF.");
        setLoading(false);
      }
    };

    render();

    return () => {
      if (lazyIoRef.current) { lazyIoRef.current.disconnect(); lazyIoRef.current = null; }
    };
  }, [signedUrl]);

  // ── 2. IntersectionObserver for page counter ──────────────────────────────
  useEffect(() => {
    if (numPages === 0) return;
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (e.isIntersecting) {
          const n = parseInt(e.target.getAttribute("data-page-num") ?? "0", 10);
          setCurrentPage(n + 1);
        }
      }),
      { threshold: 0.4 }
    );
    pageWrapsRef.current.forEach(w => observer.observe(w));
    return () => observer.disconnect();
  }, [numPages]);

  // ── 3. Build DOM overlays whenever chunks / selection change ──────────────
  useEffect(() => {
    const hasSelection = !!selectedChunkId;

    pageWrapsRef.current.forEach(wrap => {
      const pageIdx = parseInt(wrap.getAttribute("data-page-num") ?? "0", 10);
      const layer   = wrap.querySelector(".overlay-layer") as HTMLDivElement | null;
      if (!layer) return;

      layer.innerHTML = "";

      const pageChunks = chunks.filter(c => c.page === pageIdx);
      for (const chunk of pageChunks) {
        const box = document.createElement("div");
        box.className = `overlay-box ${typeToClass(chunk.chunk_type)}`;
        box.setAttribute("data-chunk-id", chunk.chunk_id);

        const { left, top, right, bottom } = chunk.bbox;
        box.style.left   = `${left * 100}%`;
        box.style.top    = `${top * 100}%`;
        box.style.width  = `${(right - left) * 100}%`;
        box.style.height = `${(bottom - top) * 100}%`;

        // Active state: only the exact selected chunk gets highlighted.
        // No parent-table co-activation — we highlight only the specific cell.
        if (hasSelection && chunk.chunk_id === selectedChunkId) {
          box.classList.add("overlay-box--active");
        }

        // Label
        const label = document.createElement("span");
        label.className = "overlay-label";
        label.textContent = chunk.label ?? chunk.chunk_type.replace(/_/g, " ");
        box.appendChild(label);

        // Click
        box.addEventListener("click", e => {
          e.stopPropagation();
          onChunkClick?.(chunk.chunk_id);
        });

        layer.appendChild(box);
      }
    });
  }, [chunks, selectedChunkId, onChunkClick]);

  // ── 4. Scroll PDF to selected chunk's page ────────────────────────────────
  useEffect(() => {
    if (!selectedChunkId || !containerRef.current) return;
    const chunk = chunks.find(c => c.chunk_id === selectedChunkId);
    if (!chunk) return;
    containerRef.current
      .querySelector(`[data-page-num="${chunk.page}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedChunkId, chunks]);

  // ── Scroll helpers ────────────────────────────────────────────────────────
  function scrollToPage(page: number) {
    containerRef.current
      ?.querySelector(`[data-page-num="${page - 1}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!signedUrl) {
    return (
      <div className="flex items-center justify-center h-full text-sm"
        style={{ color: "var(--al-subtle)" }}>
        Select a document to preview
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div className="px-3 py-2 border-b flex items-center gap-2 shrink-0"
        style={{ background: "var(--al-bg-soft)", borderColor: "var(--al-border)" }}>
        <span className="text-xs font-medium flex-1 truncate" style={{ color: "var(--al-subtle)" }}>
          {loading ? "Loading…" : `${numPages} page${numPages !== 1 ? "s" : ""}`}
        </span>

        {/* Page nav ‹ N / T › */}
        {!loading && numPages > 1 && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className="w-5 h-5 flex items-center justify-center rounded text-sm"
              style={{ color: currentPage <= 1 ? "var(--al-border)" : "var(--al-subtle)" }}>
              ‹
            </button>
            <span className="text-xs tabular-nums px-1" style={{ color: "var(--al-text-secondary)" }}>
              {currentPage} / {numPages}
            </span>
            <button
              onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))}
              disabled={currentPage >= numPages}
              className="w-5 h-5 flex items-center justify-center rounded text-sm"
              style={{ color: currentPage >= numPages ? "var(--al-border)" : "var(--al-subtle)" }}>
              ›
            </button>
          </div>
        )}

        {/* Download */}
        <a href={signedUrl} target="_blank" rel="noreferrer"
          className="text-xs font-medium shrink-0"
          style={{ color: "var(--al-accent)" }} title="Download PDF">
          ↓
        </a>
      </div>

      {/* PDF scroll area */}
      <div className="flex-1 overflow-y-auto p-3 relative" style={{ background: "#e4e4e4" }}>
        {loading && (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: "var(--al-accent-light)", borderTopColor: "var(--al-accent)" }} />
            <p className="text-xs" style={{ color: "var(--al-subtle)" }}>Rendering PDF…</p>
          </div>
        )}
        {error && (
          <div className="text-center text-sm py-8" style={{ color: "var(--al-error)" }}>{error}</div>
        )}

        <div ref={containerRef} />

        {/* Clear Selection — sticky at bottom */}
        {selectedChunkId && (
          <div className="sticky bottom-3 flex justify-center pointer-events-none">
            <button
              onClick={() => onChunkClick?.(null)}
              className="pointer-events-auto px-4 py-1.5 rounded-full text-xs font-medium"
              style={{
                background: "var(--al-card)",
                border: "1px solid var(--al-border)",
                color: "var(--al-subtle)",
                boxShadow: "0 2px 12px rgba(0,0,0,0.14)",
              }}>
              ✕ Clear Selection
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
