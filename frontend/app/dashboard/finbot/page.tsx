"use client";
import { useState, useRef, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NewsItem {
  title:    string;
  source:   string;
  date:     string;
  url:      string;
  image?:   string | null;
  ticker:   string;
  category: string;
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface Message {
  id:        string;
  role:      "user" | "assistant";
  content:   string;
  toolCalls?: ToolCall[];
  streaming?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  { label: "AAPL quote",        prompt: "What is Apple's current stock price and today's change?" },
  { label: "TSLA fundamentals", prompt: "Show me Tesla's key financial ratios and fundamentals." },
  { label: "Compare FAANG",     prompt: "Compare AAPL, GOOGL, META, AMZN, NFLX — price and P/E ratio." },
  { label: "NVDA news",         prompt: "What's the latest news on NVIDIA?" },
  { label: "MSFT 6-month",      prompt: "How has Microsoft stock performed over the last 6 months?" },
  { label: "AMZN vs MSFT",      prompt: "Compare Amazon and Microsoft: margins, P/E, market cap." },
];

const TOOL_LABELS: Record<string, string> = {
  get_quote:         "Fetching quote",
  get_fundamentals:  "Fetching fundamentals",
  get_price_history: "Loading price history",
  get_news:          "Loading news",
  compare_stocks:    "Comparing stocks",
};

// ── Markdown renderer ─────────────────────────────────────────────────────────
// Converts AI response markdown to HTML. Used with dangerouslySetInnerHTML.
// Content is AI-generated (trusted), not user input.

function renderMarkdown(md: string): string {
  // Preserve code blocks
  const codeBlocks: string[] = [];
  let html = md.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
    codeBlocks.push(code.trim());
    return `%%CODE${codeBlocks.length - 1}%%`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Headers
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm,  "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm,   "<h1>$1</h1>");

  // Bold / italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");

  // Horizontal rule
  html = html.replace(/^---$/gm, "<hr>");

  // Markdown pipe tables → HTML tables
  html = html.replace(/(?:^\|.+\|$\n?)+/gm, block => {
    const rows = block.trim().split("\n");
    const dataRows = rows.filter(r => !/^\|[\s\-:|]+\|$/.test(r.trim()));
    if (!dataRows.length) return "";
    const parse = (row: string) => row.split("|").slice(1, -1).map(c => c.trim());
    let t = '<table class="finbot-md-table"><thead><tr>';
    parse(dataRows[0]).forEach(h => { t += `<th>${h}</th>`; });
    t += "</tr></thead><tbody>";
    dataRows.slice(1).forEach(row => {
      t += "<tr>";
      parse(row).forEach(c => { t += `<td>${c}</td>`; });
      t += "</tr>";
    });
    t += "</tbody></table>";
    return t;
  });

  // Unordered lists
  html = html.replace(/^[*\-] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*\n?)+)/g, "<ul>$1</ul>");

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Paragraphs
  html = html.split(/\n\n+/).map(p => {
    p = p.trim();
    if (!p) return "";
    if (/^<(h[1-6]|ul|ol|table|hr|pre|blockquote)/.test(p)) return p;
    return `<p>${p.replace(/\n/g, "<br>")}</p>`;
  }).join("\n");

  // Restore code blocks
  codeBlocks.forEach((code, i) => {
    html = html.replace(`%%CODE${i}%%`, `<pre><code>${code}</code></pre>`);
  });

  return html;
}

// ── News Sidebar ──────────────────────────────────────────────────────────────

function NewsSidebar() {
  const [news,       setNews]       = useState<NewsItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [slideIdx,   setSlideIdx]   = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef   = useRef(false);

  const fetchNews = useCallback(async () => {
    try {
      const res  = await fetch("/api/finbot/news", { credentials: "include" });
      const data = await res.json();
      if (data.success) setNews(data.news ?? []);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchNews();
    const t = setInterval(fetchNews, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [fetchNews]);

  // Auto-advance carousel
  const startAuto = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (!pausedRef.current) setSlideIdx(i => (i + 1) % Math.max(1, news.length));
    }, 6000);
  }, [news.length]);

  useEffect(() => {
    startAuto();
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [startAuto]);

  const featured = news.slice(0, 6);
  const breaking = news.slice(0, 5);

  return (
    <div style={{
      width: 300, minWidth: 300, maxWidth: 300,
      background: "#fff",
      borderRight: "1px solid #e5e7eb",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Brand header */}
      <div style={{
        background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
        padding: "13px 16px",
        display: "flex", alignItems: "center", gap: 10,
        flexShrink: 0,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: "rgba(255,255,255,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, overflow: "hidden",
        }}>
          <img src="/finbot.png" alt="FinBot" style={{ width: 26, height: 26, objectFit: "contain" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: "#fff", fontSize: 15, letterSpacing: "-0.02em" }}>FinBot</div>
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.88)", marginTop: 1 }}>Live market intelligence</div>
        </div>
        {/* Live indicator */}
        <div style={{
          width: 7, height: 7, borderRadius: "50%",
          background: "#dc2626",
          boxShadow: "0 0 8px rgba(220,38,38,0.9)",
          animation: "finbot-pulse 2s ease-in-out infinite",
          flexShrink: 0,
        }} />
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", background: "#f8faf8" }}
        className="finbot-sidebar-scroll">

        {/* ── Featured carousel ── */}
        <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid #e5e7eb" }}
          onMouseEnter={() => { pausedRef.current = true; }}
          onMouseLeave={() => { pausedRef.current = false; }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
            textTransform: "uppercase", color: "#059669", marginBottom: 10,
          }}>Market Insights</div>

          {loading ? (
            <div style={{
              height: 130, borderRadius: 12, background: "#f0fdf4",
              border: "1px solid rgba(5,150,105,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, color: "#6b7280",
            }}>Loading…</div>
          ) : featured.length === 0 ? (
            <div style={{
              height: 130, borderRadius: 12, background: "#f0fdf4",
              border: "1px solid rgba(5,150,105,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, color: "#6b7280",
            }}>No news right now</div>
          ) : (
            <>
              <div style={{ borderRadius: 12, overflow: "hidden", position: "relative", background: "#f0fdf4", border: "1px solid rgba(5,150,105,0.15)" }}>
                <a href={featured[slideIdx]?.url ?? "#"} target="_blank" rel="noopener noreferrer"
                  style={{ display: "block", textDecoration: "none" }}>
                  {/* Image or placeholder */}
                  {featured[slideIdx]?.image
                    ? <img src={featured[slideIdx].image!} alt=""
                        style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} />
                    : <div style={{
                        height: 120,
                        background: "linear-gradient(135deg, #d1fae5 0%, #a7f3d0 60%, #6ee7b7 100%)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 32,
                      }}>📰</div>
                  }
                  <div style={{
                    position: "absolute", bottom: 0, left: 0, right: 0,
                    padding: "24px 12px 12px",
                    background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, transparent 100%)",
                  }}>
                    <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#34d399", marginBottom: 4 }}>
                      {featured[slideIdx]?.source} · {featured[slideIdx]?.ticker}
                    </div>
                    <div style={{
                      fontSize: 12, fontWeight: 600, color: "#fff", lineHeight: 1.35,
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}>
                      {featured[slideIdx]?.title}
                    </div>
                  </div>
                </a>
              </div>

              {/* Dots */}
              <div style={{ display: "flex", justifyContent: "center", gap: 5, marginTop: 8 }}>
                {featured.map((_, i) => (
                  <button key={i} onClick={() => setSlideIdx(i)}
                    style={{
                      width: i === slideIdx ? 16 : 5, height: 5,
                      borderRadius: i === slideIdx ? 3 : "50%",
                      background: i === slideIdx ? "#059669" : "#d1d5db",
                      border: "none", padding: 0, cursor: "pointer",
                      transition: "all 0.25s",
                    }} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Breaking news list ── */}
        <div style={{ padding: "14px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "#dc2626", boxShadow: "0 0 6px rgba(220,38,38,0.5)",
              animation: "finbot-pulse 1.5s ease-in-out infinite",
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#374151" }}>
              Breaking News
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {breaking.length === 0 && !loading && (
              <div style={{ fontSize: 12, color: "#6b7280", textAlign: "center", padding: "12px 0" }}>No news available</div>
            )}
            {breaking.map((item, i) => (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "9px 10px", borderRadius: 9,
                  background: "#fff", border: "1px solid transparent",
                  cursor: "pointer", transition: "all 0.18s",
                }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLDivElement).style.background = "#ecfdf5";
                    (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(5,150,105,0.2)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.background = "#fff";
                    (e.currentTarget as HTMLDivElement).style.borderColor = "transparent";
                  }}
                >
                  <span style={{ fontSize: 14, color: "#059669", flexShrink: 0, marginTop: 1 }}>📈</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 500, color: "#111827", lineHeight: 1.4,
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                      overflow: "hidden", marginBottom: 3,
                    }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 10, color: "#6b7280" }}>
                      {item.source}{item.date ? ` · ${item.date.slice(0, 10)}` : ""}
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FinBotPage() {
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [input,      setInput]      = useState("");
  const [streaming,  setStreaming]  = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [input]);

  async function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content || streaming) return;

    const history = messages.map(m => ({ role: m.role, content: m.content }));
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content };
    const aiId = crypto.randomUUID();

    setMessages(prev => [
      ...prev,
      userMsg,
      { id: aiId, role: "assistant", content: "", streaming: true },
    ]);
    setInput("");
    setStreaming(true);
    setActiveTool(null);

    try {
      const res = await fetch("/api/finbot/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, history }),
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
              setMessages(prev =>
                prev.map(m => m.id === aiId ? { ...m, content: m.content + event.text } : m)
              );
            } else if (event.type === "tool") {
              setActiveTool(event.name);
              setMessages(prev =>
                prev.map(m => m.id === aiId ? {
                  ...m,
                  toolCalls: [...(m.toolCalls ?? []), { name: event.name, args: event.args }],
                } : m)
              );
            } else if (event.type === "done") {
              setMessages(prev =>
                prev.map(m => m.id === aiId ? { ...m, streaming: false } : m)
              );
              setActiveTool(null);
            } else if (event.type === "error") {
              setMessages(prev =>
                prev.map(m => m.id === aiId
                  ? { ...m, content: `⚠️ ${event.text}`, streaming: false }
                  : m
                )
              );
            }
          } catch { /* ignore malformed SSE */ }
        }
      }
    } catch {
      setMessages(prev =>
        prev.map(m => m.id === aiId
          ? { ...m, content: "Sorry, something went wrong. Please try again.", streaming: false }
          : m
        )
      );
    }

    setStreaming(false);
    setActiveTool(null);
  }

  function clearChat() {
    setMessages([]);
    setStreaming(false);
    setActiveTool(null);
  }

  return (
    <>
      {/* Inject sidebar animations */}
      <style>{`
        @keyframes finbot-pulse {
          0%,100% { opacity:1; box-shadow:0 0 8px rgba(220,38,38,0.9); }
          50%      { opacity:0.85; box-shadow:0 0 14px rgba(220,38,38,1); }
        }
        @keyframes finbot-msg-in {
          from { opacity:0; transform:translateY(8px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes finbot-float {
          0%,100% { transform:translateY(0); }
          50%     { transform:translateY(-8px); }
        }
        .finbot-sidebar-scroll::-webkit-scrollbar { width:4px; }
        .finbot-sidebar-scroll::-webkit-scrollbar-track { background:transparent; }
        .finbot-sidebar-scroll::-webkit-scrollbar-thumb { background:rgba(5,150,105,0.25); border-radius:2px; }
        .finbot-chat-scroll::-webkit-scrollbar { width:5px; }
        .finbot-chat-scroll::-webkit-scrollbar-track { background:transparent; }
        .finbot-chat-scroll::-webkit-scrollbar-thumb { background:#e5e7eb; border-radius:3px; }
        .finbot-chip-btn:hover { background:#059669 !important; color:#fff !important; border-color:#059669 !important; transform:translateY(-2px); box-shadow:0 4px 12px rgba(5,150,105,0.28); }
        .finbot-msg-in { animation: finbot-msg-in 0.28s cubic-bezier(0.4,0,0.2,1); }
        .finbot-md-table { width:100%; border-collapse:collapse; font-size:12px; margin:8px 0; }
        .finbot-md-table th { background:#f0fdf4; color:#065f46; font-weight:700; padding:6px 10px; text-align:left; border:1px solid #d1fae5; font-size:11px; }
        .finbot-md-table td { padding:5px 10px; border:1px solid #e5e7eb; font-size:12px; color:#111827; }
        .finbot-md-table tr:nth-child(even) td { background:#f9fafb; }
        .finbot-bubble-md h1,.finbot-bubble-md h2,.finbot-bubble-md h3,.finbot-bubble-md h4 { font-weight:700; margin:10px 0 4px; color:inherit; }
        .finbot-bubble-md h1 { font-size:15px; } .finbot-bubble-md h2 { font-size:13.5px; } .finbot-bubble-md h3 { font-size:12.5px; }
        .finbot-bubble-md p  { margin:4px 0; line-height:1.65; font-size:13.5px; }
        .finbot-bubble-md ul { margin:6px 0 6px 18px; padding:0; }
        .finbot-bubble-md li { margin:3px 0; font-size:13.5px; line-height:1.55; }
        .finbot-bubble-md strong { font-weight:700; }
        .finbot-bubble-md code { font-family:monospace; font-size:11.5px; background:rgba(5,150,105,0.1); color:#065f46; padding:1px 5px; border-radius:4px; }
        .finbot-bubble-md pre { background:#f0fdf4; border:1px solid #d1fae5; border-radius:8px; padding:10px 12px; overflow-x:auto; margin:8px 0; }
        .finbot-bubble-md pre code { background:none; padding:0; }
        .finbot-bubble-md hr { border:none; border-top:1px solid #e5e7eb; margin:10px 0; }
      `}</style>

      <div style={{ display: "flex", height: "calc(100vh - 64px)", overflow: "hidden" }}>

        {/* ── Left: News Sidebar ── */}
        <NewsSidebar />

        {/* ── Right: Chat Panel ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--al-bg-soft)" }}>

          {/* Chat topbar */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 20px", background: "#fff",
            borderBottom: "1px solid #eaecf0", flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                background: "rgba(5,150,105,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center",
                overflow: "hidden",
              }}>
                <img src="/finbot.png" alt="FinBot" style={{ width: 20, height: 20, objectFit: "contain" }} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>FinBot</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>AI financial assistant · yfinance live data</div>
              </div>
            </div>
            {messages.length > 0 && (
              <button onClick={clearChat}
                style={{
                  background: "transparent", border: "1px solid #e5e7eb",
                  color: "#6b7280", borderRadius: 8, padding: "5px 13px",
                  fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all 0.2s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#f3f4f6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
                🗑 Clear
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="finbot-chat-scroll"
            style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "24px 20px", display: "flex", flexDirection: "column" }}>

            {/* Welcome state */}
            {messages.length === 0 && (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                textAlign: "center", padding: "40px 24px", minHeight: 280,
              }}>
                <div style={{ animation: "finbot-float 3s ease-in-out infinite", marginBottom: 18 }}>
                  <div style={{
                    width: 72, height: 72, borderRadius: 20,
                    background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 8px 32px rgba(5,150,105,0.3)",
                    overflow: "hidden",
                  }}>
                    <img src="/finbot.png" alt="FinBot" style={{ width: 52, height: 52, objectFit: "contain" }} />
                  </div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#111827", letterSpacing: "-0.03em", marginBottom: 8 }}>
                  FinBot
                </div>
                <div style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.55, maxWidth: 380, marginBottom: 28 }}>
                  Ask me anything about stocks, financials, market news, and investment data.
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 520 }}>
                  {SUGGESTIONS.map(s => (
                    <button key={s.label}
                      className="finbot-chip-btn"
                      onClick={() => handleSend(s.prompt)}
                      style={{
                        background: "#fff", border: "1px solid #e5e7eb",
                        borderRadius: 24, padding: "8px 16px",
                        fontSize: 13, fontWeight: 500, color: "#374151",
                        cursor: "pointer", transition: "all 0.2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                        whiteSpace: "nowrap",
                      }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760, width: "100%", margin: "0 auto" }}>
              {messages.map(msg => (
                <div key={msg.id} className="finbot-msg-in"
                  style={{
                    display: "flex", gap: 10, maxWidth: "88%",
                    alignSelf:     msg.role === "user" ? "flex-end"  : "flex-start",
                    flexDirection: msg.role === "user" ? "row-reverse" : "row",
                  }}>

                  {/* Avatar */}
                  <div style={{
                    width: 32, height: 32, borderRadius: 10, flexShrink: 0, marginTop: 2,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    overflow: "hidden",
                    background: msg.role === "user"
                      ? "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)"
                      : "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                  }}>
                    {msg.role === "user"
                      ? <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>U</span>
                      : <img src="/finbot.png" alt="FinBot" style={{ width: 22, height: 22, objectFit: "contain" }} />
                    }
                  </div>

                  {/* Body */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>

                    {/* Tool call badges — shown below bot avatar, above bubble */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {msg.toolCalls.map((tc, i) => (
                          <span key={i} style={{
                            fontSize: 11, padding: "4px 10px", borderRadius: 20,
                            background: "#f0fdf4", border: "1px solid #a7f3d0",
                            color: "#065f46", fontWeight: 500,
                            display: "flex", alignItems: "center", gap: 5,
                          }}>
                            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#059669", display: "inline-block" }} />
                            {TOOL_LABELS[tc.name] ?? tc.name}
                            {tc.args.ticker   && <span style={{ opacity: 0.7 }}>· {String(tc.args.ticker)}</span>}
                            {tc.args.tickers  && <span style={{ opacity: 0.7 }}>· {(tc.args.tickers as string[]).join(", ")}</span>}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Active tool loader */}
                    {msg.streaming && activeTool && !msg.content && (
                      <div style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "10px 14px", borderRadius: 14,
                        background: "#fff", border: "1px solid #eaecf0",
                        fontSize: 12, color: "#6b7280",
                      }}>
                        <div style={{
                          width: 12, height: 12, border: "2px solid #a7f3d0",
                          borderTopColor: "#059669", borderRadius: "50%",
                          animation: "spin 0.7s linear infinite",
                        }} />
                        {TOOL_LABELS[activeTool] ?? activeTool}…
                      </div>
                    )}

                    {/* Message bubble */}
                    {(msg.content || (msg.streaming && !activeTool)) && (
                      <div style={msg.role === "user" ? {
                        padding: "11px 15px",
                        borderRadius: 14, borderBottomRightRadius: 4,
                        background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                        color: "#fff", fontSize: 13.5, lineHeight: 1.65,
                        wordBreak: "break-word",
                      } : {
                        padding: "11px 15px",
                        borderRadius: 14, borderBottomLeftRadius: 4,
                        background: "#fff", border: "1px solid #eaecf0",
                        color: "#111827", fontSize: 13.5, lineHeight: 1.65,
                        wordBreak: "break-word",
                      }}>
                        {msg.role === "assistant"
                          ? (msg.content
                              ? <div className="finbot-bubble-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                              : <TypingDots />)
                          : msg.content
                        }
                        {msg.streaming && msg.content && (
                          <span style={{
                            display: "inline-block", width: 6, height: 14, borderRadius: 2,
                            background: msg.role === "user" ? "rgba(255,255,255,0.7)" : "#059669",
                            marginLeft: 2, verticalAlign: "middle",
                            animation: "finbot-pulse 0.9s ease-in-out infinite",
                          }} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div style={{
            padding: "12px 20px", borderTop: "1px solid #eaecf0",
            background: "#fff", flexShrink: 0,
          }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", maxWidth: 760, margin: "0 auto" }}>
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Ask about stocks, prices, earnings, news… (Enter to send)"
                disabled={streaming}
                style={{
                  flex: 1, resize: "none", border: "1px solid #e5e7eb",
                  borderRadius: 12, padding: "10px 14px",
                  fontSize: 13.5, outline: "none", lineHeight: 1.5,
                  background: "#f9fafb", color: "#111827",
                  minHeight: 42, maxHeight: 120,
                  opacity: streaming ? 0.6 : 1,
                  fontFamily: "inherit",
                  transition: "border-color 0.2s",
                }}
                onFocus={e => { (e.target as HTMLTextAreaElement).style.borderColor = "#059669"; }}
                onBlur={e  => { (e.target as HTMLTextAreaElement).style.borderColor = "#e5e7eb"; }}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || streaming}
                style={{
                  padding: "10px 20px", borderRadius: 12, border: "none",
                  fontSize: 13.5, fontWeight: 600, cursor: input.trim() && !streaming ? "pointer" : "not-allowed",
                  background: input.trim() && !streaming
                    ? "linear-gradient(135deg, #059669 0%, #10b981 100%)"
                    : "#f3f4f6",
                  color: input.trim() && !streaming ? "#fff" : "#9ca3af",
                  flexShrink: 0, transition: "all 0.2s",
                  minHeight: 42,
                }}>
                {streaming ? "…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", height: 16 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "#9ca3af", display: "inline-block",
          animation: "bounce 1.2s ease-in-out infinite",
          animationDelay: `${i * 0.18}s`,
        }} />
      ))}
    </span>
  );
}
