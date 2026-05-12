"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useReportStore } from "@/lib/stores/report-store";
import type { SectionState } from "@/lib/stores/report-store";
import SectionTOC from "@/components/report/SectionTOC";
import SectionCard from "@/components/report/SectionCard";
import ReportToolbar from "@/components/report/ReportToolbar";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Doc {
  id: string;
  filename: string;
  status: string;
  upload_time: string;
  metadata?: {
    page_count?: number;
    company_name?: string;
    fiscal_year?: number | string;
    currency?: string;
    doc_type?: string;
  };
}

const MONO  = '"JetBrains Mono", ui-monospace, Menlo, monospace';

// ── Templates ─────────────────────────────────────────────────────────────────
const TEMPLATES = [
  {
    id: "full_analysis" as const,
    n: "№ 01",
    sub: "Default commission",
    title: "Full",
    titleEm: "Analysis",
    desc: "Comprehensive seven-section deep-dive. Income statement, balance sheet, cash flow, ratios, red flags, and analyst conclusion — written in fluent prose.",
    sections: 7, words: "~3,000", mins: "~4 min",
    chips: ["Executive", "Performance", "Balance", "Cash Flow", "Ratios", "Red Flags", "Conclusion"],
    color: "#059669", soft: "rgba(5,150,105,0.08)", glow: "5,150,105",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="4" y="4" width="16" height="16" />
        <line x1="4" y1="9"  x2="20" y2="9"/>
        <line x1="9" y1="9"  x2="9"  y2="20"/>
      </svg>
    ),
  },
  {
    id: "executive_brief" as const,
    n: "№ 02",
    sub: "Quick brief",
    title: "Executive",
    titleEm: "Brief",
    desc: "Three-section overview for stakeholders who need the headline. Summary, key metrics, and a one-paragraph conclusion.",
    sections: 3, words: "~800", mins: "~90 sec",
    chips: ["Summary", "Metrics", "Conclusion"],
    color: "#2563eb", soft: "rgba(37,99,235,0.08)", glow: "37,99,235",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/>
        <polyline points="14 3 14 8 19 8" fill="none"/>
        <line x1="9"  y1="13" x2="15" y2="13"/>
        <line x1="9"  y1="17" x2="13" y2="17"/>
      </svg>
    ),
  },
  {
    id: "risk_report" as const,
    n: "№ 03",
    sub: "Risk & compliance",
    title: "Risk",
    titleEm: "Report",
    desc: "Compliance-focused analysis: liquidity, leverage, red flags, and risk concentration. Written for risk teams who don't tolerate paraphrase.",
    sections: 4, words: "~1,500", mins: "~2 min",
    chips: ["Summary", "Liquidity", "Red Flags", "Conclusion"],
    color: "#b5564a", soft: "rgba(181,86,74,0.08)", glow: "181,86,74",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9"  x2="12" y2="13"/>
        <circle cx="12" cy="17" r="0.6" fill="currentColor"/>
      </svg>
    ),
  },
  {
    id: "investor_memo" as const,
    n: "№ 04",
    sub: "IC format",
    title: "Investor",
    titleEm: "Memo",
    desc: "Investment-committee format: performance, growth drivers, risks, and forward-looking outlook. Built for memos that get read.",
    sections: 5, words: "~2,000", mins: "~3 min",
    chips: ["Summary", "Performance", "Growth", "Risks", "Outlook"],
    color: "#c026d3", soft: "rgba(192,38,211,0.08)", glow: "192,38,211",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="20" x2="12" y2="10"/>
        <line x1="18" y1="20" x2="18" y2="4"/>
        <line x1="6"  y1="20" x2="6"  y2="16"/>
      </svg>
    ),
  },
];

// ── Date grouping for filings ─────────────────────────────────────────────────
function groupByPeriod(docs: Doc[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek  = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 7);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const groups: Record<string, Doc[]> = { Today: [], "This week": [], "This month": [], Earlier: [] };
  for (const d of docs) {
    if (!d.upload_time) { groups["Earlier"].push(d); continue; }
    const t = new Date(d.upload_time);
    if (t >= startOfToday)      groups["Today"].push(d);
    else if (t >= startOfWeek)  groups["This week"].push(d);
    else if (t >= startOfMonth) groups["This month"].push(d);
    else                        groups["Earlier"].push(d);
  }
  return groups;
}

// ── File extension glyph ──────────────────────────────────────────────────────
function FileGlyph({ filename }: { filename: string }) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const tone =
    ext === "pdf" ? "#dc2626" :
    ext === "docx" || ext === "doc" ? "#2563eb" :
    ext === "html" || ext === "htm" ? "#f59e0b" :
    "#64748b";
  return (
    <div aria-hidden style={{
      width: 26, height: 30, flexShrink: 0,
      background: "var(--al-card)",
      border: "1px solid rgba(0,0,0,0.10)",
      borderRadius: 3, position: "relative",
      display: "flex", flexDirection: "column",
      alignItems: "flex-start", justifyContent: "flex-end",
      padding: "0 0 3px 3px",
      boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
    }}>
      <span style={{
        position: "absolute", top: 0, right: 0, width: 7, height: 7,
        background: "linear-gradient(225deg, rgba(0,0,0,0.10) 50%, transparent 50%)",
      }} />
      <span style={{
        fontSize: 7, fontWeight: 700, letterSpacing: "0.04em",
        color: tone, fontFamily: MONO, lineHeight: 1,
      }}>{ext.slice(0, 4).toUpperCase() || "FILE"}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ReportPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);

  const store = useReportStore();
  const abortRef = useRef<AbortController | null>(null);
  const reportBodyRef = useRef<HTMLDivElement>(null);

  const [activeSection, setActiveSection] = useState<string | null>(null);
  const sectionOrder = useRef<string[]>([]);

  // ── Fetch docs (only completed ones) ──────────────────────────────
  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/documents", { credentials: "include" });
      const data = await res.json();
      if (data.success)
        setDocs(data.documents.filter((d: Doc) => d.status === "complete"));
    } catch {}
    setLoadingDocs(false);
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const selectedDoc = docs.find(d => d.id === store.selectedDocId) ?? null;

  function selectDoc(doc: Doc) {
    if (store.selectedDocId === doc.id) return;
    abortRef.current?.abort();
    store.setSelectedDoc(doc.id);
    store.setGenerating(false);
    store.setSections({});
    store.setActiveReport(null);
    loadReportList(doc.id);
  }

  async function loadReportList(docId: string) {
    try {
      const res = await fetch(`/api/documents/${docId}/reports`, { credentials: "include" });
      const data = await res.json();
      if (data.success) {
        store.setReportList(data.reports ?? []);
        const latest = (data.reports ?? []).find((r: { status: string; id: string }) => r.status === "complete");
        if (latest) loadFullReport(latest.id);
      }
    } catch {}
  }

  async function loadFullReport(reportId: string) {
    try {
      const res = await fetch(`/api/reports/${reportId}`, { credentials: "include" });
      const data = await res.json();
      if (data.success && data.report) {
        const report = data.report;
        store.setActiveReport(report.id);
        const secs: Record<string, SectionState> = {};
        const order: string[] = [];
        for (const [sid, val] of Object.entries(report.sections ?? {})) {
          const s = val as { title?: string; markdown?: string; status?: SectionState["status"]; error?: string; word_count?: number };
          secs[sid] = {
            id: sid,
            title: s.title ?? sectionTitle(sid),
            markdown: s.markdown ?? "",
            status: s.status ?? "done",
            error: s.error,
            wordCount: s.word_count,
          };
          order.push(sid);
        }
        sectionOrder.current = order;
        store.setSections(secs);
      }
    } catch {}
  }

  async function handleGenerate() {
    if (!store.selectedDocId || store.generating) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    store.setGenerating(true);
    store.setSections({});
    store.setActiveReport(null);

    try {
      const res = await fetch(`/api/documents/${store.selectedDocId}/report`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: store.template }),
        signal: abortRef.current.signal,
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
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
          try { const event = JSON.parse(line.slice(6)); handleSSE(event); } catch {}
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") {
        console.error("Report generation error:", e);
      }
    }

    store.setGenerating(false);
    store.setGeneratingSection(null);
    if (store.selectedDocId) loadReportList(store.selectedDocId);
  }

  function handleSSE(event: { type: string; section?: string; sections?: string[]; text?: string; title?: string; word_count?: number; error?: string; report_id?: string }) {
    switch (event.type) {
      case "report_start": {
        sectionOrder.current = event.sections ?? [];
        const initial: Record<string, SectionState> = {};
        for (const sid of event.sections ?? []) {
          initial[sid] = { id: sid, title: sectionTitle(sid), markdown: "", status: "pending" };
        }
        store.setSections(initial);
        break;
      }
      case "section_start":
        if (event.section) {
          store.updateSection(event.section, { status: "generating", title: event.title ?? sectionTitle(event.section) });
          store.setGeneratingSection(event.section);
          setActiveSection(event.section);
        }
        break;
      case "delta":
        if (event.section && event.text) store.appendSectionText(event.section, event.text);
        break;
      case "section_done":
        if (event.section) {
          store.updateSection(event.section, { status: "done", wordCount: event.word_count });
          store.setGeneratingSection(null);
        }
        break;
      case "section_error":
        if (event.section) {
          store.updateSection(event.section, { status: "error", error: event.error });
          store.setGeneratingSection(null);
        }
        break;
      case "report_done":
        if (event.report_id) store.setActiveReport(event.report_id);
        break;
    }
  }

  async function handleRegenerateSection(sectionId: string) {
    if (!store.activeReportId || store.generating) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    store.setGenerating(true);
    store.updateSection(sectionId, { status: "generating", markdown: "", error: undefined });
    store.setGeneratingSection(sectionId);

    try {
      const res = await fetch(`/api/reports/${store.activeReportId}/regenerate-section`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: sectionId }),
        signal: abortRef.current.signal,
      });
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
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
          try { const event = JSON.parse(line.slice(6)); handleSSE(event); } catch {}
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") {
        store.updateSection(sectionId, { status: "error", error: "Failed to regenerate section." });
      }
    }
    store.setGenerating(false);
    store.setGeneratingSection(null);
  }

  function handleCopy() {
    const md = Object.values(store.sections).filter(s => s.status === "done").map(s => s.markdown).join("\n\n---\n\n");
    navigator.clipboard.writeText(md);
  }

  function handlePrint() {
    const md = Object.values(store.sections).filter(s => s.status === "done").map(s => s.markdown).join("\n\n---\n\n");
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>${selectedDoc?.filename ?? "Report"}</title>
      <style>
        body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.7; font-size: 13px; }
        h2 { color: #059669; border-left: 4px solid #059669; padding-left: 12px; margin-top: 2rem; font-size: 16px; }
        h3 { color: #1a1a1a; margin-top: 1.5rem; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 12px; }
        th { background: #059669; color: white; padding: 8px 12px; text-align: left; }
        td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
        tr:nth-child(even) { background: #f8fafc; }
        hr { border: none; border-top: 1px solid #e2e8f0; margin: 2rem 0; }
      </style></head><body>
      <h1 style="color:#059669;font-size:20px">${selectedDoc?.filename ?? "Report"}</h1>
      <pre style="white-space:pre-wrap;font-family:inherit">${md.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
      </body></html>
    `);
    win.document.close();
    win.print();
  }

  function jumpToSection(sectionId: string) {
    const el = document.getElementById(`section-${sectionId}`);
    if (el && reportBodyRef.current) {
      const c = reportBodyRef.current;
      const elRect = el.getBoundingClientRect();
      const cRect = c.getBoundingClientRect();
      c.scrollTop += elRect.top - cRect.top - 12;
    }
    setActiveSection(sectionId);
  }

  useEffect(() => {
    const c = reportBodyRef.current;
    if (!c) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = entry.target.id.replace("section-", "");
          setActiveSection(id);
        }
      }
    }, { root: c, rootMargin: "-10% 0px -60% 0px", threshold: 0.1 });
    const els = c.querySelectorAll("[id^=section-]");
    els.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [store.sections]);

  const totalWords = Object.values(store.sections).reduce((sum, s) => sum + (s.wordCount ?? 0), 0);
  const hasReport = Object.keys(store.sections).length > 0 &&
    Object.values(store.sections).some(s => s.status !== "pending" || s.markdown);

  // Restore on mount
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || loadingDocs || docs.length === 0) return;
    restoredRef.current = true;
    if (store.selectedDocId) {
      const doc = docs.find(d => d.id === store.selectedDocId);
      if (doc) loadReportList(doc.id);
      else store.setSelectedDoc(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingDocs, docs]);

  const groups = groupByPeriod(docs);
  const periods = (["Today", "This week", "This month", "Earlier"] as const).filter(p => groups[p].length > 0);
  const reportsByDoc = (docId: string) => store.reportList.filter(r => r.doc_id === docId).length;

  // Selected template object
  const tpl = TEMPLATES.find(t => t.id === store.template) ?? TEMPLATES[0];

  return (
    <div className="flex flex-1 min-h-0">
      {/* ═══ FILINGS PANEL (left) ═══════════════════════════════════════ */}
      <aside
        className="shrink-0 flex flex-col border-r"
        style={{
          width: 280, height: "100%",
          background: "var(--al-bg-soft)",
          borderColor: "var(--al-border)",
        }}
      >
        <div style={{
          padding: "20px 18px 16px",
          borderBottom: "1px solid var(--al-border)",
          background: "linear-gradient(180deg, var(--al-bg-soft) 0%, rgba(5,150,105,0.025) 100%)",
        }}>
          <h2 style={{
            fontSize: 11, fontWeight: 700,
            letterSpacing: "0.10em", textTransform: "uppercase",
            color: "var(--al-subtle)", marginBottom: 4,
          }}>
            Filings · Reports
          </h2>
          <p style={{
            fontSize: 13, color: "var(--al-text)", fontWeight: 500,
            letterSpacing: "-0.005em", fontVariantNumeric: "tabular-nums",
          }}>
            {docs.length} {docs.length === 1 ? "document ready" : "documents ready"}
          </p>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "10px 0 16px" }}>
          {loadingDocs && (
            <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
              <div
                style={{
                  width: 18, height: 18, borderRadius: "50%",
                  border: "2px solid var(--al-accent-light)",
                  borderTopColor: "var(--al-accent)",
                  animation: "spin 0.7s linear infinite",
                }}
              />
            </div>
          )}

          {!loadingDocs && docs.length === 0 && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "48px 24px", gap: 14, textAlign: "center",
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: 14,
                background: "linear-gradient(135deg, rgba(5,150,105,0.10), rgba(16,185,129,0.06))",
                border: "1px solid rgba(5,150,105,0.18)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--al-accent)",
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <rect x="4" y="4" width="16" height="16"/>
                  <line x1="4" y1="9"  x2="20" y2="9"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--al-text)", marginBottom: 4 }}>
                  No completed documents
                </div>
                <div style={{ fontSize: 12, color: "var(--al-subtle)", lineHeight: 1.5, maxWidth: 200 }}>
                  Process a document in the Analyzer to start commissioning reports.
                </div>
              </div>
            </div>
          )}

          {!loadingDocs && periods.map((period, pIdx) => (
            <div key={period} style={{ marginBottom: pIdx < periods.length - 1 ? 8 : 0 }}>
              <div style={{
                padding: "10px 18px 6px",
                fontSize: 10, fontWeight: 600,
                letterSpacing: "0.10em", textTransform: "uppercase",
                color: "var(--al-subtle)", opacity: 0.85,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                {period}
                <span aria-hidden style={{ flex: 1, height: 1, background: "linear-gradient(90deg, rgba(0,0,0,0.06), transparent)" }} />
                <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>
                  {groups[period].length}
                </span>
              </div>

              {groups[period].map(doc => {
                const active = store.selectedDocId === doc.id;
                const reportCount = reportsByDoc(doc.id);
                return (
                  <div
                    key={doc.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectDoc(doc)}
                    onKeyDown={e => e.key === "Enter" && selectDoc(doc)}
                    style={{
                      padding: "11px 14px",
                      cursor: "pointer",
                      display: "flex", alignItems: "flex-start", gap: 10,
                      background: active ? "rgba(5,150,105,0.06)" : "transparent",
                      borderLeft: `2px solid ${active ? "var(--al-accent)" : "transparent"}`,
                      transition: "background 150ms ease",
                    }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.025)"; }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <FileGlyph filename={doc.filename} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: active ? 600 : 500,
                        color: active ? "var(--al-accent)" : "var(--al-text)",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        marginBottom: 4, letterSpacing: "-0.005em",
                      }}>{doc.filename}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--al-subtle)" }}>
                        {reportCount > 0 ? (
                          <span style={{ color: "var(--al-accent)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                            {reportCount} {reportCount === 1 ? "report" : "reports"}
                          </span>
                        ) : (
                          <span>—</span>
                        )}
                        {doc.upload_time && (
                          <>
                            <span style={{ opacity: 0.5 }}>·</span>
                            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.02em" }}>
                              {new Date(doc.upload_time).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* ═══ COMPOSER (right) ═══════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {!selectedDoc ? (
          // ─── Empty: no doc selected ───────────────────────────────────
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            padding: "32px", textAlign: "center", gap: 16,
          }}>
            <div style={{
              width: 80, height: 80, borderRadius: 20,
              background: "linear-gradient(135deg, rgba(5,150,105,0.10), rgba(16,185,129,0.06))",
              border: "1px solid rgba(5,150,105,0.18)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--al-accent)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
            }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8" fill="none"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <div style={{
              fontWeight: 800,
              fontSize: 32, color: "var(--al-text)",
              letterSpacing: "-0.03em", lineHeight: 1.1,
            }}>
              Select a <span className="landing-gradient-text">document</span>
            </div>
            <p style={{
              fontSize: 14, color: "var(--al-subtle)",
              maxWidth: 360, lineHeight: 1.6,
            }}>
              Choose a processed document from the left, then commission an AI-written analyst report — Full Analysis, Executive Brief, Risk Report, or Investor Memo.
            </p>
          </div>
        ) : !hasReport && !store.generating ? (
          // ─── Selected: masthead + templates + generate + filed ────────
          <div style={{ flex: 1, overflowY: "auto" }}>
            <div style={{ maxWidth: 1080, margin: "0 auto", padding: "40px clamp(24px, 4vw, 56px) 64px" }}>

              {/* ── Masthead ───────────────────────────────────────────── */}
              <div style={{
                position: "relative",
                background: "var(--al-card)",
                border: "1px solid var(--al-border)",
                borderRadius: 18,
                padding: "28px 32px 24px",
                marginBottom: 48,
                boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
              }}>

                {/* Eyebrow */}
                <div style={{
                  fontFamily: MONO, fontSize: 11,
                  letterSpacing: "0.10em", textTransform: "uppercase",
                  color: "var(--al-subtle)", marginBottom: 14,
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  <span style={{ color: "var(--al-accent)", fontWeight: 600 }}>§ Selected</span>
                  <span aria-hidden style={{ width: 16, height: 1, background: "var(--al-border)" }} />
                  <span style={{ color: "var(--al-text)", fontWeight: 500, fontFamily: "inherit" }}>
                    {selectedDoc.filename}
                  </span>
                </div>

                {/* Title */}
                <h1 style={{
                  fontWeight: 800,
                  fontSize: "clamp(22px, 2.6vw, 32px)", lineHeight: 1.1,
                  letterSpacing: "-0.03em", color: "var(--al-text)",
                  marginBottom: 18,
                }}>
                  {selectedDoc.metadata?.company_name ?? "Document"}
                  {selectedDoc.metadata?.fiscal_year && (
                    <>
                      <span style={{ color: "var(--al-subtle)", margin: "0 12px", fontWeight: 400 }}>·</span>
                      Annual Report{" "}
                      <span className="landing-gradient-text">
                        FY {selectedDoc.metadata.fiscal_year}
                      </span>
                    </>
                  )}
                </h1>

                {/* Meta grid */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: 20,
                  paddingTop: 18,
                  borderTop: "1px dashed var(--al-border)",
                }}>
                  {[
                    { l: "Fiscal Year", v: selectedDoc.metadata?.fiscal_year ? `FY ${selectedDoc.metadata.fiscal_year}` : "—" },
                    { l: "Currency",    v: selectedDoc.metadata?.currency ?? "—" },
                    { l: "Type",        v: selectedDoc.metadata?.doc_type?.replace(/_/g, " ") ?? "—" },
                    { l: "Pages",       v: selectedDoc.metadata?.page_count ? `${selectedDoc.metadata.page_count} pages` : "—" },
                    { l: "Status",      v: "Ready", green: true },
                  ].map(m => (
                    <div key={m.l}>
                      <div style={{
                        fontFamily: MONO, fontSize: 10,
                        letterSpacing: "0.08em", textTransform: "uppercase",
                        color: "var(--al-subtle)", marginBottom: 5,
                      }}>{m.l}</div>
                      <div style={{
                        fontSize: 15, fontWeight: 600,
                        color: m.green ? "var(--al-accent)" : "var(--al-text)",
                        letterSpacing: "-0.01em",
                        textTransform: m.l === "Type" ? "capitalize" : undefined,
                        display: "inline-flex", alignItems: "center", gap: 6,
                      }}>
                        {m.green && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--al-accent)" }} />}
                        {m.v}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Section heading ────────────────────────────────────── */}
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                paddingBottom: 16, borderBottom: "1px solid rgba(0,0,0,0.10)",
                marginBottom: 24,
              }}>
                <h2 style={{
                  fontWeight: 800,
                  fontSize: "clamp(22px, 2.4vw, 28px)", lineHeight: 1.1, letterSpacing: "-0.028em",
                }}>
                  Choose a <span className="landing-gradient-text">template</span>
                </h2>
                <span style={{
                  fontFamily: MONO, fontSize: 11, fontWeight: 600,
                  letterSpacing: "0.10em", textTransform: "uppercase",
                  color: "var(--al-subtle)",
                }}>
                  § 4 templates
                </span>
              </div>

              {/* ── Template grid ──────────────────────────────────────── */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 14,
                marginBottom: 32,
              }} className="templates-grid">
                {TEMPLATES.map(t => {
                  const sel = store.template === t.id;
                  return (
                    <article
                      key={t.id}
                      onClick={() => store.setTemplate(t.id)}
                      style={{
                        background: sel
                          ? `linear-gradient(180deg, var(--al-card) 0%, ${t.soft} 100%)`
                          : "var(--al-card)",
                        border: sel ? `2px solid ${t.color}` : "1px solid var(--al-border)",
                        borderRadius: 18,
                        padding: sel ? "23px 23px 20px" : "24px 24px 21px",
                        cursor: "pointer",
                        transition: "all 220ms cubic-bezier(0.4,0,0.2,1)",
                        position: "relative",
                        display: "grid",
                        gridTemplateColumns: "52px 1fr",
                        gap: 20,
                        boxShadow: sel ? `0 8px 24px -8px rgba(${t.glow},0.18)` : "0 1px 2px rgba(15,23,42,0.04)",
                      }}
                      onMouseEnter={e => {
                        if (!sel) {
                          (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,0,0,0.18)";
                          (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
                          (e.currentTarget as HTMLElement).style.boxShadow = "0 24px 48px -16px rgba(0,0,0,0.10)";
                        }
                      }}
                      onMouseLeave={e => {
                        if (!sel) {
                          (e.currentTarget as HTMLElement).style.borderColor = "var(--al-border)";
                          (e.currentTarget as HTMLElement).style.transform = "none";
                          (e.currentTarget as HTMLElement).style.boxShadow = "none";
                        }
                      }}
                    >
                      {/* Icon */}
                      <div style={{
                        width: 52, height: 52,
                        background: sel ? t.color : t.soft,
                        color: sel ? "#fff" : t.color,
                        borderRadius: 12,
                        border: `1px solid rgba(${t.glow},${sel ? "0" : "0.20"})`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 220ms ease",
                        boxShadow: sel ? `0 4px 12px -2px rgba(${t.glow},0.4), inset 0 1px 0 rgba(255,255,255,0.25)` : "none",
                      }}>
                        {t.icon}
                      </div>

                      <div>
                        <div style={{
                          fontFamily: MONO, fontSize: 10, fontWeight: 600,
                          letterSpacing: "0.10em", textTransform: "uppercase",
                          color: "var(--al-subtle)", marginBottom: 6,
                        }}>{t.n} · {t.sub}</div>

                        <h3 style={{
                          fontWeight: 800,
                          fontSize: 19, lineHeight: 1.15, letterSpacing: "-0.025em",
                          color: "var(--al-text)", marginBottom: 8,
                        }}>
                          {t.title}{" "}
                          <span style={{ color: t.color }}>{t.titleEm}</span>
                        </h3>

                        <p style={{
                          fontWeight: 400,
                          fontSize: 13.5, lineHeight: 1.55,
                          color: "var(--al-text-secondary)",
                          paddingBottom: 12, marginBottom: 6,
                          borderBottom: "1px dashed var(--al-border)",
                        }}>{t.desc}</p>

                        <div style={{
                          display: "flex", gap: 14,
                          fontFamily: MONO, fontSize: 11,
                          letterSpacing: "0.04em",
                          color: "var(--al-subtle)",
                          marginBottom: 10,
                        }}>
                          <span><b style={{ color: t.color, fontWeight: 600 }}>{t.sections}</b> sections</span>
                          <span><b style={{ color: t.color, fontWeight: 600 }}>{t.words}</b> words</span>
                          <span>{t.mins}</span>
                        </div>

                        {/* Section preview chips */}
                        <div style={{
                          display: "flex", flexWrap: "wrap", gap: 5,
                          paddingTop: 8,
                        }}>
                          {t.chips.map(c => (
                            <span key={c} style={{
                              fontSize: 11, fontWeight: 500,
                              letterSpacing: "-0.005em",
                              padding: "3px 9px",
                              background: sel ? t.soft : "var(--al-bg-soft)",
                              color: sel ? t.color : "var(--al-text-secondary)",
                              border: `1px solid ${sel ? `rgba(${t.glow},0.18)` : "var(--al-border)"}`,
                              borderRadius: 6,
                            }}>{c}</span>
                          ))}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* ── Generate row ───────────────────────────────────────── */}
              <div style={{
                background: "var(--al-bg-soft)",
                border: "1px solid var(--al-border)",
                borderRadius: 16,
                padding: "20px 28px",
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 24,
                alignItems: "center",
                marginBottom: store.reportList.length > 0 ? 56 : 0,
                boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
              }} className="generate-row">
                <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
                  <span style={{
                    fontFamily: MONO, fontSize: 11, fontWeight: 600,
                    letterSpacing: "0.10em", textTransform: "uppercase",
                    color: "var(--al-subtle)",
                  }}>Selected:</span>
                  <span style={{
                    fontSize: 17, fontWeight: 700,
                    color: "var(--al-text)", letterSpacing: "-0.015em",
                  }}>
                    {tpl.title}{" "}
                    <span style={{ color: tpl.color }}>{tpl.titleEm}</span>
                  </span>
                  <span style={{
                    fontFamily: MONO, fontSize: 11,
                    color: "var(--al-subtle)", letterSpacing: "0.04em",
                  }}>
                    {tpl.sections} sections · {tpl.words} words · {tpl.mins} · GPT-4o
                  </span>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={store.generating}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 10,
                    padding: "13px 24px",
                    background: store.generating ? "var(--al-bg-secondary)" : "var(--al-text)",
                    color: store.generating ? "var(--al-subtle)" : "var(--al-card)",
                    border: `1px solid ${store.generating ? "var(--al-border)" : "var(--al-text)"}`,
                    borderRadius: 12,
                    fontFamily: "inherit",
                    fontSize: 13.5, fontWeight: 600,
                    cursor: store.generating ? "not-allowed" : "pointer",
                    transition: "all 180ms ease",
                  }}
                  onMouseEnter={e => {
                    if (!store.generating) {
                      (e.currentTarget as HTMLElement).style.background = "var(--al-accent)";
                      (e.currentTarget as HTMLElement).style.borderColor = "var(--al-accent)";
                      (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
                      (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px -8px rgba(5,150,105,0.4)";
                    }
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = store.generating ? "var(--al-bg-secondary)" : "var(--al-text)";
                    (e.currentTarget as HTMLElement).style.borderColor = store.generating ? "var(--al-border)" : "var(--al-text)";
                    (e.currentTarget as HTMLElement).style.transform = "none";
                    (e.currentTarget as HTMLElement).style.boxShadow = "none";
                  }}
                >
                  Generate report
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M3 13L13 3M13 3H6M13 3v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
                  </svg>
                </button>
              </div>

              {/* ── Filed reports list ─────────────────────────────────── */}
              {store.reportList.length > 0 && (
                <div style={{ borderTop: "1px solid var(--al-border)", paddingTop: 28 }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    marginBottom: 18,
                  }}>
                    <h3 style={{
                      fontWeight: 800,
                      fontSize: 22, letterSpacing: "-0.025em",
                      color: "var(--al-text)",
                    }}>Reports filed</h3>
                    <span style={{
                      fontFamily: MONO, fontSize: 11,
                      letterSpacing: "0.08em", textTransform: "uppercase",
                      color: "var(--al-subtle)",
                    }}>
                      § {store.reportList.length} prior {store.reportList.length === 1 ? "commission" : "commissions"}
                    </span>
                  </div>

                  <div style={{ borderTop: "1px solid var(--al-border)" }}>
                    {store.reportList.map(r => {
                      const t = TEMPLATES.find(x => x.id === r.template);
                      return (
                        <div
                          key={r.id}
                          onClick={() => loadFullReport(r.id)}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 120px 100px 100px 24px",
                            gap: 20, padding: "14px 0",
                            borderBottom: "1px solid var(--al-border-light)",
                            alignItems: "center",
                            fontSize: 13.5, cursor: "pointer",
                            transition: "background 150ms ease, padding-left 150ms ease",
                          }}
                          onMouseEnter={e => {
                            (e.currentTarget as HTMLElement).style.background = "var(--al-bg-soft)";
                            (e.currentTarget as HTMLElement).style.paddingLeft = "12px";
                          }}
                          onMouseLeave={e => {
                            (e.currentTarget as HTMLElement).style.background = "transparent";
                            (e.currentTarget as HTMLElement).style.paddingLeft = "0";
                          }}
                        >
                          <div style={{
                            fontWeight: 600, fontSize: 14.5,
                            color: "var(--al-text)",
                            letterSpacing: "-0.01em",
                          }}>
                            {t ? <>{t.title} <span style={{ color: t.color }}>{t.titleEm}</span></> : r.template}
                            <span style={{ color: "var(--al-subtle)", fontWeight: 400, marginLeft: 8 }}>{t?.n}</span>
                          </div>
                          <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--al-subtle)", letterSpacing: "0.04em" }}>
                            <b style={{ color: "var(--al-text)", fontWeight: 600 }}>{r.word_count.toLocaleString()}</b> words
                          </div>
                          <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--al-subtle)", letterSpacing: "0.04em" }}>
                            {r.created_at ? new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                          </div>
                          <div style={{
                            fontFamily: MONO, fontSize: 11,
                            letterSpacing: "0.04em", textTransform: "uppercase",
                            color: "var(--al-accent)",
                            display: "flex", alignItems: "center", gap: 6,
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--al-accent)" }} />
                            {r.status}
                          </div>
                          <div style={{ color: "var(--al-subtle)", textAlign: "right" }}>→</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          </div>
        ) : (
          // ─── Generating or complete: existing report viewer (unchanged)
          <>
            <ReportToolbar
              filename={selectedDoc.filename}
              template={store.template}
              generating={store.generating}
              sections={store.sections}
              wordCount={totalWords}
              onCopy={handleCopy}
              onPrint={handlePrint}
              onRegenerate={handleGenerate}
            />
            <div className="flex flex-1 min-h-0">
              <SectionTOC
                sections={store.sections}
                sectionOrder={sectionOrder.current}
                activeSection={activeSection}
                onJump={jumpToSection}
                wordCount={totalWords}
                generatedAt={store.reportList.find(r => r.id === store.activeReportId)?.created_at}
              />
              <div ref={reportBodyRef} className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-8 py-6">
                  {sectionOrder.current.map((sid, i) => {
                    const sec = store.sections[sid];
                    if (!sec) return null;
                    return (
                      <SectionCard
                        key={sid}
                        section={sec}
                        index={i + 1}
                        reportId={store.activeReportId ?? undefined}
                        streaming={store.generating}
                        onRegenerate={store.activeReportId ? () => handleRegenerateSection(sid) : undefined}
                        onRestored={(sectionId, content, wordCount) => {
                          // Roll the live section content back to the
                          // restored version in-place; matches what the
                          // backend just wrote to reports.sections.
                          store.updateSection(sectionId, {
                            status:    "done",
                            markdown:  content,
                            wordCount,
                            error:     undefined,
                          });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 880px) {
          .templates-grid { grid-template-columns: 1fr !important; }
          .generate-row   { grid-template-columns: 1fr !important; gap: 14px !important; }
        }
      `}</style>
    </div>
  );
}

// ── Section title helper ──────────────────────────────────────────────────────
function sectionTitle(id: string): string {
  const map: Record<string, string> = {
    executive_summary: "Executive Summary",
    financial_performance: "Financial Performance",
    balance_sheet_liquidity: "Balance Sheet & Liquidity",
    cash_flow: "Cash Flow Analysis",
    ratios_metrics: "Key Ratios & Metrics",
    red_flags_risks: "Red Flags & Risks",
    analyst_conclusion: "Analyst Conclusion",
  };
  return map[id] ?? id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
