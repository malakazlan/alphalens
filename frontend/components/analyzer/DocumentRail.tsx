"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

const STATUS_COLORS: Record<string, string> = {
  complete:   "var(--al-success)",
  error:      "var(--al-error)",
  rejected:   "var(--al-subtle)",
  queued:     "var(--al-warning)",
  parsing:    "var(--al-accent)",
  extracting: "var(--al-accent)",
  indexing:   "var(--al-accent)",
  uploading:  "var(--al-subtle)",
};
const IN_PROGRESS = new Set(["queued", "parsing", "extracting", "indexing", "uploading"]);

interface Doc {
  id: string;
  filename: string;
  status: string;
  status_message?: string | null;
  upload_time: string;
  metadata?: Record<string, unknown>;
}

interface DocumentRailProps {
  documents: Doc[];
  selectedId?: string | null;
  onSelect: (doc: Doc) => void;
  onDelete?: (docId: string) => void;
  onRetry?: (docId: string) => void;
  loading?: boolean;
}

// ── Date grouping ─────────────────────────────────────────────────────────────
function groupByPeriod(docs: Doc[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek  = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 7);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const groups: Record<string, Doc[]> = { Today: [], "This week": [], "This month": [], Earlier: [] };
  for (const d of docs) {
    if (!d.upload_time) { groups["Earlier"].push(d); continue; }
    const t = new Date(d.upload_time);
    if (t >= startOfToday)       groups["Today"].push(d);
    else if (t >= startOfWeek)   groups["This week"].push(d);
    else if (t >= startOfMonth)  groups["This month"].push(d);
    else                         groups["Earlier"].push(d);
  }
  return groups;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function SkeletonItem({ width }: { width: string }) {
  return (
    <div style={{ padding: "12px 16px" }}>
      <div className="animate-pulse" style={{ height: 11, borderRadius: 4, marginBottom: 8, background: "rgba(0,0,0,0.06)", width }} />
      <div className="animate-pulse" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(0,0,0,0.07)" }} />
        <div style={{ height: 8, borderRadius: 4, background: "rgba(0,0,0,0.04)", width: "40%" }} />
      </div>
    </div>
  );
}

// ── Tiny PDF / file glyph ────────────────────────────────────────────────────
function FileGlyph({ filename }: { filename: string }) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const tone =
    ext === "pdf" ? "#dc2626" :
    ext === "docx" || ext === "doc" ? "#2563eb" :
    ext === "html" || ext === "htm" ? "#f59e0b" :
    "#64748b";
  return (
    <div
      aria-hidden
      style={{
        width: 26, height: 30,
        flexShrink: 0,
        background: "var(--al-card)",
        border: `1px solid rgba(0,0,0,0.10)`,
        borderRadius: 3,
        position: "relative",
        display: "flex", flexDirection: "column",
        alignItems: "flex-start", justifyContent: "flex-end",
        padding: "0 0 3px 3px",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {/* Folded corner */}
      <span style={{
        position: "absolute", top: 0, right: 0,
        width: 7, height: 7,
        background: "linear-gradient(225deg, rgba(0,0,0,0.10) 50%, transparent 50%)",
      }} />
      <span style={{
        fontSize: 7,
        fontWeight: 700,
        letterSpacing: "0.04em",
        color: tone,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        lineHeight: 1,
      }}>
        {ext.slice(0, 4).toUpperCase() || "FILE"}
      </span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function DocumentRail({
  documents, selectedId, onSelect, onDelete, onRetry, loading,
}: DocumentRailProps) {
  const [menuOpenId,  setMenuOpenId]  = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; flipUp: boolean }>({ top: 0, left: 0, flipUp: false });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpenId(null);
    }
    function handleScroll() {
      setMenuOpenId(null);
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleEsc);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handleEsc);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [menuOpenId]);

  function openMenu(e: React.MouseEvent<HTMLButtonElement>, docId: string) {
    e.stopPropagation();
    if (menuOpenId === docId) { setMenuOpenId(null); return; }

    const rect = e.currentTarget.getBoundingClientRect();
    const menuHeight = onRetry && documents.find(d => d.id === docId)?.status === "error" ? 96 : 48;
    const flipUp = rect.bottom + menuHeight + 8 > window.innerHeight;

    setDropdownPos({
      top:  flipUp ? rect.top - menuHeight - 6 : rect.bottom + 6,
      left: Math.min(rect.right - 168, window.innerWidth - 180),
      flipUp,
    });
    setMenuOpenId(docId);
  }

  const groups = groupByPeriod(documents);
  const periods = (["Today", "This week", "This month", "Earlier"] as const).filter(p => groups[p].length > 0);

  return (
    <aside
      className="shrink-0 flex flex-col border-r"
      style={{
        width: 280,
        height: "100%",
        background: "var(--al-bg-soft)",
        borderColor: "var(--al-border)",
      }}
    >
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "20px 18px 16px",
          borderBottom: "1px solid var(--al-border)",
          background: "linear-gradient(180deg, var(--al-bg-soft) 0%, rgba(5,150,105,0.025) 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{
              fontSize: 11, fontWeight: 700,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              color: "var(--al-subtle)",
              marginBottom: 4,
            }}>
              Filings · Documents
            </h2>
            {!loading && (
              <p style={{
                fontSize: 13, color: "var(--al-text)",
                fontWeight: 500, letterSpacing: "-0.005em",
                fontVariantNumeric: "tabular-nums",
              }}>
                {documents.length} {documents.length === 1 ? "filed" : "filed"}
                {documents.some(d => IN_PROGRESS.has(d.status)) && (
                  <span style={{
                    marginLeft: 8,
                    fontSize: 11, fontWeight: 500,
                    color: "var(--al-warning)",
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: "var(--al-warning)",
                      animation: "pulse 1.4s ease-in-out infinite",
                    }} />
                    {documents.filter(d => IN_PROGRESS.has(d.status)).length} processing
                  </span>
                )}
              </p>
            )}
          </div>

          <Link
            href="/dashboard/analyzer"
            title="Upload new"
            style={{
              flexShrink: 0,
              width: 30, height: 30,
              borderRadius: 8,
              background: "linear-gradient(135deg, #059669, #10b981)",
              color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 1px 2px rgba(5,150,105,0.3), inset 0 1px 0 rgba(255,255,255,0.25)",
              transition: "all 180ms ease",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1.06)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(5,150,105,0.4), inset 0 1px 0 rgba(255,255,255,0.25)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 2px rgba(5,150,105,0.3), inset 0 1px 0 rgba(255,255,255,0.25)"; }}
          >
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </Link>
        </div>
      </div>

      {/* ─── List ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 0 16px" }}>
        {/* Loading skeleton */}
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
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--al-text)", marginBottom: 4 }}>
                No documents yet
              </div>
              <div style={{ fontSize: 12, color: "var(--al-subtle)", lineHeight: 1.5, maxWidth: 200 }}>
                Drop a financial PDF to get started.
              </div>
            </div>
          </div>
        )}

        {/* Period groups */}
        {!loading && periods.map((period, pIdx) => (
          <div key={period} style={{ marginBottom: pIdx < periods.length - 1 ? 8 : 0 }}>
            <div style={{
              padding: "10px 18px 6px",
              fontSize: 10, fontWeight: 600,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              color: "var(--al-subtle)",
              opacity: 0.85,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              {period}
              <span aria-hidden style={{
                flex: 1, height: 1,
                background: "linear-gradient(90deg, rgba(0,0,0,0.06), transparent)",
              }} />
              <span style={{
                fontSize: 10, fontWeight: 500,
                color: "var(--al-subtle)",
                opacity: 0.7,
                fontVariantNumeric: "tabular-nums",
              }}>
                {groups[period].length}
              </span>
            </div>

            {groups[period].map(doc => {
              const active     = selectedId === doc.id;
              const inProgress = IN_PROGRESS.has(doc.status);
              const errored    = doc.status === "error";
              const rejected   = doc.status === "rejected";
              // Rejected docs have no parsed content — opening the workspace
              // would just show empty panels. Keep them visible in the rail
              // for context but block the click.
              const clickable  = !rejected;
              // Show the rejection reason / error message on hover.
              const tooltip    = (rejected || errored)
                ? (doc.status_message ?? null)
                : null;

              return (
                <div
                  key={doc.id}
                  title={tooltip ?? undefined}
                  style={{
                    display: "flex", alignItems: "stretch",
                    position: "relative",
                    background: active ? "rgba(5,150,105,0.06)" : "transparent",
                    borderLeft: `2px solid ${active ? "var(--al-accent)" : "transparent"}`,
                    transition: "background 150ms ease",
                    opacity: rejected ? 0.55 : 1,
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.025)"; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  className="group"
                >
                  <div
                    role="button"
                    tabIndex={clickable ? 0 : -1}
                    aria-disabled={!clickable}
                    onClick={() => { if (clickable) onSelect(doc); }}
                    onKeyDown={e => { if (clickable && e.key === "Enter") onSelect(doc); }}
                    style={{
                      flex: 1, minWidth: 0,
                      cursor: clickable ? "pointer" : "default",
                      padding: "11px 8px 11px 14px",
                      display: "flex", alignItems: "flex-start", gap: 10,
                    }}
                  >
                    <FileGlyph filename={doc.filename} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: active ? 600 : 500,
                        color: active ? "var(--al-accent)" : "var(--al-text)",
                        letterSpacing: "-0.005em",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        marginBottom: 4,
                        textDecoration: rejected ? "line-through" : "none",
                      }}>
                        {doc.filename}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{
                          position: "relative",
                          width: 6, height: 6,
                          borderRadius: "50%",
                          flexShrink: 0,
                        }}>
                          <span style={{
                            position: "absolute", inset: 0,
                            background: STATUS_COLORS[doc.status] ?? "var(--al-subtle)",
                            borderRadius: "50%",
                          }} />
                          {inProgress && (
                            <span style={{
                              position: "absolute", inset: 0,
                              background: STATUS_COLORS[doc.status],
                              borderRadius: "50%",
                              animation: "pulse 1.6s ease-in-out infinite",
                              opacity: 0.55,
                            }} />
                          )}
                        </span>
                        <span style={{
                          fontSize: 11,
                          color: errored ? "var(--al-error)" : "var(--al-subtle)",
                          textTransform: "capitalize",
                          letterSpacing: "0.01em",
                          fontWeight: errored ? 500 : 400,
                          fontStyle: rejected ? "italic" : "normal",
                        }}>
                          {rejected ? "rejected · not financial" : doc.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  {onDelete && (
                    <button
                      onClick={e => openMenu(e, doc.id)}
                      title="Options"
                      aria-label="Document options"
                      style={{
                        flexShrink: 0,
                        width: 32,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: menuOpenId === doc.id ? "rgba(0,0,0,0.06)" : "transparent",
                        color: menuOpenId === doc.id ? "var(--al-text)" : "var(--al-subtle)",
                        opacity: menuOpenId === doc.id ? 1 : 0,
                        transition: "opacity 150ms ease, background 150ms ease, color 150ms ease",
                        cursor: "pointer",
                      }}
                      className="rail-row-menu"
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="8" cy="3"  r="1.5" />
                        <circle cx="8" cy="8"  r="1.5" />
                        <circle cx="8" cy="13" r="1.5" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ─── Dropdown menu — rendered to <body> via portal ────────── */}
      {mounted && menuOpenId && onDelete && createPortal(
        <div
          ref={dropdownRef}
          role="menu"
          style={{
            position: "fixed",
            top:  dropdownPos.top,
            left: dropdownPos.left,
            zIndex: 9999,
            width: 168,
            background: "var(--al-card)",
            border: "1px solid rgba(0,0,0,0.10)",
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(0,0,0,0.14), 0 4px 12px rgba(0,0,0,0.06)",
            overflow: "hidden",
            transformOrigin: dropdownPos.flipUp ? "bottom right" : "top right",
            animation: "menuAppear 130ms cubic-bezier(0.34,1.56,0.64,1) both",
          }}
        >
          {onRetry && documents.find(d => d.id === menuOpenId)?.status === "error" && (
            <button
              onClick={() => { const id = menuOpenId!; setMenuOpenId(null); onRetry(id); }}
              style={{
                width: "100%", padding: "10px 14px",
                display: "flex", alignItems: "center", gap: 10,
                fontSize: 13, color: "var(--al-accent)",
                background: "transparent", border: "none",
                cursor: "pointer", textAlign: "left",
                transition: "background 100ms ease",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--al-accent-soft)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 .49-3.45" />
              </svg>
              Retry processing
            </button>
          )}
          <button
            onClick={() => { const id = menuOpenId!; setMenuOpenId(null); onDelete(id); }}
            style={{
              width: "100%", padding: "10px 14px",
              display: "flex", alignItems: "center", gap: 10,
              fontSize: 13, color: "var(--al-error)",
              background: "transparent", border: "none",
              cursor: "pointer", textAlign: "left",
              transition: "background 100ms ease",
              fontWeight: 500,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(220,38,38,0.06)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
            Delete document
          </button>
        </div>,
        document.body
      )}

      {/* Inline keyframes */}
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.45; transform: scale(0.85); }
        }
        @keyframes menuAppear {
          from { opacity: 0; transform: translateY(-4px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
        .group:hover .rail-row-menu { opacity: 1 !important; }
      `}</style>
    </aside>
  );
}
