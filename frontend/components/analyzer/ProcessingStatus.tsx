"use client";
import { useEffect, useState } from "react";

const STAGES = ["uploading", "queued", "parsing", "extracting", "indexing", "complete"];

interface ProcessingStatusProps {
  documentId: string;
  filename: string;
  onComplete: () => void;
  onCancel: () => void;
}

export default function ProcessingStatus({ documentId, filename, onComplete, onCancel }: ProcessingStatusProps) {
  const [status, setStatus] = useState("queued");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Waiting for processing...");

  useEffect(() => {
    let stopped = false;

    async function poll() {
      while (!stopped) {
        try {
          const res = await fetch(`/api/documents/${documentId}/status`, { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            setStatus(data.status);
            setProgress(data.progress ?? 0);
            setMessage(data.status_message || stageLabel(data.status));
            if (data.status === "complete") { onComplete(); return; }
            if (data.status === "error" || data.status === "rejected") return;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    poll();
    return () => { stopped = true; };
  }, [documentId, onComplete]);

  const stageIndex = STAGES.indexOf(status);

  return (
    <div
      className="rounded-2xl border p-8 max-w-xl mx-auto"
      style={{ background: "var(--al-card)", border: "1.5px solid var(--al-border)", boxShadow: "var(--al-shadow-lg)" }}
    >
      {/* Spinner */}
      <div className="flex items-center justify-center mb-6">
        {status === "rejected" ? (
          <div className="w-16 h-16 rounded-full grid place-items-center" style={{ background: "rgba(245,158,11,0.10)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
        ) : status === "error" ? (
          <div className="w-16 h-16 rounded-full grid place-items-center" style={{ background: "rgba(220,38,38,0.08)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
        ) : status === "complete" ? (
          <div className="w-16 h-16 rounded-full grid place-items-center" style={{ background: "var(--al-accent-soft)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--al-accent)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        ) : (
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: "var(--al-accent-light)", borderTopColor: "var(--al-accent)" }} />
          </div>
        )}
      </div>

      {/* Filename */}
      <p className="text-center text-xs font-medium mb-1 truncate" style={{ color: "var(--al-subtle)" }}>{filename}</p>
      <h3 className="text-center font-bold text-lg mb-1" style={{ color: "var(--al-text)" }}>
        {status === "rejected" ? "Not a Financial Document"
          : status === "error" ? "Processing Failed"
          : status === "complete" ? "Complete!"
          : "Processing Document"}
      </h3>
      <p className="text-center text-sm mb-6" style={{ color: "var(--al-text-secondary)" }}>{message}</p>

      {/* Stage track */}
      <div className="flex items-center gap-0 mb-6">
        {STAGES.filter(s => s !== "uploading").map((s, i) => {
          const idx = STAGES.indexOf(s);
          const done = idx < stageIndex;
          const active = idx === stageIndex;
          return (
            <div key={s} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className="w-2.5 h-2.5 rounded-full transition-all duration-300"
                  style={{
                    background: done || active ? "var(--al-accent)" : "var(--al-border)",
                    boxShadow: active ? "0 0 0 3px var(--al-accent-light)" : "none",
                  }}
                />
                <span className="text-xs mt-1 capitalize" style={{ color: active ? "var(--al-accent)" : done ? "var(--al-text-secondary)" : "var(--al-border)" }}>
                  {s}
                </span>
              </div>
              {i < 4 && <div className="flex-1 h-px mx-1" style={{ background: done ? "var(--al-accent)" : "var(--al-border)" }} />}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      {status !== "complete" && status !== "error" && status !== "rejected" && (
        <div className="h-1.5 rounded-full mb-6" style={{ background: "var(--al-border)" }}>
          <div
            className="h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${progress}%`, background: "var(--al-accent)" }}
          />
        </div>
      )}

      <button
        onClick={onCancel}
        className="w-full py-2.5 rounded-xl text-sm font-medium transition-all"
        style={{ color: "var(--al-subtle)", background: "var(--al-bg-secondary)" }}
      >
        {status === "complete" || status === "error" || status === "rejected" ? "Back" : "Cancel"}
      </button>
    </div>
  );
}

function stageLabel(s: string) {
  const labels: Record<string, string> = {
    uploading: "Uploading file...",
    queued: "Queued for processing...",
    parsing: "Parsing document structure...",
    extracting: "Extracting financial data...",
    indexing: "Building search index...",
    complete: "Processing complete!",
    error: "An error occurred.",
  };
  return labels[s] ?? s;
}
