"use client";
import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

type Tab = "login" | "signup";

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>("login");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "error" | "success" } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [showSignupPw, setShowSignupPw] = useState(false);

  const { login, user } = useAuth();
  const router = useRouter();

  // If already logged in, redirect
  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  // Connection test — runs once on mount
  useEffect(() => {
    fetch("/health")
      .then(r => r.json())
      .then(d => console.log("[health] OK", d))
      .catch(e => console.error("[health] FAILED", e.message));
  }, []);

  const showMsg = (text: string, type: "error" | "success" = "error") => {
    setMessage({ text, type });
    // Only auto-dismiss success; errors stay until next attempt
    if (type === "success") setTimeout(() => setMessage(null), 5000);
  };

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      console.log("[login response]", res.status, data);
      if (data.success) {
        login(data.access_token, data.user);
        showMsg("Login successful! Redirecting...", "success");
        setTimeout(() => router.replace("/dashboard"), 800);
      } else {
        showMsg(data.error ?? "Invalid email or password");
      }
    } catch {
      showMsg("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e: FormEvent) {
    e.preventDefault();
    if (signupPassword !== signupConfirm) return showMsg("Passwords do not match");
    if (signupPassword.length < 6) return showMsg("Password must be at least 6 characters");
    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email: signupEmail, password: signupPassword }),
      });
      const data = await res.json();
      if (data.success) {
        login(data.access_token, data.user);
        showMsg("Account created! Redirecting...", "success");
        setTimeout(() => router.replace("/dashboard"), 800);
      } else {
        showMsg(data.error ?? "Failed to create account");
      }
    } catch {
      showMsg("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!loginEmail) return showMsg("Please enter your email first");
    try {
      const res = await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: loginEmail }),
      });
      const data = await res.json();
      if (data.success) showMsg("Password reset email sent! Check your inbox.", "success");
      else showMsg(data.error ?? "Failed to send reset email");
    } catch {
      showMsg("Network error. Please try again.");
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden"
      style={{ background: "var(--al-bg-soft)", color: "var(--al-text)" }}
    >
      {/* Animated background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-animated-gradient" />
        <div className="absolute inset-0 bg-dot-grid" />
      </div>

      <div className="w-full max-w-[440px] relative z-10" style={{ animation: "fadeInUp 0.8s cubic-bezier(0.4,0,0.2,1) forwards" }}>
        {/* Back link */}
        <a
          href="/"
          className="inline-flex items-center gap-1.5 mb-7 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200"
          style={{ color: "var(--al-subtle)" }}
          onMouseEnter={e => { (e.target as HTMLElement).style.color = "var(--al-accent)"; (e.target as HTMLElement).style.background = "var(--al-accent-soft)"; }}
          onMouseLeave={e => { (e.target as HTMLElement).style.color = "var(--al-subtle)"; (e.target as HTMLElement).style.background = "transparent"; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
          </svg>
          Back to Home
        </a>

        {/* Header */}
        <div className="text-center mb-9">
          <div className="flex items-center justify-center mb-6">
            <div
              className="w-14 h-14 rounded-2xl overflow-hidden"
              style={{
                background: "linear-gradient(135deg, var(--al-accent), var(--al-accent-2))",
                boxShadow: "0 4px 16px rgba(5,150,105,0.3)"
              }}
            >
              <img src="/images/ALPHA LENS LOGO.png" alt="Alpha Lens" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: "var(--al-text)" }}>Alpha Lens</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--al-text-secondary)" }}>Financial Intelligence Platform</p>
        </div>

        {/* Card */}
        <div className="glass-card p-9">
          {/* Tabs */}
          <div
            className="flex gap-1 mb-7 p-1 rounded-xl"
            style={{ background: "var(--al-bg-secondary)" }}
          >
            {(["login", "signup"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setMessage(null); }}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
                style={{
                  background: tab === t ? "var(--al-card)" : "transparent",
                  color: tab === t ? "var(--al-accent)" : "var(--al-text-secondary)",
                  fontWeight: tab === t ? 600 : 500,
                  boxShadow: tab === t ? "var(--al-shadow)" : "none",
                }}
              >
                {t === "login" ? "Sign In" : "Sign Up"}
              </button>
            ))}
          </div>

          {/* Message */}
          {message && (
            <div
              className="mb-5 px-4 py-3 rounded-xl text-sm font-medium"
              style={{
                background: message.type === "success" ? "rgba(5,150,105,0.08)" : "rgba(220,38,38,0.08)",
                color: message.type === "success" ? "var(--al-success)" : "var(--al-error)",
                border: `1px solid ${message.type === "success" ? "rgba(5,150,105,0.15)" : "rgba(220,38,38,0.15)"}`,
              }}
            >
              {message.text}
            </div>
          )}

          {/* LOGIN FORM */}
          {tab === "login" && (
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: "var(--al-text)" }}>Email</label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full px-4 py-3 text-sm rounded-xl border outline-none transition-all"
                  style={{
                    border: "1.5px solid var(--al-border)",
                    background: "var(--al-bg)",
                    color: "var(--al-text)",
                  }}
                  onFocus={e => e.target.style.borderColor = "var(--al-accent)"}
                  onBlur={e => e.target.style.borderColor = "var(--al-border)"}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: "var(--al-text)" }}>Password</label>
                <div className="relative">
                  <input
                    type={showLoginPw ? "text" : "password"}
                    required
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full px-4 py-3 pr-16 text-sm rounded-xl border outline-none transition-all"
                    style={{ border: "1.5px solid var(--al-border)", background: "var(--al-bg)", color: "var(--al-text)" }}
                    onFocus={e => e.target.style.borderColor = "var(--al-accent)"}
                    onBlur={e => e.target.style.borderColor = "var(--al-border)"}
                  />
                  <button type="button" onClick={() => setShowLoginPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium px-2 py-1 rounded"
                    style={{ color: "var(--al-subtle)" }}>
                    {showLoginPw ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <div className="text-right -mt-2">
                <button type="button" onClick={handleForgotPassword}
                  className="text-sm font-medium"
                  style={{ color: "var(--al-accent)" }}>
                  Forgot password?
                </button>
              </div>
              <SubmitButton loading={loading} label="Sign In" />
            </form>
          )}

          {/* SIGNUP FORM */}
          {tab === "signup" && (
            <form onSubmit={handleSignup} className="space-y-5">
              {[
                { label: "Email", value: signupEmail, set: setSignupEmail, type: "email", placeholder: "Enter your email" },
              ].map(f => (
                <div key={f.label}>
                  <label className="block text-sm font-semibold mb-2" style={{ color: "var(--al-text)" }}>{f.label}</label>
                  <input type={f.type} required value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.placeholder}
                    className="w-full px-4 py-3 text-sm rounded-xl border outline-none"
                    style={{ border: "1.5px solid var(--al-border)", background: "var(--al-bg)", color: "var(--al-text)" }}
                    onFocus={e => e.target.style.borderColor = "var(--al-accent)"}
                    onBlur={e => e.target.style.borderColor = "var(--al-border)"}
                  />
                </div>
              ))}
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: "var(--al-text)" }}>Password</label>
                <div className="relative">
                  <input type={showSignupPw ? "text" : "password"} required minLength={6} value={signupPassword}
                    onChange={e => setSignupPassword(e.target.value)} placeholder="Create a password"
                    className="w-full px-4 py-3 pr-16 text-sm rounded-xl border outline-none"
                    style={{ border: "1.5px solid var(--al-border)", background: "var(--al-bg)", color: "var(--al-text)" }}
                    onFocus={e => e.target.style.borderColor = "var(--al-accent)"}
                    onBlur={e => e.target.style.borderColor = "var(--al-border)"}
                  />
                  <button type="button" onClick={() => setShowSignupPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium px-2 py-1 rounded"
                    style={{ color: "var(--al-subtle)" }}>{showSignupPw ? "Hide" : "Show"}</button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: "var(--al-text)" }}>Confirm Password</label>
                <input type="password" required minLength={6} value={signupConfirm}
                  onChange={e => setSignupConfirm(e.target.value)} placeholder="Confirm your password"
                  className="w-full px-4 py-3 text-sm rounded-xl border outline-none"
                  style={{ border: "1.5px solid var(--al-border)", background: "var(--al-bg)", color: "var(--al-text)" }}
                  onFocus={e => e.target.style.borderColor = "var(--al-accent)"}
                  onBlur={e => e.target.style.borderColor = "var(--al-border)"}
                />
              </div>
              <SubmitButton loading={loading} label="Create Account" />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function SubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full py-3.5 px-6 rounded-xl text-sm font-semibold text-white transition-all duration-300 relative overflow-hidden"
      style={{
        background: "var(--al-accent)",
        boxShadow: "0 2px 8px rgba(5,150,105,0.25)",
        opacity: loading ? 0.6 : 1,
        cursor: loading ? "not-allowed" : "pointer",
      }}
      onMouseEnter={e => { if (!loading) (e.target as HTMLElement).style.background = "var(--al-accent-hover)"; }}
      onMouseLeave={e => { (e.target as HTMLElement).style.background = "var(--al-accent)"; }}
    >
      {loading ? "Please wait..." : label}
    </button>
  );
}
