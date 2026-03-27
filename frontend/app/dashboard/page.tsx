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
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/report",
    label: "Reports",
    title: "Analyst-Grade Reports",
    desc: "GPT-4o reads the full document and writes structured reports covering Executive Summary, P&L breakdown, red flags and an investment conclusion. Export-ready in one click.",
    stat: "GPT-4o",
    color: "#2563eb",
    softBg: "rgba(37,99,235,0.08)",
    glowRgb: "37,99,235",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/finbot",
    label: "FinBot",
    title: "Live Market Intelligence",
    desc: "Real-time stock quotes, fundamentals, news and multi-ticker comparisons through a conversational AI interface powered by live market data.",
    stat: "Real-time",
    color: "#7c3aed",
    softBg: "rgba(124,58,237,0.08)",
    glowRgb: "124,58,237",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6"/>
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
    desc: "Drop any financial PDF — annual reports, 10-Ks, earnings releases.",
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
    title: "Process",
    desc: "Landing.AI ADE parses every element into a searchable vector index.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
      </svg>
    ),
  },
  {
    n: "03",
    title: "Analyze",
    desc: "Chat with the document, generate reports, or query FinBot for live market context.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
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
          padding: "32px 28px 28px",
          borderRadius: 20,
          border: `1.5px solid ${hov ? `rgba(${f.glowRgb},0.38)` : "rgba(0,0,0,0.07)"}`,
          background: hov ? "#fff" : "rgba(255,255,255,0.72)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          boxShadow: hov
            ? `0 22px 60px rgba(${f.glowRgb},0.16), 0 6px 20px rgba(0,0,0,0.07)`
            : "0 2px 12px rgba(0,0,0,0.05)",
          transform: hov ? "translateY(-8px)" : "none",
          transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
          textDecoration: "none",
          position: "relative",
          overflow: "hidden",
          cursor: "pointer",
          height: "100%",
          minHeight: 280,
        }}
      >
        {/* Top accent bar */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          background: `linear-gradient(90deg, ${f.color}, transparent 80%)`,
          opacity: hov ? 1 : 0,
          transition: "opacity 0.28s ease",
          borderRadius: "20px 20px 0 0",
        }} />

        {/* Header row: icon + stat */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            display: "grid", placeItems: "center",
            background: hov
              ? `linear-gradient(135deg, rgba(${f.glowRgb},0.18), rgba(${f.glowRgb},0.08))`
              : f.softBg,
            color: f.color,
            transition: "all 0.3s",
            transform: hov ? "scale(1.1)" : "scale(1)",
            boxShadow: hov ? `0 6px 20px rgba(${f.glowRgb},0.25)` : "none",
            flexShrink: 0,
          }}>
            {f.icon}
          </div>
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: hov ? f.color : "#94a3b8",
            padding: "4px 10px", borderRadius: 20,
            background: hov ? f.softBg : "rgba(0,0,0,0.04)",
            transition: "all 0.2s",
          }}>
            {f.stat}
          </span>
        </div>

        {/* Label pill */}
        <div style={{
          display: "inline-flex", alignItems: "center",
          padding: "2px 9px", borderRadius: 5,
          background: f.softBg, marginBottom: 12, alignSelf: "flex-start",
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: f.color }}>{f.label}</span>
        </div>

        {/* Title + desc */}
        <h3 style={{
          fontSize: 18, fontWeight: 700, color: "#0a0e1a",
          margin: "0 0 10px", letterSpacing: "-0.018em", lineHeight: 1.25,
        }}>
          {f.title}
        </h3>
        <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.72, margin: 0, flexGrow: 1 }}>
          {f.desc}
        </p>

        {/* Open CTA */}
        <div style={{
          marginTop: 24,
          display: "flex", alignItems: "center", gap: 5,
          fontSize: 13, fontWeight: 600,
          color: hov ? f.color : "#94a3b8",
          transition: "all 0.2s",
        }}>
          Open
          <span style={{
            transform: hov ? "translateX(5px)" : "none",
            transition: "transform 0.22s",
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

      {/* ── Ambient background ─────────────────────────────────────── */}
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "4%", left: "2%", width: 640, height: 640, borderRadius: "50%", background: "radial-gradient(circle,rgba(5,150,105,0.09) 0%,transparent 65%)", filter: "blur(52px)", animation: "blob1 22s ease-in-out infinite" }} />
        <div style={{ position: "absolute", top: "48%", right: "2%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle,rgba(37,99,235,0.07) 0%,transparent 65%)", filter: "blur(44px)", animation: "blob2 28s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: "8%", left: "22%", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle,rgba(5,150,105,0.05) 0%,transparent 65%)", filter: "blur(60px)" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle,rgba(0,0,0,0.04) 1px,transparent 1px)", backgroundSize: "28px 28px", maskImage: "radial-gradient(ellipse 90% 70% at 50% 30%,black 20%,transparent 80%)", WebkitMaskImage: "radial-gradient(ellipse 90% 70% at 50% 30%,black 20%,transparent 80%)" }} />
      </div>

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
              fontSize: "clamp(38px,4.2vw,62px)",
              fontWeight: 900, lineHeight: 1.07,
              letterSpacing: "-0.034em",
              marginBottom: 20, color: "#0a0e1a",
            }}>
              Your Financial<br />
              <span className="landing-gradient-text">Intelligence Hub</span>
            </h1>

            <p className="hero-sub" style={{
              fontSize: "clamp(15px,1.3vw,17px)",
              color: "#475569", lineHeight: 1.78,
              maxWidth: 450, marginBottom: 34,
            }}>
              Analyze financial documents, generate analyst-grade reports, and query live market data — all from a single platform.
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
                lineHeight: 1.15, color: "#0a0e1a",
              }}>
                From upload to insight<br />in three steps
              </h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 48, position: "relative" }} className="steps-grid">
              {/* Connector line */}
              <div style={{
                position: "absolute", top: 33, left: "16%", right: "16%", height: 2,
                background: "linear-gradient(90deg, #059669, rgba(16,185,129,0.15))",
                opacity: 0.3, borderRadius: 2, zIndex: 0,
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
              <div style={{ position: "absolute", top: "-50%", right: "-4%", width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle,rgba(14,165,233,0.12) 0%,transparent 65%)", pointerEvents: "none" }} />
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
