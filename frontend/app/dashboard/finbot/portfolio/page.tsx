"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";

interface Holding {
  id:           string;
  ticker:       string;
  quantity:     number;
  cost_basis:   number;
  currency:     string;
  account_type: string;
  opened_at:    string;
  closed_at:    string | null;
  note:         string | null;
}

const ACCOUNT_TYPES = ["taxable", "retirement", "isa", "other"] as const;

interface FormState {
  ticker:       string;
  quantity:     string;
  cost_basis:   string;
  currency:     string;
  account_type: typeof ACCOUNT_TYPES[number];
  opened_at:    string;
  note:         string;
}

const EMPTY_FORM: FormState = {
  ticker:       "",
  quantity:     "",
  cost_basis:   "",
  currency:     "USD",
  account_type: "taxable",
  opened_at:    new Date().toISOString().slice(0, 10),
  note:         "",
};

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [form,    setForm]    = useState<FormState>(EMPTY_FORM);
  const [saving,  setSaving]  = useState(false);

  async function fetchHoldings() {
    setLoading(true);
    try {
      const res  = await fetch("/api/finbot/holdings", { credentials: "include" });
      const data = await res.json();
      if (data.success) setHoldings(data.holdings ?? []);
    } catch {
      setError("Could not load holdings.");
    }
    setLoading(false);
  }

  useEffect(() => { fetchHoldings(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        ticker:       form.ticker.trim().toUpperCase(),
        quantity:     parseFloat(form.quantity),
        cost_basis:   parseFloat(form.cost_basis),
        currency:     form.currency.trim().toUpperCase(),
        account_type: form.account_type,
        opened_at:    form.opened_at,
        note:         form.note.trim() || null,
      };
      const res = await fetch("/api/finbot/holdings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.detail ?? data.error ?? "Could not save holding.");
      } else {
        setForm(EMPTY_FORM);
        setAddOpen(false);
        await fetchHoldings();
      }
    } catch {
      setError("Network error.");
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this holding? Soft-deleted (kept for audit, hidden from UI).")) return;
    try {
      const res = await fetch(`/api/finbot/holdings/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) setHoldings(prev => prev.filter(h => h.id !== id));
    } catch {}
  }

  const totalCost = holdings.reduce((s, h) => s + Number(h.cost_basis), 0);

  return (
    <main className="flex-1 overflow-y-auto px-8 py-10">
      <div className="max-w-5xl mx-auto w-full">
        {/* Header */}
        <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <Link
              href={ROUTES.finbot}
              className="text-xs font-medium hover:underline"
              style={{ color: "var(--al-subtle)", letterSpacing: "0.04em" }}
            >
              ← Back to FinBot chat
            </Link>
            <h1 style={{
              fontSize: "clamp(28px, 3vw, 38px)",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              marginTop: 8,
            }}>
              <span style={{ color: "var(--al-text)" }}>Your </span>
              <span className="landing-gradient-text">Portfolio</span>
            </h1>
            <p style={{
              fontSize: 14, color: "var(--al-text-secondary)",
              maxWidth: 560, marginTop: 6,
            }}>
              Track your holdings here. FinBot will use this as live context — ask
              <span style={{ fontStyle: "italic" }}> &quot;how is my portfolio doing?&quot;</span> in chat to get current P&amp;L.
            </p>
          </div>
          <button
            onClick={() => setAddOpen(v => !v)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{
              background: addOpen ? "var(--al-card)" : "var(--al-accent)",
              color:      addOpen ? "var(--al-text-secondary)" : "white",
              border:     addOpen ? "1px solid var(--al-border)" : "1px solid var(--al-accent)",
            }}
          >
            {addOpen ? "Cancel" : "+ Add holding"}
          </button>
        </div>

        {/* Add form */}
        {addOpen && (
          <form
            onSubmit={handleAdd}
            className="mb-8 p-5 rounded-xl"
            style={{
              background: "var(--al-card)",
              border: "1px solid var(--al-border)",
              boxShadow: "var(--al-shadow)",
            }}
          >
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
              <Field label="Ticker">
                <input
                  required
                  value={form.ticker}
                  onChange={e => setForm({ ...form, ticker: e.target.value })}
                  placeholder="AAPL"
                  style={inputStyle}
                />
              </Field>
              <Field label="Account">
                <select
                  value={form.account_type}
                  onChange={e => setForm({ ...form, account_type: e.target.value as FormState["account_type"] })}
                  style={inputStyle}
                >
                  {ACCOUNT_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Quantity">
                <input
                  required type="number" step="any" min="0.000001"
                  value={form.quantity}
                  onChange={e => setForm({ ...form, quantity: e.target.value })}
                  placeholder="50"
                  style={inputStyle}
                />
              </Field>
              <Field label="Cost basis (total $)">
                <input
                  required type="number" step="any" min="0"
                  value={form.cost_basis}
                  onChange={e => setForm({ ...form, cost_basis: e.target.value })}
                  placeholder="8500"
                  style={inputStyle}
                />
              </Field>
              <Field label="Opened">
                <input
                  required type="date"
                  value={form.opened_at}
                  onChange={e => setForm({ ...form, opened_at: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Currency">
                <input
                  required maxLength={3}
                  value={form.currency}
                  onChange={e => setForm({ ...form, currency: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              <div style={{ gridColumn: "1 / -1" }}>
                <Field label="Note (optional)">
                  <input
                    value={form.note}
                    onChange={e => setForm({ ...form, note: e.target.value })}
                    placeholder="Bought on dip after 10-K"
                    maxLength={500}
                    style={inputStyle}
                  />
                </Field>
              </div>
            </div>
            {error && (
              <div className="mt-3 text-sm" style={{ color: "var(--al-error)" }}>{error}</div>
            )}
            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{
                  background: "var(--al-accent)", color: "white",
                  opacity: saving ? 0.6 : 1, cursor: saving ? "wait" : "pointer",
                }}
              >
                {saving ? "Saving…" : "Save holding"}
              </button>
            </div>
          </form>
        )}

        {/* Summary strip */}
        {!loading && holdings.length > 0 && (
          <div className="mb-6 flex gap-8 flex-wrap">
            <Stat label="Positions" value={String(holdings.length)} />
            <Stat label="Total cost basis" value={`$${totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
            <Stat label="Live value" value="ask FinBot" subtle />
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="py-20 text-center" style={{ color: "var(--al-subtle)" }}>Loading…</div>
        ) : holdings.length === 0 ? (
          <div
            className="py-16 px-8 text-center rounded-xl"
            style={{
              background: "var(--al-bg-soft)",
              border: "1px dashed var(--al-border)",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--al-text)", marginBottom: 6 }}>
              No holdings yet.
            </div>
            <div style={{ fontSize: 13, color: "var(--al-text-secondary)", maxWidth: 480, margin: "0 auto" }}>
              Add your first position above. Then ask FinBot about it — for example
              <span style={{ fontStyle: "italic" }}> &quot;how is my AAPL doing?&quot;</span>
            </div>
          </div>
        ) : (
          <div
            className="overflow-hidden rounded-xl"
            style={{
              background: "var(--al-card)",
              border: "1px solid var(--al-border)",
            }}
          >
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--al-bg-soft)", color: "var(--al-text-secondary)" }}>
                  <Th>Ticker</Th>
                  <Th align="right">Quantity</Th>
                  <Th align="right">Cost basis</Th>
                  <Th>Account</Th>
                  <Th>Opened</Th>
                  <Th>Note</Th>
                  <Th align="right">{""}</Th>
                </tr>
              </thead>
              <tbody>
                {holdings.map(h => (
                  <tr key={h.id} style={{ borderTop: "1px solid var(--al-border-light)" }}>
                    <Td><span style={{ fontWeight: 600, color: "var(--al-text)" }}>{h.ticker}</span></Td>
                    <Td align="right">{Number(h.quantity).toLocaleString(undefined, { maximumFractionDigits: 6 })}</Td>
                    <Td align="right">${Number(h.cost_basis).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Td>
                    <Td><Pill>{h.account_type}</Pill></Td>
                    <Td>{h.opened_at}</Td>
                    <Td>
                      <span style={{
                        color: "var(--al-text-secondary)",
                        fontStyle: h.note ? "normal" : "italic",
                        opacity: h.note ? 1 : 0.5,
                      }}>
                        {h.note ?? "—"}
                      </span>
                    </Td>
                    <Td align="right">
                      <button
                        onClick={() => handleDelete(h.id)}
                        title="Remove"
                        className="text-xs"
                        style={{
                          color: "var(--al-subtle)",
                          padding: "4px 8px",
                          borderRadius: 6,
                        }}
                      >
                        ✕
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

// ── small bits ──────────────────────────────────────────────────────────────

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--al-text-secondary)", marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </label>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th style={{
      padding: "10px 14px",
      textAlign: align,
      fontWeight: 600,
      fontSize: 11,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    }}>{children}</th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td style={{
      padding: "12px 14px",
      textAlign: align,
      color: "var(--al-text)",
      fontSize: 13,
      fontVariantNumeric: "tabular-nums",
    }}>{children}</td>
  );
}

function Stat({ label, value, subtle }: { label: string; value: string; subtle?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{
        fontSize: 16, fontWeight: 700,
        color: subtle ? "var(--al-subtle)" : "var(--al-text)",
        letterSpacing: "-0.01em",
        fontStyle: subtle ? "italic" : "normal",
      }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--al-subtle)" }}>{label}</div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 100,
      background: "rgba(5,150,105,0.08)",
      color: "var(--al-accent)",
      fontSize: 11,
      fontWeight: 500,
      textTransform: "capitalize",
    }}>{children}</span>
  );
}
