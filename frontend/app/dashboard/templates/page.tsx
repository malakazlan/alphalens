"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ─── Custom report templates — builder & manager ─────────────────────────────
// Talks to the four endpoints added in Phase 3 commit 6:
//   GET    /api/report-templates/custom
//   POST   /api/report-templates/custom
//   PATCH  /api/report-templates/custom/{id}
//   DELETE /api/report-templates/custom/{id}
// The shape mirrors backend/schemas.py:CustomTemplateCreate exactly — any
// drift there must be reflected here, or the API will 422 on save.

const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

interface SectionDraft {
  id:            string;
  title:         string;
  system_prompt: string;
  word_target:   number;
  rag_query:     string;
  rag_top_k:     number;
  model:         "fast" | "smart";
}

interface CustomTemplate {
  id:           string;
  name:         string;
  description?: string | null;
  sections:     SectionDraft[];
  updated_at?:  string;
}

function freshSection(idx: number): SectionDraft {
  // Slug-ish id so the audit trail can recognise this section across
  // regenerations. The backend treats anything non-empty as valid.
  const id = `s_${Math.random().toString(36).slice(2, 7)}_${idx}`;
  return {
    id,
    title:         "",
    system_prompt: "",
    word_target:   250,
    rag_query:     "",
    rag_top_k:     10,
    model:         "smart",
  };
}

export default function TemplatesPage() {
  const router = useRouter();

  const [templates, setTemplates] = useState<CustomTemplate[]>([]);
  const [loading,   setLoading]   = useState(true);

  // Currently edited template — null when the editor is closed
  const [draft,     setDraft]     = useState<CustomTemplate | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/report-templates/custom", { credentials: "include" });
      const data = await res.json();
      if (data.success) setTemplates(data.templates ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  function startNew() {
    setDraft({
      id:          "",
      name:        "",
      description: "",
      sections:    [freshSection(0)],
    });
    setError(null);
  }

  function startEdit(t: CustomTemplate) {
    setDraft({
      id:          t.id,
      name:        t.name,
      description: t.description ?? "",
      sections:    (t.sections ?? []).map((s) => ({
        id:            s.id,
        title:         s.title,
        system_prompt: s.system_prompt,
        word_target:   s.word_target ?? 250,
        rag_query:     s.rag_query   ?? "",
        rag_top_k:     s.rag_top_k   ?? 10,
        model:         s.model       ?? "smart",
      })),
    });
    setError(null);
  }

  function patchDraft(patch: Partial<CustomTemplate>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function patchSection(idx: number, patch: Partial<SectionDraft>) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.slice();
      sections[idx] = { ...sections[idx], ...patch };
      return { ...d, sections };
    });
  }

  function addSection() {
    setDraft((d) => {
      if (!d) return d;
      if (d.sections.length >= 15) return d;
      return { ...d, sections: [...d.sections, freshSection(d.sections.length)] };
    });
  }

  function removeSection(idx: number) {
    setDraft((d) => {
      if (!d) return d;
      if (d.sections.length <= 1) return d;
      return { ...d, sections: d.sections.filter((_, i) => i !== idx) };
    });
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) { setError("Template needs a name."); return; }
    for (const s of draft.sections) {
      if (!s.title.trim())         { setError("Every section needs a title."); return; }
      if (!s.system_prompt.trim()) { setError(`Section "${s.title}" needs a system prompt.`); return; }
    }
    setSaving(true);
    setError(null);

    const payload = {
      name:        draft.name.trim(),
      description: draft.description?.trim() || null,
      sections:    draft.sections.map((s) => ({
        id:            s.id,
        title:         s.title.trim(),
        system_prompt: s.system_prompt.trim(),
        word_target:   s.word_target,
        rag_query:     s.rag_query.trim() || null,
        rag_top_k:     s.rag_top_k,
        model:         s.model,
      })),
    };

    try {
      const url    = draft.id
        ? `/api/report-templates/custom/${draft.id}`
        : `/api/report-templates/custom`;
      const method = draft.id ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail ?? `Save failed (${res.status})`);
      }
      setDraft(null);
      await fetchAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: CustomTemplate) {
    if (!confirm(`Delete template "${t.name}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/report-templates/custom/${t.id}`, {
        method: "DELETE", credentials: "include",
      });
      if (res.ok) {
        await fetchAll();
        if (draft?.id === t.id) setDraft(null);
      }
    } catch {}
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "32px 36px 80px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          paddingBottom: 20, borderBottom: "1px solid var(--al-border)",
          marginBottom: 28,
        }}>
          <div>
            <button
              onClick={() => router.push("/dashboard/report")}
              style={{
                fontFamily: MONO, fontSize: 11, fontWeight: 600,
                letterSpacing: "0.08em", textTransform: "uppercase",
                color: "var(--al-subtle)", background: "transparent",
                border: "none", cursor: "pointer", padding: 0,
                marginBottom: 8,
              }}
            >
              ← Back to reports
            </button>
            <h1 style={{
              fontWeight: 800, fontSize: 28, letterSpacing: "-0.025em",
              color: "var(--al-text)", marginBottom: 6,
            }}>
              Custom <span className="landing-gradient-text">templates</span>
            </h1>
            <p style={{ fontSize: 13.5, color: "var(--al-text-secondary)", maxWidth: 560 }}>
              Define your own report structure: pick the sections, write the
              prompts, choose the model. Custom templates appear alongside the
              built-ins on the report page.
            </p>
          </div>
          {!draft && (
            <button
              onClick={startNew}
              style={{
                padding: "11px 18px",
                background: "var(--al-text)", color: "var(--al-card)",
                border: "1px solid var(--al-text)",
                borderRadius: 10, fontSize: 13.5, fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + New template
            </button>
          )}
        </div>

        {/* ── Editor ─────────────────────────────────────────────────── */}
        {draft && (
          <section style={{
            background: "var(--al-card)",
            border: "1px solid var(--al-border)",
            borderRadius: 16,
            padding: 24,
            marginBottom: 32,
            boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
              <h2 style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-0.015em" }}>
                {draft.id ? "Edit template" : "New template"}
              </h2>
              <button
                onClick={() => setDraft(null)}
                style={{
                  fontSize: 12, color: "var(--al-subtle)",
                  background: "transparent", border: "none",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
              <Field label="Name (required)">
                <input
                  value={draft.name}
                  onChange={(e) => patchDraft({ name: e.target.value })}
                  placeholder="My deep-dive template"
                  maxLength={120}
                  style={inputStyle}
                />
              </Field>
              <Field label="Description (optional)">
                <input
                  value={draft.description ?? ""}
                  onChange={(e) => patchDraft({ description: e.target.value })}
                  placeholder="A short note for future-you"
                  maxLength={500}
                  style={inputStyle}
                />
              </Field>
            </div>

            <div style={{
              fontFamily: MONO, fontSize: 10, fontWeight: 600,
              letterSpacing: "0.10em", textTransform: "uppercase",
              color: "var(--al-subtle)", marginBottom: 10,
            }}>
              Sections · {draft.sections.length}/15
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {draft.sections.map((s, idx) => (
                <div key={s.id} style={{
                  border: "1px solid var(--al-border)",
                  borderRadius: 12,
                  padding: 16,
                  background: "var(--al-bg-soft)",
                }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    marginBottom: 12,
                  }}>
                    <span style={{
                      fontFamily: MONO, fontSize: 10, fontWeight: 600,
                      letterSpacing: "0.10em", textTransform: "uppercase",
                      color: "var(--al-subtle)",
                    }}>
                      § {String(idx + 1).padStart(2, "0")}
                    </span>
                    {draft.sections.length > 1 && (
                      <button
                        onClick={() => removeSection(idx)}
                        style={{
                          fontSize: 11, color: "#b5564a",
                          background: "transparent", border: "none",
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                    <Field label="Section title">
                      <input
                        value={s.title}
                        onChange={(e) => patchSection(idx, { title: e.target.value })}
                        placeholder="Revenue Analysis"
                        maxLength={120}
                        style={inputStyle}
                      />
                    </Field>
                    <Field label="RAG query (optional)">
                      <input
                        value={s.rag_query}
                        onChange={(e) => patchSection(idx, { rag_query: e.target.value })}
                        placeholder="defaults to section title"
                        maxLength={300}
                        style={inputStyle}
                      />
                    </Field>
                  </div>

                  <Field label="System prompt (LLM instructions for this section)">
                    <textarea
                      value={s.system_prompt}
                      onChange={(e) => patchSection(idx, { system_prompt: e.target.value })}
                      placeholder="You are writing a section on revenue. Use the extract data and excerpts to..."
                      maxLength={4000}
                      rows={5}
                      style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                    />
                  </Field>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
                    <Field label={`Word target (${s.word_target})`}>
                      <input
                        type="range" min={50} max={1000} step={50}
                        value={s.word_target}
                        onChange={(e) => patchSection(idx, { word_target: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label={`RAG top-K (${s.rag_top_k})`}>
                      <input
                        type="range" min={3} max={20} step={1}
                        value={s.rag_top_k}
                        onChange={(e) => patchSection(idx, { rag_top_k: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Model">
                      <select
                        value={s.model}
                        onChange={(e) => patchSection(idx, { model: e.target.value as "fast" | "smart" })}
                        style={inputStyle}
                      >
                        <option value="smart">Smart (gpt-4o)</option>
                        <option value="fast">Fast (gpt-4o-mini)</option>
                      </select>
                    </Field>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={addSection}
              disabled={draft.sections.length >= 15}
              style={{
                marginTop: 14,
                padding: "9px 14px",
                background: "transparent",
                color: "var(--al-text-secondary)",
                border: "1px dashed var(--al-border)",
                borderRadius: 8,
                fontSize: 12.5, fontWeight: 500,
                cursor: draft.sections.length >= 15 ? "not-allowed" : "pointer",
                opacity: draft.sections.length >= 15 ? 0.5 : 1,
              }}
            >
              + Add section
            </button>

            {error && (
              <div style={{
                marginTop: 18, padding: "10px 14px",
                background: "rgba(181,86,74,0.08)",
                border: "1px solid rgba(181,86,74,0.25)",
                color: "#b5564a",
                borderRadius: 8, fontSize: 13,
              }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button
                onClick={() => setDraft(null)}
                style={{
                  padding: "10px 16px", fontSize: 13, fontWeight: 500,
                  background: "transparent",
                  border: "1px solid var(--al-border)",
                  color: "var(--al-text-secondary)",
                  borderRadius: 8, cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                style={{
                  padding: "10px 18px", fontSize: 13, fontWeight: 600,
                  background: "var(--al-accent)", color: "#fff",
                  border: "1px solid var(--al-accent)",
                  borderRadius: 8, cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? "Saving…" : draft.id ? "Save changes" : "Create template"}
              </button>
            </div>
          </section>
        )}

        {/* ── List ───────────────────────────────────────────────────── */}
        <section>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            marginBottom: 14,
          }}>
            <h2 style={{
              fontFamily: MONO, fontSize: 11, fontWeight: 600,
              letterSpacing: "0.10em", textTransform: "uppercase",
              color: "var(--al-subtle)",
            }}>
              Your templates · {templates.length}
            </h2>
          </div>

          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--al-subtle)" }}>
              Loading…
            </div>
          ) : templates.length === 0 ? (
            <div style={{
              padding: "32px 24px", textAlign: "center",
              background: "var(--al-card)",
              border: "1px dashed var(--al-border)",
              borderRadius: 14,
              color: "var(--al-text-secondary)",
              fontSize: 13.5,
            }}>
              No custom templates yet. Click <b>+ New template</b> to build one.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
              {templates.map((t) => (
                <div key={t.id} style={{
                  background: "var(--al-card)",
                  border: "1px solid var(--al-border)",
                  borderRadius: 14,
                  padding: 16,
                }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                    marginBottom: 8,
                  }}>
                    <h3 style={{
                      fontWeight: 700, fontSize: 16,
                      color: "var(--al-text)", letterSpacing: "-0.015em",
                    }}>
                      {t.name}
                    </h3>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => startEdit(t)}
                        style={{
                          fontSize: 11, color: "var(--al-accent)",
                          background: "transparent", border: "none",
                          cursor: "pointer", padding: 0,
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => remove(t)}
                        style={{
                          fontSize: 11, color: "#b5564a",
                          background: "transparent", border: "none",
                          cursor: "pointer", padding: 0,
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {t.description && (
                    <p style={{
                      fontSize: 12.5, color: "var(--al-text-secondary)",
                      lineHeight: 1.5, marginBottom: 10,
                    }}>
                      {t.description}
                    </p>
                  )}
                  <div style={{
                    fontFamily: MONO, fontSize: 10.5,
                    color: "var(--al-subtle)", letterSpacing: "0.04em",
                  }}>
                    {(t.sections ?? []).length} sections
                    {t.updated_at && <> · updated {new Date(t.updated_at).toLocaleDateString()}</>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Small primitives ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{
        fontFamily: MONO, fontSize: 10, fontWeight: 600,
        letterSpacing: "0.08em", textTransform: "uppercase",
        color: "var(--al-subtle)",
      }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "9px 11px",
  background: "var(--al-card)",
  border: "1px solid var(--al-border)",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 13,
  color: "var(--al-text)",
  outline: "none",
};
