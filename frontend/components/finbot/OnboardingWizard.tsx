"use client";
import { useState } from "react";

// 5-question onboarding for FinBot. Renders inside /dashboard/finbot when no
// profile exists or onboarding is incomplete. Submitting calls
// PUT /api/finbot/profile + POST /api/finbot/onboarding/complete.

const RISK_OPTIONS = [
  { value: "conservative", label: "Conservative", desc: "Steady, low-risk investments" },
  { value: "moderate",     label: "Moderate",     desc: "Balanced — some growth, some safety" },
  { value: "aggressive",   label: "Aggressive",   desc: "Higher risk for higher long-term returns" },
] as const;

const HORIZON_OPTIONS = [
  { value: "short",  label: "Short-term",  desc: "< 3 years" },
  { value: "medium", label: "Medium-term", desc: "3–10 years" },
  { value: "long",   label: "Long-term",   desc: "10+ years" },
] as const;

const GOAL_OPTIONS = [
  { value: "retirement",   label: "Retirement" },
  { value: "income",       label: "Income / dividends" },
  { value: "growth",       label: "Capital growth" },
  { value: "preservation", label: "Capital preservation" },
] as const;

type Risk    = typeof RISK_OPTIONS[number]["value"];
type Horizon = typeof HORIZON_OPTIONS[number]["value"];
type Goal    = typeof GOAL_OPTIONS[number]["value"];

interface Props {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0);

  const [risk,     setRisk]     = useState<Risk    | null>(null);
  const [horizon,  setHorizon]  = useState<Horizon | null>(null);
  const [goals,    setGoals]    = useState<Goal[]>([]);
  const [currency, setCurrency] = useState<string>("USD");
  const [taxCountry, setTaxCountry] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const stepTitles = [
    "How much risk are you comfortable with?",
    "What's your investment time horizon?",
    "What are your goals?",
    "A couple of details (optional)",
  ];

  const canProceed = (() => {
    if (step === 0) return risk !== null;
    if (step === 1) return horizon !== null;
    if (step === 2) return goals.length > 0;
    return true;
  })();

  function toggleGoal(g: Goal) {
    setGoals(prev => (prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]));
  }

  async function handleSubmit() {
    if (!risk || !horizon) return;
    setError(null);
    setSaving(true);
    try {
      const upsertRes = await fetch("/api/finbot/profile", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          risk_tolerance:      risk,
          time_horizon:        horizon,
          goals,
          currency_preference: currency.trim().toUpperCase() || "USD",
          tax_country:         taxCountry.trim() ? taxCountry.trim().toUpperCase() : null,
        }),
      });
      if (!upsertRes.ok) throw new Error(`profile save failed (${upsertRes.status})`);

      const completeRes = await fetch("/api/finbot/onboarding/complete", {
        method: "POST",
        credentials: "include",
      });
      if (!completeRes.ok) throw new Error(`onboarding complete failed (${completeRes.status})`);

      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSaving(false);
    }
  }

  return (
    <div
      className="flex flex-1 items-center justify-center min-h-0 px-6 py-10"
      style={{ background: "var(--al-bg-soft)" }}
    >
      <div
        className="w-full max-w-xl rounded-2xl"
        style={{
          background: "var(--al-card)",
          border: "1px solid var(--al-border)",
          boxShadow: "var(--al-shadow-lg)",
          padding: "32px 36px",
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "4px 10px", borderRadius: 100,
            background: "rgba(5,150,105,0.08)",
            border: "1px solid rgba(5,150,105,0.18)",
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--al-accent)" }} />
            <span style={{
              fontSize: 11, fontWeight: 600, color: "var(--al-accent)",
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>FinBot · onboarding</span>
          </div>
          <h2 style={{
            fontSize: 22, fontWeight: 700, color: "var(--al-text)",
            letterSpacing: "-0.02em", marginTop: 12,
          }}>
            {stepTitles[step]}
          </h2>
          <p style={{ fontSize: 13, color: "var(--al-text-secondary)", marginTop: 4 }}>
            Step {step + 1} of {stepTitles.length}. We use this to tailor every chat.
          </p>
        </div>

        {/* Step body */}
        {step === 0 && (
          <div className="flex flex-col gap-3">
            {RISK_OPTIONS.map(opt => (
              <Choice key={opt.value} active={risk === opt.value} onClick={() => setRisk(opt.value)}>
                <div style={{ fontWeight: 600, color: "var(--al-text)" }}>{opt.label}</div>
                <div style={{ fontSize: 12, color: "var(--al-text-secondary)" }}>{opt.desc}</div>
              </Choice>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            {HORIZON_OPTIONS.map(opt => (
              <Choice key={opt.value} active={horizon === opt.value} onClick={() => setHorizon(opt.value)}>
                <div style={{ fontWeight: 600, color: "var(--al-text)" }}>{opt.label}</div>
                <div style={{ fontSize: 12, color: "var(--al-text-secondary)" }}>{opt.desc}</div>
              </Choice>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {GOAL_OPTIONS.map(opt => (
              <Choice key={opt.value} active={goals.includes(opt.value)} onClick={() => toggleGoal(opt.value)}>
                <div style={{ fontWeight: 600, color: "var(--al-text)" }}>{opt.label}</div>
              </Choice>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--al-text-secondary)", marginBottom: 4 }}>
                Preferred currency
              </div>
              <input
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                maxLength={3}
                placeholder="USD"
                style={inputStyle}
              />
            </label>
            <label>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--al-text-secondary)", marginBottom: 4 }}>
                Tax country (ISO, optional)
              </div>
              <input
                value={taxCountry}
                onChange={e => setTaxCountry(e.target.value)}
                maxLength={2}
                placeholder="US"
                style={inputStyle}
              />
            </label>
          </div>
        )}

        {error && (
          <div className="mt-4 text-sm" style={{ color: "var(--al-error)" }}>{error}</div>
        )}

        {/* Footer */}
        <div className="mt-7 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0 || saving}
            style={{
              fontSize: 13, fontWeight: 500,
              color: step === 0 ? "var(--al-subtle)" : "var(--al-text-secondary)",
              opacity: step === 0 ? 0.5 : 1, cursor: step === 0 ? "default" : "pointer",
              background: "transparent", border: "none",
            }}
          >
            ← Back
          </button>
          {step < stepTitles.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep(s => s + 1)}
              disabled={!canProceed}
              className="px-5 py-2 rounded-lg text-sm font-medium"
              style={{
                background: canProceed ? "var(--al-accent)" : "var(--al-card)",
                color:      canProceed ? "white" : "var(--al-subtle)",
                border:     `1px solid ${canProceed ? "var(--al-accent)" : "var(--al-border)"}`,
                cursor:     canProceed ? "pointer" : "not-allowed",
              }}
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="px-5 py-2 rounded-lg text-sm font-medium"
              style={{
                background: "var(--al-accent)", color: "white",
                opacity: saving ? 0.6 : 1, cursor: saving ? "wait" : "pointer",
              }}
            >
              {saving ? "Saving…" : "Finish"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Choice({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "12px 14px",
        borderRadius: 10,
        background: active ? "rgba(5,150,105,0.06)" : "var(--al-bg)",
        border: `1px solid ${active ? "var(--al-accent)" : "var(--al-border)"}`,
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--al-border)",
  background: "var(--al-bg)",
  fontSize: 14,
  color: "var(--al-text)",
  outline: "none",
};
