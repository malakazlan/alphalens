"use client";

// ─── Bulk upload panel ───────────────────────────────────────────────────────
// One row per file the user just dropped on the main analyzer dropzone.
// The parent (AnalyzerView) owns the polling loop and updates the rows in
// place — this component is purely presentational.

interface BulkJob {
  filename:    string;
  documentId:  string | null;
  status:      string;
  progress:    number;
  message:     string;
  isDuplicate: boolean;
  error?:      string | null;
}

interface BulkUploadPanelProps {
  jobs:       BulkJob[];
  onClose:    () => void;
  onOpenDoc:  (id: string) => void;
}

const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

function statusTone(s: string, isDup: boolean): { color: string; bg: string; label: string } {
  if (isDup)              return { color: "#2563eb", bg: "rgba(37,99,235,0.10)",  label: "Already filed" };
  if (s === "complete")   return { color: "#059669", bg: "rgba(5,150,105,0.10)",  label: "Complete" };
  if (s === "error")      return { color: "#dc2626", bg: "rgba(220,38,38,0.10)",  label: "Error" };
  if (s === "rejected")   return { color: "#d97706", bg: "rgba(217,119,6,0.10)",  label: "Rejected" };
  if (s === "pending")    return { color: "#64748b", bg: "rgba(100,116,139,0.10)", label: "Hashing" };
  if (s === "queued")     return { color: "#64748b", bg: "rgba(100,116,139,0.10)", label: "Queued" };
  return { color: "#059669", bg: "rgba(5,150,105,0.10)", label: s.charAt(0).toUpperCase() + s.slice(1) };
}

function isTerminal(s: string) {
  return s === "complete" || s === "error" || s === "rejected";
}

export default function BulkUploadPanel({ jobs, onClose, onOpenDoc }: BulkUploadPanelProps) {
  const total       = jobs.length;
  const done        = jobs.filter(j => isTerminal(j.status) || j.isDuplicate).length;
  const completed   = jobs.filter(j => j.status === "complete" || j.isDuplicate).length;
  const errors      = jobs.filter(j => j.status === "error" || j.status === "rejected").length;
  const allFinished = done === total;

  return (
    <div className="max-w-3xl mx-auto w-full pt-2">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        paddingBottom: 16,
        borderBottom: "1px solid var(--al-border)",
        marginBottom: 18,
      }}>
        <div>
          <div style={{
            fontFamily: MONO, fontSize: 11, fontWeight: 600,
            letterSpacing: "0.10em", textTransform: "uppercase",
            color: "var(--al-subtle)", marginBottom: 6,
          }}>
            Bulk upload · {total} {total === 1 ? "file" : "files"}
          </div>
          <h2 style={{
            fontWeight: 800, fontSize: 26, letterSpacing: "-0.025em",
            color: "var(--al-text)",
          }}>
            {allFinished
              ? <>Batch <span className="landing-gradient-text">complete</span></>
              : <>Processing your <span className="landing-gradient-text">documents</span></>}
          </h2>
        </div>
        <div style={{
          fontFamily: MONO, fontSize: 11.5,
          color: "var(--al-subtle)", letterSpacing: "0.04em",
          textAlign: "right",
        }}>
          <div><b style={{ color: "var(--al-text)", fontWeight: 700 }}>{completed}</b> ready</div>
          {errors > 0 && <div style={{ color: "#dc2626" }}>{errors} failed</div>}
        </div>
      </div>

      {/* ── Rows ──────────────────────────────────────────────────── */}
      <div style={{
        background: "var(--al-card)",
        border: "1px solid var(--al-border)",
        borderRadius: 14,
        overflow: "hidden",
      }}>
        {jobs.map((j, i) => {
          const tone        = statusTone(j.status, j.isDuplicate);
          const isOpen      = (j.status === "complete" || j.isDuplicate) && !!j.documentId;
          const pct         = j.isDuplicate ? 100
                            : j.status === "complete" ? 100
                            : isTerminal(j.status) ? 0
                            : j.progress;
          return (
            <div
              key={`${j.filename}_${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 110px 80px",
                gap: 14,
                alignItems: "center",
                padding: "14px 18px",
                borderBottom: i < jobs.length - 1 ? "1px solid var(--al-border-light, var(--al-border))" : "none",
                background: i % 2 === 0 ? "transparent" : "rgba(0,0,0,0.012)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 13.5, fontWeight: 600,
                  color: "var(--al-text)", letterSpacing: "-0.005em",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  marginBottom: 5,
                }} title={j.filename}>
                  {j.filename}
                </div>
                <div style={{
                  height: 4, borderRadius: 999,
                  background: "var(--al-border)",
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute", inset: 0,
                    width: `${pct}%`,
                    background: tone.color,
                    transition: "width 320ms ease",
                    borderRadius: 999,
                  }} />
                </div>
                <div style={{
                  fontSize: 11.5, color: "var(--al-subtle)",
                  marginTop: 5, letterSpacing: "0.005em",
                }}>
                  {j.message}
                </div>
              </div>
              <span style={{
                fontFamily: MONO, fontSize: 10.5, fontWeight: 600,
                letterSpacing: "0.06em", textTransform: "uppercase",
                padding: "4px 9px", borderRadius: 6,
                background: tone.bg, color: tone.color,
                textAlign: "center",
              }}>
                {tone.label}
              </span>
              {isOpen ? (
                <button
                  onClick={() => j.documentId && onOpenDoc(j.documentId)}
                  style={{
                    fontFamily: "inherit", fontSize: 12, fontWeight: 600,
                    padding: "6px 10px",
                    background: "var(--al-bg-soft)",
                    color: "var(--al-text)",
                    border: "1px solid var(--al-border)",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Open →
                </button>
              ) : <span />}
            </div>
          );
        })}
      </div>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginTop: 20,
      }}>
        <p style={{ fontSize: 12.5, color: "var(--al-subtle)", lineHeight: 1.5 }}>
          {allFinished
            ? "All files settled. You can close this panel — finished documents are in your library."
            : "You can leave this panel open or close it; processing continues in the background."}
        </p>
        <button
          onClick={onClose}
          style={{
            padding: "9px 16px",
            background: allFinished ? "var(--al-text)" : "transparent",
            color: allFinished ? "var(--al-card)" : "var(--al-text-secondary)",
            border: `1px solid ${allFinished ? "var(--al-text)" : "var(--al-border)"}`,
            borderRadius: 8,
            fontSize: 13, fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {allFinished ? "Done" : "Close"}
        </button>
      </div>
    </div>
  );
}
