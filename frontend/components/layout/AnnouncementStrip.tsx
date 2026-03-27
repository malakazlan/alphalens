"use client";
import { useState } from "react";
import Link from "next/link";

// No localStorage — strip shows on every home page visit.
// Dismissing hides it for the current visit only (state resets on remount).

const ITEMS = [
  { text: "Agentic Document Extraction powered by Landing.AI ADE",          btn: "Learn More",  href: "/dashboard/docs#analyzer"  },
  { text: "Visual bounding box grounding on every PDF element",              btn: "See How",     href: "/dashboard/docs#analyzer"  },
  { text: "GPT-4o analyst reports generated in under 30 seconds",           btn: "Try Now",     href: "/dashboard/report"         },
  { text: "Real time market intelligence and live stock data with FinBot",   btn: "Explore",     href: "/dashboard/finbot"         },
  { text: "Semantic vector search across all document content via Qdrant",   btn: "Read More",   href: "/dashboard/docs#technical" },
  { text: "Extract structured financials from any financial PDF automatically", btn: "Get Started", href: "/dashboard/analyzer"  },
];

function TickerRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
      {ITEMS.map((item, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "0 24px" }}>
          {i > 0 && (
            <span style={{ color: "rgba(96,165,250,0.3)", fontWeight: 300, fontSize: 16, marginRight: 4 }}>·</span>
          )}
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", fontWeight: 400, letterSpacing: "0.005em" }}>
            {item.text}
          </span>
          <Link
            href={item.href}
            style={{
              fontSize: 11, fontWeight: 600, color: "#60a5fa",
              border: "1px solid rgba(96,165,250,0.45)",
              padding: "3px 11px", borderRadius: 4,
              textDecoration: "none", letterSpacing: "0.01em", flexShrink: 0,
              transition: "background 0.18s, border-color 0.18s, color 0.18s",
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = "rgba(96,165,250,0.15)";
              el.style.borderColor = "rgba(96,165,250,0.75)";
              el.style.color = "#93c5fd";
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = "transparent";
              el.style.borderColor = "rgba(96,165,250,0.45)";
              el.style.color = "#60a5fa";
            }}
          >
            {item.btn}
          </Link>
        </span>
      ))}
    </div>
  );
}

export default function AnnouncementStrip() {
  const [visible, setVisible] = useState(true);
  const [paused,  setPaused]  = useState(false);

  if (!visible) return null;

  return (
    <div
      style={{
        height: 42, background: "#0a0e1a",
        borderBottom: "1px solid rgba(37,99,235,0.18)",
        position: "relative", overflow: "hidden", flexShrink: 0,
        contain: "layout style paint",
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Fade edges */}
      <div style={{ position: "absolute", top: 0, left: 0, width: 80, height: "100%", background: "linear-gradient(90deg,#0a0e1a,transparent)", zIndex: 2, pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 0, right: 44, width: 80, height: "100%", background: "linear-gradient(270deg,#0a0e1a,transparent)", zIndex: 2, pointerEvents: "none" }} />

      <div className="ticker-wrap" style={{ height: "100%", display: "flex", alignItems: "center" }}>
        <div className="ticker-inner" style={{ animationDuration: "62s", animationPlayState: paused ? "paused" : "running" }}>
          <TickerRow /><TickerRow />
        </div>
      </div>

      <button
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
        style={{
          position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
          background: "transparent", border: "none", cursor: "pointer",
          padding: 5, zIndex: 3, color: "rgba(255,255,255,0.35)",
          transition: "color 0.15s", display: "flex", alignItems: "center",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.35)"; }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}
