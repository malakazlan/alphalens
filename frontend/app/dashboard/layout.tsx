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
    <div className="h-screen overflow-hidden flex flex-col" style={{ background: "var(--al-bg-soft)" }}>
      <Header />
      <main className="flex-1 overflow-y-auto min-h-0 flex flex-col">{children}</main>
    </div>
  );
}
