"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

const NAV = [
  { label: "Home",     href: "/dashboard" },
  { label: "Analyzer", href: "/dashboard/analyzer" },
  { label: "Reports",  href: "/dashboard/report" },
  { label: "FinBot",   href: "/dashboard/finbot" },
  { label: "Docs",     href: "/dashboard/docs" },
];

// ── Single nav link with full hover + active state ──────────────────────────
function NavLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  const [hov, setHov] = useState(false);

  const bg    = active ? "rgba(5,150,105,0.09)"  : hov ? "rgba(0,0,0,0.045)" : "transparent";
  const color = active ? "#059669"               : hov ? "#0f172a"           : "#475569";
  const fw    = active ? 600                     : 500;

  return (
    <Link
      href={href}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "inline-flex", alignItems: "center",
        padding: "6px 14px", borderRadius: 8,
        fontSize: 14, fontWeight: fw,
        color, background: bg,
        textDecoration: "none",
        transition: "color 0.18s ease, background 0.18s ease",
        position: "relative",
      }}
    >
      {label}
      {/* Active underline indicator */}
      {active && (
        <span style={{
          position: "absolute", bottom: 2, left: "50%",
          transform: "translateX(-50%)",
          width: 18, height: 2.5,
          borderRadius: 2,
          background: "linear-gradient(90deg, #059669, #10b981)",
        }} />
      )}
    </Link>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function Header() {
  const pathname  = usePathname();
  const { logout, user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutHov, setLogoutHov] = useState(false);

  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: "rgba(255,255,255,0.94)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        borderBottom: "1px solid rgba(226,232,240,0.9)",
        boxShadow: "0 1px 12px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>

        {/* ── Logo ── */}
        <Link
          href="/dashboard"
          style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", flexShrink: 0 }}
        >
          <div style={{
            width: 36, height: 36, borderRadius: 9, overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg, #059669, #10b981)",
            boxShadow: "0 2px 8px rgba(5,150,105,0.28)",
            flexShrink: 0,
          }}>
            <img src="/images/ALPHA LENS LOGO.png" alt="Alpha Lens" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em", color: "#0a0e1a" }}>
            Alpha Lens
          </span>
        </Link>

        {/* ── Desktop nav ── */}
        <nav style={{ display: "flex", alignItems: "center", gap: 2 }} className="hidden md:flex">
          {NAV.map(({ label, href }) => {
            const active = href === "/dashboard"
              ? pathname === href
              : pathname.startsWith(href);
            return <NavLink key={href} label={label} href={href} active={active} />;
          })}
        </nav>

        {/* ── Right side ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {user && (
            <span
              className="hidden md:block"
              style={{ fontSize: 12.5, color: "#94a3b8", fontWeight: 400, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {user.email}
            </span>
          )}

          <button
            onClick={logout}
            onMouseEnter={() => setLogoutHov(true)}
            onMouseLeave={() => setLogoutHov(false)}
            style={{
              padding: "6px 16px", borderRadius: 8,
              fontSize: 13.5, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
              background:   logoutHov ? "#059669"               : "rgba(5,150,105,0.08)",
              color:        logoutHov ? "#ffffff"               : "#059669",
              border:       logoutHov ? "1px solid #059669"     : "1px solid rgba(5,150,105,0.22)",
              transition: "background 0.2s ease, color 0.2s ease, border-color 0.2s ease",
              boxShadow:    logoutHov ? "0 2px 10px rgba(5,150,105,0.28)" : "none",
            }}
          >
            Logout
          </button>

          {/* Hamburger */}
          <button
            className="md:hidden"
            onClick={() => setMenuOpen(v => !v)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 8,
              background: menuOpen ? "rgba(5,150,105,0.08)" : "transparent",
              border: "none", cursor: "pointer",
              color: "#475569", transition: "background 0.18s",
            }}
            aria-label="Toggle menu"
          >
            {menuOpen
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            }
          </button>
        </div>
      </div>

      {/* ── Mobile dropdown ── */}
      {menuOpen && (
        <div
          style={{
            borderTop: "1px solid rgba(226,232,240,0.9)",
            background: "rgba(255,255,255,0.98)",
            padding: "8px 16px 16px",
          }}
          className="md:hidden"
        >
          {NAV.map(({ label, href }) => {
            const active = href === "/dashboard"
              ? pathname === href
              : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                style={{
                  display: "block", padding: "10px 12px",
                  borderRadius: 8, marginBottom: 2,
                  fontSize: 14, fontWeight: active ? 600 : 400,
                  color: active ? "#059669" : "#475569",
                  background: active ? "rgba(5,150,105,0.07)" : "transparent",
                  textDecoration: "none",
                  borderLeft: active ? "3px solid #059669" : "3px solid transparent",
                  transition: "all 0.18s",
                }}
              >
                {label}
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}
