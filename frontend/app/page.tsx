"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";

// ── Scroll-reveal hook ───────────────────────────────────────────────────────
function useReveal(threshold = 0.1) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible: !mounted || visible };
}

// ── Data ─────────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    label: "Analyzer",
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    title: "Document Intelligence",
    desc: "Upload any financial PDF. Landing.AI ADE parses every element including tables, charts and text with visual bounding-box grounding and builds a fully searchable knowledge index.",
    stat: "50MB max",
  },
  {
    label: "Reports",
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
    title: "Analyst-Grade Reports",
    desc: "GPT-4o reads the full document and writes a structured analyst report covering Executive Summary, P&L breakdown, red flags and an investment conclusion. Export-ready in one click.",
    stat: "GPT-4o powered",
  },
  {
    label: "Chat",
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
    title: "Cited Document Chat",
    desc: "Ask questions in plain English and receive answers grounded to exact pages. Every response includes citation chips you can click to jump directly to the source in the live PDF viewer.",
    stat: "Vector search",
  },
  {
    label: "FinBot",
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6"/></svg>,
    title: "Live Market Intelligence",
    desc: "Real-time stock quotes, fundamentals, news and multi-ticker comparisons through a conversational AI interface powered by live market data from yfinance.",
    stat: "Real-time data",
  },
];

const STEPS = [
  { n: "01", title: "Upload Your Document", desc: "Drop any financial PDF including annual reports, 10-Ks and earnings releases. Up to 50 MB, processed in seconds.", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> },
  { n: "02", title: "AI Processes", desc: "Landing.AI ADE parses structure and extracts every table, figure and text block with visual grounding into a searchable vector index.", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg> },
  { n: "03", title: "Analyze and Act", desc: "Browse extracted financials, chat with the document, generate a full analyst report or query FinBot for live market context.", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
];

// ── Feature card ─────────────────────────────────────────────────────────────
function FeatureCard({ f, i }: { f: typeof FEATURES[0]; i: number }) {
  const { ref, visible } = useReveal();
  const [hov, setHov] = useState(false);
  return (
    <div ref={ref} style={{ opacity: visible ? 1 : 0, transform: visible ? "none" : "translateY(36px)", transition: `opacity 0.65s ease ${i * 0.09}s, transform 0.65s cubic-bezier(0.22,1,0.36,1) ${i * 0.09}s` }}>
      <Link href="/login" style={{ display: "flex", flexDirection: "column", gap: 0, textDecoration: "none", padding: "36px 34px 30px", borderRadius: 20, border: `1.5px solid ${hov ? "rgba(5,150,105,0.35)" : "rgba(0,0,0,0.07)"}`, background: hov ? "#fff" : "rgba(255,255,255,0.68)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)", transform: hov ? "translateY(-7px)" : "none", boxShadow: hov ? "0 24px 64px rgba(5,150,105,0.1), 0 6px 20px rgba(0,0,0,0.07)" : "0 2px 8px rgba(0,0,0,0.04)" }}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 }}>
          <div style={{ width: 50, height: 50, borderRadius: 13, display: "grid", placeItems: "center", background: hov ? "linear-gradient(135deg,rgba(5,150,105,0.15),rgba(16,185,129,0.08))" : "rgba(5,150,105,0.07)", color: hov ? "#059669" : "#374151", transition: "all 0.3s", flexShrink: 0 }}>{f.icon}</div>
          <span style={{ fontSize: 11, fontWeight: 600, color: hov ? "#059669" : "#94a3b8", padding: "4px 10px", borderRadius: 20, background: hov ? "rgba(5,150,105,0.08)" : "rgba(0,0,0,0.04)", transition: "all 0.2s" }}>{f.stat}</span>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 5, background: "rgba(5,150,105,0.07)", marginBottom: 12, alignSelf: "flex-start" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#059669" }}>{f.label}</span>
        </div>
        <h3 style={{ fontSize: 19, fontWeight: 700, color: "#0a0e1a", margin: "0 0 10px", letterSpacing: "-0.018em", lineHeight: 1.25 }}>{f.title}</h3>
        <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.72, margin: 0, flexGrow: 1 }}>{f.desc}</p>
        <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 600, color: hov ? "#059669" : "#94a3b8", transition: "all 0.2s" }}>
          Explore <span style={{ transform: hov ? "translateX(4px)" : "none", transition: "transform 0.22s", display: "inline-block" }}>→</span>
        </div>
      </Link>
    </div>
  );
}

// ── Step card ─────────────────────────────────────────────────────────────────
function StepCard({ step, i }: { step: typeof STEPS[0]; i: number }) {
  const { ref, visible } = useReveal();
  return (
    <div ref={ref} style={{ textAlign: "center", position: "relative", zIndex: 1, opacity: visible ? 1 : 0, transform: visible ? "none" : "translateY(28px)", transition: `opacity 0.55s ease ${i * 0.15}s, transform 0.55s cubic-bezier(0.22,1,0.36,1) ${i * 0.15}s` }}>
      <div style={{ width: 72, height: 72, borderRadius: "50%", display: "grid", placeItems: "center", margin: "0 auto 20px", background: "rgba(255,255,255,0.9)", border: "2px solid #059669", boxShadow: "0 0 0 8px rgba(5,150,105,0.08), 0 6px 20px rgba(5,150,105,0.1)" }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: "#059669" }}>{step.n}</span>
      </div>
      <div style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", background: "rgba(5,150,105,0.08)", color: "#059669", margin: "0 auto 14px" }}>{step.icon}</div>
      <h3 style={{ fontSize: 17, fontWeight: 700, color: "#0a0e1a", margin: "0 0 10px", letterSpacing: "-0.01em" }}>{step.title}</h3>
      <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.72, margin: 0, maxWidth: 240, marginLeft: "auto", marginRight: "auto" }}>{step.desc}</p>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const featReveal   = useReveal();
  const howReveal    = useReveal();
  const imgReveal    = useReveal();
  const quoteReveal  = useReveal();
  const ctaReveal    = useReveal();

  return (
    <div style={{ fontFamily:"Inter,-apple-system,BlinkMacSystemFont,sans-serif", background:"#f2f4f7", color:"#0a0e1a", overflowX:"hidden", position:"relative" }}>

      {/* Ambient background */}
      <div aria-hidden style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0, overflow:"hidden" }}>
        <div className="blob-a" style={{ position:"absolute", top:"5%", left:"3%", width:700, height:700, borderRadius:"50%", background:"radial-gradient(circle,rgba(5,150,105,0.09) 0%,transparent 65%)", filter:"blur(48px)" }} />
        <div className="blob-b" style={{ position:"absolute", top:"45%", right:"2%", width:550, height:550, borderRadius:"50%", background:"radial-gradient(circle,rgba(14,165,233,0.065) 0%,transparent 65%)", filter:"blur(44px)" }} />
        <div style={{ position:"absolute", bottom:"8%", left:"18%", width:450, height:450, borderRadius:"50%", background:"radial-gradient(circle,rgba(5,150,105,0.05) 0%,transparent 65%)", filter:"blur(56px)" }} />
        <div style={{ position:"absolute", inset:0, backgroundImage:"radial-gradient(circle,rgba(0,0,0,0.045) 1px,transparent 1px)", backgroundSize:"30px 30px", maskImage:"radial-gradient(ellipse 90% 70% at 50% 30%,black 20%,transparent 80%)", WebkitMaskImage:"radial-gradient(ellipse 90% 70% at 50% 30%,black 20%,transparent 80%)" }} />
      </div>

      <div style={{ position:"relative", zIndex:1 }}>

        {/* Nav */}
        <header style={{ position:"sticky", top:0, zIndex:100, transition:"background .3s,box-shadow .3s", background: scrolled ? "rgba(242,244,247,0.96)" : "rgba(242,244,247,0.6)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", borderBottom: scrolled ? "1px solid rgba(0,0,0,0.08)" : "1px solid transparent", boxShadow: scrolled ? "0 2px 20px rgba(0,0,0,0.07)" : "none" }}>
          <div style={{ maxWidth:1280, margin:"0 auto", padding:"0 clamp(16px,4vw,48px)", height:66, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <Link href="/" style={{ display:"flex", alignItems:"center", gap:12, textDecoration:"none" }}>
              <div style={{ width:40, height:40, borderRadius:10, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(135deg,#059669,#10b981)", boxShadow:"0 2px 8px rgba(5,150,105,0.3)", flexShrink:0 }}>
                <img src="/images/ALPHA LENS LOGO.png" alt="Alpha Lens" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
              </div>
              <span style={{ fontWeight:700, fontSize:19, letterSpacing:"-0.02em", color:"#0a0e1a" }}>Alpha Lens</span>
            </Link>
            <nav className="nav-links" style={{ display:"flex", alignItems:"center", gap:2 }}>
              <a href="#features" className="nav-a">Features</a>
              <a href="#how" className="nav-a">How it works</a>
              <Link href="/login" className="nav-a">Sign in</Link>
              <Link href="/login" className="btn-green" style={{ marginLeft:10, padding:"9px 20px", fontSize:14 }}>Get Started</Link>
            </nav>
          </div>
        </header>

        {/* Hero */}
        <section style={{ maxWidth:1340, margin:"0 auto", padding:"clamp(64px,9vw,110px) clamp(16px,4vw,48px) 80px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:"clamp(32px,5vw,80px)", alignItems:"center" }} className="hero-grid">

          {/* Left copy */}
          <div>
            <div className="hero-badge" style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"6px 14px", borderRadius:100, background:"rgba(5,150,105,0.08)", border:"1px solid rgba(5,150,105,0.22)", marginBottom:26 }}>
              <span className="dot-pulse" style={{ width:7, height:7, borderRadius:"50%", background:"#059669", display:"block", flexShrink:0 }} />
              <span style={{ fontSize:13, fontWeight:500, color:"#059669" }}>AI-Powered Financial Intelligence</span>
            </div>

            <h1 className="hero-h1" style={{ fontSize:"clamp(40px,4.8vw,68px)", fontWeight:900, lineHeight:1.06, letterSpacing:"-0.035em", marginBottom:22 }}>
              Transform Your<br />
              <span className="landing-gradient-text">Financial Analysis</span>
            </h1>

            <p className="hero-sub" style={{ fontSize:"clamp(16px,1.4vw,18px)", color:"#475569", lineHeight:1.75, maxWidth:470, marginBottom:36 }}>
              Upload financial documents and let AI extract structured data, generate analyst-grade reports and answer questions with exact source citations. All in under 30 seconds.
            </p>

            <div className="hero-ctas" style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"center", marginBottom:30 }}>
              <Link href="/login" className="btn-green">
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><path d="M10 2v16M2 10h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
                Start Analyzing Free
              </Link>
              <a href="#features" className="btn-ghost">
                See Features
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M5 10h10M12 7l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </a>
            </div>

            <div className="hero-trust" style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
              {["Landing.AI ADE","OpenAI GPT-4o","Qdrant","Supabase"].map(t => (
                <span key={t} style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:12, color:"#94a3b8", padding:"3px 10px", borderRadius:20, background:"rgba(0,0,0,0.04)", border:"1px solid rgba(0,0,0,0.06)", fontWeight:500 }}>
                  <span style={{ width:5, height:5, borderRadius:"50%", background:"#10b981", display:"block" }} />{t}
                </span>
              ))}
            </div>
          </div>

          {/* Right — Landing-page.png */}
          <div className="hero-img hero-img-col" style={{ position:"relative" }}>
            <div style={{ position:"absolute", inset:-80, background:"radial-gradient(ellipse 65% 50% at 50% 55%,rgba(5,150,105,0.13) 0%,transparent 70%)", pointerEvents:"none", zIndex:0 }} />
            <div style={{ position:"relative", zIndex:1, borderRadius:20, overflow:"hidden", boxShadow:"0 40px 90px rgba(5,150,105,0.14), 0 12px 32px rgba(0,0,0,0.12)", border:"1px solid rgba(0,0,0,0.08)", transform:"scale(1.06)" }}>
              <img
                src="/images/Landing-page.png"
                alt="Alpha Lens Platform"
                style={{ width:"100%", display:"block" }}
              />
            </div>
          </div>
        </section>

        {/* Tech ticker — CTA banner theme */}
        <div style={{ position:"relative", overflow:"hidden", padding:"15px 0" }}>
          {/* Same gradient as CTA banner */}
          <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg,#0a0e1a 0%,#0d1f18 50%,#0a1320 100%)" }} />
          {/* Green glow accent left */}
          <div style={{ position:"absolute", top:"-60%", left:"-5%", width:320, height:320, borderRadius:"50%", background:"radial-gradient(circle,rgba(5,150,105,0.18) 0%,transparent 65%)", pointerEvents:"none" }} />
          {/* Blue glow accent right */}
          <div style={{ position:"absolute", top:"-60%", right:"-5%", width:260, height:260, borderRadius:"50%", background:"radial-gradient(circle,rgba(14,165,233,0.1) 0%,transparent 65%)", pointerEvents:"none" }} />
          <div style={{ position:"relative", zIndex:1 }}>
            <div className="ticker-wrap">
              <div className="ticker-inner">
                {[...Array(2)].map((_,ri)=>(
                  <div key={ri} style={{ display:"flex", alignItems:"center" }}>
                    {["Landing.AI ADE","·","OpenAI GPT-4o","·","Qdrant Vector Search","·","Supabase Auth","·","Next.js 14","·","FastAPI","·","PDF Bounding-Box Grounding","·","Real-time Market Data","·"].map((t,i)=>(
                      <span key={i} style={{ fontSize:13, color: t==="·" ? "rgba(52,211,153,0.35)" : "rgba(255,255,255,0.55)", fontWeight: t==="·" ? 300 : 500, padding:"0 18px", whiteSpace:"nowrap", letterSpacing: t==="·" ? 0 : "0.01em" }}>{t}</span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Features */}
        <section id="features" style={{ maxWidth:1280, margin:"0 auto", padding:"110px clamp(16px,4vw,48px)" }}>
          <div ref={featReveal.ref} style={{ textAlign:"center", marginBottom:68, opacity:featReveal.visible?1:0, transform:featReveal.visible?"none":"translateY(24px)", transition:"opacity .6s ease,transform .6s cubic-bezier(.22,1,.36,1)" }}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"5px 14px", borderRadius:100, background:"rgba(5,150,105,0.07)", border:"1px solid rgba(5,150,105,0.2)", marginBottom:18 }}>
              <span style={{ fontSize:13, fontWeight:500, color:"#059669" }}>Core Capabilities</span>
            </div>
            <h2 style={{ fontSize:"clamp(28px,3.2vw,46px)", fontWeight:800, letterSpacing:"-0.028em", lineHeight:1.1, marginBottom:16 }}>
              Everything you need to<br /><span className="landing-gradient-text">make smarter decisions</span>
            </h2>
            <p style={{ fontSize:17, color:"#64748b", maxWidth:500, margin:"0 auto", lineHeight:1.68 }}>Four powerful tools from raw PDF to actionable intelligence.</p>
          </div>
          <div className="feat-grid" style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:16 }}>
            {FEATURES.map((f,i)=><FeatureCard key={f.title} f={f} i={i} />)}
          </div>
        </section>

        {/* Stats strip */}
        <div style={{ background:"rgba(255,255,255,0.55)", backdropFilter:"blur(16px)", borderTop:"1px solid rgba(0,0,0,0.06)", borderBottom:"1px solid rgba(0,0,0,0.06)" }}>
          <div className="stats-row" style={{ maxWidth:1280, margin:"0 auto", padding:"0 clamp(16px,4vw,48px)", display:"grid", gridTemplateColumns:"repeat(4,1fr)" }}>
            {[["Landing.AI","Document parsing"],["GPT-4o","Reports and chat"],["30s","Processing time"],["50 MB","Max file size"]].map(([v,l],i)=>(
              <div key={String(l)} style={{ padding:"28px 24px", textAlign:"center", borderRight:i<3?"1px solid rgba(0,0,0,0.06)":"none", transition:"background .2s" }}
                onMouseEnter={e=>(e.currentTarget.style.background="rgba(5,150,105,0.04)")}
                onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                <div style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.025em", color:"#0a0e1a", marginBottom:4 }}>{v}</div>
                <div style={{ fontSize:13, color:"#64748b" }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* How it works */}
        <section id="how" style={{ maxWidth:1280, margin:"0 auto", padding:"110px clamp(16px,4vw,48px) 72px" }}>
          <div ref={howReveal.ref} style={{ textAlign:"center", marginBottom:64, opacity:howReveal.visible?1:0, transform:howReveal.visible?"none":"translateY(24px)", transition:"opacity .6s,transform .6s cubic-bezier(.22,1,.36,1)" }}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"5px 14px", borderRadius:100, background:"rgba(5,150,105,0.07)", border:"1px solid rgba(5,150,105,0.2)", marginBottom:18 }}>
              <span style={{ fontSize:13, fontWeight:500, color:"#059669" }}>How It Works</span>
            </div>
            <h2 style={{ fontSize:"clamp(28px,3.2vw,46px)", fontWeight:800, letterSpacing:"-0.028em", lineHeight:1.1 }}>
              From upload to insight<br />in three steps
            </h2>
          </div>
          <div className="steps-grid" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:56, position:"relative", marginBottom:72 }}>
            <div style={{ position:"absolute", top:34, left:"16%", right:"16%", height:2, background:"linear-gradient(90deg,#059669,rgba(16,185,129,0.2))", opacity:.3, borderRadius:2, zIndex:0 }} />
            {STEPS.map((s,i)=><StepCard key={s.n} step={s} i={i} />)}
          </div>

          {/* Landing-page2.png showcase */}
          <div ref={imgReveal.ref} style={{ opacity:imgReveal.visible?1:0, transform:imgReveal.visible?"none":"translateY(32px)", transition:"opacity .8s ease,transform .8s cubic-bezier(.22,1,.36,1)" }}>
            <div style={{ position:"relative", borderRadius:24, overflow:"hidden", boxShadow:"0 40px 100px rgba(5,150,105,0.12), 0 10px 30px rgba(0,0,0,0.1)", border:"1px solid rgba(0,0,0,0.07)" }}>
              <img
                src="/images/Landing-page2.png"
                alt="Alpha Lens in action"
                style={{ width:"100%", display:"block" }}
              />
              <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top,rgba(10,14,26,0.35) 0%,transparent 50%)", pointerEvents:"none" }} />
              <div style={{ position:"absolute", bottom:28, left:32, right:32, display:"flex", justifyContent:"space-between", alignItems:"flex-end", flexWrap:"wrap", gap:12 }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:"rgba(255,255,255,0.7)", marginBottom:4 }}>See the full platform</div>
                  <div style={{ fontSize:20, fontWeight:800, color:"#fff", letterSpacing:"-0.02em" }}>Analyze any financial document in seconds</div>
                </div>
                <Link href="/login" className="btn-green" style={{ padding:"11px 24px", fontSize:14, flexShrink:0 }}>
                  Try it now
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M5 10h10M12 7l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Quote block */}
        <div style={{ background:"linear-gradient(135deg,rgba(5,150,105,0.05) 0%,rgba(14,165,233,0.04) 100%)", borderTop:"1px solid rgba(5,150,105,0.1)", borderBottom:"1px solid rgba(5,150,105,0.1)" }}>
          <div ref={quoteReveal.ref} style={{ maxWidth:860, margin:"0 auto", padding:"80px clamp(24px,4vw,48px)", textAlign:"center", opacity:quoteReveal.visible?1:0, transform:quoteReveal.visible?"none":"translateY(20px)", transition:"opacity .7s,transform .7s cubic-bezier(.22,1,.36,1)" }}>
            <div style={{ width:44, height:44, borderRadius:12, background:"rgba(5,150,105,0.1)", display:"grid", placeItems:"center", margin:"0 auto 28px", color:"#059669" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/></svg>
            </div>
            <p style={{ fontSize:"clamp(18px,2.2vw,24px)", fontWeight:600, color:"#0a0e1a", lineHeight:1.55, letterSpacing:"-0.015em", marginBottom:28 }}>
              "The platform that turns a 200-page annual report into actionable intelligence in under 30 seconds. Every financial analyst's new essential tool."
            </p>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:12 }}>
              <div style={{ width:40, height:40, borderRadius:"50%", background:"linear-gradient(135deg,#059669,#10b981)", display:"grid", placeItems:"center", color:"#fff", fontWeight:800, fontSize:15 }}>A</div>
              <div style={{ textAlign:"left" }}>
                <div style={{ fontSize:14, fontWeight:700, color:"#0a0e1a" }}>Alex Chen</div>
                <div style={{ fontSize:13, color:"#64748b" }}>Senior Financial Analyst</div>
              </div>
            </div>
          </div>
        </div>

        {/* CTA banner */}
        <div style={{ padding:"40px clamp(16px,3vw,40px)" }}>
          <div ref={ctaReveal.ref} style={{ maxWidth:1280, margin:"0 auto", borderRadius:28, background:"linear-gradient(135deg,#0a0e1a 0%,#0d1f18 50%,#0a1320 100%)", position:"relative", overflow:"hidden", opacity:ctaReveal.visible?1:0, transform:ctaReveal.visible?"none":"translateY(24px)", transition:"opacity .7s,transform .7s cubic-bezier(.22,1,.36,1)" }}>
            <div style={{ position:"absolute", top:-140, left:-100, width:560, height:560, borderRadius:"50%", background:"radial-gradient(circle,rgba(5,150,105,0.22) 0%,transparent 65%)" }} />
            <div style={{ position:"absolute", bottom:-100, right:-80, width:440, height:440, borderRadius:"50%", background:"radial-gradient(circle,rgba(14,165,233,0.14) 0%,transparent 65%)" }} />
            <div style={{ position:"absolute", inset:0, backgroundImage:"radial-gradient(circle,rgba(255,255,255,0.025) 1px,transparent 1px)", backgroundSize:"26px 26px" }} />
            <div style={{ position:"relative", zIndex:1, maxWidth:740, margin:"0 auto", padding:"88px clamp(24px,4vw,60px)", textAlign:"center" }}>
              <h2 style={{ fontSize:"clamp(30px,3.8vw,54px)", fontWeight:900, letterSpacing:"-0.03em", color:"#fff", lineHeight:1.08, marginBottom:18 }}>
                Ready to transform your<br />
                <span style={{ background:"linear-gradient(120deg,#34d399 0%,#6ee7b7 50%,#38bdf8 100%)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>financial workflow?</span>
              </h2>
              <p style={{ fontSize:17, color:"rgba(255,255,255,0.55)", lineHeight:1.7, maxWidth:420, margin:"0 auto 42px" }}>
                Upload your first document and receive an AI-generated analyst report in under 30 seconds.
              </p>
              <div style={{ display:"flex", gap:12, justifyContent:"center", flexWrap:"wrap" }}>
                <Link href="/login" className="btn-green" style={{ padding:"14px 34px", fontSize:16, boxShadow:"0 6px 26px rgba(5,150,105,0.5)" }}>
                  Get Started Free
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M5 10h10M12 7l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </Link>
                <Link href="/login" style={{ display:"inline-flex", alignItems:"center", gap:7, padding:"14px 26px", color:"rgba(255,255,255,.7)", borderRadius:10, fontSize:15, fontWeight:500, textDecoration:"none", border:"1.5px solid rgba(255,255,255,.16)", transition:"all .2s" }}
                  onMouseEnter={e=>{const el=e.currentTarget as HTMLElement;el.style.color="#fff";el.style.borderColor="rgba(255,255,255,.35)";}}
                  onMouseLeave={e=>{const el=e.currentTarget as HTMLElement;el.style.color="rgba(255,255,255,.7)";el.style.borderColor="rgba(255,255,255,.16)";}}>
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer style={{ background:"#0a0e1a" }}>
          <div className="footer-grid" style={{ maxWidth:1280, margin:"0 auto", padding:"64px clamp(16px,4vw,48px) 48px", display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr", gap:52 }}>
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
                <div style={{ width:40, height:40, borderRadius:10, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(135deg,#059669,#10b981)", boxShadow:"0 2px 8px rgba(5,150,105,0.3)", flexShrink:0 }}>
                  <img src="/images/ALPHA LENS LOGO.png" alt="Alpha Lens" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                </div>
                <span style={{ fontWeight:700, fontSize:19, letterSpacing:"-0.02em", color:"#fff" }}>Alpha Lens</span>
              </div>
              <p style={{ fontSize:14, lineHeight:1.7, color:"#475569", maxWidth:270 }}>AI-powered financial document analysis. From raw PDF to actionable intelligence in seconds.</p>
            </div>
            {[
              {h:"Product", links:[["Analyzer","/login"],["Reports","/login"],["FinBot","/login"],["Chat","/login"]]},
              {h:"Technology", links:[["Landing.AI ADE","#"],["OpenAI GPT-4o","#"],["Qdrant Vector DB","#"],["Supabase","#"]]},
              {h:"Company", links:[["About","#"],["Privacy","#"],["Terms","#"],["Contact","#"]]},
            ].map(({h,links})=>(
              <div key={h}>
                <div style={{ fontSize:11, fontWeight:700, color:"#64748b", marginBottom:18, textTransform:"uppercase", letterSpacing:"0.09em" }}>{h}</div>
                <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
                  {links.map(([l,href])=><Link key={l} href={href} className="footer-a">{l}</Link>)}
                </div>
              </div>
            ))}
          </div>
          <div style={{ borderTop:"1px solid #1e293b", maxWidth:1280, margin:"0 auto", padding:"22px clamp(16px,4vw,48px)", display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
            <p style={{ fontSize:13, color:"#334155" }}>© 2026 Alpha Lens. All rights reserved.</p>
            <p style={{ fontSize:13, color:"#334155" }}>Built with Next.js, FastAPI and Landing.AI</p>
          </div>
        </footer>

      </div>
    </div>
  );
}
