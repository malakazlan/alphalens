"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useState, useEffect, useRef } from "react";
import AnnouncementStrip from "@/components/layout/AnnouncementStrip";

// ── Scroll-reveal hook ─────────────────────────────────────────────────────────
function useReveal(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

// ── Data ───────────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    href: "/dashboard/analyzer",
    label: "Analyzer",
    title: "Document Intelligence",
    desc: "Upload any financial PDF and Landing.AI ADE parses every table, chart and text block with visual bounding-box grounding into a fully searchable knowledge index.",
    stat: "50 MB max",
    color: "#059669",
    softBg: "rgba(5,150,105,0.08)",
    glowRgb: "5,150,105",
    chips: ["Tables", "Bboxes", "JSON"],
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/>
        <polyline points="14 3 14 9 20 9"/>
        <rect x="7" y="12" width="6" height="2" rx="0.4" fill="currentColor" fillOpacity="0.18" stroke="none"/>
        <line x1="7" y1="13" x2="13" y2="13"/>
        <line x1="7" y1="16.5" x2="17" y2="16.5"/>
        <line x1="7" y1="19" x2="14" y2="19"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/report",
    label: "Reports",
    title: "Analyst-Grade Reports",
    desc: "GPT-4o reads the full document and writes structured reports covering Executive Summary, P&L breakdown, red flags and an investment conclusion. Export-ready in one click.",
    stat: "GPT-4o",
    color: "#047857",
    softBg: "rgba(4,120,87,0.08)",
    glowRgb: "4,120,87",
    chips: ["Executive", "Risk", "Investor Memo"],
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="20" x2="21" y2="20"/>
        <line x1="3" y1="20" x2="3" y2="4"/>
        <rect x="6" y="13" width="3.2" height="7" rx="0.4" fill="currentColor" fillOpacity="0.15"/>
        <rect x="11" y="9"  width="3.2" height="11" rx="0.4" fill="currentColor" fillOpacity="0.30"/>
        <rect x="16" y="5"  width="3.2" height="15" rx="0.4" fill="currentColor" fillOpacity="0.55"/>
        <polyline points="6.5 11 12.5 7 18 4" opacity="0.7"/>
        <circle cx="18" cy="4" r="1.2" fill="currentColor"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/finbot",
    label: "FinBot",
    title: "Live Market Intelligence",
    desc: "Real-time stock quotes, fundamentals, news and multi-ticker comparisons through a conversational AI interface powered by live market data.",
    stat: "Real-time",
    color: "#10b981",
    softBg: "rgba(16,185,129,0.08)",
    glowRgb: "16,185,129",
    chips: ["Quotes", "News", "Compare"],
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 19h18"/>
        <polyline points="3 16 8 11 11 13 16 6 21 9"/>
        <circle cx="16" cy="6" r="1.6" fill="currentColor"/>
        <circle cx="8" cy="11" r="1.2" fill="currentColor" fillOpacity="0.5"/>
        <circle cx="11" cy="13" r="1.2" fill="currentColor" fillOpacity="0.5"/>
      </svg>
    ),
  },
];

const STATS = [
  { value: "50 MB",   label: "Max file size" },
  { value: "~30s",    label: "Processing time" },
  { value: "GPT-4o",  label: "Report engine" },
  { value: "Live",    label: "Market data" },
];

const STEPS = [
  {
    n: "01",
    title: "Upload",
    desc: "Drop any financial PDF — annual reports, 10-Ks, prospectuses, audits. SHA-256 dedup catches re-uploads.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
    ),
  },
  {
    n: "02",
    title: "Parse & ground",
    desc: "Landing.AI ADE returns a structured tree — every chunk retains its page and bounding box.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <line x1="3" y1="9" x2="21" y2="9"/>
        <line x1="9" y1="9" x2="9" y2="21"/>
      </svg>
    ),
  },
  {
    n: "03",
    title: "Index",
    desc: "Section-aware chunks embedded into Qdrant; every cell in every table reachable by ID.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>
      </svg>
    ),
  },
  {
    n: "04",
    title: "Cite",
    desc: "Questions become answers; answers become highlights on the original page. Nothing un-sourced.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>
      </svg>
    ),
  },
];

// ── Feature Card ───────────────────────────────────────────────────────────────
function FeatureCard({ f, i }: { f: typeof FEATURES[0]; i: number }) {
  const [hov, setHov] = useState(false);
  const { ref, visible } = useReveal();

  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "none" : "translateY(28px)",
        transition: `opacity 0.55s ease ${i * 0.1}s, transform 0.55s cubic-bezier(0.22,1,0.36,1) ${i * 0.1}s`,
      }}
    >
      <Link
        href={f.href}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "30px 28px 26px",
          borderRadius: 22,
          border: `1.5px solid ${hov ? `rgba(${f.glowRgb},0.42)` : "rgba(0,0,0,0.06)"}`,
          background: hov ? "#fff" : "rgba(255,255,255,0.78)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          boxShadow: hov
            ? `0 28px 70px rgba(${f.glowRgb},0.18), 0 8px 24px rgba(0,0,0,0.06)`
            : "0 2px 10px rgba(0,0,0,0.04)",
          transform: hov ? "translateY(-10px)" : "none",
          transition: "all 0.32s cubic-bezier(0.4,0,0.2,1)",
          textDecoration: "none",
          position: "relative",
          overflow: "hidden",
          cursor: "pointer",
          height: "100%",
          minHeight: 320,
        }}
      >
        {/* Decorative dot pattern — emerges on hover */}
        <div aria-hidden style={{
          position: "absolute",
          top: -24, right: -24,
          width: 180, height: 180,
          opacity: hov ? 0.6 : 0,
          transition: "opacity 0.4s ease",
          backgroundImage: `radial-gradient(rgba(${f.glowRgb},0.18) 1px, transparent 1px)`,
          backgroundSize: "10px 10px",
          maskImage: "radial-gradient(circle at 100% 0%, black 0%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(circle at 100% 0%, black 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        {/* Top accent bar */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          background: `linear-gradient(90deg, ${f.color}, transparent 75%)`,
          opacity: hov ? 1 : 0,
          transition: "opacity 0.28s ease",
          borderRadius: "22px 22px 0 0",
        }} />

        {/* Corner accent — angled mark, premium detail */}
        <div aria-hidden style={{
          position: "absolute", top: 22, right: 22,
          width: 22, height: 22,
          borderTop: `1.5px solid ${hov ? f.color : "rgba(0,0,0,0.10)"}`,
          borderRight: `1.5px solid ${hov ? f.color : "rgba(0,0,0,0.10)"}`,
          transition: "border-color 0.28s ease",
          pointerEvents: "none",
        }} />

        {/* Header row: icon + stat */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, position: "relative", zIndex: 1 }}>
          <div style={{
            width: 60, height: 60, borderRadius: 16,
            display: "grid", placeItems: "center",
            background: hov
              ? `linear-gradient(135deg, ${f.color} 0%, ${f.color}D9 100%)`
              : `linear-gradient(135deg, rgba(${f.glowRgb},0.12), rgba(${f.glowRgb},0.06))`,
            color: hov ? "#fff" : f.color,
            transition: "all 0.32s cubic-bezier(0.4,0,0.2,1)",
            transform: hov ? "scale(1.06) rotate(-3deg)" : "scale(1) rotate(0)",
            boxShadow: hov
              ? `0 10px 28px rgba(${f.glowRgb},0.40), inset 0 1px 0 rgba(255,255,255,0.25)`
              : `0 1px 0 rgba(${f.glowRgb},0.08), inset 0 1px 0 rgba(255,255,255,0.5)`,
            flexShrink: 0,
            border: `1px solid rgba(${f.glowRgb},${hov ? "0" : "0.12"})`,
          }}>
            {f.icon}
          </div>
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: hov ? f.color : "#94a3b8",
            padding: "5px 10px", borderRadius: 20,
            background: hov ? f.softBg : "rgba(0,0,0,0.04)",
            border: `1px solid ${hov ? `rgba(${f.glowRgb},0.20)` : "transparent"}`,
            transition: "all 0.2s",
            letterSpacing: "0.01em",
            marginRight: 30,
          }}>
            {f.stat}
          </span>
        </div>

        {/* Label pill */}
        <div style={{
          display: "inline-flex", alignItems: "center",
          padding: "3px 10px", borderRadius: 6,
          background: f.softBg, marginBottom: 12, alignSelf: "flex-start",
          border: `1px solid rgba(${f.glowRgb},0.16)`,
          position: "relative", zIndex: 1,
        }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: f.color, letterSpacing: "0.06em", textTransform: "uppercase" }}>{f.label}</span>
        </div>

        {/* Title + desc */}
        <h3 style={{
          fontSize: 19, fontWeight: 700, color: "#0a0e1a",
          margin: "0 0 10px", letterSpacing: "-0.02em", lineHeight: 1.22,
          position: "relative", zIndex: 1,
        }}>
          {f.title}
        </h3>
        <p style={{
          fontSize: 14, color: "#64748b", lineHeight: 1.7, margin: 0,
          flexGrow: 1, position: "relative", zIndex: 1,
        }}>
          {f.desc}
        </p>

        {/* Output chips — what this tool produces */}
        <div style={{
          marginTop: 20,
          paddingTop: 16,
          borderTop: "1px dashed rgba(0,0,0,0.08)",
          display: "flex", flexWrap: "wrap", gap: 6,
          position: "relative", zIndex: 1,
        }}>
          {f.chips.map(c => (
            <span key={c} style={{
              fontSize: 11, fontWeight: 500,
              color: hov ? f.color : "#64748b",
              padding: "3px 9px",
              borderRadius: 5,
              background: hov ? f.softBg : "rgba(0,0,0,0.035)",
              border: `1px solid ${hov ? `rgba(${f.glowRgb},0.14)` : "transparent"}`,
              transition: "all 0.2s",
              letterSpacing: "-0.005em",
            }}>
              {c}
            </span>
          ))}
        </div>

        {/* Open CTA */}
        <div style={{
          marginTop: 18,
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 13, fontWeight: 600,
          color: hov ? f.color : "#94a3b8",
          transition: "all 0.2s",
          position: "relative", zIndex: 1,
        }}>
          Open {f.label}
          <span style={{
            transform: hov ? "translateX(6px)" : "none",
            transition: "transform 0.24s cubic-bezier(0.4,0,0.2,1)",
            display: "inline-block",
          }}>
            →
          </span>
        </div>
      </Link>
    </div>
  );
}

// ── Step Card ──────────────────────────────────────────────────────────────────
function StepCard({ step, i }: { step: typeof STEPS[0]; i: number }) {
  const [hov, setHov] = useState(false);
  const { ref, visible } = useReveal();

  return (
    <div
      ref={ref}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        textAlign: "center",
        position: "relative",
        zIndex: 1,
        opacity: visible ? 1 : 0,
        transform: visible ? "none" : "translateY(24px)",
        transition: `opacity 0.5s ease ${i * 0.15}s, transform 0.5s cubic-bezier(0.22,1,0.36,1) ${i * 0.15}s`,
      }}
    >
      <div style={{
        width: 68, height: 68, borderRadius: "50%",
        display: "grid", placeItems: "center",
        margin: "0 auto 18px",
        background: hov ? "#059669" : "rgba(255,255,255,0.9)",
        border: "2px solid #059669",
        boxShadow: hov
          ? "0 0 0 10px rgba(5,150,105,0.12), 0 8px 24px rgba(5,150,105,0.3)"
          : "0 0 0 8px rgba(5,150,105,0.07), 0 4px 12px rgba(5,150,105,0.1)",
        transition: "all 0.28s cubic-bezier(0.4,0,0.2,1)",
        transform: hov ? "scale(1.08)" : "none",
      }}>
        <span style={{
          fontSize: 15, fontWeight: 800,
          color: hov ? "#fff" : "#059669",
          transition: "color 0.22s",
        }}>
          {step.n}
        </span>
      </div>

      <div style={{
        width: 36, height: 36, borderRadius: 10,
        display: "grid", placeItems: "center",
        background: hov ? "rgba(5,150,105,0.14)" : "rgba(5,150,105,0.07)",
        color: "#059669",
        margin: "0 auto 12px",
        transition: "background 0.22s",
      }}>
        {step.icon}
      </div>

      <h3 style={{
        fontSize: 16, fontWeight: 700,
        color: hov ? "#059669" : "#0a0e1a",
        margin: "0 0 8px",
        letterSpacing: "-0.01em",
        transition: "color 0.22s",
      }}>
        {step.title}
      </h3>
      <p style={{
        fontSize: 14, color: "#64748b",
        lineHeight: 1.72, margin: 0,
        maxWidth: 230, marginLeft: "auto", marginRight: "auto",
      }}>
        {step.desc}
      </p>
    </div>
  );
}

// ── Citation Showcase ──────────────────────────────────────────────────────────
function CitationSection() {
  const { ref, visible } = useReveal(0.15);

  const POINTS = [
    { t: "Cell-level grounding",     d: "Click any number in the answer to highlight its exact bounding box on the source PDF." },
    { t: "Section-aware retrieval",  d: "Questions about the equity statement search the equity statement — not the balance sheet." },
    { t: "Multi-year disambiguation", d: "When the same row label appears under two sub-groups, both are returned, both labelled." },
    { t: "Parenthetical negatives",  d: "Values like (880,843) are matched and labelled as losses, not gains." },
  ];

  return (
    <section style={{ maxWidth: 1280, margin: "0 auto", padding: "40px clamp(16px,4vw,48px) 88px" }}>
      <div
        ref={ref}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.05fr",
          gap: "clamp(32px,5vw,72px)",
          alignItems: "center",
          opacity: visible ? 1 : 0,
          transform: visible ? "none" : "translateY(28px)",
          transition: "opacity 0.65s ease, transform 0.65s cubic-bezier(0.22,1,0.36,1)",
        }}
        className="cite-grid"
      >
        {/* LEFT — text + bullets */}
        <div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "5px 14px", borderRadius: 100,
            background: "rgba(5,150,105,0.07)",
            border: "1px solid rgba(5,150,105,0.2)",
            marginBottom: 18,
          }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#059669" }}>The differentiator</span>
          </div>

          <h2 style={{
            fontSize: "clamp(28px,3.2vw,46px)",
            fontWeight: 800, letterSpacing: "-0.028em",
            lineHeight: 1.1, marginBottom: 18, color: "#0a0e1a",
          }}>
            Every answer, <br />
            <span className="landing-gradient-text">cited to the cell</span>.
          </h2>

          <p style={{
            fontSize: 16, color: "#475569", lineHeight: 1.7,
            maxWidth: 520, marginBottom: 28,
          }}>
            Most AI tools paraphrase. AlphaLens pins. Every figure in every response carries a footnote back to its exact location on the original PDF — no hallucinations, no rounding, no <em style={{ color: "#0a0e1a", fontStyle: "normal", fontWeight: 500 }}>"the document says…"</em>
          </p>

          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {POINTS.map(p => (
              <li key={p.t} style={{
                display: "flex", gap: 14,
                padding: "14px 0",
                borderTop: "1px solid rgba(0,0,0,0.06)",
              }}>
                <span style={{
                  flexShrink: 0,
                  width: 24, height: 24, borderRadius: 7,
                  display: "grid", placeItems: "center",
                  background: "rgba(5,150,105,0.10)",
                  color: "#059669",
                  marginTop: 1,
                }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: "#0a0e1a", marginBottom: 3, letterSpacing: "-0.01em" }}>{p.t}</div>
                  <div style={{ fontSize: 13.5, color: "#64748b", lineHeight: 1.55 }}>{p.d}</div>
                </div>
              </li>
            ))}
            <li style={{ borderTop: "1px solid rgba(0,0,0,0.06)", padding: "14px 0 0" }} />
          </ul>
        </div>

        {/* RIGHT — chat demo card */}
        <div style={{ position: "relative" }}>
          {/* Soft glow */}
          <div aria-hidden style={{
            position: "absolute", inset: -40,
            background: "radial-gradient(ellipse 70% 60% at 60% 50%, rgba(5,150,105,0.10) 0%, transparent 70%)",
            pointerEvents: "none", zIndex: 0,
          }} />

          <div style={{
            position: "relative", zIndex: 1,
            borderRadius: 20, overflow: "hidden",
            background: "#fff",
            border: "1px solid rgba(0,0,0,0.07)",
            boxShadow: "0 28px 64px rgba(15,23,42,0.10), 0 8px 20px rgba(15,23,42,0.05)",
          }}>
            {/* Header bar */}
            <div style={{
              padding: "12px 18px",
              background: "linear-gradient(180deg,#fafbfc,#f4f6f9)",
              borderBottom: "1px solid rgba(0,0,0,0.06)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#059669", boxShadow: "0 0 0 3px rgba(5,150,105,0.2)" }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#0a0e1a", letterSpacing: "-0.01em" }}>9781513563602-mod01.pdf</span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 500, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>Page 4 · Chat</span>
            </div>

            {/* User message */}
            <div style={{ padding: "18px 20px 6px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>User</div>
              <div style={{
                display: "inline-block",
                background: "rgba(0,0,0,0.04)",
                padding: "10px 14px", borderRadius: 12,
                fontSize: 14, color: "#1f2937",
                border: "1px solid rgba(0,0,0,0.05)",
              }}>
                What was Total Assets in 2024?
              </div>
            </div>

            {/* Bot answer */}
            <div style={{ padding: "12px 20px 22px" }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: "#059669",
                letterSpacing: "0.06em", textTransform: "uppercase",
                marginBottom: 8,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#059669" }} />
                AlphaLens
              </div>
              <div style={{ fontSize: 14.5, lineHeight: 1.6, color: "#1f2937" }}>
                Total assets in 2024 were <b style={{ color: "#0a0e1a", fontVariantNumeric: "tabular-nums" }}>$312,500K</b><span style={{
                  display: "inline-block",
                  fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  fontSize: 10, color: "#2563eb",
                  background: "rgba(37,99,235,0.08)",
                  padding: "1px 5px", borderRadius: 3,
                  marginLeft: 3, verticalAlign: "1px",
                  letterSpacing: "0.02em",
                }}>[0-13]</span>, up from <b style={{ color: "#0a0e1a", fontVariantNumeric: "tabular-nums" }}>$284,100K</b><span style={{
                  display: "inline-block",
                  fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  fontSize: 10, color: "#2563eb",
                  background: "rgba(37,99,235,0.08)",
                  padding: "1px 5px", borderRadius: 3,
                  marginLeft: 3, verticalAlign: "1px",
                  letterSpacing: "0.02em",
                }}>[0-12]</span> in 2023 — a <b style={{ color: "#059669", fontVariantNumeric: "tabular-nums" }}>+10.0%</b> year-over-year increase.
              </div>

              {/* Source chips */}
              <div style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: "1px dashed rgba(0,0,0,0.08)",
                display: "flex", flexDirection: "column", gap: 6,
              }}>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2, fontWeight: 500 }}>
                  Visual reference for the answer:
                </div>
                {[
                  { lbl: "Total Assets · 2024 → 312,500" },
                  { lbl: "Total Assets · 2023 → 284,100" },
                ].map(c => (
                  <div key={c.lbl} style={{
                    display: "flex", alignItems: "center",
                    padding: "8px 12px",
                    border: "1px solid rgba(0,0,0,0.06)",
                    background: "rgba(0,0,0,0.02)",
                    borderRadius: 10,
                    fontSize: 12,
                  }}>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", color: "#94a3b8", fontSize: 11, marginRight: 10 }}>Pg 4 · table, cell</span>
                    <span style={{ color: "rgba(0,0,0,0.16)", marginRight: 10 }}>|</span>
                    <span style={{ flex: 1, color: "#2563eb", fontWeight: 500 }}>{c.lbl}</span>
                    <span style={{ color: "#2563eb", fontWeight: 600 }}>→</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function HomePage() {
  const { user } = useAuth();
  const firstName = user?.email?.split("@")[0] ?? "there";

  const featReveal = useReveal();
  const stepsReveal = useReveal();
  const ctaReveal = useReveal();

  return (
    <div style={{
      fontFamily: "Inter,-apple-system,BlinkMacSystemFont,sans-serif",
      background: "#f2f4f7",
      minHeight: "100%",
      overflowX: "hidden",
      position: "relative",
    }}>

      {/* Announcement strip — home only */}
      <AnnouncementStrip />

      {/* Atmosphere now provided by DashboardLayout — single source */}

      <div style={{ position: "relative", zIndex: 1 }}>

        {/* ══════════════════════════════════════════════════════════════
            HERO
        ══════════════════════════════════════════════════════════════ */}
        <section style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: "clamp(52px,6vw,92px) clamp(16px,4vw,48px) 68px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "clamp(32px,5vw,80px)",
          alignItems: "center",
        }} className="hero-grid">

          {/* Left copy */}
          <div>
            {/* Welcome badge */}
            <div className="hero-badge" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "6px 14px", borderRadius: 100,
              background: "rgba(5,150,105,0.08)",
              border: "1px solid rgba(5,150,105,0.22)",
              marginBottom: 24,
            }}>
              <span className="dot-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: "#059669", display: "block", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: "#059669" }}>
                Welcome back, {firstName}
              </span>
            </div>

            <h1 className="hero-h1" style={{
              fontSize: "clamp(40px,4.6vw,68px)",
              fontWeight: 900, lineHeight: 1.04,
              letterSpacing: "-0.038em",
              marginBottom: 22, color: "#0a0e1a",
            }}>
              Your Financial<br />
              <span className="landing-gradient-text">Intelligence Hub</span>
            </h1>

            <p className="hero-sub" style={{
              fontSize: "clamp(15px,1.3vw,17.5px)",
              color: "#475569", lineHeight: 1.7,
              maxWidth: 480, marginBottom: 36,
            }}>
              Analyze financial documents, generate analyst-grade reports, and query live market data — all from a single platform that <span style={{ color: "#0a0e1a", fontWeight: 500 }}>cites every figure to its source cell</span>.
            </p>

            {/* CTAs */}
            <div className="hero-ctas" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 34 }}>
              <Link href="/dashboard/analyzer" className="btn-green">
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2v16M2 10h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                </svg>
                Upload a Document
              </Link>
              <Link
                href="/dashboard/finbot"
                className="btn-ghost"
              >
                Ask FinBot
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
                  <path d="M5 10h10M12 7l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Link>
            </div>

            {/* Trust pills */}
            <div className="hero-trust" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {["Landing.AI ADE", "OpenAI GPT-4o", "Qdrant", "Live Data"].map(t => (
                <span key={t} style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  fontSize: 12, color: "#94a3b8", fontWeight: 500,
                  padding: "3px 10px", borderRadius: 20,
                  background: "rgba(0,0,0,0.04)",
                  border: "1px solid rgba(0,0,0,0.06)",
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#10b981", display: "block" }} />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Right — app screenshot */}
          <div className="hero-img" style={{ position: "relative" }}>
            <div style={{
              position: "absolute", inset: -70,
              background: "radial-gradient(ellipse 65% 50% at 50% 55%,rgba(5,150,105,0.13) 0%,transparent 70%)",
              pointerEvents: "none", zIndex: 0,
            }} />
            <div style={{
              position: "relative", zIndex: 1,
              borderRadius: 20, overflow: "hidden",
              boxShadow: "0 36px 80px rgba(5,150,105,0.14), 0 10px 28px rgba(0,0,0,0.1)",
              border: "1px solid rgba(0,0,0,0.08)",
            }}>
              <img
                src="/images/home.png"
                alt="Alpha Lens Dashboard"
                style={{ width: "100%", display: "block" }}
              />
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            STATS STRIP
        ══════════════════════════════════════════════════════════════ */}
        <div style={{
          background: "rgba(255,255,255,0.55)",
          backdropFilter: "blur(16px)",
          borderTop: "1px solid rgba(0,0,0,0.06)",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
        }}>
          <div style={{
            maxWidth: 1280, margin: "0 auto",
            padding: "0 clamp(16px,4vw,48px)",
            display: "grid", gridTemplateColumns: "repeat(4,1fr)",
          }} className="stats-row">
            {STATS.map((s, i) => (
              <div
                key={s.label}
                style={{
                  padding: "24px 20px", textAlign: "center",
                  borderRight: i < 3 ? "1px solid rgba(0,0,0,0.06)" : "none",
                  transition: "background 0.2s",
                  cursor: "default",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(5,150,105,0.04)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#0a0e1a", marginBottom: 3 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════
            FEATURE CARDS
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ maxWidth: 1280, margin: "0 auto", padding: "88px clamp(16px,4vw,48px) 88px" }}>
          <div
            ref={featReveal.ref}
            style={{
              textAlign: "center", marginBottom: 60,
              opacity: featReveal.visible ? 1 : 0,
              transform: featReveal.visible ? "none" : "translateY(24px)",
              transition: "opacity 0.6s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "5px 14px", borderRadius: 100,
              background: "rgba(5,150,105,0.07)",
              border: "1px solid rgba(5,150,105,0.2)",
              marginBottom: 16,
            }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#059669" }}>Core Tools</span>
            </div>
            <h2 style={{
              fontSize: "clamp(26px,3vw,44px)",
              fontWeight: 800, letterSpacing: "-0.028em",
              lineHeight: 1.12, marginBottom: 14, color: "#0a0e1a",
            }}>
              Three powerful tools,<br />
              <span className="landing-gradient-text">one platform</span>
            </h2>
            <p style={{ fontSize: 16, color: "#64748b", maxWidth: 460, margin: "0 auto", lineHeight: 1.72 }}>
              From raw PDF to live market intelligence — everything you need in a single workflow.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18 }} className="feat-grid">
            {FEATURES.map((f, i) => <FeatureCard key={f.href} f={f} i={i} />)}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            CITATION SHOWCASE — every answer cited to the cell
        ══════════════════════════════════════════════════════════════ */}
        <CitationSection />

        {/* ══════════════════════════════════════════════════════════════
            HOW IT WORKS
        ══════════════════════════════════════════════════════════════ */}
        <section style={{
          background: "rgba(255,255,255,0.45)",
          backdropFilter: "blur(12px)",
          borderTop: "1px solid rgba(0,0,0,0.05)",
          borderBottom: "1px solid rgba(0,0,0,0.05)",
        }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", padding: "80px clamp(16px,4vw,48px)" }}>
            <div
              ref={stepsReveal.ref}
              style={{
                textAlign: "center", marginBottom: 56,
                opacity: stepsReveal.visible ? 1 : 0,
                transform: stepsReveal.visible ? "none" : "translateY(24px)",
                transition: "opacity 0.6s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1)",
              }}
            >
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "5px 14px", borderRadius: 100,
                background: "rgba(5,150,105,0.07)",
                border: "1px solid rgba(5,150,105,0.2)",
                marginBottom: 16,
              }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#059669" }}>Workflow</span>
              </div>
              <h2 style={{
                fontSize: "clamp(24px,2.8vw,40px)",
                fontWeight: 800, letterSpacing: "-0.025em",
                lineHeight: 1.15, color: "#0a0e1a", marginBottom: 12,
              }}>
                From upload to <span className="landing-gradient-text">cited answer</span>
              </h2>
              <p style={{ fontSize: 16, color: "#64748b", maxWidth: 520, margin: "0 auto", lineHeight: 1.7 }}>
                A document arrives as paper. It leaves as a queryable knowledge base — every cell reachable by ID, every figure cited.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 32, position: "relative" }} className="steps-grid">
              {/* Connector line — spans across all 4 step circles */}
              <div style={{
                position: "absolute", top: 33, left: "12%", right: "12%", height: 2,
                background: "linear-gradient(90deg, rgba(4,120,87,0.4), rgba(16,185,129,0.4) 50%, rgba(52,211,153,0.15))",
                opacity: 0.45, borderRadius: 2, zIndex: 0,
              }} />
              {STEPS.map((s, i) => <StepCard key={s.n} step={s} i={i} />)}
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            DARK CTA BANNER
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ maxWidth: 1280, margin: "0 auto", padding: "80px clamp(16px,4vw,48px)" }}>
          <div
            ref={ctaReveal.ref}
            style={{
              opacity: ctaReveal.visible ? 1 : 0,
              transform: ctaReveal.visible ? "none" : "translateY(28px)",
              transition: "opacity 0.7s ease, transform 0.7s cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            <div style={{
              borderRadius: 24,
              padding: "clamp(40px,5vw,72px) clamp(24px,4vw,64px)",
              background: "linear-gradient(135deg, #0a0e1a 0%, #0d1f18 50%, #0a1320 100%)",
              position: "relative", overflow: "hidden", textAlign: "center",
            }}>
              {/* Glows */}
              <div style={{ position: "absolute", top: "-50%", left: "-4%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle,rgba(5,150,105,0.22) 0%,transparent 65%)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", top: "-50%", right: "-4%", width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle,rgba(16,185,129,0.16) 0%,transparent 65%)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle,rgba(255,255,255,0.03) 1px,transparent 1px)", backgroundSize: "24px 24px", pointerEvents: "none" }} />

              <div style={{ position: "relative", zIndex: 1 }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "5px 14px", borderRadius: 100,
                  background: "rgba(5,150,105,0.18)",
                  border: "1px solid rgba(5,150,105,0.35)",
                  marginBottom: 20,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", display: "block" }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#34d399" }}>Ready to start?</span>
                </div>

                <h2 style={{
                  fontSize: "clamp(26px,3.2vw,48px)",
                  fontWeight: 800, letterSpacing: "-0.03em",
                  lineHeight: 1.1, color: "#fff", marginBottom: 16,
                }}>
                  Analyze your first document<br />in under 30 seconds
                </h2>
                <p style={{
                  fontSize: 16, color: "rgba(255,255,255,0.52)",
                  maxWidth: 480, margin: "0 auto 32px", lineHeight: 1.75,
                }}>
                  Upload any financial PDF and let Alpha Lens extract, structure, and explain every data point.
                </p>
                <Link href="/dashboard/analyzer" className="btn-green" style={{ display: "inline-flex" }}>
                  <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                    <path d="M10 2v16M2 10h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                  </svg>
                  Go to Analyzer
                </Link>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
