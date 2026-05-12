"use client";
import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChunkOverlay } from "@/components/analyzer/DocViewer";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SourceChunk {
  chunk_id:          string;
  chunk_type:        string;
  section_header:    string;
  page:              number;
  markdown:          string;
  bbox:              { left: number; top: number; right: number; bottom: number };
  score:             number;
  // Phase 6 — LLM-provided short label. When present, this drives the
  // chip text directly (most accurate path, since the LLM has read the
  // actual table content). Empty when the LLM emitted [[id]] without
  // the `|label` suffix — falls back to heuristic-derived labels.
  llm_label?:        string;
  // Cross-cell context (heuristic fallback for chip label)
  row_label_id?:     string | null;
  row_label_text?:   string;
  group_label_id?:   string | null;
  group_label_text?: string;
  col_header_id?:    string | null;
  col_header_text?:  string;
  year_label?:       string | null;
}

interface Message {
  id:        string;
  role:      "user" | "assistant";
  content:   string;
  sources?:  SourceChunk[];
  streaming?: boolean;
}

interface ResolvedChip {
  source:           SourceChunk;
  cellId:           string | null;   // primary highlight — the value cell
  label:            string;
  secondaryCellIds: string[];        // row label + group label + col header cells
}

interface ChatPanelProps {
  docId:         string;
  parseChunks?:  ChunkOverlay[];
  onChunkSelect: (chunkId: string | null, secondaryIds?: string[]) => void;
}

interface Conversation {
  id:         string;
  title:      string | null;
  created_at: string;
  updated_at: string;
}

// Doc-agnostic starter prompts shown in the empty state. Generic-financial
// so they work on any uploaded filing; clicking sends immediately so a
// first-time user sees a cited answer without typing. Keep at 4 — more
// crowds the panel.
const STARTER_PROMPTS: { icon: string; label: string; prompt: string }[] = [
  { icon: "✦", label: "Document summary",       prompt: "Give me a short document summary." },
  { icon: "★", label: "Main findings",          prompt: "What are the main findings of this document?" },
  { icon: "▶", label: "Cash flow overview",     prompt: "Give me a summary of the cash flow statement." },
  { icon: "⇄", label: "Compare year-over-year", prompt: "Compare the most recent two years of revenue." },
];

// ── Figure label extractor ────────────────────────────────────────────────────
// ADE figure chunks carry a structured description in markdown — usually a
// "Title: …" header and a "Figure N: …" caption. Pull out the human-friendly
// pieces so the chip reads "Figure 1 — Quarterly Net Revenue" instead of
// "bar chart Title: Quarterly…" (the raw first line).
function extractFigureLabel(markdown: string): string {
  if (!markdown) return "Figure";
  // Strip HTML, descriptor wrapping (<::desc: kind::>), and excess whitespace.
  const flat = markdown
    .replace(/<[^>]+>/g, " ")
    .replace(/<::|::>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Pattern 1: explicit "Figure N: caption"
  const figMatch = flat.match(/Figure\s+(\d+)\s*[:\-—]\s*([^.]{2,80})/i);
  if (figMatch) {
    const num = figMatch[1];
    const cap = figMatch[2].trim();
    return `Figure ${num} — ${cap}`;
  }

  // Pattern 2: "Title: <title>" (ADE's chart parse format)
  const titleMatch = flat.match(/Title:\s*([^.]{2,80})/i);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  // Pattern 3: leading "bar chart" / "line chart" / "pie chart" + nearby words
  const chartKind = flat.match(/\b(bar chart|line chart|pie chart|column chart|scatter plot|chart|graph)\b/i);
  if (chartKind) {
    return chartKind[1][0].toUpperCase() + chartKind[1].slice(1);
  }

  // Fallback: first 60 chars of flattened description.
  return flat.slice(0, 60) || "Figure";
}

// ── Chip label builder ────────────────────────────────────────────────────────

function buildChipLabel(chunk: SourceChunk): string {
  const value = chunk.markdown || "";

  // Phase 6 — LLM-provided label wins. The model has read the actual
  // table content and named what each value represents; that's strictly
  // more reliable than our row-major grid heuristics, which break on
  // messy ADE table parses (e.g. multi-line row labels, missing sub-
  // section headers). Still pair with a year when one is available so
  // YoY chip lists stay disambiguated.
  if (chunk.llm_label && chunk.llm_label.trim()) {
    const yearPart =
      chunk.year_label ||
      (/^(19|20)\d{2}$/.test(chunk.col_header_text ?? "") ? chunk.col_header_text : null);
    const parts = [chunk.llm_label.trim()];
    if (yearPart) parts.push(yearPart);
    return `${parts.join(" · ")}${value ? `  →  ${value}` : ""}`;
  }

  // ── Heuristic fallback (pre-Phase-6 path) ─────────────────────────────
  // Runs only when the LLM didn't annotate the citation with a label.
  // Section · year · group · row → value.
  const parts: string[] = [];

  const section = chunk.section_header || "";
  if (section) {
    const words = section.trim().split(/\s+/);
    parts.push(words.length > 4 ? words.slice(-3).join(" ") : section);
  }

  const yearPart =
    chunk.year_label ||
    (/^(19|20)\d{2}$/.test(chunk.col_header_text ?? "") ? chunk.col_header_text : null);
  if (yearPart) parts.push(yearPart);

  if (chunk.group_label_text) parts.push(chunk.group_label_text);
  if (chunk.row_label_text)   parts.push(chunk.row_label_text);

  return parts.length > 0
    ? `${parts.join(" · ")}${value ? `  →  ${value}` : ""}`
    : value || chunk.chunk_id;
}

// ── Chip resolver ─────────────────────────────────────────────────────────────
// Runs once per message after sources arrive (moved to useMemo in MessageRow).

function resolveChips(sources: SourceChunk[]): ResolvedChip[] {
  const tableChips: ResolvedChip[] = [];
  const textChips:  ResolvedChip[] = [];
  const seen = new Set<string>();

  for (const chunk of sources) {
    if (seen.has(chunk.chunk_id)) continue;
    seen.add(chunk.chunk_id);

    const isCell = chunk.chunk_type === "table_cell" || /^\d+-\d+$/.test(chunk.chunk_id);
    const isTable = isCell || chunk.chunk_type === "table";

    if (!isTable) {
      // Figure chunks: derive a clean "Figure N — caption" label from the
      // chart's parsed description. LLM-provided label still wins when
      // present (it usually reads better than the auto-extracted one).
      let label: string;
      if (chunk.llm_label && chunk.llm_label.trim()) {
        label = chunk.llm_label.trim();
      } else if (chunk.chunk_type === "figure") {
        label = extractFigureLabel(chunk.markdown);
      } else {
        const raw = chunk.markdown.replace(/<[^>]+>/g, "").trim();
        label = (chunk.section_header || raw.split("\n")[0]).slice(0, 60) || chunk.chunk_type;
      }
      textChips.push({ source: chunk, cellId: null, label, secondaryCellIds: [] });
      continue;
    }

    // Direct cell reference from backend value-matcher (isCell already guarantees \d+-\d+ shape)
    if (isCell) {
      const secondaryCellIds = [
        chunk.row_label_id,
        chunk.group_label_id,
        chunk.col_header_id,
      ].filter((id): id is string => !!id);

      tableChips.push({
        source:           chunk,
        cellId:           chunk.chunk_id,
        label:            buildChipLabel(chunk),
        secondaryCellIds,
      });
      continue;
    }

    // Fallback: Qdrant table chunk (no cell-level resolution)
    const fallback = (chunk.section_header || "table").slice(0, 60);
    tableChips.push({ source: chunk, cellId: null, label: fallback, secondaryCellIds: [] });
  }

  if (tableChips.length > 0) {
    // Sort by document order: page → top → left
    tableChips.sort((a, b) => {
      const pd = a.source.page - b.source.page;
      if (pd !== 0) return pd;
      const at = a.source.bbox?.top ?? 0, bt = b.source.bbox?.top ?? 0;
      if (Math.abs(at - bt) > 0.01) return at - bt;
      return (a.source.bbox?.left ?? 0) - (b.source.bbox?.left ?? 0);
    });

    // Dedup by resolved cellId (same cell from two sources)
    const seenCell = new Set<string>();
    return tableChips
      .filter(c => { if (!c.cellId) return true; if (seenCell.has(c.cellId)) return false; seenCell.add(c.cellId); return true; })
      .slice(0, 6);
  }

  return textChips.slice(0, 4);
}

function hasBbox(bbox: SourceChunk["bbox"]): boolean {
  return typeof bbox?.left === "number" && typeof bbox?.right === "number" &&
         typeof bbox?.top  === "number" && typeof bbox?.bottom === "number";
}

// ── Markdown renderer ────────────────────────────────────────────────────────
// Assistant messages stream as markdown — `## Heading`, `**bold**`, GFM tables,
// bullets, etc. Rendering them as plain text exposes the raw syntax to the
// user (`## Heading` shows literally). react-markdown + remark-gfm builds a
// React tree from the text; we map every node type to a Tailwind/inline style
// so the result blends with the chat panel's typography.
//
// Defence-in-depth: any `[[cell-id]]` markers that leaked past the backend
// strip (stream edge cases, old persisted messages from before the fix) are
// removed here before rendering. Citation chips still drive the highlight
// flow; users should never see the raw markers in the bubble.
const _CITATION_LEAK_RE = /\[\[[^\]]+\]\]/g;

function MarkdownContent({ text }: { text: string }) {
  const cleaned = useMemo(
    () => text.replace(_CITATION_LEAK_RE, "").replace(/[ \t]+(?=[.,;:!?])/g, ""),
    [text],
  );
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h2 className="text-base font-bold mt-3 mb-2" style={{ color: "var(--al-text)" }}>{children}</h2>,
          h2: ({ children }) => <h3 className="text-base font-bold mt-3 mb-2" style={{ color: "var(--al-text)" }}>{children}</h3>,
          h3: ({ children }) => <h4 className="text-sm font-semibold mt-2.5 mb-1.5" style={{ color: "var(--al-text)" }}>{children}</h4>,
          h4: ({ children }) => <h5 className="text-sm font-semibold mt-2 mb-1" style={{ color: "var(--al-text-secondary)" }}>{children}</h5>,
          h5: ({ children }) => <h6 className="text-xs font-semibold mt-2 mb-1 uppercase tracking-wide" style={{ color: "var(--al-text-secondary)" }}>{children}</h6>,
          h6: ({ children }) => <h6 className="text-xs font-semibold mt-2 mb-1 uppercase tracking-wide" style={{ color: "var(--al-subtle)" }}>{children}</h6>,
          p:  ({ children }) => <p  className="text-sm leading-relaxed my-1.5" style={{ color: "var(--al-text)" }}>{children}</p>,
          strong: ({ children }) => <strong className="font-semibold" style={{ color: "var(--al-text)" }}>{children}</strong>,
          em:     ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="text-sm space-y-1 pl-5 my-1.5" style={{ listStyle: "disc" }}>{children}</ul>,
          ol: ({ children }) => <ol className="text-sm space-y-1 pl-5 my-1.5" style={{ listStyle: "decimal" }}>{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed" style={{ color: "var(--al-text)" }}>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote
              className="my-2 pl-3 py-1 text-sm italic rounded-r-md"
              style={{ borderLeft: "3px solid var(--al-accent)", background: "var(--al-bg-soft)", color: "var(--al-text-secondary)" }}
            >{children}</blockquote>
          ),
          code: ({ children, className }) => {
            const isBlock = (className ?? "").includes("language-");
            if (isBlock) {
              return (
                <pre
                  className="my-2 px-3 py-2 rounded-lg overflow-x-auto text-xs font-mono"
                  style={{ background: "var(--al-bg-soft)", border: "1px solid var(--al-border)", color: "var(--al-text)" }}
                >
                  <code>{children}</code>
                </pre>
              );
            }
            return (
              <code
                className="px-1.5 py-0.5 rounded text-xs font-mono"
                style={{ background: "var(--al-bg-soft)", border: "1px solid var(--al-border)", color: "var(--al-text)" }}
              >{children}</code>
            );
          },
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="underline"
              style={{ color: "var(--al-accent)" }}
            >{children}</a>
          ),
          // GFM tables — wrap in a scroll container so wide financial tables
          // don't blow the panel width on small screens.
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-lg" style={{ border: "1px solid var(--al-border)" }}>
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead style={{ background: "var(--al-bg-soft)" }}>{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr style={{ borderTop: "1px solid var(--al-border)" }}>{children}</tr>,
          th: ({ children }) => (
            <th className="text-left px-3 py-1.5 font-semibold" style={{ color: "var(--al-text)" }}>{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-1.5" style={{ color: "var(--al-text)" }}>{children}</td>
          ),
          hr: () => <hr className="my-3" style={{ borderColor: "var(--al-border)" }} />,
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}

// ── MessageRow — memoised so old rows skip re-renders during streaming ──────
// Without memo, every SSE delta runs setMessages → React diffs the whole list
// → every MessageRow re-runs, including expensive paths like ReactMarkdown
// (which re-parses the entire message text from scratch). With memo + a
// custom equality, only the actively-streaming row re-renders.
//
// Equality rules:
//  - Different message id → re-render (different message)
//  - role / content / streaming changed → re-render
//  - sources reference changed → re-render (chips need refresh)
//  - activeChip relevance for THIS row changed → re-render
//  - parseChunks/onChipClick are deliberately excluded; parent uses stable
//    refs (see ChatPanel) so these don't trigger spurious re-renders.

interface MessageRowProps {
  msg:         Message;
  activeChip:  { msgId: string; idx: number } | null;
  onChipClick: (chip: ResolvedChip, msgId: string, idx: number) => void;
}

const MessageRow = memo(function MessageRow({
  msg,
  activeChip,
  onChipClick,
}: MessageRowProps) {
  // Chips are resolved once when sources arrive — not on every streaming delta.
  // msg.sources is a stable reference (set once, never mutated after streaming ends).
  const chips = useMemo(
    () => resolveChips(msg.sources ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [msg.sources],
  );

  const isUser = msg.role === "user";

  // Copy-to-clipboard for assistant answers. Shows brief 'Copied' feedback.
  // Uses the cleaned content directly — any stray [[id|label]] markers
  // have already been stripped server-side at persist time and
  // defensively in MarkdownContent.
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(msg.content || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — fail silently */ }
  }

  return (
    <div className={`chat-msg-enter flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div style={{ maxWidth: isUser ? "88%" : "92%" }} className="group">
        {/* Message bubble.
            User: plain text, gradient bubble (preserve newlines).
            Assistant while streaming: plain text — markdown would re-parse
              on every delta and stall the panel. Switch to MarkdownContent
              ONCE when streaming ends (markdown parses exactly once per
              assistant message). */}
        <div
          className={`relative rounded-2xl ${isUser ? "px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap" : "px-4 py-3"}`}
          style={isUser ? {
            background:              "linear-gradient(135deg, #059669 0%, #10b981 100%)",
            color:                   "#fff",
            borderBottomRightRadius: 4,
          } : {
            background:             "var(--al-card)",
            color:                  "var(--al-text)",
            border:                 "1.5px solid var(--al-border)",
            borderBottomLeftRadius: 4,
          }}
        >
          {isUser
            ? (msg.content || null)
            : msg.content
              ? (msg.streaming
                  ? <span
                      className="text-sm leading-relaxed"
                      style={{ whiteSpace: "pre-wrap", color: "var(--al-text)" }}
                    >{msg.content}</span>
                  : <MarkdownContent text={msg.content} />)
              : (msg.streaming ? <TypingDots /> : null)}

          {/* Copy button — only on completed assistant messages with
              content. Hover-revealed on the bubble's group hover to keep
              the resting state clean. */}
          {!isUser && !msg.streaming && msg.content && (
            <button
              onClick={handleCopy}
              aria-label={copied ? "Copied" : "Copy message"}
              title={copied ? "Copied" : "Copy"}
              className="absolute top-2 right-2 px-2 py-1 rounded-md text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity"
              style={{
                background: "var(--al-bg-soft)",
                border:     "1px solid var(--al-border)",
                color:      copied ? "var(--al-accent)" : "var(--al-subtle)",
              }}
            >
              {copied ? "✓ Copied" : "⧉ Copy"}
            </button>
          )}
        </div>

        {/* Source chips — shown after streaming ends */}
        {chips.length > 0 && (
          <div className="mt-2.5 space-y-1.5">
            <p className="text-xs mb-1.5" style={{ color: "var(--al-subtle)" }}>
              Visual reference for the answer:
            </p>
            {chips.map((chip, i) => {
              const isActive = activeChip?.msgId === msg.id && activeChip?.idx === i;
              const locType =
                chip.source.chunk_type === "table_cell" ? ".table, cell"
                : chip.source.chunk_type === "table"     ? ".table"
                : chip.source.chunk_type === "figure"    ? ".figure"
                :                                          ".text";
              // Per-chunk-type colour theming. `accent` matches the DocViewer
              // overlay palette in globals.css so clicking a chip lands on a
              // highlight of the same colour. `text` is a slightly darker
              // same-hue shade for the chip's label text — the bright
              // overlay colours work great as borders but are too low-
              // contrast for small label text on a white card.
              //   table/table_cell -> blue    #2193FD  (overlay-box--table)
              //   figure           -> magenta #FF5CFF  (overlay-box--figure)
              //   text/other       -> green   #32D583  (overlay-box--text)
              const isTable  = chip.source.chunk_type === "table_cell" || chip.source.chunk_type === "table";
              const isFigure = chip.source.chunk_type === "figure";
              const tone =
                isTable  ? { accent: "#2193FD", text: "#1672D4", tint: "rgba(33,147,253,0.06)",  glyphBg: "rgba(33,147,253,0.12)",  border: "rgba(33,147,253,0.35)" }
              : isFigure ? { accent: "#FF5CFF", text: "#C026D3", tint: "rgba(255,92,255,0.06)",  glyphBg: "rgba(255,92,255,0.14)",  border: "rgba(255,92,255,0.40)" }
              :            { accent: "#32D583", text: "#15803D", tint: "rgba(50,213,131,0.06)",  glyphBg: "rgba(50,213,131,0.14)",  border: "rgba(50,213,131,0.38)" };
              return (
                <button
                  key={`${msg.id}-${i}`}
                  onClick={() => onChipClick(chip, msg.id, i)}
                  className="w-full text-left px-3 py-2 rounded-xl transition-all flex items-center gap-2"
                  style={{
                    border:     `1.5px solid ${isActive ? tone.accent : tone.border}`,
                    background: isActive ? tone.tint : "var(--al-bg-soft)",
                  }}
                >
                  {/* Type glyph — single character that reinforces the colour */}
                  <span
                    className="shrink-0 inline-flex items-center justify-center font-bold tabular-nums"
                    style={{
                      width: 18, height: 18, borderRadius: 5,
                      background: tone.glyphBg, color: tone.text,
                      fontSize: 10,
                    }}
                    aria-hidden
                  >
                    {isTable ? "T" : isFigure ? "F" : "¶"}
                  </span>

                  {/* Location */}
                  <span className="shrink-0" style={{ color: "var(--al-subtle)", fontSize: 11 }}>
                    Page {chip.source.page + 1}{locType}
                  </span>

                  {/* Divider */}
                  <span className="shrink-0" style={{ color: "var(--al-border)", fontSize: 12 }}>|</span>

                  {/* Semantic label */}
                  <span className="flex-1 truncate font-medium" style={{ color: tone.text, fontSize: 12 }}>
                    {chip.label}
                  </span>

                  {/* Arrow */}
                  <span className="shrink-0" style={{ color: tone.text, opacity: isActive ? 1 : 0.65, fontSize: 13 }}>→</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Streaming indicator */}
        {msg.streaming && msg.content && (
          <div className="mt-1.5 flex items-center gap-1.5 px-1">
            <span className="text-xs" style={{ color: "var(--al-subtle)" }}>Analyzing document</span>
            <TypingDots />
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  // Custom equality — return true to SKIP re-render.
  if (prev.msg.id        !== next.msg.id)        return false;
  if (prev.msg.role      !== next.msg.role)      return false;
  if (prev.msg.content   !== next.msg.content)   return false;
  if (prev.msg.streaming !== next.msg.streaming) return false;
  if (prev.msg.sources   !== next.msg.sources)   return false;
  // activeChip only matters for this specific row.
  const prevIsActive = prev.activeChip?.msgId === prev.msg.id;
  const nextIsActive = next.activeChip?.msgId === next.msg.id;
  if (prevIsActive !== nextIsActive) return false;
  if (prevIsActive && prev.activeChip?.idx !== next.activeChip?.idx) return false;
  return true;
});

// ── ChatPanel ─────────────────────────────────────────────────────────────────

export default function ChatPanel({ docId, parseChunks = [], onChunkSelect }: ChatPanelProps) {
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [input,     setInput]     = useState("");
  const [streaming, setStreaming] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [activeChip, setActiveChip] = useState<{ msgId: string; idx: number } | null>(null);

  // Multi-conversation state. `conversations` is the list for the current
  // doc (ordered most-recent-first); `currentConvId` is the active thread.
  // `menuOpen` toggles the dropdown that lets the user switch threads.
  const [conversations,  setConversations]  = useState<Conversation[]>([]);
  const [currentConvId,  setCurrentConvId]  = useState<string | null>(null);
  const [menuOpen,       setMenuOpen]       = useState(false);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef    = useRef<AbortController | null>(null);
  const menuRef     = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    const container = bottomRef.current?.parentElement;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

  // Close the conversation dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  // Load (or hydrate) one conversation's messages into state.
  async function loadConversation(convId: string | null) {
    setHydrating(true);
    setMessages([]);
    setActiveChip(null);
    try {
      const url = convId
        ? `/api/documents/${docId}/chat-history?conversation_id=${convId}`
        : `/api/documents/${docId}/chat-history`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const rows = Array.isArray(data?.messages) ? data.messages : [];
      setMessages(
        rows.map((m: { id: string; role: "user" | "assistant"; content: string; sources?: SourceChunk[] }) => ({
          id:      m.id,
          role:    m.role,
          content: m.content,
          sources: m.sources ?? undefined,
        })),
      );
      const id = data?.conversation?.id ?? null;
      setCurrentConvId(id);
    } catch {
      setMessages([]);
    } finally {
      setHydrating(false);
    }
  }

  async function refreshConversations(): Promise<Conversation[]> {
    try {
      const r = await fetch(`/api/documents/${docId}/conversations`, { credentials: "include" });
      if (!r.ok) return [];
      const data = await r.json();
      const list: Conversation[] = data?.conversations ?? [];
      setConversations(list);
      return list;
    } catch {
      return [];
    }
  }

  // Hydrate from server on mount / doc change. Pulls the conversation list
  // AND the most-recent thread's messages. Reloading the page or switching
  // docs restores the user's last active thread for that doc.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refreshConversations();
      // loadConversation(null) → server returns the most-recent thread,
      // creating one if none exist. Same contract as before.
      if (!cancelled) await loadConversation(null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // ── New / switch / rename / delete handlers ───────────────────────────────
  async function handleNewConversation() {
    setMenuOpen(false);
    try {
      const r = await fetch(`/api/documents/${docId}/conversations`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({}),
      });
      if (!r.ok) return;
      const data  = await r.json();
      const newId = data?.conversation?.id;
      if (!newId) return;
      await refreshConversations();
      await loadConversation(newId);
    } catch { /* swallow — user can retry */ }
  }

  async function handleSwitchConversation(convId: string) {
    if (convId === currentConvId) { setMenuOpen(false); return; }
    setMenuOpen(false);
    await loadConversation(convId);
  }

  async function handleDeleteConversation(convId: string) {
    try {
      const r = await fetch(`/api/documents/${docId}/conversations/${convId}`, {
        method:      "DELETE",
        credentials: "include",
      });
      if (!r.ok) return;
      const remaining = await refreshConversations();
      // If we just deleted the active thread, drop into the most-recent
      // remaining one (or auto-create a fresh one via loadConversation(null)).
      if (convId === currentConvId) {
        if (remaining.length > 0) await loadConversation(remaining[0].id);
        else                       await loadConversation(null);
      }
    } catch { /* swallow */ }
  }

  // First user message text → conversation title (auto-name). Keeps the
  // dropdown readable. Server stores the title; we patch it on first send
  // of a freshly-created (titleless) conversation.
  async function maybeAutoTitle(convId: string | null, firstMessage: string) {
    if (!convId) return;
    const conv = conversations.find(c => c.id === convId);
    if (!conv || conv.title) return;
    const title = firstMessage.slice(0, 60).trim();
    if (!title) return;
    try {
      await fetch(`/api/documents/${docId}/conversations/${convId}`, {
        method:      "PATCH",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ title }),
      });
      // Optimistic local update so the dropdown reflects the title right away.
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, title } : c));
    } catch { /* swallow */ }
  }

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [input]);

  // ── Send / stop ──────────────────────────────────────────────────────────────
  // handleStop is a dedicated cancel — same AbortController the next send
  // call would interrupt, just triggered explicitly via the Stop button so
  // the user can abort a long answer without sending a new message.
  function handleStop() {
    abortRef.current?.abort();
  }

  // Programmatic send used by suggested-prompt cards. Passes the text
  // directly into handleSend (avoids racing with React's setInput batch).
  function sendPrompt(text: string) {
    void handleSend(text);
  }

  async function handleSend(textOverride?: string) {
    const userContent = (textOverride ?? input).trim();
    if (!userContent) return;

    // Abort any in-flight stream cleanly
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    // Cap history at 20 messages to prevent unbounded growth
    const history = messages.slice(-20).map(m => ({ role: m.role, content: m.content }));

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: userContent };
    const aiMsgId = crypto.randomUUID();

    setMessages(prev => [
      ...prev.slice(-39), // keep at most 40 messages in state (20 turns)
      userMsg,
      { id: aiMsgId, role: "assistant", content: "", streaming: true },
    ]);
    setInput("");
    setStreaming(true);
    setActiveChip(null);

    // Auto-title the (still-untitled) conversation from the first user
    // message — fire-and-forget so it doesn't block the SSE stream below.
    if (messages.length === 0) { void maybeAutoTitle(currentConvId, userContent); }

    // ── rAF-batched delta flush ─────────────────────────────────────────────
    // SSE delivers many small deltas — `setMessages` per delta forces React
    // to reconcile the entire messages list every time. Accumulate deltas
    // in a local buffer; flush once per animation frame so the visible
    // refresh rate caps at display refresh (≈60Hz). Markdown isn't parsed
    // mid-stream (see MessageRow render), so this is purely a state-write
    // throttle. Non-delta events (sources/done/error) flush immediately to
    // keep the UI responsive at state transitions.
    let pendingText = "";
    let rafHandle: number | null = null;
    const flushPending = () => {
      rafHandle = null;
      if (!pendingText) return;
      const chunk = pendingText;
      pendingText = "";
      setMessages(prev => prev.map(m =>
        m.id === aiMsgId ? { ...m, content: m.content + chunk } : m
      ));
    };
    const queueDelta = (text: string) => {
      pendingText += text;
      if (rafHandle === null) {
        rafHandle = requestAnimationFrame(flushPending);
      }
    };
    const cancelFlush = () => {
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
    };
    // Run any queued delta inline before a control event (sources/done).
    // Ensures the bubble's `content` is up-to-date when the user sees the
    // streaming flag flip to false.
    const drainPending = () => {
      cancelFlush();
      flushPending();
    };

    try {
      const res = await fetch(`/api/documents/${docId}/chat`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({
          message:         userContent,
          history,
          conversation_id: currentConvId,
        }),
        signal:      abortRef.current.signal,
      });

      if (!res.body) throw new Error("No response body");

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "delta") {
              queueDelta(event.text);
            } else if (event.type === "sources") {
              drainPending();
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, sources: event.chunks } : m
              ));
            } else if (event.type === "done") {
              drainPending();
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, streaming: false } : m
              ));
            } else if (event.type === "error") {
              drainPending();
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, content: `Error: ${event.text}`, streaming: false } : m
              ));
            }
          } catch { /* ignore malformed SSE */ }
        }
      }
      // Stream ended without a terminal event — flush whatever's queued.
      drainPending();
    } catch (err: any) {
      drainPending();
      if (err?.name === "AbortError") {
        // User sent a new message — mark previous response as done silently
        setMessages(prev => prev.map(m =>
          m.id === aiMsgId && m.streaming ? { ...m, streaming: false } : m
        ));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === aiMsgId
            ? { ...m, content: "Sorry, something went wrong. Please try again.", streaming: false }
            : m
        ));
      }
    } finally {
      cancelFlush();
      setStreaming(false);
    }
  }

  // ── Chip click — primary + secondary highlights ───────────────────────────
  // Stable callback via refs (read latest values lazily) so MessageRow's
  // memo equality isn't defeated by a fresh `handleChipClick` reference on
  // every parent re-render. Same pattern as DocViewer's onChunkClickRef.
  const onChunkSelectRef = useRef(onChunkSelect);
  const parseChunksRef   = useRef(parseChunks);
  useEffect(() => { onChunkSelectRef.current = onChunkSelect; });
  useEffect(() => { parseChunksRef.current   = parseChunks;   });

  const handleChipClick = useCallback(
    (chip: ResolvedChip, msgId: string, idx: number) => {
      setActiveChip(prev =>
        prev?.msgId === msgId && prev?.idx === idx ? null : { msgId, idx }
      );

      const select = onChunkSelectRef.current;
      const chunks = parseChunksRef.current;

      // Non-cell chip (text / figure). Resolve to the chunk's own overlay
      // so the doc viewer highlights the whole text passage or figure
      // box. Was previously a hard bail with select(null) — that's why
      // text and figure chips never lit anything up.
      if (!chip.cellId) {
        const srcId   = chip.source.chunk_id;
        const overlay = chunks.find(o => o.chunk_id === srcId);
        if (overlay) {
          select(overlay.chunk_id, []);
        } else {
          // No matching overlay (chunk was filtered out by bbox guard,
          // or this is a chat-context-only chunk). Clear the highlight
          // rather than leave stale state.
          select(null);
        }
        return;
      }

      // Primary: the value cell
      const overlay = chunks.find(o => o.chunk_id === chip.cellId);
      if (overlay) {
        select(overlay.chunk_id, chip.secondaryCellIds);
        return;
      }

      // Fallback: bbox center-point lookup
      const chunk      = chip.source;
      const pageChunks = chunks.filter(o => o.page === chunk.page);
      if (hasBbox(chunk.bbox)) {
        const cx = (chunk.bbox.left + chunk.bbox.right) / 2;
        const cy = (chunk.bbox.top  + chunk.bbox.bottom) / 2;
        const cell = pageChunks.find(o =>
          o.chunk_type === "table_cell" &&
          o.bbox.left <= cx && cx <= o.bbox.right &&
          o.bbox.top  <= cy && cy <= o.bbox.bottom
        );
        if (cell) { select(cell.chunk_id, chip.secondaryCellIds); return; }

        const tbl = pageChunks.find(o =>
          o.chunk_type === "table" &&
          o.bbox.left < chunk.bbox.right && o.bbox.right > chunk.bbox.left &&
          o.bbox.top  < chunk.bbox.bottom && o.bbox.bottom > chunk.bbox.top
        );
        if (tbl) { select(tbl.chunk_id, chip.secondaryCellIds); return; }
      }
    },
    [],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const currentConv = conversations.find(c => c.id === currentConvId);
  const currentTitle = currentConv?.title?.trim() || "New chat";

  return (
    <div className="h-full flex flex-col">
      {/* Header — conversation switcher + new-chat */}
      <div
        ref={menuRef}
        className="relative px-3 py-2 border-b shrink-0 flex items-center gap-2"
        style={{ borderColor: "var(--al-border)", background: "var(--al-bg-soft)" }}
      >
        <button
          onClick={() => setMenuOpen(o => !o)}
          className="flex-1 flex items-center gap-2 min-w-0 text-left px-2.5 py-1.5 rounded-lg transition-all"
          style={{
            background: menuOpen ? "var(--al-card)" : "transparent",
            border:     `1px solid ${menuOpen ? "var(--al-border)" : "transparent"}`,
          }}
          aria-label="Switch conversation"
        >
          <span className="text-xs shrink-0" style={{ color: "var(--al-subtle)" }}>💬</span>
          <span
            className="text-xs font-medium truncate"
            style={{ color: currentConv?.title ? "var(--al-text)" : "var(--al-subtle)" }}
          >
            {currentTitle}
          </span>
          <span
            className="text-xs shrink-0 ml-auto transition-transform"
            style={{
              color:      "var(--al-subtle)",
              transform:  menuOpen ? "rotate(180deg)" : "none",
            }}
          >
            ▾
          </span>
        </button>
        <button
          onClick={handleNewConversation}
          title="Start a new chat"
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-sm font-semibold transition-all"
          style={{
            background: "var(--al-accent-soft)",
            color:      "var(--al-accent)",
          }}
        >
          +
        </button>

        {menuOpen && (
          <div
            className="absolute left-3 right-3 top-full mt-1 rounded-xl overflow-hidden z-20"
            style={{
              background: "var(--al-card)",
              border:     "1.5px solid var(--al-border)",
              boxShadow:  "0 6px 24px rgba(0,0,0,0.12)",
            }}
          >
            {conversations.length === 0 && (
              <div className="px-3 py-3 text-xs" style={{ color: "var(--al-subtle)" }}>
                No conversations yet.
              </div>
            )}
            {conversations.map(c => {
              const isActive = c.id === currentConvId;
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-2 px-2 py-1.5 group transition-colors"
                  style={{ background: isActive ? "var(--al-accent-soft)" : "transparent" }}
                >
                  <button
                    onClick={() => handleSwitchConversation(c.id)}
                    className="flex-1 min-w-0 text-left px-1.5 py-1 rounded-md"
                  >
                    <p
                      className="text-xs font-medium truncate"
                      style={{ color: isActive ? "var(--al-accent)" : "var(--al-text)" }}
                    >
                      {c.title?.trim() || "New chat"}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--al-subtle)" }}>
                      {new Date(c.updated_at).toLocaleString(undefined, {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteConversation(c.id); }}
                    title="Delete this conversation"
                    className="shrink-0 w-6 h-6 rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                    style={{ color: "var(--al-subtle)" }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {hydrating && messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div
              className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: "var(--al-accent-light)", borderTopColor: "var(--al-accent)" }}
            />
          </div>
        )}

        {!hydrating && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-5 select-none px-2">
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, var(--al-accent) 0%, var(--al-accent-2) 100%)",
                  boxShadow:  "0 4px 14px var(--al-accent-glow)",
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                  stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </div>
              <p className="text-sm font-semibold" style={{ color: "var(--al-text)" }}>
                Ask anything about this document
              </p>
              <p className="text-xs text-center" style={{ color: "var(--al-subtle)", maxWidth: 260 }}>
                Cite-grounded answers with click-through to the source cell.
              </p>
            </div>

            {/* Starter prompts — generic-financial, doc-agnostic.
                Clicking sends immediately so first-time users see a result
                without typing. Four feels right; more would crowd the panel. */}
            <div className="w-full max-w-sm grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
              {STARTER_PROMPTS.map(({ label, prompt, icon }) => (
                <button
                  key={prompt}
                  onClick={() => sendPrompt(prompt)}
                  className="text-left px-3 py-2.5 rounded-xl transition-all hover:-translate-y-px"
                  style={{
                    background: "var(--al-card)",
                    border:     "1.5px solid var(--al-border)",
                    boxShadow:  "var(--al-shadow-sm, 0 1px 2px rgba(0,0,0,0.04))",
                  }}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base shrink-0" style={{ color: "var(--al-accent)" }}>{icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: "var(--al-text)" }}>{label}</p>
                      <p className="text-[11px] leading-tight mt-0.5 truncate" style={{ color: "var(--al-subtle)" }}>
                        {prompt}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <MessageRow
            key={msg.id}
            msg={msg}
            activeChip={activeChip}
            onChipClick={handleChipClick}
          />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="p-3 border-t shrink-0"
        style={{ borderColor: "var(--al-border)", background: "var(--al-bg-soft)" }}>
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
            }}
            disabled={streaming}
            placeholder={streaming ? "Generating…" : "Ask about this document"}
            className="chat-textarea flex-1 resize-none px-3.5 py-2.5 rounded-xl text-sm outline-none transition-all"
            style={{
              background: "var(--al-card)",
              border:     "1.5px solid var(--al-border)",
              color:      "var(--al-text)",
              minHeight:  "40px",
              maxHeight:  "120px",
              opacity:    streaming ? 0.6 : 1,
            }}
          />
          {streaming ? (
            // Streaming → dedicated Stop. Visually distinct from Send so
            // the user knows tapping cancels (not sends a new turn).
            <button
              onClick={handleStop}
              aria-label="Stop generating"
              title="Stop generating"
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0"
              style={{
                background: "var(--al-bg-secondary)",
                color:      "var(--al-text)",
                border:     "1.5px solid var(--al-border)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <rect x="2" y="2" width="10" height="10" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          ) : (
            // Idle → arrow-up Send. Disabled when input is empty.
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              aria-label="Send message"
              title="Send (Enter)"
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0"
              style={{
                background: input.trim() ? "var(--al-accent)" : "var(--al-bg-secondary)",
                color:      input.trim() ? "#fff"            : "var(--al-subtle)",
                cursor:     input.trim() ? "pointer"         : "not-allowed",
                boxShadow:  input.trim() ? "0 2px 8px var(--al-accent-glow)" : "none",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 13V3" />
                <path d="M3.5 7.5L8 3l4.5 4.5" />
              </svg>
            </button>
          )}
        </div>
        {/* Keyboard hint footer — replaces the streaming-only "Analyzing…"
            message with a permanent, more useful affordance. */}
        <div className="flex items-center justify-between mt-1.5 px-1">
          <p className="text-[11px]" style={{ color: "var(--al-subtle)" }}>
            {streaming
              ? "Analyzing… click ■ to stop."
              : <><kbd className="chat-kbd">Enter</kbd> to send · <kbd className="chat-kbd">Shift+Enter</kbd> for new line</>}
          </p>
          {input.length > 1500 && (
            <span className="text-[11px]" style={{ color: input.length > 1900 ? "#dc2626" : "var(--al-subtle)" }}>
              {input.length} / 2000
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="flex gap-1 items-center" style={{ height: 16 }}>
      {[0, 1, 2].map(i => (
        <span key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: "var(--al-subtle)", animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  );
}
