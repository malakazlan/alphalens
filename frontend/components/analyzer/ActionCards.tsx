"use client";
import { useRef, useState } from "react";

const ACCEPT = ".pdf,.docx,.doc,.html,.htm,.png,.jpg,.jpeg,.tiff,.tif,.webp";

// ── Three instruments — colors + content from design/analyzer.html ────────────
const FEATURES = [
  {
    id: "parse",
    color: "#059669",                 // emerald
    glowRgb: "5,150,105",
    softBg: "rgba(5,150,105,0.08)",
    n: "№ 01",
    sub: "Document Intelligence",
    titleLead: "Parse",
    titleTrail: "a document",
    body: "Vision-grade extraction. Tables, figures, paragraphs — every chunk grounded to its bounding box on every page.",
    metaLeft: "VIA LANDING.AI ADE",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    id: "extract",
    color: "#2563eb",                 // blue (per design)
    glowRgb: "37,99,235",
    softBg: "rgba(37,99,235,0.08)",
    n: "№ 02",
    sub: "Schema Extraction",
    titleLead: "Extract",
    titleTrail: "financials",
    body: "Income statement, balance sheet, cash flow, and key ratios — lifted into clean JSON with confidence per field.",
    metaLeft: "28 STRUCTURED FIELDS",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" />
        <line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
  },
  {
    id: "chat",
    color: "#c026d3",                 // magenta (per design)
    glowRgb: "192,38,211",
    softBg: "rgba(192,38,211,0.08)",
    n: "№ 03",
    sub: "Conversational Analysis",
    titleLead: "Chat",
    titleTrail: "with a document",
    body: "Ask in natural language. Every figure in the answer carries a citation back to its exact cell on the original page.",
    metaLeft: "CITED ANSWERS",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

export type ParseScope = "core" | "full";

interface ActionCardsProps {
  onFileSelect: (file: File, action: string, parseScope: ParseScope) => void;
  disabled?: boolean;
}

export default function ActionCards({ onFileSelect, disabled }: ActionCardsProps) {
  const mainInputRef    = useRef<HTMLInputElement>(null);
  const featureInputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const [dragOver,   setDragOver]   = useState(false);
  const [hoveredId,  setHoveredId]  = useState<string | null>(null);
  // Cost Lever 4: Core (default, ~50% cheaper) trims TOC/exhibits/blanks
  // and runs Extract on a financial-section-only subset. Full parses
  // everything. Sticky in component state so the user's last choice
  // persists across re-renders within the same session.
  const [parseScope, setParseScope] = useState<ParseScope>("core");

  function pick(file: File, action: string) {
    if (!disabled) onFileSelect(file, action, parseScope);
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
      {/* ═══ PARSE-MODE TOGGLE (Cost Lever 4) ════════════════════════════ */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "flex-end",
        gap: 8, marginBottom: 12,
      }}>
        <span style={{ fontSize: 11.5, color: "var(--al-subtle)", letterSpacing: "0.02em" }}>
          Parse mode
        </span>
        <div
          role="tablist"
          aria-label="Parse scope"
          style={{
            display: "inline-flex",
            background: "rgba(0,0,0,0.04)",
            border: "1px solid rgba(0,0,0,0.06)",
            borderRadius: 8,
            padding: 2,
          }}
        >
          {([
            { val: "core", label: "Core",  hint: "Skips TOC, exhibits, blanks. ~50% cheaper. Default." },
            { val: "full", label: "Full",  hint: "Parses every page. Higher cost." },
          ] as const).map(opt => {
            const active = parseScope === opt.val;
            return (
              <button
                key={opt.val}
                type="button"
                role="tab"
                aria-selected={active}
                title={opt.hint}
                onClick={() => setParseScope(opt.val)}
                disabled={disabled}
                style={{
                  padding: "4px 12px",
                  fontSize: 11.5,
                  fontWeight: active ? 600 : 500,
                  color: active ? "#fff" : "var(--al-text-secondary)",
                  background: active ? "var(--al-accent)" : "transparent",
                  border: "none",
                  borderRadius: 6,
                  cursor: disabled ? "not-allowed" : "pointer",
                  transition: "all 180ms ease",
                  letterSpacing: "0.01em",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ DROP ZONE ═══════════════════════════════════════════════════ */}
      <label
        onDragOver={e => { e.preventDefault(); if (!disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          display: "block",
          background: dragOver
            ? "linear-gradient(180deg, #FFF 0%, rgba(5,150,105,0.06) 100%)"
            : "var(--al-card)",
          border: `1.5px dashed ${dragOver ? "#059669" : "rgba(0,0,0,0.14)"}`,
          borderRadius: 20,
          padding: "64px 48px",
          textAlign: "center",
          cursor: disabled ? "not-allowed" : "pointer",
          position: "relative",
          marginBottom: 40,
          transition: "all 240ms cubic-bezier(0.4,0,0.2,1)",
          transform: dragOver ? "scale(1.005)" : "none",
        }}
        className="dropzone-shell"
      >
        {/* Inset hairline frame — design detail */}
        <span aria-hidden style={{
          position: "absolute", inset: 8,
          border: `1px solid ${dragOver ? "rgba(5,150,105,0.32)" : "rgba(0,0,0,0.05)"}`,
          borderRadius: 14,
          pointerEvents: "none",
          transition: "border-color 240ms ease",
        }} />

        <input
          ref={mainInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={handleMainChange}
          disabled={disabled}
          style={{ display: "none" }}
        />

        {/* Rounded ink-bordered icon block */}
        <div
          className="cloud-float"
          style={{
            width: 64, height: 64,
            margin: "0 auto 24px",
            border: `1px solid ${dragOver ? "#059669" : "var(--al-text)"}`,
            borderRadius: 16,
            color: dragOver ? "#059669" : "var(--al-text)",
            background: dragOver ? "rgba(5,150,105,0.04)" : "var(--al-bg-soft)",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 240ms ease",
            transform: dragOver ? "translateY(-4px)" : "none",
            position: "relative", zIndex: 1,
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M12 4v12m0-12l-4 4m4-4l4 4M4 18v2a2 2 0 002 2h12a2 2 0 002-2v-2"
              stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {/* Title — Inter, bold, gradient on accent */}
        <h2 style={{
          fontWeight: 800,
          fontSize: "clamp(24px, 2.8vw, 32px)",
          lineHeight: 1.1,
          letterSpacing: "-0.028em",
          color: "var(--al-text)",
          marginBottom: 10,
          position: "relative", zIndex: 1,
        }}>
          {dragOver ? (
            <span className="landing-gradient-text">Drop to upload</span>
          ) : (
            <>
              Drop your{" "}
              <span className="landing-gradient-text">financial document</span>
            </>
          )}
        </h2>

        {/* Subtitle — Inter regular */}
        <p style={{
          fontWeight: 400,
          fontSize: 14.5,
          color: "var(--al-text-secondary)",
          marginBottom: 28,
          position: "relative", zIndex: 1,
        }}>
          or{" "}
          <span style={{
            color: "#059669",
            fontWeight: 600,
            cursor: disabled ? "not-allowed" : "pointer",
          }}>
            click to browse
          </span>{" "}
          from your machine
        </p>

        {/* Format chips with · separators */}
        <div style={{
          display: "flex", gap: 16,
          justifyContent: "center", flexWrap: "wrap",
          paddingTop: 22,
          borderTop: "1px solid rgba(0,0,0,0.06)",
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 11,
          letterSpacing: "0.08em",
          color: "var(--al-subtle)",
          position: "relative", zIndex: 1,
        }}>
          {["PDF", "DOCX", "HTML", "PNG · JPG · TIFF", "≤ 50 MB"].map((f, i, arr) => (
            <span key={f} style={{ padding: "4px 0", display: "inline-flex", alignItems: "center", gap: 16 }}>
              {f}
              {i < arr.length - 1 && (
                <span aria-hidden style={{ color: "rgba(0,0,0,0.18)" }}>·</span>
              )}
            </span>
          ))}
        </div>
      </label>

      {/* ═══ THREE INSTRUMENTS ═══════════════════════════════════════════ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
        }}
        className="instruments-grid"
      >
        {FEATURES.map((f, i) => {
          const isHov = hoveredId === f.id;
          return (
            <div
              key={f.id}
              onMouseEnter={() => setHoveredId(f.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => featureInputRef.current[f.id]?.click()}
              style={{
                background: "var(--al-card)",
                border: `1px solid ${isHov ? "rgba(15,23,42,0.18)" : "rgba(0,0,0,0.07)"}`,
                borderRadius: 20,
                padding: "30px 26px 24px",
                cursor: disabled ? "not-allowed" : "pointer",
                transition: "all 240ms cubic-bezier(0.4,0,0.2,1)",
                position: "relative",
                overflow: "hidden",
                transform: isHov ? "translateY(-2px)" : "none",
                boxShadow: isHov
                  ? "0 24px 48px -16px rgba(15,23,42,0.10), 0 4px 12px rgba(15,23,42,0.04)"
                  : "0 1px 2px rgba(15,23,42,0.04)",
                animation: `fade-in-up 0.45s cubic-bezier(0.22,1,0.36,1) ${i * 0.08}s both`,
              }}
            >
              {/* Bottom accent bar — slides in on hover */}
              <span aria-hidden style={{
                position: "absolute",
                bottom: 0, left: 0, right: 0,
                height: 3,
                background: f.color,
                borderRadius: "0 0 20px 20px",
                transform: isHov ? "scaleX(1)" : "scaleX(0)",
                transformOrigin: "left",
                transition: "transform 240ms ease",
              }} />

              {/* Top row: number + icon */}
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 22,
              }}>
                <span style={{
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  color: "var(--al-subtle)",
                  display: "inline-flex", alignItems: "center", gap: 8,
                }}>
                  {f.n}
                  <span aria-hidden style={{
                    width: 7, height: 7,
                    background: f.color,
                    display: "inline-block",
                  }} />
                </span>

                {/* Existing icon — preserved from old ActionCards */}
                <div style={{
                  width: 40, height: 40,
                  background: f.softBg,
                  color: f.color,
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center", justifyContent: "center",
                  border: `1px solid rgba(${f.glowRgb},${isHov ? "0.24" : "0.12"})`,
                  transition: "all 240ms ease",
                  transform: isHov ? "rotate(-3deg)" : "none",
                }}>
                  {f.icon}
                </div>
              </div>

              {/* Sub-label (mono uppercase) */}
              <div style={{
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 10.5,
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                color: "var(--al-subtle)",
                fontWeight: 600,
                marginBottom: 12,
              }}>
                {f.sub}
              </div>

              {/* Title — Inter bold with colored accent on lead word */}
              <h3 style={{
                fontWeight: 800,
                fontSize: 22,
                lineHeight: 1.1,
                letterSpacing: "-0.025em",
                color: "var(--al-text)",
                marginBottom: 10,
              }}>
                <span style={{ color: f.color }}>{f.titleLead}</span>{" "}
                {f.titleTrail}
              </h3>

              {/* Body — Inter regular */}
              <p style={{
                fontWeight: 400,
                fontSize: 14,
                lineHeight: 1.6,
                color: "var(--al-text-secondary)",
                paddingBottom: 18,
                marginBottom: 14,
                borderBottom: "1px dashed rgba(0,0,0,0.08)",
              }}>
                {f.body}
              </p>

              {/* Meta footer */}
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 10.5,
                letterSpacing: "0.06em",
                color: "var(--al-subtle)",
              }}>
                <span>{f.metaLeft}</span>
                <span style={{
                  color: f.color,
                  display: "inline-flex", alignItems: "center", gap: 5,
                  transition: "transform 200ms ease",
                  transform: isHov ? "translateX(3px)" : "none",
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                }}>
                  Open <span style={{ fontFamily: "inherit" }}>→</span>
                </span>
              </div>

              <input
                ref={el => { featureInputRef.current[f.id] = el; }}
                type="file"
                accept={ACCEPT}
                onChange={e => handleFeatureChange(f.id, e)}
                disabled={disabled}
                style={{ display: "none" }}
              />
            </div>
          );
        })}
      </div>

      {/* Inline keyframes — fade-in-up animation */}
      <style jsx>{`
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
