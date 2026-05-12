"use client";

import { useEffect, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface VersionRow {
  id:          string;
  section_id:  string;
  content:     string;
  model:       string | null;
  tokens_in:   number | null;
  tokens_out:  number | null;
  created_at:  string;
}

interface VersionHistoryModalProps {
  open:         boolean;
  onClose:      () => void;
  reportId:     string;
  sectionId:    string;
  sectionTitle: string;
  // Called with the restored content + word_count so the parent can
  // optimistically update the section without a refetch.
  onRestored:   (payload: { content: string; word_count: number }) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function summariseContent(md: string): string {
  // First non-heading line as a preview. Strips the leading `## Title`
  // since every section starts with one, then collapses whitespace.
  const lines = md.split("\n").map(l => l.trim()).filter(Boolean);
  const skipFirst = lines[0]?.startsWith("#") ? lines.slice(1) : lines;
  const preview = (skipFirst[0] ?? "").replace(/[*_`#|>-]/g, "").trim();
  return preview.length > 120 ? preview.slice(0, 120).trimEnd() + "…" : preview;
}

// ── Component ────────────────────────────────────────────────────────────────
// Modal lists the last ~20 versions captured for a section (each section
// regeneration / restore appends a row server-side). User picks one and
// the section content rolls back instantly.

export default function VersionHistoryModal({
  open, onClose, reportId, sectionId, sectionTitle, onRestored,
}: VersionHistoryModalProps) {
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [busyId,   setBusyId]   = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/reports/${reportId}/versions?section=${encodeURIComponent(sectionId)}`, {
      credentials: "include",
    })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(data => {
        if (cancelled) return;
        setVersions(Array.isArray(data?.versions) ? data.versions : []);
      })
      .catch(() => { if (!cancelled) setError("Couldn't load history."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, reportId, sectionId]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleRestore(v: VersionRow) {
    setBusyId(v.id);
    setError("");
    try {
      const r = await fetch(
        `/api/reports/${reportId}/sections/${encodeURIComponent(sectionId)}/restore/${v.id}`,
        { method: "POST", credentials: "include" },
      );
      if (!r.ok) throw new Error(`status ${r.status}`);
      const data = await r.json();
      onRestored({
        content:    data.content ?? v.content,
        word_count: data.word_count ?? v.content.split(/\s+/).length,
      });
      onClose();
    } catch {
      setError("Restore failed. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(15,23,42,0.45)",
        backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 600,
          background: "var(--al-card)", borderRadius: 16,
          border: "1px solid var(--al-border)",
          boxShadow: "0 24px 56px rgba(0,0,0,0.18)",
          display: "flex", flexDirection: "column",
          maxHeight: "min(640px, 84vh)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid var(--al-border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: "var(--al-text)" }}>
              Version history
            </p>
            <p style={{ fontSize: 11, color: "var(--al-subtle)", marginTop: 2 }}>
              {sectionTitle} · {versions.length} version{versions.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 28, height: 28, border: "none", borderRadius: 8,
              background: "var(--al-bg-soft)", color: "var(--al-text-secondary)",
              fontSize: 16, cursor: "pointer",
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {loading && (
            <div style={{ padding: 32, display: "flex", justifyContent: "center" }}>
              <div className="animate-spin" style={{
                width: 18, height: 18, borderRadius: "50%",
                border: "2px solid var(--al-accent-light)", borderTopColor: "var(--al-accent)",
              }} />
            </div>
          )}

          {error && !loading && (
            <div style={{ padding: 18, fontSize: 12, color: "#dc2626", textAlign: "center" }}>
              {error}
            </div>
          )}

          {!loading && versions.length === 0 && !error && (
            <div style={{ padding: 32, textAlign: "center" }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--al-text)" }}>
                No history yet
              </p>
              <p style={{ fontSize: 12, color: "var(--al-subtle)", marginTop: 6 }}>
                A version is saved each time you regenerate this section.
              </p>
            </div>
          )}

          {!loading && versions.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {versions.map((v, i) => {
                const isCurrent = i === 0;
                const tokens = (v.tokens_in ?? 0) + (v.tokens_out ?? 0);
                return (
                  <li key={v.id}
                    style={{
                      padding: "10px 18px",
                      borderTop: i === 0 ? "none" : "1px solid var(--al-border)",
                    }}
                  >
                    <div style={{
                      display: "flex", alignItems: "flex-start",
                      justifyContent: "space-between", gap: 12,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          display: "flex", alignItems: "center", gap: 8,
                          flexWrap: "wrap",
                        }}>
                          <span style={{
                            fontSize: 12, fontWeight: 600, color: "var(--al-text)",
                          }}>
                            {formatTimestamp(v.created_at)}
                          </span>
                          {isCurrent && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "1px 7px",
                              borderRadius: 999, background: "var(--al-accent-soft)",
                              color: "var(--al-accent)",
                            }}>Current</span>
                          )}
                          {v.model && (
                            <span style={{
                              fontSize: 10, padding: "1px 6px", borderRadius: 4,
                              background: "var(--al-bg-soft)", color: "var(--al-text-secondary)",
                              fontFamily: "ui-monospace, monospace",
                            }}>{v.model}</span>
                          )}
                          {tokens > 0 && (
                            <span style={{ fontSize: 10, color: "var(--al-subtle)" }}>
                              {tokens.toLocaleString()} tokens
                            </span>
                          )}
                        </div>
                        <p style={{
                          fontSize: 11, color: "var(--al-text-secondary)",
                          marginTop: 4, lineHeight: 1.4,
                        }}>
                          {summariseContent(v.content)}
                        </p>
                      </div>
                      {!isCurrent && (
                        <button
                          onClick={() => handleRestore(v)}
                          disabled={busyId === v.id}
                          style={{
                            flexShrink: 0,
                            padding: "5px 12px", borderRadius: 8,
                            border: "1px solid var(--al-border)",
                            background: busyId === v.id ? "var(--al-bg-secondary)" : "var(--al-accent-soft)",
                            color: busyId === v.id ? "var(--al-subtle)" : "var(--al-accent)",
                            fontSize: 11, fontWeight: 600,
                            cursor: busyId === v.id ? "wait" : "pointer",
                          }}
                        >
                          {busyId === v.id ? "Restoring…" : "Restore"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
