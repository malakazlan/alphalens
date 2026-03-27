"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useReportStore } from "@/lib/stores/report-store";
import type { ReportTemplate, SectionState } from "@/lib/stores/report-store";
import TemplateSelector from "@/components/report/TemplateSelector";
import SectionTOC from "@/components/report/SectionTOC";
import SectionCard from "@/components/report/SectionCard";
import ReportToolbar from "@/components/report/ReportToolbar";

interface Doc {
  id: string;
  filename: string;
  status: string;
  upload_time: string;
}

export default function ReportPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);

  const store = useReportStore();
  const abortRef = useRef<AbortController | null>(null);
  const reportBodyRef = useRef<HTMLDivElement>(null);

  // Active section for scrollspy
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const sectionOrder = useRef<string[]>([]);

  // ── Fetch docs ─────────────────────────────────────────────────────
  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/documents", { credentials: "include" });
      const data = await res.json();
      if (data.success)
        setDocs(data.documents.filter((d: Doc) => d.status === "complete"));
    } catch {}
    setLoadingDocs(false);
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // ── Select document ────────────────────────────────────────────────
  const selectedDoc = docs.find((d) => d.id === store.selectedDocId) ?? null;

  function selectDoc(doc: Doc) {
    if (store.selectedDocId === doc.id) return;
    abortRef.current?.abort();
    store.setSelectedDoc(doc.id);
    store.setGenerating(false);
    store.setSections({});
    store.setActiveReport(null);
    // Check if existing report exists
    loadReportList(doc.id);
  }

  // ── Load report list for a document ────────────────────────────────
  async function loadReportList(docId: string) {
    try {
      const res = await fetch(`/api/documents/${docId}/reports`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) {
        store.setReportList(data.reports ?? []);
        // Auto-load the most recent complete report
        const latest = (data.reports ?? []).find(
          (r: any) => r.status === "complete"
        );
        if (latest) {
          loadFullReport(latest.id);
        }
      }
    } catch {}
  }

  // ── Load a full report from DB ─────────────────────────────────────
  async function loadFullReport(reportId: string) {
    try {
      const res = await fetch(`/api/reports/${reportId}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data.success && data.report) {
        const report = data.report;
        store.setActiveReport(report.id);

        // Convert sections JSONB to SectionState records
        const secs: Record<string, SectionState> = {};
        const order: string[] = [];
        for (const [sid, val] of Object.entries(report.sections ?? {})) {
          const s = val as any;
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

  // ── Generate report (section-by-section SSE) ───────────────────────
  async function handleGenerate() {
    if (!store.selectedDocId || store.generating) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    store.setGenerating(true);
    store.setSections({});
    store.setActiveReport(null);

    try {
      const res = await fetch(
        `/api/documents/${store.selectedDocId}/report`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template: store.template }),
          signal: abortRef.current.signal,
        }
      );

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
          try {
            const event = JSON.parse(line.slice(6));
            handleSSE(event);
          } catch {}
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        console.error("Report generation error:", e);
      }
    }

    store.setGenerating(false);
    store.setGeneratingSection(null);

    // Reload report list
    if (store.selectedDocId) {
      loadReportList(store.selectedDocId);
    }
  }

  function handleSSE(event: any) {
    switch (event.type) {
      case "report_start":
        sectionOrder.current = event.sections ?? [];
        // Initialize all sections as pending
        const initial: Record<string, SectionState> = {};
        for (const sid of event.sections ?? []) {
          initial[sid] = {
            id: sid,
            title: sectionTitle(sid),
            markdown: "",
            status: "pending",
          };
        }
        store.setSections(initial);
        break;

      case "section_start":
        store.updateSection(event.section, {
          status: "generating",
          title: event.title ?? sectionTitle(event.section),
        });
        store.setGeneratingSection(event.section);
        setActiveSection(event.section);
        break;

      case "delta":
        store.appendSectionText(event.section, event.text);
        break;

      case "section_done":
        store.updateSection(event.section, {
          status: "done",
          wordCount: event.word_count,
        });
        store.setGeneratingSection(null);
        break;

      case "section_error":
        store.updateSection(event.section, {
          status: "error",
          error: event.error,
        });
        store.setGeneratingSection(null);
        break;

      case "report_done":
        store.setActiveReport(event.report_id);
        break;
    }
  }

  // ── Regenerate single section ──────────────────────────────────────
  async function handleRegenerateSection(sectionId: string) {
    if (!store.activeReportId || store.generating) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    store.setGenerating(true);
    store.updateSection(sectionId, { status: "generating", markdown: "", error: undefined });
    store.setGeneratingSection(sectionId);

    try {
      const res = await fetch(
        `/api/reports/${store.activeReportId}/regenerate-section`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: sectionId }),
          signal: abortRef.current.signal,
        }
      );

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
          try {
            const event = JSON.parse(line.slice(6));
            handleSSE(event);
          } catch {}
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        store.updateSection(sectionId, {
          status: "error",
          error: "Failed to regenerate section.",
        });
      }
    }

    store.setGenerating(false);
    store.setGeneratingSection(null);
  }

  // ── Copy all markdown ──────────────────────────────────────────────
  function handleCopy() {
    const md = Object.values(store.sections)
      .filter((s) => s.status === "done")
      .map((s) => s.markdown)
      .join("\n\n---\n\n");
    navigator.clipboard.writeText(md);
  }

  // ── Print ──────────────────────────────────────────────────────────
  function handlePrint() {
    const md = Object.values(store.sections)
      .filter((s) => s.status === "done")
      .map((s) => s.markdown)
      .join("\n\n---\n\n");

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>${selectedDoc?.filename ?? "Report"}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
               max-width: 800px; margin: 40px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.7; font-size: 13px; }
        h2 { color: #059669; border-left: 4px solid #059669; padding-left: 12px; margin-top: 2rem; font-size: 16px; }
        h3 { color: #1a1a1a; margin-top: 1.5rem; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 12px; }
        th { background: #059669; color: white; padding: 8px 12px; text-align: left; }
        td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
        tr:nth-child(even) { background: #f8fafc; }
        li { margin-bottom: 4px; }
        hr { border: none; border-top: 1px solid #e2e8f0; margin: 2rem 0; }
        @media print { body { margin: 15mm; } }
      </style></head><body>
      <h1 style="color:#059669;font-size:20px">${selectedDoc?.filename ?? "Financial Report"}</h1>
      <pre style="white-space:pre-wrap;font-family:inherit">${md.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
      </body></html>
    `);
    win.document.close();
    win.print();
  }

  // ── Jump to section ────────────────────────────────────────────────
  function jumpToSection(sectionId: string) {
    const el = document.getElementById(`section-${sectionId}`);
    if (el && reportBodyRef.current) {
      const container = reportBodyRef.current;
      const elRect = el.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      container.scrollTop += elRect.top - cRect.top - 12;
    }
    setActiveSection(sectionId);
  }

  // ── Scrollspy ──────────────────────────────────────────────────────
  useEffect(() => {
    const container = reportBodyRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id.replace("section-", "");
            setActiveSection(id);
          }
        }
      },
      { root: container, rootMargin: "-10% 0px -60% 0px", threshold: 0.1 }
    );

    const els = container.querySelectorAll("[id^=section-]");
    els.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [store.sections]);

  // ── Word count ─────────────────────────────────────────────────────
  const totalWords = Object.values(store.sections).reduce(
    (sum, s) => sum + (s.wordCount ?? 0),
    0
  );

  // ── Has any content to show ────────────────────────────────────────
  const hasReport =
    Object.keys(store.sections).length > 0 &&
    Object.values(store.sections).some(
      (s) => s.status !== "pending" || s.markdown
    );

  // ── Restore on mount ──────────────────────────────────────────────
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || loadingDocs || docs.length === 0) return;
    restoredRef.current = true;

    if (store.selectedDocId) {
      const doc = docs.find((d) => d.id === store.selectedDocId);
      if (doc) {
        loadReportList(doc.id);
      } else {
        store.setSelectedDoc(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingDocs, docs]);

  return (
    <div className="flex flex-1 min-h-0">
      {/* ── Left: document list ──────────────────────────────── */}
      <div
        className="flex flex-col shrink-0 border-r overflow-hidden"
        style={{
          width: 240,
          borderColor: "var(--al-border)",
          background: "var(--al-bg)",
        }}
      >
        <div
          className="px-4 py-4 border-b shrink-0"
          style={{
            borderColor: "var(--al-border)",
            background: "var(--al-bg-soft)",
          }}
        >
          <h1 className="text-sm font-bold" style={{ color: "var(--al-text)" }}>
            Reports
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--al-subtle)" }}>
            {docs.length} document{docs.length !== 1 ? "s" : ""} ready
          </p>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-2">
          {loadingDocs && (
            <div className="flex justify-center py-8">
              <div
                className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                style={{
                  borderColor: "var(--al-accent-light)",
                  borderTopColor: "var(--al-accent)",
                }}
              />
            </div>
          )}

          {!loadingDocs && docs.length === 0 && (
            <p
              className="text-xs text-center py-8 px-4"
              style={{ color: "var(--al-subtle)" }}
            >
              No completed documents yet. Upload and process a document in the
              Analyzer.
            </p>
          )}

          {docs.map((doc) => {
            const active = store.selectedDocId === doc.id;
            return (
              <button
                key={doc.id}
                onClick={() => selectDoc(doc)}
                className="w-full text-left px-3 py-3 rounded-xl mb-1 transition-all"
                style={{
                  background: active ? "var(--al-accent-soft)" : "transparent",
                  border: `1.5px solid ${active ? "var(--al-accent)" : "transparent"}`,
                }}
              >
                <p
                  className="text-xs font-semibold truncate mb-0.5"
                  style={{
                    color: active ? "var(--al-accent)" : "var(--al-text)",
                  }}
                >
                  {doc.filename}
                </p>
                <p className="text-xs" style={{ color: "var(--al-subtle)" }}>
                  {doc.upload_time
                    ? new Date(doc.upload_time).toLocaleDateString()
                    : ""}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right: report area ───────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {!selectedDoc ? (
          /* Empty state — no doc selected */
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "var(--al-accent-soft)", color: "var(--al-accent)" }}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <p className="text-sm font-semibold" style={{ color: "var(--al-text)" }}>
              Select a document
            </p>
            <p className="text-xs max-w-xs" style={{ color: "var(--al-subtle)" }}>
              Choose a processed document from the left panel, then generate an
              AI-powered financial analysis report.
            </p>
          </div>
        ) : !hasReport && !store.generating ? (
          /* Template selector — doc selected, no report yet */
          <TemplateSelector
            selected={store.template}
            onSelect={(t) => store.setTemplate(t)}
            onGenerate={handleGenerate}
            docName={selectedDoc.filename}
            generating={store.generating}
          />
        ) : (
          /* Report viewer — generating or complete */
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
              {/* Section TOC */}
              <SectionTOC
                sections={store.sections}
                sectionOrder={sectionOrder.current}
                activeSection={activeSection}
                onJump={jumpToSection}
                wordCount={totalWords}
                generatedAt={
                  store.reportList.find((r) => r.id === store.activeReportId)
                    ?.created_at
                }
              />

              {/* Report content */}
              <div
                ref={reportBodyRef}
                className="flex-1 overflow-y-auto"
              >
                <div className="max-w-3xl mx-auto px-8 py-6">
                  {sectionOrder.current.map((sid) => {
                    const sec = store.sections[sid];
                    if (!sec) return null;
                    return (
                      <SectionCard
                        key={sid}
                        section={sec}
                        streaming={store.generating}
                        onRegenerate={
                          store.activeReportId
                            ? () => handleRegenerateSection(sid)
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Helper: section ID → display title ───────────────────────────── */
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
  return map[id] ?? id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
