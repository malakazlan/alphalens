"use client";
import { useState, useRef, useEffect } from "react";
import { ChunkOverlay } from "@/components/analyzer/DocViewer";

interface SourceChunk {
  chunk_id: string;
  chunk_type: string;
  section_header: string;
  page: number;
  markdown: string;
  bbox: { left: number; top: number; right: number; bottom: number };
  score: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceChunk[];
  streaming?: boolean;
}

interface ChatPanelProps {
  docId: string;
  parseChunks?: ChunkOverlay[];
  onChunkSelect: (chunkId: string | null) => void;
}

// Build a map of { element_id → cell_text } from a table chunk's HTML markdown.
// ADE table markdown: <table id="0-1"><tr><td id="0-2">Net Real Estate</td>...</table>
// These element_ids are the exact chunk_ids stored in grounding overlays.
function parseCellsFromHTML(markdown: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof window === "undefined" || !markdown) return result;
  try {
    const doc = new DOMParser().parseFromString(markdown, "text/html");
    doc.querySelectorAll("td, th").forEach(cell => {
      const id   = (cell as HTMLElement).id;
      const text = (cell.textContent || "").replace(/\s+/g, " ").trim();
      if (id && text) result[id] = text;
    });
  } catch { /* ignore */ }
  return result;
}

// Extract all numbers (e.g. "548,642", "1,501,908") from the AI answer text.
// Filters out trivially short matches like "1" or "18" that aren't financial values.
function extractAnswerNums(text: string): string[] {
  return (text.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g) ?? [])
    .filter(n => n.replace(/,/g, "").length >= 3);
}

// Normalise a number string for comparison: strip commas, spaces, currency symbols.
function normaliseNum(s: string): string {
  return s.replace(/[\s,$%()]/g, "").replace(/,/g, "");
}

interface ResolvedChip {
  source:  SourceChunk;
  cellId:  string | null;  // grounding element_id for direct overlay lookup
  label:   string;          // chip display text
}

// Core resolution: given the AI's answer text and raw source chunks,
// produce chips that match Landing.AI's behavior:
//   - One chip per unique table chunk, pointing to the value cell
//   - Table chips take full priority — text/note chunks are only shown
//     as a fallback when no table chips exist at all
//   - No row-label chips — value cell only, one per occurrence
function resolveChips(answerText: string, sources: SourceChunk[]): ResolvedChip[] {
  const answerNums  = extractAnswerNums(answerText);
  const seenChunkId = new Set<string>();
  const tableChips: ResolvedChip[] = [];
  const textChips:  ResolvedChip[] = [];

  for (const chunk of sources) {
    // Deduplicate by Qdrant chunk_id
    if (seenChunkId.has(chunk.chunk_id)) continue;
    seenChunkId.add(chunk.chunk_id);

    const isTable = chunk.chunk_type === "table" || chunk.chunk_type === "table_cell";

    if (!isTable) {
      // Collect text chips as fallback — only used if zero table chips found
      const raw   = chunk.markdown.replace(/<[^>]+>/g, "").trim();
      const label = (chunk.section_header || raw.split("\n")[0].trim()).slice(0, 60)
                    || chunk.chunk_type;
      textChips.push({ source: chunk, cellId: null, label });
      continue;
    }

    // ── Direct grounding cell reference (from backend value-matching) ──────
    // chunk_type "table_cell" with chunk_id like "0-5" (element_id format)
    // means this came from the application-level value matcher, not from
    // a Qdrant table chunk. The chunk_id IS the cell element_id for overlay lookup.
    // markdown field contains the cell text (for label display).
    if (chunk.chunk_type === "table_cell" && /^\d+-\d+$/.test(chunk.chunk_id)) {
      const cellText = chunk.markdown.replace(/<[^>]+>/g, "").trim();
      tableChips.push({
        source: chunk,
        cellId: chunk.chunk_id,
        label: cellText || chunk.chunk_id,
      });
      continue;
    }

    // ── Table chunk: find the cell whose text matches the answer value ──────
    const cellMap = parseCellsFromHTML(chunk.markdown);
    let foundId   = "";
    let foundText = "";

    // Priority 1: exact numeric match
    for (const num of answerNums) {
      const normNum = normaliseNum(num);
      for (const [id, text] of Object.entries(cellMap)) {
        if (normaliseNum(text) === normNum) { foundId = id; foundText = text; break; }
      }
      if (foundId) break;
    }

    // Priority 2: substring match (e.g. "Rs. 143,990" contains "143,990")
    if (!foundId) {
      for (const num of answerNums) {
        const normNum = normaliseNum(num);
        for (const [id, text] of Object.entries(cellMap)) {
          if (normaliseNum(text).includes(normNum) && normNum.length >= 3) {
            foundId = id; foundText = text; break;
          }
        }
        if (foundId) break;
      }
    }

    // One chip per table chunk — value cell only (no label/row-header chip)
    const fallback = (chunk.section_header || "").slice(0, 60) || "table";
    tableChips.push({
      source: chunk,
      cellId: foundId || null,
      label:  (foundText || fallback).slice(0, 60),
    });
    // No early break — collect all table chunks first, sort + dedup below
  }

  if (tableChips.length > 0) {
    // Sort by document reading order (page → top → left-to-right for same row).
    // Qdrant returns chunks by score, not position — for 4 near-identical challan tables
    // the score order is arbitrary. This gives chips in the same order as the ParsePanel labels.
    tableChips.sort((a, b) => {
      const pd = a.source.page - b.source.page;
      if (pd !== 0) return pd;
      const at = a.source.bbox?.top ?? 0, bt = b.source.bbox?.top ?? 0;
      if (Math.abs(at - bt) > 0.01) return at - bt;
      return (a.source.bbox?.left ?? 0) - (b.source.bbox?.left ?? 0);
    });

    // Dedup by resolved cellId — catches Qdrant duplicate entries (same table indexed
    // twice with different chunk_ids) that would otherwise show the same cell twice.
    const seenCellId = new Set<string>();
    const deduped = tableChips.filter(chip => {
      if (!chip.cellId) return true;
      if (seenCellId.has(chip.cellId)) return false;
      seenCellId.add(chip.cellId);
      return true;
    });

    return deduped.slice(0, 4);
  }

  // Table chips win; text chips are fallback only (answers with no numeric table match)
  return textChips.slice(0, 4);
}

// Check if a bbox object has actual coordinate data (not empty {})
function hasBbox(bbox: SourceChunk["bbox"]): boolean {
  return typeof bbox?.left === "number" && typeof bbox?.right === "number" &&
         typeof bbox?.top  === "number" && typeof bbox?.bottom === "number";
}

export default function ChatPanel({ docId, parseChunks = [], onChunkSelect }: ChatPanelProps) {
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [input,     setInput]     = useState("");
  const [streaming, setStreaming] = useState(false);
  // Scoped to message + index so the same chunk_id in two different messages
  // never cross-highlights each other
  const [activeChip, setActiveChip] = useState<{ msgId: string; idx: number } | null>(null);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll only the messages container — NOT ancestors.
  // scrollIntoView() scrolls every overflow:hidden ancestor too (CSS spec),
  // which pushes the tab bar off-screen. Direct scrollTop avoids this.
  useEffect(() => {
    const container = bottomRef.current?.parentElement;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [input]);

  // ── Send message ─────────────────────────────────────────────────────────
  async function handleSend() {
    if (!input.trim() || streaming) return;

    const userContent = input.trim();
    const history     = messages.map(m => ({ role: m.role, content: m.content }));
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: userContent };
    const aiMsgId = crypto.randomUUID();

    setMessages(prev => [
      ...prev,
      userMsg,
      { id: aiMsgId, role: "assistant", content: "", streaming: true },
    ]);
    setInput("");
    setStreaming(true);
    setActiveChip(null);

    try {
      const res = await fetch(`/api/documents/${docId}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userContent, history }),
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
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === aiMsgId
          ? { ...m, content: "Sorry, something went wrong. Please try again.", streaming: false }
          : m
      ));
    }

    setStreaming(false);
  }

  // ── Citation chip click ───────────────────────────────────────────────────
  function handleChipClick(chip: ResolvedChip, msgId: string, idx: number) {
    setActiveChip({ msgId, idx });

    if (!parseChunks.length) return;

    // ── Priority 1: use the pre-resolved cell element_id (answer-matched) ──
    // cellId is like "0-5" — the exact grounding element_id stored as chunk_id
    // in parseChunks by page.tsx. Search all pages in case page number drifts.
    if (chip.cellId) {
      const overlay = parseChunks.find(o => o.chunk_id === chip.cellId);
      if (overlay) { onChunkSelect(overlay.chunk_id); return; }
    }

    // ── Priority 2: fallback using the source chunk's bbox ─────────────────
    const chunk      = chip.source;
    const pageChunks = parseChunks.filter(o => o.page === chunk.page);
    const isTable    = chunk.chunk_type === "table" || chunk.chunk_type === "table_cell";

    if (isTable && hasBbox(chunk.bbox)) {
      // Center-point: find the grounding cell whose bbox contains the chunk center
      const cx = (chunk.bbox.left + chunk.bbox.right) / 2;
      const cy = (chunk.bbox.top  + chunk.bbox.bottom) / 2;
      const cell = pageChunks.find(o =>
        o.chunk_type === "table_cell" &&
        o.bbox.left <= cx && cx <= o.bbox.right &&
        o.bbox.top  <= cy && cy <= o.bbox.bottom
      );
      if (cell) { onChunkSelect(cell.chunk_id); return; }

      // Whole-table overlay fallback
      const tbl = pageChunks.find(o =>
        o.chunk_type === "table" &&
        o.bbox.left < chunk.bbox.right && o.bbox.right > chunk.bbox.left &&
        o.bbox.top  < chunk.bbox.bottom && o.bbox.bottom > chunk.bbox.top
      );
      if (tbl) { onChunkSelect(tbl.chunk_id); return; }
    }

    if (!isTable && hasBbox(chunk.bbox)) {
      const hit = pageChunks.find(o =>
        o.bbox.left < chunk.bbox.right && o.bbox.right > chunk.bbox.left &&
        o.bbox.top  < chunk.bbox.bottom && o.bbox.bottom > chunk.bbox.top
      );
      if (hit) { onChunkSelect(hit.chunk_id); return; }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Empty state */}
        {messages.length === 0 && (
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
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div style={{ maxWidth: "88%" }}>
              {/* Message bubble */}
              <div
                className="px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap"
                style={msg.role === "user" ? {
                  background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                  color: "#fff",
                  borderBottomRightRadius: 4,
                } : {
                  background: "var(--al-card)",
                  color: "var(--al-text)",
                  border: "1.5px solid var(--al-border)",
                  borderBottomLeftRadius: 4,
                }}
              >
                {msg.content || (msg.streaming ? <TypingDots /> : null)}
              </div>

              {/* Citation chips — answer-value aware, deduplicated */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2.5 space-y-1.5">
                  <p className="text-xs mb-1.5" style={{ color: "var(--al-subtle)" }}>
                    Visual reference for the answer:
                  </p>
                  {resolveChips(msg.content, msg.sources).map((chip, i) => {
                    const isActive  = activeChip?.msgId === msg.id && activeChip?.idx === i;
                    const isTable   = chip.source.chunk_type === "table" || chip.source.chunk_type === "table_cell";
                    const chipLabel = isTable
                      ? `Page ${chip.source.page + 1}.table, cell${chip.label ? `  |  ${chip.label}` : ""}`
                      : `Page ${chip.source.page + 1}.${chip.source.chunk_type}${chip.label ? `  |  ${chip.label}` : ""}`;

                    return (
                      <button
                        key={`${msg.id}-${i}`}
                        onClick={() => handleChipClick(chip, msg.id, i)}
                        className="w-full text-left px-3 py-2 rounded-xl text-xs transition-all flex items-center gap-2"
                        style={{
                          border:     `${isActive ? "2px" : "1.5px"} solid ${isActive ? "#2193FD" : "var(--al-border)"}`,
                          background: isActive ? "rgba(33,147,253,0.06)" : "var(--al-bg-soft)",
                          color:      isActive ? "#2193FD" : "var(--al-accent)",
                        }}
                      >
                        <span className="flex-1 truncate font-medium" style={{ fontSize: 12 }}>
                          {chipLabel}
                        </span>
                        {isActive ? (
                          <span
                            className="shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold"
                            style={{ background: "rgba(33,147,253,0.12)", color: "#2193FD", fontSize: 11 }}
                            onClick={e => { e.stopPropagation(); setActiveChip(null); onChunkSelect(null); }}
                          >
                            Clear
                          </span>
                        ) : (
                          <span className="shrink-0" style={{ color: "var(--al-accent)", opacity: 0.6 }}>→</span>
                        )}
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
            disabled={streaming}
            className="flex-1 resize-none px-3 py-2.5 rounded-xl text-sm outline-none transition-all"
            style={{
              background: "var(--al-card)",
              border:     "1.5px solid var(--al-border)",
              color:      "var(--al-text)",
              minHeight:  "40px",
              maxHeight:  "120px",
              opacity:    streaming ? 0.6 : 1,
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shrink-0"
            style={{
              background: input.trim() && !streaming ? "var(--al-accent)" : "var(--al-bg-secondary)",
              color:      input.trim() && !streaming ? "#fff" : "var(--al-subtle)",
              cursor:     input.trim() && !streaming ? "pointer" : "not-allowed",
            }}
          >
            {streaming ? "…" : "Send"}
          </button>
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
