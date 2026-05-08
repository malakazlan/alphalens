"use client";
import { useEffect, useRef, useState, useCallback } from "react";

// ── Type colours (exact spec from ANALYZER_REDESIGN_PLAN) ─────────────────────
const TYPE_COLOR: Record<string, string> = {
  text: "#32D583", title: "#32D583", key_value: "#32D583",
  page_header: "#32D583", page_footer: "#32D583", page_number: "#32D583", form: "#32D583",
  table: "#2193FD", table_cell: "#2193FD",
  figure: "#FF5CFF", card: "#FF5CFF", scan_code: "#FF5CFF",
  logo: "#F63D68",
  attestation: "#05DEDE",
  error: "#64748b",
};

function typeColor(t: string) { return TYPE_COLOR[t] ?? "#64748b"; }

function typeCategory(t: string): "text" | "table" | "figure" | "logo" | "attestation" | "other" {
  if (["text","title","key_value","page_header","page_footer","page_number","form"].includes(t)) return "text";
  if (["table","table_cell"].includes(t)) return "table";
  if (["figure","card","scan_code"].includes(t)) return "figure";
  if (t === "logo") return "logo";
  if (t === "attestation") return "attestation";
  return "other";
}

function typeHighlightClass(t: string) {
  const cat = typeCategory(t);
  if (cat === "text")        return "markdown-section--text";
  if (cat === "table")       return "markdown-section--table";
  if (cat === "figure")      return "markdown-section--figure";
  if (cat === "logo")        return "markdown-section--logo";
  if (cat === "attestation") return "markdown-section--attestation";
  return "markdown-section--text";
}


// ── Markdown renderer ─────────────────────────────────────────────────────────
// Converts ADE chunk markdown to rendered HTML string.
// Handles: HTML tables (pass-through), headings, bold/italic, code, page breaks, anchors
function renderChunkMarkdown(md: string): string {
  // Unwrap ADE annotation blocks — <::description::> → plain description text.
  // ADE uses this for figure/logo/attestation content, e.g.:
  //   <::logo: Not a logo: [BALANCE SHEET]::>
  //   <::attestation: Signature\nAftab Mahmood Butt\n::>
  //   <::A composite image...:: image::>
  md = md.replace(/<::([\s\S]*?)::>/g, (_, inner) => {
    let text = inner.trim();
    // Strip leading type prefix e.g. "logo: ", "attestation: "
    text = text.replace(/^(?:logo|attestation|figure|card|scan_code):\s*/i, "");
    // Strip trailing single-word media hint on its own line e.g. "\n: image"
    text = text.replace(/\n?\s*:\s*\w+\s*$/, "").trim();
    return text;
  });

  // Split on HTML tags vs text to preserve tables
  const segments = md
    .replace(/<!-- PAGE BREAK -->/g, "\n__PAGEBREAK__\n")
    .split(/(<table[\s\S]*?<\/table>|<a[^>]*><\/a>)/gi);

  let html = "";
  for (const seg of segments) {
    if (!seg) continue;
    if (/^<table/i.test(seg)) {
      html += seg; // pass HTML tables through unchanged
    } else if (/^<a\s/i.test(seg)) {
      html += seg; // pass anchors (will be hidden by CSS)
    } else if (seg.includes("__PAGEBREAK__")) {
      html += '<div class="md-page-break">Page break</div>';
    } else {
      // Process markdown syntax line by line
      const lines = seg.split("\n");
      let buf = "";
      for (const raw of lines) {
        let line = raw
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.+?)\*/g, "<em>$1</em>")
          .replace(/`(.+?)`/g, "<code>$1</code>");

        if (/^### /.test(line))      { html += buf ? `<p>${buf.trim()}</p>` : ""; buf = ""; html += `<h3>${line.slice(4)}</h3>`; }
        else if (/^## /.test(line))  { html += buf ? `<p>${buf.trim()}</p>` : ""; buf = ""; html += `<h2>${line.slice(3)}</h2>`; }
        else if (/^# /.test(line))   { html += buf ? `<p>${buf.trim()}</p>` : ""; buf = ""; html += `<h1>${line.slice(2)}</h1>`; }
        else if (line.trim() === "") { if (buf.trim()) { html += `<p>${buf.trim()}</p>`; buf = ""; } }
        else { buf += (buf ? " " : "") + line.trim(); }
      }
      if (buf.trim()) html += `<p>${buf.trim()}</p>`;
    }
  }
  return html;
}

// ── JSON syntax highlighter ───────────────────────────────────────────────────
function syntaxHighlightJSON(obj: unknown): string {
  const str = JSON.stringify(obj, null, 2);
  return str.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    match => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) return `<span class="json-key">${match}</span>`;
        return `<span class="json-string">${match}</span>`;
      }
      if (/true|false/.test(match)) return `<span class="json-boolean">${match}</span>`;
      if (/null/.test(match))       return `<span class="json-null">${match}</span>`;
      return `<span class="json-number">${match}</span>`;
    }
  );
}

// ── Sanitizer ─────────────────────────────────────────────────────────────────
// Aggressive HTML sanitizer for content destined for dangerouslySetInnerHTML.
// ADE-parsed markdown can contain HTML pulled verbatim from the source PDF,
// and a weaponised document could embed <script>, <iframe>, or inline event
// handlers. This strips them before injection. Dependency-free — for stronger
// guarantees we'd swap in DOMPurify, but this closes the standard XSS vectors.
function sanitizeHtml(html: string): string {
  if (!html) return "";
  return html
    // Dangerous container tags with their inner content
    .replace(/<(script|iframe|object|embed|style|link|meta|form)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, "")
    // Self-closing or unterminated variants
    .replace(/<(script|iframe|object|embed|style|link|meta|form)\b[^>]*\/?>/gi, "")
    // Inline event handlers — onclick="...", onerror='...', onload=foo
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "")
    // javascript: / vbscript: / data: protocols in any href/src-style attribute
    .replace(/(href|src|action|formaction|xlink:href)\s*=\s*"\s*(?:javascript|vbscript|data)\s*:[^"]*"/gi, "$1=\"#\"")
    .replace(/(href|src|action|formaction|xlink:href)\s*=\s*'\s*(?:javascript|vbscript|data)\s*:[^']*'/gi, "$1='#'");
}

// ── Chunk interface ───────────────────────────────────────────────────────────
interface Chunk {
  chunk_id: string;
  chunk_type: string;
  section_header: string;
  page: number;
  markdown: string;
  bbox: { left: number; top: number; right: number; bottom: number };
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface ParsePanelProps {
  docId: string;
  selectedChunkId?: string | null;
  onChunkSelect: (chunkId: string) => void;
  // Built by page.tsx openDoc — same map that drives the PDF overlay labels.
  // When provided, ParsePanel badges show the exact same numbers as the PDF zones.
  labelMap?: Map<string, string>;
}

type SubTab = "markdown" | "json";

// ── Noise text detector ──────────────────────────────────────────────────────
// Filters out tiny chunks that look like page numbers or note references
// (e.g. "/7", "11", "3.1", "Page 7", "- 7 -") that ADE sometimes misclassifies as "text".
function isNoiseText(stripped: string): boolean {
  if (stripped.length < 6 && !/[a-zA-Z]/.test(stripped)) return true;
  if (/^[\d\s.,\/\-()]+$/.test(stripped)) return true;
  if (/^(?:page\s*)?\d+(?:\s*(?:\/|of)\s*\d+)?$/i.test(stripped)) return true;
  return false;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ParsePanel({ docId, selectedChunkId, onChunkSelect, labelMap }: ParsePanelProps) {
  const [chunks,   setChunks]   = useState<Chunk[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");
  const [subTab,   setSubTab]   = useState<SubTab>("markdown");
  const [search,   setSearch]   = useState("");
  const [copied,   setCopied]   = useState(false);

  const markdownRef   = useRef<HTMLDivElement>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch(`/api/documents/${docId}/chunks`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          // Sort by reading order: page → top → left (same tiebreaker as page.tsx overlay build).
          // Left tiebreaker is required for side-by-side elements (same row → same bbox.top).
          const sorted = [...(d.chunks as Chunk[])].sort((a, b) => {
            const pd = (a.page ?? 0) - (b.page ?? 0);
            if (pd !== 0) return pd;
            const at = a.bbox?.top ?? 0, bt = b.bbox?.top ?? 0;
            if (Math.abs(at - bt) > 0.01) return at - bt;
            return (a.bbox?.left ?? 0) - (b.bbox?.left ?? 0);
          });
          // Dedup at state level: removes table_cell & content duplicates for all tabs
          const seenContent = new Set<string>();
          const deduped = sorted.filter(c => {
            if (c.chunk_type === "table_cell") return false;
            const stripped = c.markdown.replace(/<::([\s\S]*?)::>/g, "$1").replace(/<[^>]+>/g, "").trim().slice(0, 200);
            const key = `${c.page}|${stripped}`;
            if (seenContent.has(key)) return false;
            seenContent.add(key);
            return true;
          });
          setChunks(deduped);
        } else {
          setError(d.detail ?? "Failed to load.");
        }
      })
      .catch(() => setError("Could not connect."))
      .finally(() => setLoading(false));
  }, [docId]);

  useEffect(() => { load(); }, [load]);

  // ── Bidirectional sync: scroll to selectedChunkId when it changes ──────────
  // React handles highlight classes via `isSelected` in the render.
  // This effect only handles scrolling the correct container.
  // Scroll only the markdown container — NOT ancestors.
  // scrollIntoView() scrolls every overflow:hidden ancestor (CSS spec),
  // which pushes the tab bar off-screen. Manual scrollTop avoids this.
  useEffect(() => {
    if (!selectedChunkId) return;

    if (subTab === "markdown" && markdownRef.current) {
      const el = markdownRef.current.querySelector(
        `[data-chunk-id="${selectedChunkId}"]`
      ) as HTMLElement | null;
      if (el) {
        const container = markdownRef.current;
        const elRect = el.getBoundingClientRect();
        const cRect = container.getBoundingClientRect();
        // Only scroll if the element is outside the visible area
        if (elRect.top < cRect.top || elRect.bottom > cRect.bottom) {
          container.scrollTop += elRect.top - cRect.top - 50;
        }
      }
    }
  }, [selectedChunkId, subTab]);

  // ── Table cell click delegation ────────────────────────────────────────────
  function handleMarkdownClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;

    // Table cell click — element id (e.g. "0-5") is directly the chunk_id
    // of the synthetic table_cell ChunkOverlay added from grounding data in page.tsx
    if (target.tagName === "TD") {
      // Remove previous active cell highlight
      markdownRef.current?.querySelectorAll("td.cell-active").forEach(td => td.classList.remove("cell-active"));
      target.classList.add("cell-active");

      const cellId = target.id; // e.g. "0-5"
      if (cellId) {
        // This triggers the table_cell overlay in DocViewer (invisible at rest → visible)
        onChunkSelect(cellId);
      } else {
        // Fallback: select the parent table chunk if cell has no id
        const table = target.closest("table");
        if (table?.id) {
          const chunk = chunks.find(c => c.markdown.includes(`id="${table.id}"`));
          if (chunk) onChunkSelect(chunk.chunk_id);
        }
      }
      return;
    }

    // Section card click
    const section = target.closest(".markdown-section") as HTMLElement | null;
    if (section) {
      const id = section.getAttribute("data-chunk-id");
      if (id) onChunkSelect(id);
    }
  }

  // Noise types hidden from the Markdown reading tab
  const MARKDOWN_NOISE = new Set(["page_number", "page_header", "page_footer"]);

  // mdChunks: noise-filtered, short-content filtered (chunks state is already deduped)
  const mdChunks = chunks.filter(c => {
    if (MARKDOWN_NOISE.has(c.chunk_type)) return false;
    const stripped = c.markdown.replace(/<::([\s\S]*?)::>/g, "$1").replace(/<[^>]+>/g, "").trim();
    if (stripped.length < 4) return false;
    if (isNoiseText(stripped)) return false;
    return true;
  });

  // ── Copy JSON ──────────────────────────────────────────────────────────────
  function copyJSON() {
    navigator.clipboard.writeText(JSON.stringify(chunks, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  // ── Loading / error ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: "var(--al-accent-light)", borderTopColor: "var(--al-accent)" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-xs text-center" style={{ color: "var(--al-error)" }}>
        <p className="mb-3">⚠ {error}</p>
        <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg"
          style={{ color: "var(--al-accent)", background: "var(--al-accent-soft)" }}>
          Retry
        </button>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {/* Sub-tab bar */}
      <div className="flex gap-1 px-3 pt-3 pb-0 shrink-0">
        {(["markdown", "json"] as SubTab[]).map(t => (
          <button key={t} onClick={() => setSubTab(t)}
            className="px-3 py-1.5 rounded-t-lg text-xs font-medium capitalize transition-all border border-b-0"
            style={{
              background:   subTab === t ? "var(--al-card)" : "transparent",
              color:        subTab === t ? "var(--al-accent)" : "var(--al-subtle)",
              borderColor:  subTab === t ? "var(--al-border)" : "transparent",
              borderBottom: subTab === t ? "1px solid var(--al-card)" : undefined,
              marginBottom: subTab === t ? "-1px" : 0,
              zIndex:       subTab === t ? 1 : 0,
              position:     "relative",
            }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Content — tabs share border-top */}
      <div className="flex-1 overflow-hidden flex flex-col border-t" style={{ borderColor: "var(--al-border)" }}>

        {/* ── MARKDOWN TAB ────────────────────────────────────────────────── */}
        {subTab === "markdown" && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Search bar */}
            <div className="px-3 py-2 border-b shrink-0 flex items-center gap-2"
              style={{ borderColor: "var(--al-border)", background: "var(--al-bg-soft)" }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search in document…"
                className="flex-1 text-xs px-3 py-1.5 rounded-lg outline-none"
                style={{
                  background: "var(--al-card)",
                  border: "1.5px solid var(--al-border)",
                  color: "var(--al-text)",
                }}
              />
              {search && (
                <button onClick={() => setSearch("")}
                  className="text-xs shrink-0" style={{ color: "var(--al-subtle)" }}>✕</button>
              )}
            </div>

            {/* Chunk sections — flat reading layout, no card boxes */}
            <div
              ref={markdownRef}
              className="flex-1 overflow-y-auto pb-4"
              style={{ display: "flex", flexDirection: "column" }}
              onClick={handleMarkdownClick}
            >
              {mdChunks.map((chunk, idx) => {
                const isSelected  = selectedChunkId === chunk.chunk_id;
                const color       = typeColor(chunk.chunk_type);
                const typeLabel   = chunk.chunk_type
                  .split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                const badgeLabel  = labelMap?.get(chunk.chunk_id) ?? `${idx + 1} - ${typeLabel}`;
                const rendered    = renderChunkMarkdown(chunk.markdown);
                const isMediaChunk = ["figure", "card", "scan_code", "logo", "attestation"].includes(chunk.chunk_type);

                const displayHtml = search.trim()
                  ? rendered.replace(
                      new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
                      '<mark class="search-hit">$1</mark>'
                    )
                  : rendered;

                return (
                  <div
                    key={chunk.chunk_id}
                    className="markdown-section cursor-pointer"
                    data-chunk-id={chunk.chunk_id}
                    style={{
                      borderLeft: `3px solid ${isSelected ? color : "transparent"}`,
                      background: isSelected ? `${color}0d` : "transparent",
                    }}
                  >
                    {/* Label: plain grey at rest → colored pill when selected */}
                    <div style={{ marginBottom: 6 }}>
                      {isSelected ? (
                        <span style={{
                          display: "inline-block",
                          fontSize: 10, fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 4,
                          lineHeight: 1.6,
                          letterSpacing: "0.02em",
                          background: color,
                          color: color === "#32D583" ? "#000" : "#fff",
                        }}>
                          {badgeLabel}
                        </span>
                      ) : (
                        <span style={{
                          fontSize: 11, fontWeight: 500,
                          color: "var(--al-subtle)",
                          letterSpacing: "0.01em",
                        }}>
                          {badgeLabel}
                        </span>
                      )}
                    </div>
                    <div
                      className="md-content"
                      style={isMediaChunk ? {
                        fontStyle: "italic",
                        fontSize: "0.82em",
                        color: "var(--al-text-secondary)",
                        borderLeft: `2px solid ${color}40`,
                        paddingLeft: 8,
                        marginTop: 2,
                      } : undefined}
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(displayHtml) }}
                    />
                  </div>
                );
              })}

              {mdChunks.length === 0 && !loading && (
                <div className="text-center py-12 text-sm" style={{ color: "var(--al-subtle)" }}>
                  No parsed content yet.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── JSON TAB ────────────────────────────────────────────────────── */}
        {subTab === "json" && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b shrink-0 flex items-center justify-between"
              style={{ borderColor: "var(--al-border)", background: "var(--al-bg-soft)" }}>
              <span className="text-xs" style={{ color: "var(--al-subtle)" }}>
                {chunks.length} chunks
              </span>
              <button onClick={copyJSON}
                className="text-xs px-3 py-1 rounded-lg transition-all"
                style={{
                  background: copied ? "var(--al-accent)" : "var(--al-accent-soft)",
                  color:      copied ? "#fff" : "var(--al-accent)",
                }}>
                {copied ? "Copied!" : "Copy JSON"}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <pre
                className="text-xs leading-relaxed"
                style={{ fontFamily: "ui-monospace, monospace", color: "var(--al-text)" }}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(syntaxHighlightJSON(chunks)) }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
