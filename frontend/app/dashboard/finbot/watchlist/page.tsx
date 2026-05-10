"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";

interface WatchEntry {
  id:          string;
  ticker:      string;
  alert_above: number | null;
  alert_below: number | null;
  note:        string | null;
  created_at:  string;
}

interface FormState {
  ticker:      string;
  alert_above: string;
  alert_below: string;
  note:        string;
}

const EMPTY_FORM: FormState = {
  ticker:      "",
  alert_above: "",
  alert_below: "",
  note:        "",
};

export default function WatchlistPage() {
  const [items,   setItems]   = useState<WatchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [form,    setForm]    = useState<FormState>(EMPTY_FORM);
  const [saving,  setSaving]  = useState(false);

  async function fetchList() {
    setLoading(true);
    try {
      const res  = await fetch("/api/finbot/watchlist", { credentials: "include" });
      const data = await res.json();
      if (data.success) setItems(data.watchlist ?? []);
    } catch {
      setError("Could not load watchlist.");
    }
    setLoading(false);
  }

  useEffect(() => { fetchList(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        ticker:      form.ticker.trim().toUpperCase(),
        alert_above: form.alert_above === "" ? null : parseFloat(form.alert_above),
        alert_below: form.alert_below === "" ? null : parseFloat(form.alert_below),
        note:        form.note.trim() || null,
      };
      const res  = await fetch("/api/finbot/watchlist", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.detail ?? data.error ?? "Could not save.");
      } else {
        setForm(EMPTY_FORM);
        setAddOpen(false);
        await fetchList();
      }
    } catch {
      setError("Network error.");
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this ticker from your watchlist?")) return;
    try {
      const res = await fetch(`/api/finbot/watchlist/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) setItems(prev => prev.filter(w => w.id !== id));
    } catch {}
  }

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
              <span className="landing-gradient-text">Watchlist</span>
            </h1>
            <p style={{
              fontSize: 14, color: "var(--al-text-secondary)",
              maxWidth: 560, marginTop: 6,
            }}>
              Tickers you&apos;re tracking. FinBot references these proactively when
              relevant — earnings dates, big moves, news.
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
            {addOpen ? "Cancel" : "+ Add ticker"}
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
              <Field label="Alert above ($)">
                <input
                  type="number" step="any" min="0"
                  value={form.alert_above}
                  onChange={e => setForm({ ...form, alert_above: e.target.value })}
                  placeholder="optional"
                  style={inputStyle}
                />
              </Field>
              <Field label="Alert below ($)">
                <input
                  type="number" step="any" min="0"
                  value={form.alert_below}
                  onChange={e => setForm({ ...form, alert_below: e.target.value })}
                  placeholder="optional"
                  style={inputStyle}
                />
              </Field>
              <Field label="Note (optional)">
                <input
                  value={form.note}
                  onChange={e => setForm({ ...form, note: e.target.value })}
                  placeholder="Watch ahead of earnings"
                  maxLength={500}
                  style={inputStyle}
                />
              </Field>
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
                {saving ? "Saving…" : "Save ticker"}
              </button>
            </div>
          </form>
        )}

        {/* List */}
        {loading ? (
          <div className="py-20 text-center" style={{ color: "var(--al-subtle)" }}>Loading…</div>
        ) : items.length === 0 ? (
          <div
            className="py-16 px-8 text-center rounded-xl"
            style={{
              background: "var(--al-bg-soft)",
              border: "1px dashed var(--al-border)",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--al-text)", marginBottom: 6 }}>
              Watchlist is empty.
            </div>
            <div style={{ fontSize: 13, color: "var(--al-text-secondary)", maxWidth: 480, margin: "0 auto" }}>
              Add tickers above, or just tell FinBot in chat:
              <span style={{ fontStyle: "italic" }}> &quot;Add NVDA to my watchlist.&quot;</span>
            </div>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {items.map(w => (
              <div
                key={w.id}
                style={{
                  background: "var(--al-card)",
                  border: "1px solid var(--al-border)",
                  borderRadius: 12,
                  padding: "14px 16px",
                  position: "relative",
                }}
              >
                <button
                  onClick={() => handleDelete(w.id)}
                  title="Remove"
                  style={{
                    position: "absolute", top: 8, right: 8,
                    background: "transparent", border: "none",
                    color: "var(--al-subtle)", padding: "4px 8px",
                    borderRadius: 6, fontSize: 14, cursor: "pointer",
                  }}
                >
                  ✕
                </button>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--al-text)", letterSpacing: "-0.02em" }}>
                  {w.ticker}
                </div>
                {(w.alert_above != null || w.alert_below != null) && (
                  <div style={{ fontSize: 12, color: "var(--al-text-secondary)", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
                    {w.alert_above != null && <>↑ ${w.alert_above}</>}
                    {w.alert_above != null && w.alert_below != null && <span style={{ margin: "0 6px" }}>·</span>}
                    {w.alert_below != null && <>↓ ${w.alert_below}</>}
                  </div>
                )}
                {w.note && (
                  <div style={{ fontSize: 12, color: "var(--al-text-secondary)", marginTop: 6, fontStyle: "italic" }}>
                    {w.note}
                  </div>
                )}
              </div>
            ))}
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
