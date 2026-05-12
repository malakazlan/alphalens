"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";

// ── Types ────────────────────────────────────────────────────────────────────

interface SourceRow {
  id:              string;
  section_id:      string;
  chunk_id:        string;
  page:            number | null;
  section_header:  string | null;
  created_at:      string;
}

interface SourcesFooterProps {
  reportId:    string;
  sectionId:   string;
  // Only render the footer if the section is settled — pending /
  // generating sections don't have sources yet (the capture writes happen
  // after the section's last delta).
  enabled:     boolean;
}

// ── Component ────────────────────────────────────────────────────────────────
// Compact list of chips beneath a settled section. Each chip → page + section
// header from the analyzer; clicking opens that doc in the analyzer at the
// referenced page. Pulled from GET /api/reports/{id}/sources?section=…
//
// Loads lazily — the footer doesn't fetch until the parent reports it as
// `enabled` (which happens once the section reaches `done`).

export default function SourcesFooter({
  reportId, sectionId, enabled,
}: SourcesFooterProps) {
  const [rows,    setRows]    = useState<SourceRow[]>([]);
  const [docId,   setDocId]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [open,    setOpen]    = useState(true);  // expanded by default

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/reports/${reportId}/sources?section=${encodeURIComponent(sectionId)}`, {
      credentials: "include",
    })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(data => {
        if (cancelled) return;
        setRows(Array.isArray(data?.sources) ? data.sources : []);
        setDocId(data?.doc_id ?? null);
      })
      .catch(() => { if (!cancelled) setError("Couldn't load sources."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, reportId, sectionId]);

  if (!enabled) return null;
  if (loading && rows.length === 0) return null;       // hide spinner — section just settled
  if (!loading && rows.length === 0 && !error) return null;

  return (
    <div
      className="mt-4 pt-3 border-t"
      style={{ borderColor: "var(--al-border)" }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide transition-opacity hover:opacity-100"
        style={{ color: "var(--al-subtle)", opacity: open ? 1 : 0.75 }}
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transition: "transform 150ms", transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        Sources · {rows.length}
      </button>

      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {error && (
            <span className="text-[10px]" style={{ color: "#dc2626" }}>{error}</span>
          )}
          {rows.map(row => {
            const label = [
              row.page !== null ? `Page ${row.page + 1}` : null,
              row.section_header || null,
            ].filter(Boolean).join(" · ") || "Source";
            const href = docId ? ROUTES.analyzerDoc(docId) : null;
            const chipStyle: React.CSSProperties = {
              background: "var(--al-bg-soft)",
              border:     "1px solid var(--al-border)",
              color:      "var(--al-text-secondary)",
            };
            const chipClass =
              "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-medium max-w-[280px] truncate transition-colors hover:[background:var(--al-accent-soft)] hover:[color:var(--al-accent)] hover:[border-color:var(--al-accent)]";
            return href ? (
              <Link key={row.id} href={href} title={label} className={chipClass} style={chipStyle}>
                <span style={{ color: "var(--al-accent)" }}>↗</span>
                <span className="truncate">{label}</span>
              </Link>
            ) : (
              <span key={row.id} title={label} className={chipClass} style={chipStyle}>
                <span className="truncate">{label}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
