"use client";

import { useEffect, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

// Minimal shape returned by GET /api/documents — kept loose so we don't
// fight backend field-ordering tweaks. Filename is the only field we
// require for a usable picker row.
interface PickerDoc {
  id:           string;
  filename:     string;
  status:       string;
  upload_time?: string;
  metadata?: {
    company_name?: string | null;
    doc_type?:     string | null;
    fiscal_year?:  string | null;
    page_count?:   number | null;
  } | null;
}

export interface PickedDoc {
  id:           string;
  filename:     string;
  company_name?: string | null;
  doc_type?:     string | null;
  fiscal_year?:  string | null;
}

interface DocPickerProps {
  open:           boolean;
  onClose:        () => void;
  onPick:         (doc: PickedDoc) => void;
  activeDocId?:   string | null;
}

// ── Component ────────────────────────────────────────────────────────────────
// Modal overlay listing the user's COMPLETED documents. Click a row to
// pin it as the active doc for the current FinBot conversation. Filters
// out parsing / errored / rejected docs because pinning an unready doc
// would silently fail at chat time. Empty state guides the user back
// to Analyzer to upload first.

export default function DocPicker({
  open, onClose, onPick, activeDocId,
}: DocPickerProps) {
  const [docs,    setDocs]    = useState<PickerDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch("/api/documents", { credentials: "include" })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(data => {
        if (cancelled) return;
        const all: PickerDoc[] = Array.isArray(data?.documents) ? data.documents : [];
        // Only completed docs can answer questions — pinning a parsing
        // doc would lead to a confusing "doc not ready" error mid-chat.
        setDocs(all.filter(d => d.status === "complete"));
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your documents. Try again.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  // Close on Escape — standard modal behaviour.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 520,
          background: "#fff", borderRadius: 16,
          border: "1px solid #e5e7eb",
          boxShadow: "0 24px 56px rgba(0,0,0,0.18)",
          display: "flex", flexDirection: "column",
          maxHeight: "min(560px, 80vh)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid #f1f5f9",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Attach a document</p>
            <p style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
              FinBot will use it for any document-related question in this chat.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 28, height: 28, border: "none", borderRadius: 8,
              background: "#f1f5f9", color: "#475569", fontSize: 16,
              cursor: "pointer",
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && (
            <div style={{ padding: 24, display: "flex", justifyContent: "center" }}>
              <div className="animate-spin" style={{
                width: 18, height: 18, borderRadius: "50%",
                border: "2px solid #d1fae5", borderTopColor: "#059669",
              }} />
            </div>
          )}

          {error && !loading && (
            <div style={{ padding: 24, fontSize: 13, color: "#dc2626", textAlign: "center" }}>
              {error}
            </div>
          )}

          {!loading && !error && docs && docs.length === 0 && (
            <div style={{ padding: 28, textAlign: "center" }}>
              <p style={{ fontSize: 13, color: "#0f172a", fontWeight: 600 }}>No documents yet</p>
              <p style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                Upload a financial document in the Analyzer first.<br />
                Once it finishes parsing, it&apos;ll appear here.
              </p>
            </div>
          )}

          {!loading && !error && docs && docs.length > 0 && (
            <ul style={{ margin: 0, padding: "6px 0" }}>
              {docs.map(d => {
                const isActive = d.id === activeDocId;
                const meta = d.metadata ?? {};
                const subBits = [
                  meta.company_name,
                  meta.doc_type,
                  meta.fiscal_year ? `FY${meta.fiscal_year}` : null,
                ].filter(Boolean);
                return (
                  <li key={d.id}>
                    <button
                      onClick={() => onPick({
                        id:           d.id,
                        filename:     d.filename,
                        company_name: meta.company_name ?? null,
                        doc_type:     meta.doc_type ?? null,
                        fiscal_year:  meta.fiscal_year ?? null,
                      })}
                      style={{
                        width: "100%", textAlign: "left",
                        padding: "10px 18px", border: "none",
                        background: isActive ? "rgba(5, 150, 105, 0.08)" : "transparent",
                        cursor: "pointer", display: "flex", gap: 12,
                        alignItems: "center",
                      }}
                      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc"; }}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                    >
                      <div style={{
                        width: 30, height: 30, borderRadius: 8,
                        background: isActive ? "#059669" : "#f1f5f9",
                        color: isActive ? "#fff" : "#64748b",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, flexShrink: 0,
                      }}>📄</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontSize: 13, fontWeight: 600, color: "#0f172a",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>{d.filename || "(untitled)"}</p>
                        {subBits.length > 0 && (
                          <p style={{
                            fontSize: 11, color: "#64748b", marginTop: 2,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}>{subBits.join(" · ")}</p>
                        )}
                      </div>
                      {isActive && (
                        <span style={{
                          fontSize: 11, color: "#059669", fontWeight: 600,
                          padding: "2px 8px", borderRadius: 999,
                          background: "rgba(5, 150, 105, 0.12)",
                          flexShrink: 0,
                        }}>Pinned</span>
                      )}
                    </button>
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
