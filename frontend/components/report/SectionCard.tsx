"use client";
import ReportMarkdown from "./ReportMarkdown";
import type { SectionState } from "@/lib/stores/report-store";

interface SectionCardProps {
  section: SectionState;
  onRegenerate?: () => void;
  streaming?: boolean;
}

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
      <div className="mt-3 rounded-lg h-20 animate-pulse" style={{ background: "var(--al-border-light)" }} />
    </div>
  );
}

export default function SectionCard({ section, onRegenerate, streaming }: SectionCardProps) {
  const isError = section.status === "error";
  const isPending = section.status === "pending";
  const isGenerating = section.status === "generating";

  return (
    <div
      id={`section-${section.id}`}
      className="mb-6 rounded-xl border overflow-hidden"
      style={{
        borderColor: isError ? "rgba(220,38,38,0.3)" : "var(--al-border)",
        background: "var(--al-card)",
      }}
    >
      {/* Section header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b group"
        style={{
          borderColor: "var(--al-border)",
          background: "var(--al-bg-soft)",
        }}
      >
        <div className="flex items-center gap-2">
          {/* Status indicator */}
          {isGenerating && (
            <span
              className="w-2 h-2 rounded-full animate-pulse shrink-0"
              style={{ background: "var(--al-accent)" }}
            />
          )}
          {isError && (
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#dc2626" }} />
          )}
          <h2
            className="text-sm font-bold"
            style={{ color: isError ? "#dc2626" : "var(--al-text)" }}
          >
            {section.title}
          </h2>
        </div>

        {/* Regenerate button — visible on hover */}
        {onRegenerate && !streaming && section.status !== "pending" && (
          <button
            onClick={onRegenerate}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
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

        {section.status === "done" && <ReportMarkdown text={section.markdown} />}

        {isError && (
          <div className="flex flex-col items-center gap-3 py-4">
            <p className="text-xs" style={{ color: "#dc2626" }}>
              {section.error ?? "Failed to generate this section."}
            </p>
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                className="text-xs px-4 py-2 rounded-lg font-medium"
                style={{ color: "var(--al-accent)", background: "var(--al-accent-soft)" }}
              >
                Retry Section
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
