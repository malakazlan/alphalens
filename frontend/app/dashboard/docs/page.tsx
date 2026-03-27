"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";

// ── Sidebar navigation ──────────────────────────────────────────────────────
const SECTIONS = [
  { id: "overview",        label: "Overview" },
  { id: "getting-started", label: "Getting Started" },
  { id: "analyzer",        label: "Document Analyzer" },
  { id: "reports",         label: "Report Generation" },
  { id: "finbot",          label: "FinBot" },
  { id: "security",        label: "Security and Privacy" },
  { id: "technical",       label: "Technical Stack" },
];

// ── Callout box ─────────────────────────────────────────────────────────────
function Callout({ type, children }: { type: "info" | "tip" | "note"; children: React.ReactNode }) {
  const config = {
    info: { bg: "rgba(37,99,235,0.06)", border: "rgba(37,99,235,0.25)", color: "#2563eb", label: "Info" },
    tip:  { bg: "rgba(5,150,105,0.06)",  border: "rgba(5,150,105,0.25)",  color: "#059669", label: "Tip" },
    note: { bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.25)", color: "#d97706", label: "Note" },
  }[type];
  return (
    <div style={{
      padding: "14px 18px", borderRadius: 10, marginBottom: 20,
      background: config.bg,
      border: `1px solid ${config.border}`,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: config.color, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
        {config.label}
      </span>
      <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.72 }}>{children}</div>
    </div>
  );
}

// ── Section heading ─────────────────────────────────────────────────────────
function SectionHeading({ id, title, subtitle }: { id: string; title: string; subtitle?: string }) {
  return (
    <div id={id} style={{ marginBottom: 28, paddingTop: 16, scrollMarginTop: 88 }}>
      <div style={{ width: 3, height: 28, borderRadius: 2, background: "linear-gradient(180deg,#059669,#10b981)", display: "inline-block", verticalAlign: "middle", marginRight: 12 }} />
      <h2 style={{ display: "inline", fontSize: 26, fontWeight: 800, color: "#0a0e1a", letterSpacing: "-0.025em", verticalAlign: "middle" }}>
        {title}
      </h2>
      {subtitle && (
        <p style={{ fontSize: 15, color: "#64748b", lineHeight: 1.72, marginTop: 10, marginBottom: 0 }}>{subtitle}</p>
      )}
    </div>
  );
}

// ── Sub heading ─────────────────────────────────────────────────────────────
function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 17, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.015em", marginBottom: 10, marginTop: 28 }}>
      {children}
    </h3>
  );
}

// ── Body paragraph ──────────────────────────────────────────────────────────
function Body({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 14.5, color: "#374151", lineHeight: 1.8, marginBottom: 16 }}>
      {children}
    </p>
  );
}

// ── Feature badge ───────────────────────────────────────────────────────────
function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
      background: `${color}14`, color,
      border: `1px solid ${color}30`,
      marginRight: 6, marginBottom: 4,
    }}>
      {children}
    </span>
  );
}

// ── Capability card (used in overview) ──────────────────────────────────────
function CapCard({ color, glowRgb, label, title, desc, icon }: {
  color: string; glowRgb: string; label: string; title: string; desc: string;
  icon: React.ReactNode;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: "24px 22px",
        borderRadius: 16,
        border: `1.5px solid ${hov ? `rgba(${glowRgb},0.35)` : "rgba(0,0,0,0.07)"}`,
        background: hov ? "#fff" : "rgba(255,255,255,0.7)",
        boxShadow: hov ? `0 12px 36px rgba(${glowRgb},0.14)` : "0 2px 8px rgba(0,0,0,0.04)",
        transform: hov ? "translateY(-4px)" : "none",
        transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
        position: "relative", overflow: "hidden",
      }}
    >
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${color}, transparent 80%)`,
        opacity: hov ? 1 : 0, transition: "opacity 0.25s",
        borderRadius: "16px 16px 0 0",
      }} />
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        display: "grid", placeItems: "center",
        background: `rgba(${glowRgb},0.1)`,
        color, marginBottom: 14,
        transform: hov ? "scale(1.08)" : "none",
        transition: "transform 0.25s",
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color, marginBottom: 8,
        padding: "2px 8px", borderRadius: 4, background: `rgba(${glowRgb},0.08)`,
        display: "inline-block" }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#0a0e1a", marginBottom: 8, letterSpacing: "-0.015em" }}>
        {title}
      </div>
      <p style={{ fontSize: 13.5, color: "#64748b", lineHeight: 1.7, margin: 0 }}>{desc}</p>
    </div>
  );
}

// ── Data table ──────────────────────────────────────────────────────────────
function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(0,0,0,0.07)", marginBottom: 24 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(5,150,105,0.06)" }}>
            {headers.map(h => (
              <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#059669", letterSpacing: "0.04em", textTransform: "uppercase", borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "rgba(248,250,252,0.8)" }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "9px 16px", fontSize: 13.5, color: j === 0 ? "#0f172a" : "#475569", fontWeight: j === 0 ? 600 : 400, borderBottom: i < rows.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none" }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Step item ───────────────────────────────────────────────────────────────
function StepItem({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        display: "grid", placeItems: "center",
        background: "rgba(5,150,105,0.1)", border: "2px solid rgba(5,150,105,0.3)",
        color: "#059669", fontSize: 13, fontWeight: 800,
      }}>
        {n}
      </div>
      <div style={{ paddingTop: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.72 }}>{children}</div>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("overview");
  const contentRef = useRef<HTMLDivElement>(null);

  // Scrollspy via IntersectionObserver
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveSection(id);
        },
        { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach(o => o.disconnect());
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={{
      display: "flex",
      height: "100%",
      fontFamily: "Inter,-apple-system,BlinkMacSystemFont,sans-serif",
      background: "#f8fafc",
    }}>

      {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
      <aside style={{
        width: 248,
        flexShrink: 0,
        borderRight: "1px solid rgba(226,232,240,0.8)",
        background: "rgba(255,255,255,0.7)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        padding: "36px 0",
        overflowY: "auto",
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        height: "calc(100vh - 98px)",
      }}>
        <div style={{ padding: "0 20px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 16 }}>
            Documentation
          </div>

          <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {SECTIONS.map(({ id, label }) => {
              const active = activeSection === id;
              return (
                <button
                  key={id}
                  onClick={() => scrollTo(id)}
                  style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: active ? 600 : 400,
                    color: active ? "#059669" : "#475569",
                    background: active ? "rgba(5,150,105,0.08)" : "transparent",
                    borderLeft: active ? "3px solid #059669" : "3px solid transparent",
                    transition: "all 0.18s",
                    fontFamily: "inherit",
                  }}
                  onMouseEnter={e => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.04)";
                      (e.currentTarget as HTMLElement).style.color = "#0f172a";
                    }
                  }}
                  onMouseLeave={e => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                      (e.currentTarget as HTMLElement).style.color = "#475569";
                    }
                  }}
                >
                  {label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar CTA */}
        <div style={{ margin: "20px 20px 0", padding: "16px", borderRadius: 12, background: "rgba(5,150,105,0.07)", border: "1px solid rgba(5,150,105,0.15)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#059669", marginBottom: 6 }}>Ready to start?</div>
          <div style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.6, marginBottom: 12 }}>
            Upload your first financial document and see Alpha Lens in action.
          </div>
          <Link
            href="/dashboard/analyzer"
            style={{
              display: "block", textAlign: "center",
              padding: "8px 0", borderRadius: 8,
              background: "#059669", color: "#fff",
              fontSize: 13, fontWeight: 600,
              textDecoration: "none",
              transition: "background 0.18s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}
          >
            Open Analyzer
          </Link>
        </div>
      </aside>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <main
        ref={contentRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "48px clamp(24px,4vw,72px) 96px",
          maxWidth: 860,
        }}
      >
        {/* Page header */}
        <div style={{ marginBottom: 52 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "5px 14px", borderRadius: 100,
            background: "rgba(5,150,105,0.07)", border: "1px solid rgba(5,150,105,0.2)",
            marginBottom: 18,
          }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#059669" }}>Product Documentation</span>
          </div>
          <h1 style={{
            fontSize: "clamp(28px,3vw,42px)", fontWeight: 900,
            letterSpacing: "-0.03em", lineHeight: 1.1,
            color: "#0a0e1a", marginBottom: 14,
          }}>
            Alpha Lens Documentation
          </h1>
          <p style={{ fontSize: 16, color: "#64748b", lineHeight: 1.8, maxWidth: 620, marginBottom: 24 }}>
            Everything you need to understand, configure and get the most out of the Alpha Lens platform. This guide covers each module in detail, from document uploading to live market intelligence.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Badge color="#059669">v2.0</Badge>
            <Badge color="#2563eb">Landing.AI ADE</Badge>
            <Badge color="#7c3aed">GPT-4o</Badge>
            <Badge color="#0891b2">Qdrant</Badge>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════
            OVERVIEW
        ══════════════════════════════════════════════════════════════ */}
        <SectionHeading
          id="overview"
          title="Overview"
          subtitle="Alpha Lens is an AI powered financial document intelligence platform that transforms raw financial PDFs into structured, searchable knowledge."
        />

        <Body>
          Built for analysts, investors and finance professionals, Alpha Lens combines Landing.AI Agentic Document Extraction, OpenAI GPT-4o reasoning and real time market data into a unified workflow. Every module is designed to reduce the time from document receipt to actionable insight from hours to seconds.
        </Body>

        <Body>
          The platform operates on a four module architecture. The Document Analyzer processes and indexes uploaded PDFs with full visual grounding. The Report Generator produces structured analyst reports from that indexed content. The Chat interface enables natural language querying with exact source citations. FinBot extends beyond individual documents to deliver live market data, stock comparisons and financial news through a conversational interface.
        </Body>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, margin: "28px 0 36px" }}>
          <CapCard
            color="#059669" glowRgb="5,150,105"
            label="Analyzer" title="Document Intelligence"
            desc="Parse any financial PDF with visual bounding box grounding and vector indexing."
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
          />
          <CapCard
            color="#2563eb" glowRgb="37,99,235"
            label="Reports" title="Analyst Reports"
            desc="Generate GPT-4o powered, structured analyst reports in under 30 seconds."
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
          />
          <CapCard
            color="#7c3aed" glowRgb="124,58,237"
            label="FinBot" title="Market Intelligence"
            desc="Query live stock data, news and financials through a conversational AI interface."
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6"/></svg>}
          />
        </div>

        <hr style={{ border: "none", borderTop: "1px solid rgba(0,0,0,0.07)", margin: "40px 0" }} />

        {/* ══════════════════════════════════════════════════════════════
            GETTING STARTED
        ══════════════════════════════════════════════════════════════ */}
        <SectionHeading id="getting-started" title="Getting Started" />

        <Body>
          Alpha Lens is designed to be operational within minutes. No configuration files, no setup scripts and no external dependencies are required from the user. All processing happens on the platform infrastructure.
        </Body>

        <StepItem n="01" title="Create your account">
          Navigate to the Alpha Lens login page and sign up with your email address. Authentication is handled by Supabase and your session is secured with a JWT token that refreshes automatically. All your documents and data are isolated to your account from the moment it is created.
        </StepItem>

        <StepItem n="02" title="Upload your first document">
          From the Analyzer section, click the upload area or drag and drop any financial PDF. The platform accepts files up to 50 MB. Compatible document types include annual reports, SEC 10-K and 10-Q filings, quarterly earnings releases, investor day presentations, earnings call transcripts and IPO prospectuses.
        </StepItem>

        <StepItem n="03" title="Wait for processing">
          After upload, Landing.AI ADE begins parsing the document in a background worker. A live progress indicator displays the current processing stage. Most documents complete in approximately 30 seconds. You will be notified when the document is ready for analysis.
        </StepItem>

        <StepItem n="04" title="Explore the workspace">
          Once processing is complete, the Analyzer workspace opens automatically. From there you can browse parsed content in the Parse view, review extracted financial data in the Extract view, ask questions using the Chat panel and generate a full analyst report.
        </StepItem>

        <Callout type="tip">
          For best results, use documents that contain structured financial tables such as income statements and balance sheets. Landing.AI ADE performs visual element detection, so documents with clear page structure produce higher quality extractions.
        </Callout>

        <hr style={{ border: "none", borderTop: "1px solid rgba(0,0,0,0.07)", margin: "40px 0" }} />

        {/* ══════════════════════════════════════════════════════════════
            DOCUMENT ANALYZER
        ══════════════════════════════════════════════════════════════ */}
        <SectionHeading
          id="analyzer"
          title="Document Analyzer"
          subtitle="The primary workspace for processing, exploring and querying financial documents."
        />

        <Body>
          The Analyzer is the core module of Alpha Lens. After a document is uploaded, Landing.AI Agentic Document Extraction runs an asynchronous parsing job that identifies every structural element in the PDF including tables, charts, text blocks and figures. Each element is assigned a precise bounding box coordinate, creating a direct visual link between the parsed content and the original PDF page.
        </Body>

        <Body>
          The parsed elements are then embedded using OpenAI text-embedding-3-small and stored in a Qdrant vector collection filtered by user and document ID. This enables semantic search over the full document content at retrieval time.
        </Body>

        <SubHeading>Parse View</SubHeading>
        <Body>
          The Parse View displays the complete document content rendered as structured markdown. Section headings are preserved from the original PDF layout. Each content block is linked to its source page and bounding box, enabling bidirectional citation tracking between the text view and the PDF viewer.
        </Body>
        <Body>
          When a citation is active, the corresponding bounding box is highlighted in the PDF viewer with a color coded overlay. Text blocks use an emerald highlight, table elements use a blue highlight and figure elements use a pink highlight.
        </Body>

        <SubHeading>Extract View</SubHeading>
        <Body>
          The Extract View presents structured financial data derived from the document. Income statement line items, balance sheet figures, cash flow statements and key performance metrics are normalised into a consistent schema regardless of the source document layout. This data is surfaced in a clean tabular format with direct links back to the source tables in the PDF.
        </Body>

        <SubHeading>Chat Panel</SubHeading>
        <Body>
          The Chat panel enables natural language questions about the document. Each user message is embedded and matched against the vector index using cosine similarity search. The top matching chunks are assembled into a context window and passed to GPT-4o-mini along with the conversation history. Every response includes citation chips that reference the specific pages and visual bounding boxes in the PDF viewer.
        </Body>

        <Callout type="info">
          The Chat panel supports two context modes. In RAG mode, answers are grounded in the most relevant document chunks retrieved by vector search. In full context mode for shorter documents, the entire parsed content is included in the prompt to ensure comprehensive coverage.
        </Callout>

        <SubHeading>PDF Viewer Overlay</SubHeading>
        <Body>
          The PDF viewer renders the original document page by page using PDF.js. A transparent overlay layer sits on top of each rendered page and displays bounding box annotations for every extracted element. Hovering over an overlay box highlights the corresponding content block in the Parse View. Clicking a citation chip in the Chat panel scrolls the viewer to the correct page and activates the relevant bounding box.
        </Body>

        <hr style={{ border: "none", borderTop: "1px solid rgba(0,0,0,0.07)", margin: "40px 0" }} />

        {/* ══════════════════════════════════════════════════════════════
            REPORT GENERATION
        ══════════════════════════════════════════════════════════════ */}
        <SectionHeading
          id="reports"
          title="Report Generation"
          subtitle="Produce structured, analyst grade financial reports from any processed document."
        />

        <Body>
          The Reports module uses GPT-4o with access to the full parsed document content to write structured analyst reports. Reports are generated section by section with a live streaming progress indicator. Each section can be independently regenerated if you want to update or refine specific parts of the report without reprocessing the entire document.
        </Body>

        <SubHeading>Available Templates</SubHeading>

        <DataTable
          headers={["Template", "Best For", "Key Sections"]}
          rows={[
            ["Full Analysis", "Comprehensive investment research", "Executive Summary, Business Overview, Financial Performance, Risk Factors, Investment Conclusion"],
            ["Executive Brief", "Internal distribution and quick reference", "Company Snapshot, Key Financials, Top Risks, Recommendation"],
            ["Risk Report", "Compliance and due diligence workflows", "Operational Risks, Financial Risks, Market Risks, Regulatory Exposure"],
            ["Investor Memo", "Institutional investment communications", "Investment Thesis, Valuation, Comparable Analysis, Catalysts"],
          ]}
        />

        <SubHeading>Exporting Reports</SubHeading>
        <Body>
          Completed reports can be exported to PDF using the Export button in the report toolbar. The export is generated server side and preserves the full formatting including section headings, data tables and financial figures. The exported file is ready for distribution without additional editing.
        </Body>

        <Callout type="note">
          Report quality is directly dependent on the quality of the source document. Documents with clearly labelled financial tables, consistent section headings and machine readable text will produce more detailed and accurate reports than scanned or image only PDFs.
        </Callout>

        <hr style={{ border: "none", borderTop: "1px solid rgba(0,0,0,0.07)", margin: "40px 0" }} />

        {/* ══════════════════════════════════════════════════════════════
            FINBOT
        ══════════════════════════════════════════════════════════════ */}
        <SectionHeading
          id="finbot"
          title="FinBot"
          subtitle="A live market intelligence interface powered by real time financial data tools."
        />

        <Body>
          FinBot operates as an agentic conversational interface with direct access to live financial data sources. Unlike the Document Chat, which is grounded in uploaded content, FinBot queries external APIs in real time to answer questions about current market conditions, individual securities and broader financial topics.
        </Body>

        <SubHeading>Available Capabilities</SubHeading>

        <DataTable
          headers={["Capability", "Description", "Data Source"]}
          rows={[
            ["Stock Price Lookup", "Current price, daily change and volume for any ticker", "yfinance"],
            ["Historical Price Chart", "Price history over configurable date ranges", "yfinance"],
            ["Fundamentals", "P/E ratio, EPS, revenue, market cap and more", "yfinance"],
            ["Multi Ticker Comparison", "Side by side comparison of up to five securities", "yfinance"],
            ["Financial News", "Real time news headlines for any ticker or topic", "Finnhub"],
            ["Investment Modeling", "Simple scenario calculations based on user inputs", "Internal"],
          ]}
        />

        <SubHeading>News Sidebar</SubHeading>
        <Body>
          The FinBot layout includes a dedicated news sidebar on the left panel. It displays a live stream of financial headlines sourced from Finnhub. The carousel advances automatically every five seconds and a full breaking news list is visible below it. Clicking any headline brings the story into the conversation context, allowing you to ask follow up questions about any market event.
        </Body>

        <SubHeading>Example Queries</SubHeading>
        <Body>
          FinBot understands natural language questions. Some examples of what you can ask:
        </Body>
        <div style={{ background: "rgba(15,23,42,0.03)", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 10, padding: "16px 20px", marginBottom: 20 }}>
          {[
            "What is the current price of AAPL and how has it performed over the last month?",
            "Compare the revenue growth of MSFT, GOOGL and AMZN over the past four quarters.",
            "What are the top financial news stories today?",
            "If I invest 10000 dollars in NVDA today and it grows at 15 percent annually, what will it be worth in five years?",
            "Show me the key fundamentals for Tesla.",
          ].map((q, i) => (
            <div key={i} style={{
              fontSize: 13.5, color: "#374151", padding: "8px 0",
              borderBottom: i < 4 ? "1px solid rgba(0,0,0,0.05)" : "none",
              display: "flex", alignItems: "flex-start", gap: 10,
            }}>
              <span style={{ color: "#059669", fontWeight: 700, flexShrink: 0, marginTop: 1 }}>›</span>
              {q}
            </div>
          ))}
        </div>

        <hr style={{ border: "none", borderTop: "1px solid rgba(0,0,0,0.07)", margin: "40px 0" }} />

        {/* ══════════════════════════════════════════════════════════════
            SECURITY AND PRIVACY
        ══════════════════════════════════════════════════════════════ */}
        <SectionHeading
          id="security"
          title="Security and Privacy"
          subtitle="Alpha Lens is built with data isolation as a first principle, not an afterthought."
        />

        <SubHeading>User Data Isolation</SubHeading>
        <Body>
          All documents, extracted data, chat history, report content and vector embeddings are scoped to the authenticated user account. Row level security policies on the Supabase PostgreSQL database enforce this isolation at the query layer. No API endpoint can return data belonging to a different user, regardless of the request parameters.
        </Body>

        <SubHeading>Authentication</SubHeading>
        <Body>
          Authentication is handled by Supabase Auth using email and password. On successful login, a signed JWT is issued and stored in the browser. Every API request to the FastAPI backend includes this token in the Authorization header. The backend verifies the token signature and extracts the user ID before processing any request. Expired tokens are rejected and the user is redirected to the login page.
        </Body>

        <SubHeading>Document Storage</SubHeading>
        <Body>
          Uploaded PDF files are stored in Supabase Storage. File access is controlled through signed URLs with short expiry windows. Direct file paths are never exposed to the client. The signed URL is generated on demand when the PDF viewer needs to render the document and expires shortly after.
        </Body>

        <Callout type="info">
          Documents uploaded to Alpha Lens are used solely for processing within your account. They are not shared with other users, used for model training or retained beyond your account lifetime.
        </Callout>

        <hr style={{ border: "none", borderTop: "1px solid rgba(0,0,0,0.07)", margin: "40px 0" }} />

        {/* ══════════════════════════════════════════════════════════════
            TECHNICAL STACK
        ══════════════════════════════════════════════════════════════ */}
        <SectionHeading
          id="technical"
          title="Technical Stack"
          subtitle="The complete technology stack powering Alpha Lens from frontend to data infrastructure."
        />

        <SubHeading>Frontend</SubHeading>
        <DataTable
          headers={["Technology", "Version", "Purpose"]}
          rows={[
            ["Next.js", "14", "React framework with App Router and server components"],
            ["React", "18", "Component model and client side interactivity"],
            ["Tailwind CSS", "3.x", "Utility first styling system"],
            ["shadcn/ui", "Latest", "Accessible component primitives"],
            ["PDF.js", "3.11.174", "Client side PDF rendering with page canvas output"],
            ["Zustand", "5.0", "Lightweight client state management"],
          ]}
        />

        <SubHeading>Backend</SubHeading>
        <DataTable
          headers={["Technology", "Version", "Purpose"]}
          rows={[
            ["FastAPI", "0.104", "Async REST API and server sent event streaming"],
            ["Python", "3.11", "Backend runtime"],
            ["ARQ", "0.25", "Background task queue for async document processing"],
            ["Upstash Redis", "Latest", "Task queue broker for ARQ workers"],
            ["Uvicorn", "0.24", "ASGI server"],
          ]}
        />

        <SubHeading>AI and Document Intelligence</SubHeading>
        <DataTable
          headers={["Technology", "Model or Version", "Purpose"]}
          rows={[
            ["Landing.AI ADE", "1.2", "Agentic document extraction with visual bounding box grounding"],
            ["OpenAI GPT-4o", "Latest", "Report generation and full context document analysis"],
            ["OpenAI GPT-4o-mini", "Latest", "Document chat and FinBot conversational responses"],
            ["OpenAI Embeddings", "text-embedding-3-small", "1536 dimension vector generation for semantic search"],
          ]}
        />

        <SubHeading>Data Infrastructure</SubHeading>
        <DataTable
          headers={["Technology", "Purpose"]}
          rows={[
            ["Qdrant Cloud", "Vector database storing 1536 dimension document embeddings with metadata filtering per user and document"],
            ["Supabase PostgreSQL", "Relational data storage for documents, chat history, reports and grounding coordinates"],
            ["Supabase Auth", "User authentication and JWT session management"],
            ["Supabase Storage", "Secure file storage for uploaded PDFs with signed URL access control"],
          ]}
        />

        <SubHeading>Market Data</SubHeading>
        <DataTable
          headers={["Provider", "Data Provided"]}
          rows={[
            ["yfinance", "Real time and historical stock prices, company fundamentals, financial statements"],
            ["Finnhub", "Live financial news headlines, market updates and company specific news feeds"],
          ]}
        />

        <SubHeading>Deployment</SubHeading>
        <Body>
          The Next.js frontend is deployed on Vercel with automatic preview deployments for every branch. The FastAPI backend and ARQ worker run as separate services on Render.com. The worker service connects to Upstash Redis to pick up document processing jobs from the queue. All environment secrets are managed through platform environment variable configuration and are never committed to the repository.
        </Body>

        <Callout type="tip">
          The Qdrant collection uses a single collection for all users with payload filtering by user ID and document ID. This avoids the overhead of creating and deleting collections per user while maintaining strict data isolation through query time filters.
        </Callout>

        {/* Bottom nav */}
        <div style={{
          marginTop: 56, padding: "24px 0",
          borderTop: "1px solid rgba(0,0,0,0.07)",
          display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16,
        }}>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>
            Alpha Lens v2.0 · Last updated March 2026
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Link href="/dashboard/analyzer" style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 13, fontWeight: 600, color: "#059669",
              textDecoration: "none", padding: "8px 16px", borderRadius: 8,
              background: "rgba(5,150,105,0.07)", border: "1px solid rgba(5,150,105,0.2)",
              transition: "all 0.18s",
            }}>
              Open Analyzer
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none"><path d="M5 10h10M12 7l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
            <Link href="/dashboard/finbot" style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 13, fontWeight: 600, color: "#7c3aed",
              textDecoration: "none", padding: "8px 16px", borderRadius: 8,
              background: "rgba(124,58,237,0.07)", border: "1px solid rgba(124,58,237,0.2)",
              transition: "all 0.18s",
            }}>
              Try FinBot
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none"><path d="M5 10h10M12 7l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
