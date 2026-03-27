"use client";
import { useEffect, useState, useCallback } from "react";
import { useAnalyzerStore } from "@/lib/stores/analyzer-store";

// ── Types ────────────────────────────────────────────────────────────────────
interface GroundingRef {
  chunk_id: string;
  cell_id?: string;
  page?: number;
}

interface ExtractPanelProps {
  docId: string;
  onHighlightChunk?: (chunkId: string, cellId?: string, page?: number) => void;
}

// ── Formatters ───────────────────────────────────────────────────────────────
function fmt(val: unknown, cur = ""): string {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "number") {
    const abs = Math.abs(val);
    const prefix = cur ? `${cur} ` : "";
    if (abs >= 1_000_000_000) return `${prefix}${(val / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000)     return `${prefix}${(val / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000)         return `${prefix}${(val / 1_000).toFixed(1)}K`;
    return `${prefix}${val}`;
  }
  return String(val);
}

function fmtPct(val: unknown): string {
  if (val === null || val === undefined) return "—";
  return `${Number(val).toFixed(2)}%`;
}

// ── Confidence bar ───────────────────────────────────────────────────────────
function ConfidenceBar({ value }: { value: number | undefined | null }) {
  if (value === undefined || value === null) return null;
  const pct = Math.round(value * 100);
  const color = pct >= 90 ? "#059669" : pct >= 70 ? "#f59e0b" : "#dc2626";
  return (
    <div className="flex items-center gap-1.5 shrink-0 ml-2" title={`${pct}% confidence`}>
      <div
        className="h-1.5 rounded-full"
        style={{ width: 40, background: "var(--al-border)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-[10px] tabular-nums" style={{ color, minWidth: 28 }}>
        {pct}%
      </span>
    </div>
  );
}

// ── Extract row with optional confidence + click-to-highlight ────────────────
function ExtractRow({
  label,
  value,
  confidence,
  grounding,
  onHighlight,
}: {
  label: string;
  value: string;
  confidence?: number | null;
  grounding?: GroundingRef | null;
  onHighlight?: (g: GroundingRef) => void;
}) {
  const clickable = !!(grounding && onHighlight);
  return (
    <div
      className={`flex items-center justify-between py-2 border-b last:border-0 ${
        clickable ? "cursor-pointer hover:bg-[rgba(5,150,105,0.04)] transition-colors rounded" : ""
      }`}
      style={{ borderColor: "var(--al-border-light)" }}
      onClick={clickable ? () => onHighlight!(grounding!) : undefined}
    >
      <span className="text-xs flex items-center gap-1" style={{ color: "var(--al-text-secondary)" }}>
        {clickable && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--al-accent)" strokeWidth="2.5" className="shrink-0 opacity-50">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        )}
        {label}
      </span>
      <div className="flex items-center">
        <span className="text-xs font-semibold text-right ml-4" style={{ color: "var(--al-text)" }}>
          {value}
        </span>
        <ConfidenceBar value={confidence} />
      </div>
    </div>
  );
}

// ── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div
      className="flex items-center justify-between py-2 border-b last:border-0"
      style={{ borderColor: "var(--al-border-light)" }}
    >
      <div className="h-3 rounded w-24 animate-pulse" style={{ background: "var(--al-border)" }} />
      <div className="h-3 rounded w-16 animate-pulse" style={{ background: "var(--al-border)" }} />
    </div>
  );
}

// ── Collapsible section card ─────────────────────────────────────────────────
function Section({
  id,
  title,
  accent = "var(--al-accent)",
  fieldCount,
  children,
  skeleton = false,
  expanded,
  onToggle,
}: {
  id: string;
  title: string;
  accent?: string;
  fieldCount?: number;
  children?: React.ReactNode;
  skeleton?: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="rounded-xl border mb-3 overflow-hidden"
      style={{ border: "1.5px solid var(--al-border)", background: "var(--al-card)" }}
    >
      {/* Header — clickable to collapse/expand */}
      <button
        onClick={onToggle}
        className="flex items-center w-full border-b transition-colors hover:bg-[rgba(0,0,0,0.015)]"
        style={{ borderColor: expanded ? "var(--al-border)" : "transparent" }}
      >
        <div className="w-1 self-stretch shrink-0" style={{ background: accent }} />
        <div className="px-4 py-3 flex-1 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>
            {title}
          </h3>
          <div className="flex items-center gap-2">
            {fieldCount !== undefined && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `${accent}14`, color: accent }}>
                {fieldCount} fields
              </span>
            )}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={accent}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform duration-200"
              style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>
      </button>
      {/* Body */}
      <div
        className="transition-all duration-200 overflow-hidden"
        style={{ maxHeight: expanded ? 1000 : 0, opacity: expanded ? 1 : 0 }}
      >
        <div className="px-4 py-1">
          {skeleton ? [1, 2, 3].map((i) => <SkeletonRow key={i} />) : children}
        </div>
      </div>
    </div>
  );
}

// ── Summary bar (sticky) ─────────────────────────────────────────────────────
const OPINION_COLOR: Record<string, string> = {
  "Unqualified/Clean": "#059669",
  Qualified: "#f59e0b",
  Adverse: "#dc2626",
  "Disclaimer of Opinion": "#dc2626",
};

function SummaryBar({ data }: { data: Record<string, any> }) {
  const opinion = data.auditor_opinion as string | undefined;
  const opColor = OPINION_COLOR[opinion ?? ""] ?? "#64748b";

  return (
    <div
      className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2.5 mb-3 rounded-xl border"
      style={{
        background: "var(--al-bg-soft)",
        borderColor: "var(--al-border)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: "var(--al-text)" }}>
          {data.company_name ?? "Unknown Company"}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {data.fiscal_year && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--al-accent-soft)", color: "var(--al-accent)" }}>
              FY {data.fiscal_year}
            </span>
          )}
          {data.fiscal_period && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(33,147,253,0.08)", color: "#2193FD" }}>
              {data.fiscal_period}
            </span>
          )}
          {data.currency && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--al-border-light)", color: "var(--al-subtle)" }}>
              {data.currency}
            </span>
          )}
        </div>
      </div>
      {opinion && (
        <span
          className="text-[10px] font-semibold px-2.5 py-1 rounded-full shrink-0"
          style={{ background: `${opColor}14`, color: opColor }}
        >
          {opinion}
        </span>
      )}
    </div>
  );
}

// ── Export helpers ────────────────────────────────────────────────────────────
function downloadJSON(data: Record<string, any>) {
  const name = `${(data.company_name ?? "document").replace(/\s+/g, "_")}_${data.fiscal_year ?? "extract"}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCSV(data: Record<string, any>, confidence: Record<string, number> | undefined) {
  const name = `${(data.company_name ?? "document").replace(/\s+/g, "_")}_${data.fiscal_year ?? "extract"}.csv`;
  const rows: string[][] = [["Section", "Field", "Value", "Confidence"]];

  const SECTION_FIELDS: Record<string, [string, string[]]> = {
    income_statement: ["Income Statement", ["revenue", "gross_profit", "operating_income", "net_income", "ebitda", "eps", "revenue_yoy_growth"]],
    balance_sheet: ["Balance Sheet", ["total_assets", "total_liabilities", "total_equity", "cash_and_equivalents", "total_debt", "current_assets", "current_liabilities"]],
    cash_flow: ["Cash Flow", ["operating_cash_flow", "investing_cash_flow", "financing_cash_flow", "free_cash_flow", "capex"]],
    key_metrics: ["Key Metrics", ["gross_margin", "net_margin", "roe", "roa", "current_ratio", "debt_to_equity", "pe_ratio"]],
  };

  // Doc info
  for (const key of ["company_name", "doc_type", "fiscal_year", "fiscal_period", "currency", "reporting_date"]) {
    if (data[key] !== undefined && data[key] !== null)
      rows.push(["Document Info", key, String(data[key]), ""]);
  }

  for (const [secKey, [secLabel, fields]] of Object.entries(SECTION_FIELDS)) {
    const sec = data[secKey] ?? {};
    for (const f of fields) {
      if (sec[f] !== undefined && sec[f] !== null) {
        const confKey = `${secKey}.${f}`;
        const conf = confidence?.[confKey];
        rows.push([secLabel, f, String(sec[f]), conf !== undefined ? `${Math.round(conf * 100)}%` : ""]);
      }
    }
  }

  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ExtractPanel({ docId, onHighlightChunk }: ExtractPanelProps) {
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const { expandedSections, toggleSection } = useAnalyzerStore();

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch(`/api/documents/${docId}/extract`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setData(d.extract);
        else setError(d.error ?? "Failed to load extract data.");
      })
      .catch(() => setError("Could not connect to server."))
      .finally(() => setLoading(false));
  }, [docId]);

  useEffect(() => {
    load();
  }, [load]);

  // Helper to get confidence for a field path
  const conf = (path: string): number | undefined => {
    return (data?._confidence as Record<string, number> | undefined)?.[path];
  };

  // Helper to get grounding ref for a field path
  const gnd = (path: string): GroundingRef | undefined => {
    return (data?._grounding as Record<string, GroundingRef> | undefined)?.[path];
  };

  // Highlight handler
  const handleHighlight = (g: GroundingRef) => {
    onHighlightChunk?.(g.chunk_id, g.cell_id, g.page);
  };

  // Count non-null fields in a section object
  const countFields = (obj: Record<string, any> | undefined): number => {
    if (!obj) return 0;
    return Object.values(obj).filter((v) => v !== null && v !== undefined).length;
  };

  // ── Loading skeleton ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-4 overflow-y-auto h-full">
        <Section id="s1" title="Document Info" accent="#32D583" skeleton expanded onToggle={() => {}} />
        <Section id="s2" title="Income Statement" accent="#2193FD" skeleton expanded onToggle={() => {}} />
        <Section id="s3" title="Balance Sheet" accent="#2193FD" skeleton expanded onToggle={() => {}} />
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: "rgba(220,38,38,0.08)", color: "var(--al-error)", fontSize: 20 }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className="text-sm font-medium text-center" style={{ color: "var(--al-error)" }}>
          {error}
        </p>
        <button
          onClick={load}
          className="text-xs px-4 py-2 rounded-lg font-medium"
          style={{ color: "var(--al-accent)", background: "var(--al-accent-soft)" }}
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────
  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: "var(--al-accent-soft)", color: "var(--al-accent)" }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </div>
        <p className="text-sm font-medium" style={{ color: "var(--al-text-secondary)" }}>
          No extract data available
        </p>
        <p className="text-xs text-center" style={{ color: "var(--al-subtle)", maxWidth: 260 }}>
          Upload and process a financial document to automatically extract income statements, balance sheets, and cash flow data.
        </p>
      </div>
    );
  }

  // ── Data available — render sections ───────────────────────────────────
  const cur = data.currency ?? "";
  const is = data.income_statement ?? {};
  const bs = data.balance_sheet ?? {};
  const cf = data.cash_flow ?? {};
  const km = data.key_metrics ?? {};
  const flags = (data.red_flags ?? []) as string[];
  const opinion = data.auditor_opinion as string | undefined;
  const opinionColor = OPINION_COLOR[opinion ?? ""] ?? "#64748b";

  return (
    <div className="overflow-y-auto h-full">
      {/* Sticky summary bar */}
      <div className="p-4 pb-0">
        <SummaryBar data={data} />
      </div>

      <div className="px-4 pb-4">
        {/* Document Info */}
        <Section
          id="document_info"
          title="Document Info"
          accent="#32D583"
          fieldCount={6}
          expanded={expandedSections.includes("document_info")}
          onToggle={() => toggleSection("document_info")}
        >
          <ExtractRow label="Company" value={data.company_name ?? "—"} />
          <ExtractRow label="Type" value={data.doc_type ?? "—"} />
          <ExtractRow label="Fiscal Year" value={data.fiscal_year ? String(data.fiscal_year) : "—"} />
          <ExtractRow label="Period" value={data.fiscal_period ?? "—"} />
          <ExtractRow label="Currency" value={cur || "—"} />
          <ExtractRow label="Reporting Date" value={data.reporting_date ?? "—"} />
        </Section>

        {/* Income Statement */}
        {countFields(is) > 0 && (
          <Section
            id="income_statement"
            title="Income Statement"
            accent="#2193FD"
            fieldCount={countFields(is)}
            expanded={expandedSections.includes("income_statement")}
            onToggle={() => toggleSection("income_statement")}
          >
            {is.revenue !== undefined && (
              <ExtractRow label="Revenue" value={fmt(is.revenue, cur)} confidence={conf("income_statement.revenue")} grounding={gnd("income_statement.revenue")} onHighlight={handleHighlight} />
            )}
            {is.gross_profit !== undefined && (
              <ExtractRow label="Gross Profit" value={fmt(is.gross_profit, cur)} confidence={conf("income_statement.gross_profit")} grounding={gnd("income_statement.gross_profit")} onHighlight={handleHighlight} />
            )}
            {is.operating_income !== undefined && (
              <ExtractRow label="Operating Income" value={fmt(is.operating_income, cur)} confidence={conf("income_statement.operating_income")} grounding={gnd("income_statement.operating_income")} onHighlight={handleHighlight} />
            )}
            {is.net_income !== undefined && (
              <ExtractRow label="Net Income" value={fmt(is.net_income, cur)} confidence={conf("income_statement.net_income")} grounding={gnd("income_statement.net_income")} onHighlight={handleHighlight} />
            )}
            {is.ebitda !== undefined && (
              <ExtractRow label="EBITDA" value={fmt(is.ebitda, cur)} confidence={conf("income_statement.ebitda")} grounding={gnd("income_statement.ebitda")} onHighlight={handleHighlight} />
            )}
            {is.eps !== undefined && (
              <ExtractRow label="EPS" value={fmt(is.eps)} confidence={conf("income_statement.eps")} grounding={gnd("income_statement.eps")} onHighlight={handleHighlight} />
            )}
          </Section>
        )}

        {/* Balance Sheet */}
        {countFields(bs) > 0 && (
          <Section
            id="balance_sheet"
            title="Balance Sheet"
            accent="#2193FD"
            fieldCount={countFields(bs)}
            expanded={expandedSections.includes("balance_sheet")}
            onToggle={() => toggleSection("balance_sheet")}
          >
            {bs.total_assets !== undefined && (
              <ExtractRow label="Total Assets" value={fmt(bs.total_assets, cur)} confidence={conf("balance_sheet.total_assets")} grounding={gnd("balance_sheet.total_assets")} onHighlight={handleHighlight} />
            )}
            {bs.total_liabilities !== undefined && (
              <ExtractRow label="Total Liabilities" value={fmt(bs.total_liabilities, cur)} confidence={conf("balance_sheet.total_liabilities")} grounding={gnd("balance_sheet.total_liabilities")} onHighlight={handleHighlight} />
            )}
            {bs.total_equity !== undefined && (
              <ExtractRow label="Total Equity" value={fmt(bs.total_equity, cur)} confidence={conf("balance_sheet.total_equity")} grounding={gnd("balance_sheet.total_equity")} onHighlight={handleHighlight} />
            )}
            {bs.cash_and_equivalents !== undefined && (
              <ExtractRow label="Cash & Equivalents" value={fmt(bs.cash_and_equivalents, cur)} confidence={conf("balance_sheet.cash_and_equivalents")} grounding={gnd("balance_sheet.cash_and_equivalents")} onHighlight={handleHighlight} />
            )}
            {bs.total_debt !== undefined && (
              <ExtractRow label="Total Debt" value={fmt(bs.total_debt, cur)} confidence={conf("balance_sheet.total_debt")} grounding={gnd("balance_sheet.total_debt")} onHighlight={handleHighlight} />
            )}
            {bs.current_assets !== undefined && (
              <ExtractRow label="Current Assets" value={fmt(bs.current_assets, cur)} confidence={conf("balance_sheet.current_assets")} grounding={gnd("balance_sheet.current_assets")} onHighlight={handleHighlight} />
            )}
            {bs.current_liabilities !== undefined && (
              <ExtractRow label="Current Liabilities" value={fmt(bs.current_liabilities, cur)} confidence={conf("balance_sheet.current_liabilities")} grounding={gnd("balance_sheet.current_liabilities")} onHighlight={handleHighlight} />
            )}
          </Section>
        )}

        {/* Cash Flow */}
        {countFields(cf) > 0 && (
          <Section
            id="cash_flow"
            title="Cash Flow"
            accent="#32D583"
            fieldCount={countFields(cf)}
            expanded={expandedSections.includes("cash_flow")}
            onToggle={() => toggleSection("cash_flow")}
          >
            {cf.operating_cash_flow !== undefined && (
              <ExtractRow label="Operating CF" value={fmt(cf.operating_cash_flow, cur)} confidence={conf("cash_flow.operating_cash_flow")} grounding={gnd("cash_flow.operating_cash_flow")} onHighlight={handleHighlight} />
            )}
            {cf.investing_cash_flow !== undefined && (
              <ExtractRow label="Investing CF" value={fmt(cf.investing_cash_flow, cur)} confidence={conf("cash_flow.investing_cash_flow")} grounding={gnd("cash_flow.investing_cash_flow")} onHighlight={handleHighlight} />
            )}
            {cf.financing_cash_flow !== undefined && (
              <ExtractRow label="Financing CF" value={fmt(cf.financing_cash_flow, cur)} confidence={conf("cash_flow.financing_cash_flow")} grounding={gnd("cash_flow.financing_cash_flow")} onHighlight={handleHighlight} />
            )}
            {cf.free_cash_flow !== undefined && (
              <ExtractRow label="Free Cash Flow" value={fmt(cf.free_cash_flow, cur)} confidence={conf("cash_flow.free_cash_flow")} grounding={gnd("cash_flow.free_cash_flow")} onHighlight={handleHighlight} />
            )}
            {cf.capex !== undefined && (
              <ExtractRow label="CapEx" value={fmt(cf.capex, cur)} confidence={conf("cash_flow.capex")} grounding={gnd("cash_flow.capex")} onHighlight={handleHighlight} />
            )}
          </Section>
        )}

        {/* Key Metrics */}
        {countFields(km) > 0 && (
          <Section
            id="key_metrics"
            title="Key Metrics"
            accent="#FF5CFF"
            fieldCount={countFields(km)}
            expanded={expandedSections.includes("key_metrics")}
            onToggle={() => toggleSection("key_metrics")}
          >
            {km.gross_margin !== undefined && (
              <ExtractRow label="Gross Margin" value={fmtPct(km.gross_margin)} confidence={conf("key_metrics.gross_margin")} />
            )}
            {km.net_margin !== undefined && (
              <ExtractRow label="Net Margin" value={fmtPct(km.net_margin)} confidence={conf("key_metrics.net_margin")} />
            )}
            {km.roe !== undefined && (
              <ExtractRow label="ROE" value={fmtPct(km.roe)} confidence={conf("key_metrics.roe")} />
            )}
            {km.roa !== undefined && (
              <ExtractRow label="ROA" value={fmtPct(km.roa)} confidence={conf("key_metrics.roa")} />
            )}
            {km.current_ratio !== undefined && (
              <ExtractRow label="Current Ratio" value={fmt(km.current_ratio)} confidence={conf("key_metrics.current_ratio")} />
            )}
            {km.debt_to_equity !== undefined && (
              <ExtractRow label="Debt / Equity" value={fmt(km.debt_to_equity)} confidence={conf("key_metrics.debt_to_equity")} />
            )}
            {km.pe_ratio !== undefined && (
              <ExtractRow label="P/E Ratio" value={fmt(km.pe_ratio)} confidence={conf("key_metrics.pe_ratio")} />
            )}
          </Section>
        )}

        {/* Audit & Red Flags */}
        {(opinion || flags.length > 0) && (
          <Section
            id="audit_risk"
            title="Audit & Risk"
            accent={opinionColor}
            expanded={expandedSections.includes("audit_risk")}
            onToggle={() => toggleSection("audit_risk")}
          >
            {opinion && (
              <div
                className="flex items-center justify-between py-2 border-b"
                style={{ borderColor: "var(--al-border-light)" }}
              >
                <span className="text-xs" style={{ color: "var(--al-text-secondary)" }}>
                  Auditor Opinion
                </span>
                <span
                  className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                  style={{ background: `${opinionColor}14`, color: opinionColor }}
                >
                  {opinion}
                </span>
              </div>
            )}
            {flags.map((flag, i) => (
              <div
                key={i}
                className="flex items-start gap-2 py-2 border-b last:border-0"
                style={{ borderColor: "var(--al-border-light)" }}
              >
                <div
                  className="shrink-0 mt-0.5 w-4 h-4 rounded flex items-center justify-center"
                  style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L1 21h22L12 2zm0 4l7.53 13H4.47L12 6zm-1 5v4h2v-4h-2zm0 6v2h2v-2h-2z" />
                  </svg>
                </div>
                <span className="text-xs leading-relaxed" style={{ color: "#f59e0b" }}>
                  {flag}
                </span>
              </div>
            ))}
          </Section>
        )}

        {/* Export bar */}
        <div
          className="flex items-center gap-2 pt-2 pb-1 border-t mt-1"
          style={{ borderColor: "var(--al-border)" }}
        >
          <button
            onClick={() => downloadJSON(data)}
            className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: "var(--al-accent)", background: "var(--al-accent-soft)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export JSON
          </button>
          <button
            onClick={() => downloadCSV(data, data._confidence)}
            className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: "var(--al-subtle)", background: "var(--al-border-light)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>
    </div>
  );
}
