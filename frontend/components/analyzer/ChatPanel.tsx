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
      const raw   = chunk.markdown.replace(/<[^>]+>/g, "").trim();
      const label = (chunk.section_header || raw.split("\n")[0]).slice(0, 60) || chunk.chunk_type;
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

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div style={{ maxWidth: isUser ? "88%" : "92%" }}>
        {/* Message bubble.
            User: plain text, gradient bubble (preserve newlines).
            Assistant while streaming: plain text — markdown would re-parse
              on every delta and stall the panel. Switch to MarkdownContent
              ONCE when streaming ends (markdown parses exactly once per
              assistant message). */}
        <div
          className={`rounded-2xl ${isUser ? "px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap" : "px-4 py-3"}`}
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
                :                                          ".text";
              return (
                <button
                  key={`${msg.id}-${i}`}
                  onClick={() => onChipClick(chip, msg.id, i)}
                  className="w-full text-left px-3 py-2 rounded-xl transition-all flex items-center gap-2"
                  style={{
                    border:     `1.5px solid ${isActive ? "#2193FD" : "var(--al-border)"}`,
                    background: isActive ? "rgba(33,147,253,0.06)" : "var(--al-bg-soft)",
                  }}
                >
                  {/* Location */}
                  <span className="shrink-0" style={{ color: "var(--al-subtle)", fontSize: 11 }}>
                    Page {chip.source.page + 1}{locType}
                  </span>

                  {/* Divider */}
                  <span className="shrink-0" style={{ color: "var(--al-border)", fontSize: 12 }}>|</span>

                  {/* Semantic label */}
                  <span className="flex-1 truncate font-medium" style={{ color: "#2193FD", fontSize: 12 }}>
                    {chip.label}
                  </span>

                  {/* Arrow */}
                  <span className="shrink-0" style={{ color: "#2193FD", opacity: isActive ? 1 : 0.65, fontSize: 13 }}>→</span>
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

  // ── Send message ─────────────────────────────────────────────────────────────
  async function handleSend() {
    if (!input.trim()) return;

    // Abort any in-flight stream cleanly
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const userContent = input.trim();
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

      if (!chip.cellId) {
        select(null);
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
          <div className="flex flex-col items-center justify-center h-full gap-3 select-none">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
              style={{ background: "var(--al-accent-soft)", color: "var(--al-accent)" }}>
              💬
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--al-text-secondary)" }}>
              Ask anything about this document
            </p>
            <p className="text-xs" style={{ color: "var(--al-subtle)" }}>
              Click a source chip to highlight it in the PDF
            </p>
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
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder="Ask about this document… (Enter to send)"
            className="flex-1 resize-none px-3 py-2.5 rounded-xl text-sm outline-none transition-all"
            style={{
              background: "var(--al-card)",
              border:     "1.5px solid var(--al-border)",
              color:      "var(--al-text)",
              minHeight:  "40px",
              maxHeight:  "120px",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shrink-0"
            style={{
              background: input.trim() ? "var(--al-accent)" : "var(--al-bg-secondary)",
              color:      input.trim() ? "#fff" : "var(--al-subtle)",
              cursor:     input.trim() ? "pointer" : "not-allowed",
            }}
          >
            {streaming ? "↺" : "Send"}
          </button>
        </div>
        {streaming && (
          <p className="text-xs mt-1.5 px-1" style={{ color: "var(--al-subtle)" }}>
            Analyzing… send a new message to cancel
          </p>
        )}
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
