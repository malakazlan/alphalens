"use client";
import { useRef, useState } from "react";

const ACCEPT = ".pdf,.docx,.doc,.html,.htm,.png,.jpg,.jpeg,.tiff,.tif,.webp";

const FEATURES = [
  {
    id: "parse",
    color: "#32D583",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    title: "Parse Document",
    description: "AI-powered extraction with visual bounding-box overlays for every chunk.",
  },
  {
    id: "extract",
    color: "#2193FD",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" />
        <line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
    title: "Extract Data",
    description: "Pull income statements, balance sheets & cash flows into clean JSON.",
  },
  {
    id: "chat",
    color: "#FF5CFF",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: "Chat with Doc",
    description: "Ask questions in natural language — answers grounded in exact page citations.",
  },
];

interface ActionCardsProps {
  onFileSelect: (file: File, action: string) => void;
  disabled?: boolean;
}

export default function ActionCards({ onFileSelect, disabled }: ActionCardsProps) {
  const mainInputRef    = useRef<HTMLInputElement>(null);
  const featureInputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const [dragOver, setDragOver]   = useState(false);

  function pick(file: File, action: string) {
    if (!disabled) onFileSelect(file, action);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) pick(file, "parse");
  }

  function handleMainChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) { pick(file, "parse"); e.target.value = ""; }
  }

  function handleFeatureChange(action: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) { pick(file, action); e.target.value = ""; }
  }

  return (
    <div>
      {/* ── Main Upload Zone ─────────────────────────────────────────────── */}
      <label
        className="block cursor-pointer"
        onDragOver={e => { e.preventDefault(); if (!disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          width: "100%",
          maxWidth: 680,
          margin: "0 auto",
          display: "block",
        }}
      >
        <input ref={mainInputRef} type="file" accept={ACCEPT} className="hidden"
          onChange={handleMainChange} disabled={disabled} />

        <div
          className="flex flex-col items-center justify-center gap-4 transition-all duration-200"
          style={{
            height: 180,
            borderRadius: 20,
            border: dragOver
              ? "2px solid var(--al-accent)"
              : "2px dashed rgba(5,150,105,0.30)",
            background: dragOver
              ? "rgba(5,150,105,0.07)"
              : "rgba(5,150,105,0.025)",
            transform: dragOver ? "scale(1.01)" : "scale(1)",
          }}
        >
          {/* Cloud icon */}
          <div className="cloud-float" style={{ color: "var(--al-accent)" }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
            </svg>
          </div>

          <div className="text-center">
            <p className="text-base font-semibold mb-1" style={{ color: "var(--al-text)" }}>
              {dragOver ? "Drop to upload" : "Drop your financial document here"}
            </p>
            <p className="text-sm" style={{ color: "var(--al-accent)" }}>
              or <span className="underline underline-offset-2">click to browse</span>
            </p>
          </div>

          {/* Format chips */}
          <div className="flex gap-2 flex-wrap justify-center">
            {["PDF", "DOCX", "PNG", "JPEG", "TIFF"].map(fmt => (
              <span key={fmt}
                className="text-xs px-2.5 py-0.5 rounded-full"
                style={{ background: "rgba(100,116,139,0.08)", color: "var(--al-subtle)" }}>
                {fmt}
              </span>
            ))}
          </div>
        </div>
      </label>

      {/* ── Feature Cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-10" style={{ maxWidth: 680, margin: "40px auto 0" }}>
        {FEATURES.map((f, i) => (
          <div key={f.id}
            className="fade-in-up rounded-2xl border p-5 flex flex-col gap-3 cursor-pointer transition-all duration-200 hover:-translate-y-0.5"
            style={{
              background:   "var(--al-card)",
              border:       "1px solid var(--al-border)",
              animationDelay: `${i * 0.08}s`,
            }}
            onClick={() => featureInputRef.current[f.id]?.click()}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `${f.color}18`, color: f.color }}>
              {f.icon}
            </div>
            <div>
              <h3 className="text-sm font-bold mb-1" style={{ color: "var(--al-text)" }}>{f.title}</h3>
              <p className="text-xs leading-relaxed" style={{ color: "var(--al-text-secondary)" }}>{f.description}</p>
            </div>
            <input
              ref={el => { featureInputRef.current[f.id] = el; }}
              type="file" accept={ACCEPT} className="hidden"
              onChange={e => handleFeatureChange(f.id, e)} disabled={disabled}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
