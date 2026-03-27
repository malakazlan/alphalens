"use client";
import type { ReportTemplate } from "@/lib/stores/report-store";

interface TemplateInfo {
  id: ReportTemplate;
  label: string;
  description: string;
  sections: number;
  words: string;
  icon: React.ReactNode;
  accent: string;
}

const TEMPLATES: TemplateInfo[] = [
  {
    id: "full_analysis",
    label: "Full Analysis",
    description: "Comprehensive 7-section financial deep-dive with tables and ratios",
    sections: 7,
    words: "~3,000",
    accent: "#059669",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="21" x2="9" y2="9" />
      </svg>
    ),
  },
  {
    id: "executive_brief",
    label: "Executive Brief",
    description: "Quick overview with summary, metrics, and conclusion",
    sections: 3,
    words: "~800",
    accent: "#2193FD",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    id: "risk_report",
    label: "Risk Report",
    description: "Compliance-focused: liquidity, red flags, and risk analysis",
    sections: 4,
    words: "~1,500",
    accent: "#f59e0b",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  {
    id: "investor_memo",
    label: "Investor Memo",
    description: "Investment committee format with performance and outlook",
    sections: 5,
    words: "~2,000",
    accent: "#FF5CFF",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="20" x2="12" y2="10" />
        <line x1="18" y1="20" x2="18" y2="4" />
        <line x1="6" y1="20" x2="6" y2="16" />
      </svg>
    ),
  },
];

interface TemplateSelectorProps {
  selected: ReportTemplate;
  onSelect: (t: ReportTemplate) => void;
  onGenerate: () => void;
  docName: string;
  generating: boolean;
}

export default function TemplateSelector({
  selected,
  onSelect,
  onGenerate,
  docName,
  generating,
}: TemplateSelectorProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-10">
      {/* Doc name */}
      <p
        className="text-sm font-semibold mb-1 truncate max-w-md"
        style={{ color: "var(--al-text)" }}
      >
        {docName}
      </p>
      <p className="text-xs mb-6" style={{ color: "var(--al-subtle)" }}>
        Choose a report template
      </p>

      {/* Template grid */}
      <div className="grid grid-cols-2 gap-3 max-w-lg w-full mb-6">
        {TEMPLATES.map((t) => {
          const active = selected === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className="text-left p-4 rounded-xl border transition-all"
              style={{
                borderColor: active ? t.accent : "var(--al-border)",
                background: active ? `${t.accent}08` : "var(--al-card)",
                boxShadow: active ? `0 0 0 1px ${t.accent}` : "none",
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{
                    background: `${t.accent}14`,
                    color: t.accent,
                  }}
                >
                  {t.icon}
                </div>
                <span
                  className="text-sm font-semibold"
                  style={{ color: active ? t.accent : "var(--al-text)" }}
                >
                  {t.label}
                </span>
              </div>
              <p
                className="text-[11px] leading-relaxed mb-2"
                style={{ color: "var(--al-subtle)" }}
              >
                {t.description}
              </p>
              <div className="flex items-center gap-3">
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: `${t.accent}14`, color: t.accent }}
                >
                  {t.sections} sections
                </span>
                <span
                  className="text-[10px]"
                  style={{ color: "var(--al-subtle)" }}
                >
                  {t.words} words
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Generate button */}
      <button
        onClick={onGenerate}
        disabled={generating}
        className="px-8 py-3 rounded-xl text-sm font-semibold transition-all"
        style={{
          background: generating ? "var(--al-bg-secondary)" : "var(--al-accent)",
          color: generating ? "var(--al-subtle)" : "#fff",
          opacity: generating ? 0.7 : 1,
        }}
      >
        {generating ? "Generating…" : "Generate Report"}
      </button>
    </div>
  );
}
