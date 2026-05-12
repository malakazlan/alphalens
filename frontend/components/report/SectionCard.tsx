"use client";
import { useState } from "react";
import ReportMarkdown from "./ReportMarkdown";
import SourcesFooter from "./SourcesFooter";
import VersionHistoryModal from "./VersionHistoryModal";
import type { SectionState } from "@/lib/stores/report-store";

interface SectionCardProps {
  section:      SectionState;
  index?:       number;            // 1-based display index in the report
  reportId?:    string;             // when set, audit features (sources + history) are enabled
  onRegenerate?: () => void;
  // Called after a successful restore from VersionHistoryModal so the
  // page can update the section content in-place without a refetch.
  onRestored?:  (sectionId: string, content: string, wordCount: number) => void;
  streaming?:   boolean;            // any section currently mid-stream
}

// ── Status pill ─────────────────────────────────────────────────────────────
// Replaces the previous tiny coloured dot with a labelled pill so the user
// can see at a glance which sections are queued, running, done, or failed.
// With parallel section generation, multiple cards can be in "Generating"
// at the same time — the pill colour makes that scannable.

function StatusPill({ status }: { status: SectionState["status"] }) {
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
        style={{ background: "var(--al-bg-secondary)", color: "var(--al-subtle)" }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--al-subtle)" }} />
        Queued
      </span>
    );
  }
  if (status === "generating") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold"
        style={{ background: "var(--al-accent-soft)", color: "var(--al-accent)" }}
      >
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--al-accent)" }} />
        Generating
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
        style={{ background: "var(--al-accent-soft)", color: "var(--al-accent)" }}
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Done
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#dc2626" }} />
      Error
    </span>
  );
}

// ── Skeleton ────────────────────────────────────────────────────────────────
// Used during pending + generating-with-empty-content. Mimics the eventual
// content shape (paragraph lines + a chunkier block for a table/list) so
// the layout doesn't shift when text arrives.
function SectionSkeleton() {
  return (
    <div className="space-y-2 py-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="h-3 rounded animate-pulse"
          style={{
            background: "var(--al-border)",
            width: `${70 + Math.random() * 30}%`,
          }}
        />
      ))}
      <div className="mt-3 rounded-lg h-20 animate-pulse" style={{ background: "var(--al-border-light, var(--al-border))" }} />
    </div>
  );
}

export default function SectionCard({
  section, index, reportId, onRegenerate, onRestored, streaming,
}: SectionCardProps) {
  const isError      = section.status === "error";
  const isPending    = section.status === "pending";
  const isGenerating = section.status === "generating";
  const isDone       = section.status === "done";

  // Audit affordances appear only on settled sections of a saved report
  // (reportId comes from the page once the report row is created).
  const auditEnabled = !!reportId && (isDone || isError);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div
      id={`section-${section.id}`}
      className="report-section-enter mb-6 rounded-xl border overflow-hidden"
      style={{
        borderColor: isError ? "rgba(220,38,38,0.3)" : "var(--al-border)",
        background:  "var(--al-card)",
        boxShadow:   "var(--al-shadow-sm, 0 1px 2px rgba(0,0,0,0.04))",
      }}
    >
      {/* Section header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b group"
        style={{
          borderColor: "var(--al-border)",
          background:  "var(--al-bg-soft)",
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {typeof index === "number" && (
            <span
              className="shrink-0 inline-flex items-center justify-center text-[10px] font-bold tabular-nums"
              style={{
                width:  18,
                height: 18,
                borderRadius: 999,
                background: isDone ? "var(--al-accent)" : "var(--al-bg-secondary)",
                color:      isDone ? "#fff"             : "var(--al-subtle)",
              }}
            >
              {index}
            </span>
          )}
          <h2
            className="text-sm font-bold truncate"
            style={{ color: isError ? "#dc2626" : "var(--al-text)" }}
          >
            {section.title}
          </h2>
          <StatusPill status={section.status} />
          {isDone && typeof section.wordCount === "number" && (
            <span className="text-[10px] shrink-0" style={{ color: "var(--al-subtle)" }}>
              · {section.wordCount} words
            </span>
          )}
        </div>

        {/* Hover toolbar — Redo + History. Hidden while any section is
            streaming so the user doesn't trigger a regenerate or modal
            during fan-out. */}
        <div className="flex items-center gap-1 shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {auditEnabled && (
            <button
              onClick={() => setHistoryOpen(true)}
              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
              style={{ color: "var(--al-text-secondary)", background: "var(--al-bg-secondary)" }}
              title="View previous versions of this section"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              History
            </button>
          )}
          {onRegenerate && !streaming && !isPending && !isGenerating && (
            <button
              onClick={onRegenerate}
              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
              style={{ color: "var(--al-accent)", background: "var(--al-accent-soft)" }}
              title="Regenerate this section"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              Redo
            </button>
          )}
        </div>
      </div>

      {/* Section body */}
      <div className="px-5 py-4">
        {isPending && <SectionSkeleton />}

        {isGenerating && (
          <>
            {section.markdown ? (
              <>
                <ReportMarkdown text={section.markdown} />
                <span
                  className="inline-block w-2 h-4 rounded-sm animate-pulse ml-0.5"
                  style={{ background: "var(--al-accent)", verticalAlign: "middle" }}
                />
              </>
            ) : (
              <SectionSkeleton />
            )}
          </>
        )}

        {isDone && <ReportMarkdown text={section.markdown} />}

        {/* Sources footer — populated by silent capture in commit 3.
            Hidden until the section reaches a settled state. */}
        {reportId && (isDone || isError) && (
          <SourcesFooter
            reportId={reportId}
            sectionId={section.id}
            enabled={isDone}
          />
        )}

        {reportId && (
          <VersionHistoryModal
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            reportId={reportId}
            sectionId={section.id}
            sectionTitle={section.title}
            onRestored={({ content, word_count }) => {
              onRestored?.(section.id, content, word_count);
            }}
          />
        )}

        {isError && (
          <div className="flex flex-col items-center gap-3 py-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8"  x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-center" style={{ color: "#dc2626", maxWidth: 320 }}>
              {section.error ?? "Failed to generate this section."}
            </p>
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                className="text-xs px-4 py-2 rounded-lg font-medium transition-all"
                style={{ color: "#fff", background: "var(--al-accent)" }}
              >
                Retry section
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
