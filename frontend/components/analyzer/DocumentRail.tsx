"use client";
import Link from "next/link";

const STATUS_COLORS: Record<string, string> = {
  complete: "var(--al-success)",
  error: "var(--al-error)",
  queued: "var(--al-warning)",
  parsing: "var(--al-accent)",
  extracting: "var(--al-accent)",
  indexing: "var(--al-accent)",
  uploading: "var(--al-subtle)",
};

const IN_PROGRESS = new Set(["queued", "parsing", "extracting", "indexing", "uploading"]);

interface Doc {
  id: string;
  filename: string;
  status: string;
  upload_time: string;
  metadata?: Record<string, unknown>;
}

interface DocumentRailProps {
  documents: Doc[];
  selectedId?: string | null;
  onSelect: (doc: Doc) => void;
  loading?: boolean;
}

function SkeletonItem({ width }: { width: string }) {
  return (
    <div className="px-4 py-3 animate-pulse">
      <div className="h-3 rounded-md mb-2" style={{ background: "var(--al-border)", width }} />
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--al-border)" }} />
        <div className="h-2 rounded w-12" style={{ background: "var(--al-border-light)" }} />
      </div>
    </div>
  );
}

export default function DocumentRail({ documents, selectedId, onSelect, loading }: DocumentRailProps) {
  return (
    <aside className="w-64 shrink-0 flex flex-col border-r h-full"
      style={{ background: "var(--al-bg-soft)", borderColor: "var(--al-border)" }}>

      {/* Header */}
      <div className="px-4 py-4 border-b flex items-center justify-between"
        style={{ borderColor: "var(--al-border)" }}>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--al-subtle)" }}>
            Documents
          </h2>
          {!loading && documents.length > 0 && (
            <p className="text-xs mt-0.5" style={{ color: "var(--al-subtle)" }}>
              {documents.length} file{documents.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <Link
          href="/dashboard/analyzer"
          title="Upload new document"
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150 hover:scale-110"
          style={{ background: "var(--al-accent-soft)", color: "var(--al-accent)" }}>
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </Link>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-2">
        {/* Skeletons */}
        {loading && (
          <>
            <SkeletonItem width="72%" />
            <SkeletonItem width="55%" />
            <SkeletonItem width="80%" />
            <SkeletonItem width="63%" />
          </>
        )}

        {/* Empty state */}
        {!loading && documents.length === 0 && (
          <div className="flex flex-col items-center px-4 py-10 gap-3 text-center">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "var(--al-accent-soft)", color: "var(--al-accent)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "var(--al-subtle)" }}>
              No documents yet.<br />Upload a file to get started.
            </p>
          </div>
        )}

        {/* Document items */}
        {documents.map(doc => {
          const active = selectedId === doc.id;
          const inProgress = IN_PROGRESS.has(doc.status);
          return (
            <button
              key={doc.id}
              onClick={() => onSelect(doc)}
              className="w-full text-left px-4 py-3 flex flex-col gap-1 transition-all duration-150"
              style={{
                background: active ? "var(--al-accent-soft)" : "transparent",
                borderLeft: `3px solid ${active ? "var(--al-accent)" : "transparent"}`,
              }}
            >
              <span className="text-sm font-medium truncate block"
                style={{ color: active ? "var(--al-accent)" : "var(--al-text)" }}>
                {doc.filename}
              </span>
              <div className="flex items-center gap-2">
                {/* Status dot — pulsing for in-progress */}
                <span className="relative flex shrink-0 w-1.5 h-1.5">
                  <span className="w-1.5 h-1.5 rounded-full block"
                    style={{ background: STATUS_COLORS[doc.status] ?? "var(--al-subtle)" }} />
                  {inProgress && (
                    <span className="absolute inset-0 rounded-full animate-ping opacity-60"
                      style={{ background: STATUS_COLORS[doc.status] }} />
                  )}
                </span>
                <span className="text-xs capitalize" style={{ color: "var(--al-subtle)" }}>{doc.status}</span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
