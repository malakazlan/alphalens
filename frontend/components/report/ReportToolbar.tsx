"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import type { SectionState } from "@/lib/stores/report-store";

const TEMPLATE_LABELS: Record<string, string> = {
  full_analysis: "Full Analysis",
  executive_brief: "Executive Brief",
  risk_report: "Risk Report",
  investor_memo: "Investor Memo",
};

// PDF render lifecycle on the server: idle → queued → rendering → ready | error.
// We mirror that exactly so the button copy reflects the real state.
type PdfStatus = "idle" | "queued" | "rendering" | "ready" | "error";

interface ReportToolbarProps {
  filename: string;
  template: string;
  reportId?: string | null;
  generating: boolean;
  sections: Record<string, SectionState>;
  wordCount: number;
  onCopy: () => void;
  onPrint: () => void;
  onRegenerate: () => void;
}

export default function ReportToolbar({
  filename,
  template,
  reportId,
  generating,
  sections,
  wordCount,
  onCopy,
  onPrint,
  onRegenerate,
}: ReportToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // ── PDF export state ────────────────────────────────────────────────────────
  // Polling runs while pdfStatus is queued|rendering. We also do a one-shot
  // status fetch when the dropdown opens so a stale 'ready' (e.g. user
  // rendered yesterday) shows up without a fresh click.
  const [pdfStatus, setPdfStatus]   = useState<PdfStatus>("idle");
  const [pdfError,  setPdfError]    = useState<string | null>(null);
  const pdfPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPdfPoll = useCallback(() => {
    if (pdfPollRef.current) {
      clearInterval(pdfPollRef.current);
      pdfPollRef.current = null;
    }
  }, []);

  const fetchPdfStatus = useCallback(async () => {
    if (!reportId) return;
    try {
      const res  = await fetch(`/api/reports/${reportId}/pdf-status`, { credentials: "include" });
      const data = await res.json();
      if (data.success) {
        const s = (data.status as PdfStatus) ?? "idle";
        setPdfStatus(s);
        setPdfError(s === "error" ? (data.message ?? "Render failed") : null);
        if (s === "ready" || s === "error" || s === "idle") stopPdfPoll();
      }
    } catch {}
  }, [reportId, stopPdfPoll]);

  // Refresh status when dropdown opens so the user sees the real state.
  useEffect(() => {
    if (exportOpen && reportId) fetchPdfStatus();
  }, [exportOpen, reportId, fetchPdfStatus]);

  // Stop polling when unmounting (e.g. switching docs/reports).
  useEffect(() => () => stopPdfPoll(), [stopPdfPoll]);

  async function handleRenderPdf() {
    if (!reportId) return;
    setPdfError(null);
    setPdfStatus("queued");
    try {
      const res  = await fetch(`/api/reports/${reportId}/render-pdf`, {
        method: "POST", credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setPdfStatus("error");
        setPdfError(data.detail ?? data.error ?? "Render request failed");
        return;
      }
      // Begin polling.
      stopPdfPoll();
      pdfPollRef.current = setInterval(fetchPdfStatus, 2000);
    } catch {
      setPdfStatus("error");
      setPdfError("Network error. Please retry.");
    }
  }

  async function handleDownloadPdf() {
    if (!reportId) return;
    try {
      const res  = await fetch(`/api/reports/${reportId}/pdf-url`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok || !data.success || !data.url) {
        setPdfError(data.detail ?? "Download URL unavailable");
        return;
      }
      // Use a real anchor so the browser respects the Content-Disposition
      // from Supabase Storage (signed URL serves with proper headers).
      const a = document.createElement("a");
      a.href     = data.url;
      a.download = `${filename.replace(/\.[^.]+$/, "")}_report.pdf`;
      a.rel      = "noopener";
      a.target   = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setExportOpen(false);
    } catch {
      setPdfError("Download failed. Please retry.");
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const vals          = Object.values(sections);
  const doneCount     = vals.filter((s) => s.status === "done").length;
  const runningCount  = vals.filter((s) => s.status === "generating").length;
  const errorCount    = vals.filter((s) => s.status === "error").length;
  const totalCount    = vals.length;
  const allDone       = doneCount === totalCount && totalCount > 0;
  // Coarse progress percentage. Counts a running section as half-done so
  // the bar advances visibly during parallel generation (the user sees
  // movement, not a static jump from 0% to 100%).
  const progressPct = totalCount === 0 ? 0
    : Math.min(100, Math.round(((doneCount + runningCount * 0.5) / totalCount) * 100));

  function handleCopy() {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setExportOpen(false);
  }

  function handlePrint() {
    onPrint();
    setExportOpen(false);
  }

  function handleDownloadMD() {
    const md = Object.values(sections)
      .filter((s) => s.status === "done")
      .map((s) => s.markdown)
      .join("\n\n---\n\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename.replace(/\.[^.]+$/, "")}_report.md`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  }

  return (
    <div
      className="flex items-center justify-between px-4 py-2.5 border-b shrink-0"
      style={{ background: "var(--al-bg-soft)", borderColor: "var(--al-border)" }}
    >
      {/* Left: status */}
      <div className="flex items-center gap-3 min-w-0">
        {generating && (
          <div
            className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin shrink-0"
            style={{ borderColor: "var(--al-accent-light)", borderTopColor: "var(--al-accent)" }}
          />
        )}
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
          style={{
            background: "var(--al-accent-soft)",
            color: "var(--al-accent)",
          }}
        >
          {TEMPLATE_LABELS[template] ?? template}
        </span>
        <span
          className="text-sm font-semibold truncate"
          style={{ color: "var(--al-text)" }}
        >
          {filename}
        </span>
        {generating && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] tabular-nums" style={{ color: "var(--al-subtle)" }}>
              {doneCount}/{totalCount} done
              {runningCount > 0 && (
                <span className="ml-1" style={{ color: "var(--al-accent)" }}>
                  · {runningCount} running
                </span>
              )}
              {errorCount > 0 && (
                <span className="ml-1" style={{ color: "#dc2626" }}>
                  · {errorCount} failed
                </span>
              )}
            </span>
            <div
              className="w-24 h-1 rounded-full overflow-hidden"
              style={{ background: "var(--al-border)" }}
              aria-label={`Progress: ${progressPct}%`}
            >
              <div
                className="h-full transition-all duration-500"
                style={{
                  width:      `${progressPct}%`,
                  background: "linear-gradient(90deg, var(--al-accent), #10b981)",
                }}
              />
            </div>
          </div>
        )}
        {allDone && wordCount > 0 && (
          <span className="text-[11px] shrink-0" style={{ color: "var(--al-subtle)" }}>
            {wordCount.toLocaleString()} words
          </span>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Export dropdown */}
        {allDone && (
          <div ref={exportRef} className="relative">
            <button
              onClick={() => setExportOpen((v) => !v)}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
              style={{ color: "var(--al-accent)", background: "var(--al-accent-soft)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {exportOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 py-1 rounded-xl border shadow-lg"
                style={{
                  background: "var(--al-card)",
                  borderColor: "var(--al-border)",
                  minWidth: 200,
                }}
              >
                {/* PDF export — only enabled when we know the report id */}
                {reportId && (
                  <>
                    {pdfStatus === "ready" ? (
                      <button
                        onClick={handleDownloadPdf}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-[rgba(0,0,0,0.03)]"
                        style={{ color: "var(--al-accent)", fontWeight: 600 }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                          <polyline points="14 2 14 8 20 8" fill="none"/>
                          <line x1="12" y1="13" x2="12" y2="19"/>
                          <polyline points="9 16 12 19 15 16"/>
                        </svg>
                        Download PDF
                      </button>
                    ) : (
                      <button
                        onClick={handleRenderPdf}
                        disabled={pdfStatus === "queued" || pdfStatus === "rendering"}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-[rgba(0,0,0,0.03)] disabled:opacity-60 disabled:cursor-not-allowed"
                        style={{ color: "var(--al-text)" }}
                      >
                        {pdfStatus === "queued" || pdfStatus === "rendering" ? (
                          <span
                            className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin shrink-0"
                            style={{ borderColor: "var(--al-accent-light)", borderTopColor: "var(--al-accent)" }}
                          />
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                            <polyline points="14 2 14 8 20 8" fill="none"/>
                          </svg>
                        )}
                        {pdfStatus === "queued"    ? "Queued…"
                          : pdfStatus === "rendering" ? "Rendering…"
                          : pdfStatus === "error"    ? "Retry PDF render"
                          :                             "Export as PDF"}
                      </button>
                    )}
                    {pdfError && (
                      <div className="px-3 py-1.5 text-[10px]" style={{ color: "#dc2626" }}>
                        {pdfError}
                      </div>
                    )}
                    <div className="my-1 mx-2 h-px" style={{ background: "var(--al-border)" }} />
                  </>
                )}
                <button
                  onClick={handleCopy}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-[rgba(0,0,0,0.03)]"
                  style={{ color: "var(--al-text)" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  {copied ? "Copied!" : "Copy Markdown"}
                </button>
                <button
                  onClick={handleDownloadMD}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-[rgba(0,0,0,0.03)]"
                  style={{ color: "var(--al-text)" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download .md
                </button>
                <button
                  onClick={handlePrint}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-[rgba(0,0,0,0.03)]"
                  style={{ color: "var(--al-text)" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 6 2 18 2 18 9" />
                    <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
                    <rect x="6" y="14" width="12" height="8" />
                  </svg>
                  Print
                </button>
              </div>
            )}
          </div>
        )}

        {/* Regenerate */}
        <button
          onClick={onRegenerate}
          disabled={generating}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
          style={{
            background: generating ? "var(--al-bg-secondary)" : "var(--al-accent)",
            color: generating ? "var(--al-subtle)" : "#fff",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
          {generating ? "Generating…" : "Regenerate"}
        </button>
      </div>
    </div>
  );
}
