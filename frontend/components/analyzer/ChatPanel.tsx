"use client";
import { useState, useRef, useEffect, useMemo } from "react";
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
  // Cross-cell context (set by backend table grid builder)
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
  const parts: string[] = [];

  // Section name (take last 3 words to keep chips compact for long section names)
  const section = chunk.section_header || "";
  if (section) {
    const words = section.trim().split(/\s+/);
    parts.push(words.length > 4 ? words.slice(-3).join(" ") : section);
  }

  // Year: prefer explicit year_label (from SOCE table pattern),
  // fall back to col_header_text if it looks like a year.
  const yearPart =
    chunk.year_label ||
    (/^(19|20)\d{2}$/.test(chunk.col_header_text ?? "") ? chunk.col_header_text : null);
  if (yearPart) parts.push(yearPart);

  // Sub-group header (disambiguates identical row labels, e.g. "Foreign Currency")
  if (chunk.group_label_text) parts.push(chunk.group_label_text);

  // Row label
  if (chunk.row_label_text) parts.push(chunk.row_label_text);

  // Value
  const value = chunk.markdown || "";
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

// ── MessageRow — isolated so useMemo for chips doesn't re-run on content delta ─

function MessageRow({
  msg,
  parseChunks,
  activeChip,
  onChipClick,
}: {
  msg:         Message;
  parseChunks: ChunkOverlay[];
  activeChip:  { msgId: string; idx: number } | null;
  onChipClick: (chip: ResolvedChip, msgId: string, idx: number) => void;
}) {
  // Chips are resolved once when sources arrive — not on every streaming delta.
  // msg.sources is a stable reference (set once, never mutated after streaming ends).
  const chips = useMemo(
    () => resolveChips(msg.sources ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [msg.sources],
  );

  return (
    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      <div style={{ maxWidth: "88%" }}>
        {/* Message bubble */}
        <div
          className="px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap"
          style={msg.role === "user" ? {
            background:            "linear-gradient(135deg, #059669 0%, #10b981 100%)",
            color:                 "#fff",
            borderBottomRightRadius: 4,
          } : {
            background:           "var(--al-card)",
            color:                "var(--al-text)",
            border:               "1.5px solid var(--al-border)",
            borderBottomLeftRadius: 4,
          }}
        >
          {msg.content || (msg.streaming ? <TypingDots /> : null)}
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
}

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
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, content: m.content + event.text } : m
              ));
            } else if (event.type === "sources") {
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, sources: event.chunks } : m
              ));
            } else if (event.type === "done") {
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, streaming: false } : m
              ));
            } else if (event.type === "error") {
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, content: `Error: ${event.text}`, streaming: false } : m
              ));
            }
          } catch { /* ignore malformed SSE */ }
        }
      }
    } catch (err: any) {
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
      setStreaming(false);
    }
  }

  // ── Chip click — primary + secondary highlights ───────────────────────────
  function handleChipClick(chip: ResolvedChip, msgId: string, idx: number) {
    setActiveChip(prev =>
      prev?.msgId === msgId && prev?.idx === idx ? null : { msgId, idx }
    );

    if (!chip.cellId) {
      onChunkSelect(null);
      return;
    }

    // Primary: the value cell
    const overlay = parseChunks.find(o => o.chunk_id === chip.cellId);
    if (overlay) {
      onChunkSelect(overlay.chunk_id, chip.secondaryCellIds);
      return;
    }

    // Fallback: bbox center-point lookup
    const chunk      = chip.source;
    const pageChunks = parseChunks.filter(o => o.page === chunk.page);
    if (hasBbox(chunk.bbox)) {
      const cx = (chunk.bbox.left + chunk.bbox.right) / 2;
      const cy = (chunk.bbox.top  + chunk.bbox.bottom) / 2;
      const cell = pageChunks.find(o =>
        o.chunk_type === "table_cell" &&
        o.bbox.left <= cx && cx <= o.bbox.right &&
        o.bbox.top  <= cy && cy <= o.bbox.bottom
      );
      if (cell) { onChunkSelect(cell.chunk_id, chip.secondaryCellIds); return; }

      const tbl = pageChunks.find(o =>
        o.chunk_type === "table" &&
        o.bbox.left < chunk.bbox.right && o.bbox.right > chunk.bbox.left &&
        o.bbox.top  < chunk.bbox.bottom && o.bbox.bottom > chunk.bbox.top
      );
      if (tbl) { onChunkSelect(tbl.chunk_id, chip.secondaryCellIds); return; }
    }
  }

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
            parseChunks={parseChunks}
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
