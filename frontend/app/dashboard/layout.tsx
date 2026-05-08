"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import Header from "@/components/layout/Header";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--al-bg-soft)" }}>
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl overflow-hidden"
            style={{ background: "linear-gradient(135deg, var(--al-accent), var(--al-accent-2))", boxShadow: "0 4px 16px rgba(5,150,105,0.3)" }}
          >
            <img src="/images/ALPHA LENS LOGO.png" alt="Alpha Lens" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: "var(--al-accent)", borderTopColor: "transparent" }} />
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div
      className="h-screen overflow-hidden flex flex-col"
      style={{ background: "var(--al-bg-soft)", position: "relative" }}
    >
      {/* ─── Ambient atmosphere — single layer for all dashboard pages ─── */}
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        <div style={{
          position: "absolute", top: "6%", left: "3%",
          width: 540, height: 540, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(5,150,105,0.08) 0%, transparent 65%)",
          filter: "blur(56px)",
          animation: "blob1 22s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", top: "52%", right: "3%",
          width: 460, height: 460, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(16,185,129,0.06) 0%, transparent 65%)",
          filter: "blur(48px)",
          animation: "blob2 28s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", bottom: "6%", left: "26%",
          width: 380, height: 380, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(4,120,87,0.04) 0%, transparent 65%)",
          filter: "blur(60px)",
        }} />
        {/* Subtle dot grid — only fades in around the upper-center, doesn't dominate */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "radial-gradient(circle, rgba(15,23,42,0.035) 1px, transparent 1px)",
          backgroundSize: "30px 30px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black 25%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black 25%, transparent 80%)",
        }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <Header />
        <main className="flex-1 overflow-y-auto min-h-0 flex flex-col">{children}</main>
      </div>
    </div>
  );
}
