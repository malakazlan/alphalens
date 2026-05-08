"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useAnalyzerStore } from "@/lib/stores/analyzer-store";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GroundingRef {
  chunk_id: string;
  cell_id?: string;
  page?: number;
}

interface ExtractCell {
  col_header:  string;
  value_text:  string;
  cell_id:     string;
  page:        number;
  bbox:        { left: number; top: number; right: number; bottom: number };
}

interface ExtractRow {
  row_label:       string;
  row_label_id:    string;
  is_group_header: boolean;
  cells:           ExtractCell[];
  yoy_delta_pct:   number | null;
}

interface ExtractTable {
  table_id:    string;
  title:       string;
  section:     string;
  page:        number;
  bbox:        { left: number; top: number; right: number; bottom: number };
  col_headers: string[];
  year_cols:   number[];
  unit_scale:  number;
  unit_label:  string;
  rows:        ExtractRow[];
}

interface ExtractPanelProps {
  docId:              string;
  onHighlightChunk?:  (chunkId: string, cellId?: string, page?: number) => void;
}

// ── Formatters ────────────────────────────────────────────────────────────────

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

/** Scale a raw value string by unit_scale for display. Returns original if not numeric. */
function applyScale(text: string, scale: number): string {
  if (scale <= 1 || !text) return text;
  const clean = text.replace(/,/g, "").replace(/\((.+)\)/, "-$1").trim();
  const num = parseFloat(clean);
  if (isNaN(num)) return text;
  const scaled = num * scale;
  const abs = Math.abs(scaled);
  if (abs >= 1_000_000_000) return `${(scaled / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000)     return `${(scaled / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)         return `${(scaled / 1_000).toFixed(1)}K`;
  return scaled.toLocaleString();
}

// ── Confidence bar ─────────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number | undefined | null }) {
  if (value === undefined || value === null) return null;
  const pct = Math.round(value * 100);
  const color = pct >= 90 ? "#059669" : pct >= 70 ? "#f59e0b" : "#dc2626";
  return (
    <div className="flex items-center gap-1.5 shrink-0 ml-2" title={`${pct}% confidence`}>
      <div className="h-1.5 rounded-full" style={{ width: 40, background: "var(--al-border)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] tabular-nums" style={{ color, minWidth: 28 }}>{pct}%</span>
    </div>
  );
}

// ── Structured ExtractRow ─────────────────────────────────────────────────────

function ExtractRow({
  label, value, confidence, grounding, onHighlight,
}: {
  label:       string;
  value:       string;
  confidence?: number | null;
  grounding?:  GroundingRef | null;
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
        <span className="text-xs font-semibold text-right ml-4" style={{ color: "var(--al-text)" }}>{value}</span>
        <ConfidenceBar value={confidence} />
      </div>
    </div>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: "var(--al-border-light)" }}>
      <div className="h-3 rounded w-24 animate-pulse" style={{ background: "var(--al-border)" }} />
      <div className="h-3 rounded w-16 animate-pulse" style={{ background: "var(--al-border)" }} />
    </div>
  );
}

// ── Collapsible section card ───────────────────────────────────────────────────

function Section({
  id, title, accent = "var(--al-accent)", fieldCount, children,
  skeleton = false, expanded, onToggle,
}: {
  id: string; title: string; accent?: string; fieldCount?: number;
  children?: React.ReactNode; skeleton?: boolean;
  expanded: boolean; onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border mb-3 overflow-hidden" style={{ border: "1.5px solid var(--al-border)", background: "var(--al-card)" }}>
      <button
        onClick={onToggle}
        className="flex items-center w-full border-b transition-colors hover:bg-[rgba(0,0,0,0.015)]"
        style={{ borderColor: expanded ? "var(--al-border)" : "transparent" }}
      >
        <div className="w-1 self-stretch shrink-0" style={{ background: accent }} />
        <div className="px-4 py-3 flex-1 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>{title}</h3>
          <div className="flex items-center gap-2">
            {fieldCount !== undefined && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `${accent}14`, color: accent }}>
                {fieldCount} fields
              </span>
            )}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className="transition-transform duration-200" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>
      </button>
      <div className="transition-all duration-200 overflow-hidden" style={{ maxHeight: expanded ? 2000 : 0, opacity: expanded ? 1 : 0 }}>
        <div className="px-4 py-1">
          {skeleton ? [1, 2, 3].map((i) => <SkeletonRow key={i} />) : children}
        </div>
      </div>
    </div>
  );
}

// ── Summary bar ────────────────────────────────────────────────────────────────

const OPINION_COLOR: Record<string, string> = {
  "Unqualified/Clean": "#059669",
  "Qualified":         "#f59e0b",
  "Adverse":           "#dc2626",
  "Disclaimer of Opinion": "#dc2626",
};

function SummaryBar({ data }: { data: Record<string, any> }) {
  const opinion  = data.auditor_opinion as string | undefined;
  const opColor  = OPINION_COLOR[opinion ?? ""] ?? "#64748b";
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2.5 mb-3 rounded-xl border"
      style={{ background: "var(--al-bg-soft)", borderColor: "var(--al-border)", backdropFilter: "blur(8px)" }}>
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
        <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full shrink-0"
          style={{ background: `${opColor}14`, color: opColor }}>
          {opinion}
        </span>
      )}
    </div>
  );
}

// ── YoY delta badge ────────────────────────────────────────────────────────────

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined) return null;
  const pos   = pct >= 0;
  const color = pos ? "#059669" : "#dc2626";
  const bg    = pos ? "rgba(5,150,105,0.08)" : "rgba(220,38,38,0.08)";
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded tabular-nums shrink-0"
      style={{ color, background: bg }}>
      {pos ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

// ── TableGrid ─────────────────────────────────────────────────────────────────

function TableGrid({
  table,
  activeCellId,
  onCellClick,
}: {
  table:        ExtractTable;
  activeCellId: string | null;
  onCellClick:  (cellId: string, page: number) => void;
}) {
  const { toggleSection } = useAnalyzerStore();
  const sectionKey = `tbl_${table.table_id}`;
  const defaultExpanded = table.rows.filter(r => !r.is_group_header).length <= 20;
  // Local expand state — initialised to defaultExpanded, toggled by the section key
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Sort state: null = natural order, colIdx = sort by that column
  const [sortCol, setSortCol]       = useState<number | null>(null);
  const [sortAsc, setSortAsc]       = useState(true);
  // Unit display override per table
  const [unitMode, setUnitMode]     = useState<"raw" | "scaled">("scaled");

  const effectiveScale = unitMode === "scaled" ? table.unit_scale : 1;

  // Value columns = col_headers minus label col (index 0)
  const valueCols = table.col_headers.slice(1); // ["2021", "2022", "2023"]

  // Sort rows — group headers always stay in their natural position
  const sortedRows = useMemo(() => {
    if (sortCol === null) return table.rows;
    return [...table.rows].sort((a, b) => {
      if (a.is_group_header || b.is_group_header) return 0;
      const aCell = a.cells[sortCol];
      const bCell = b.cells[sortCol];
      const aNum  = parseFloat((aCell?.value_text ?? "").replace(/[^0-9.\-]/g, ""));
      const bNum  = parseFloat((bCell?.value_text ?? "").replace(/[^0-9.\-]/g, ""));
      if (isNaN(aNum) || isNaN(bNum)) return 0;
      return sortAsc ? aNum - bNum : bNum - aNum;
    });
  }, [table.rows, sortCol, sortAsc]);

  const hasYears  = table.year_cols.length >= 2;
  const hasYoy    = hasYears && table.rows.some(r => r.yoy_delta_pct !== null);
  const pageLabel = `Page ${table.page + 1}`;

  // Column count for the <colgroup>
  const totalCols = 1 + valueCols.length + (hasYoy ? 1 : 0);

  return (
    <div className="rounded-xl border mb-3 overflow-hidden" style={{ border: "1.5px solid var(--al-border)", background: "var(--al-card)" }}>
      {/* Header */}
      <button
        onClick={() => { setExpanded(e => !e); toggleSection(sectionKey); }}
        className="flex items-center w-full border-b transition-colors hover:bg-[rgba(0,0,0,0.015)]"
        style={{ borderColor: expanded ? "var(--al-border)" : "transparent" }}
      >
        <div className="w-1 self-stretch shrink-0" style={{ background: "#2193FD" }} />
        <div className="px-4 py-3 flex-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wider truncate" style={{ color: "#2193FD" }}>
              {table.title || `Table ${table.table_id}`}
            </h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
              style={{ background: "rgba(33,147,253,0.08)", color: "#2193FD" }}>
              {pageLabel}
            </span>
            {hasYears && (
              <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                style={{ background: "rgba(33,147,253,0.08)", color: "#2193FD" }}>
                {table.year_cols.length} years
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Unit toggle */}
            {table.unit_scale > 1 && (
              <button
                onClick={e => { e.stopPropagation(); setUnitMode(m => m === "scaled" ? "raw" : "scaled"); }}
                className="text-[10px] px-2 py-0.5 rounded font-medium transition-colors"
                style={{
                  background: unitMode === "scaled" ? "rgba(33,147,253,0.12)" : "var(--al-border-light)",
                  color:      unitMode === "scaled" ? "#2193FD"               : "var(--al-subtle)",
                  border:     "1px solid var(--al-border)",
                }}
                title={unitMode === "scaled" ? `Showing values ${table.unit_label} (click for raw)` : "Click to scale values"}
              >
                {unitMode === "scaled" ? table.unit_label : "raw"}
              </button>
            )}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2193FD" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className="transition-transform duration-200" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>
      </button>

      {/* Table body */}
      <div className="transition-all duration-200 overflow-hidden" style={{ maxHeight: expanded ? 9999 : 0, opacity: expanded ? 1 : 0 }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse" style={{ minWidth: totalCols * 100 }}>
            <colgroup>
              <col style={{ minWidth: 180 }} />
              {valueCols.map((_, i) => <col key={i} style={{ minWidth: 100 }} />)}
              {hasYoy && <col style={{ minWidth: 70 }} />}
            </colgroup>

            {/* Column headers */}
            <thead>
              <tr style={{ background: "var(--al-bg-soft)", borderBottom: "1.5px solid var(--al-border)" }}>
                <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--al-text-secondary)" }} />
                {valueCols.map((hdr, vi) => {
                  const isSorted = sortCol === vi;
                  return (
                    <th key={vi}
                      className="text-right px-3 py-2 font-semibold cursor-pointer select-none transition-colors"
                      style={{ color: isSorted ? "#2193FD" : "var(--al-text-secondary)" }}
                      onClick={() => { if (isSorted) setSortAsc(a => !a); else { setSortCol(vi); setSortAsc(false); } }}
                      title="Click to sort"
                    >
                      <span className="flex items-center justify-end gap-1">
                        {hdr}
                        <span style={{ opacity: isSorted ? 1 : 0.3, fontSize: 10 }}>
                          {isSorted ? (sortAsc ? "↑" : "↓") : "↕"}
                        </span>
                      </span>
                    </th>
                  );
                })}
                {hasYoy && (
                  <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--al-subtle)" }}>
                    YoY
                  </th>
                )}
              </tr>
            </thead>

            {/* Rows */}
            <tbody>
              {sortedRows.map((row, ri) => {
                if (row.is_group_header) {
                  return (
                    <tr key={ri} style={{ borderBottom: "1px solid var(--al-border-light)" }}>
                      <td colSpan={totalCols} className="px-4 py-1.5 font-semibold text-xs"
                        style={{ color: "var(--al-text-secondary)", background: "var(--al-bg-soft)", letterSpacing: "0.03em" }}>
                        {row.row_label}
                      </td>
                    </tr>
                  );
                }

                const isLabelActive = activeCellId === row.row_label_id;
                return (
                  <tr key={ri}
                    className="transition-colors"
                    style={{
                      borderBottom: "1px solid var(--al-border-light)",
                      background:   isLabelActive ? "rgba(33,147,253,0.04)" : undefined,
                    }}>
                    {/* Row label */}
                    <td
                      className="px-4 py-2 cursor-pointer transition-colors"
                      style={{ color: isLabelActive ? "#2193FD" : "var(--al-text-secondary)" }}
                      onClick={() => row.row_label_id && onCellClick(row.row_label_id, row.cells[0]?.page ?? table.page)}
                      title="Click to highlight in PDF"
                    >
                      <span className="flex items-center gap-1">
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 opacity-40">
                          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                        </svg>
                        {row.row_label || "—"}
                      </span>
                    </td>

                    {/* Value cells */}
                    {row.cells.map((cell, ci) => {
                      const isActive = activeCellId === cell.cell_id;
                      const display  = effectiveScale > 1
                        ? applyScale(cell.value_text, effectiveScale)
                        : cell.value_text;
                      return (
                        <td key={ci}
                          className="text-right px-3 py-2 tabular-nums cursor-pointer font-medium transition-colors"
                          style={{
                            color:      isActive ? "#2193FD" : "var(--al-text)",
                            background: isActive ? "rgba(33,147,253,0.06)" : undefined,
                          }}
                          onClick={() => cell.cell_id && onCellClick(cell.cell_id, cell.page)}
                          title={`${cell.col_header} · raw: ${cell.value_text} · cell ${cell.cell_id}`}
                        >
                          {display || "—"}
                        </td>
                      );
                    })}

                    {/* YoY delta */}
                    {hasYoy && (
                      <td className="text-right px-3 py-2">
                        <DeltaBadge pct={row.yoy_delta_pct} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Unit note footer */}
        {table.unit_label && (
          <p className="text-[10px] px-4 py-1.5 border-t" style={{ color: "var(--al-subtle)", borderColor: "var(--al-border-light)" }}>
            Values {table.unit_label}{unitMode === "scaled" ? " — scaled for display" : " — showing raw"}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Export helpers ─────────────────────────────────────────────────────────────

function downloadJSON(data: Record<string, any>) {
  const name = `${(data.company_name ?? "document").replace(/\s+/g, "_")}_${data.fiscal_year ?? "extract"}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a"); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function downloadCSV(
  data: Record<string, any>,
  confidence: Record<string, number> | undefined,
  tables: ExtractTable[],
) {
  const name = `${(data.company_name ?? "document").replace(/\s+/g, "_")}_${data.fiscal_year ?? "extract"}.csv`;
  const rows: string[][] = [["Section", "Field / Row", "Column", "Value", "Confidence"]];

  // Structured fields
  const SECTION_FIELDS: Record<string, [string, string[]]> = {
    income_statement: ["Income Statement", ["revenue","gross_profit","operating_income","net_income","ebitda","eps"]],
    balance_sheet:    ["Balance Sheet",    ["total_assets","total_liabilities","equity","cash","debt","current_assets","current_liabilities"]],
    cash_flow:        ["Cash Flow",        ["operating","investing","financing","free_cash_flow","capital_expenditures"]],
    key_metrics:      ["Key Metrics",      ["gross_margin","net_margin","roe","roa","current_ratio","debt_to_equity","pe_ratio"]],
  };
  for (const key of ["company_name","doc_type","fiscal_year","fiscal_period","currency","reporting_date"])
    if (data[key]) rows.push(["Document Info", key, "", String(data[key]), ""]);

  for (const [secKey, [secLabel, fields]] of Object.entries(SECTION_FIELDS)) {
    const sec = data[secKey] ?? {};
    for (const f of fields) {
      if (sec[f] !== undefined && sec[f] !== null) {
        const conf = confidence?.[`${secKey}.${f}`];
        rows.push([secLabel, f, "", String(sec[f]), conf !== undefined ? `${Math.round(conf * 100)}%` : ""]);
      }
    }
  }

  // Document tables
  for (const tbl of tables) {
    for (const row of tbl.rows) {
      if (row.is_group_header) continue;
      for (const cell of row.cells) {
        rows.push([tbl.title || `Table ${tbl.table_id}`, row.row_label, cell.col_header, cell.value_text, ""]);
      }
    }
  }

  const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a"); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// ── Excel export ───────────────────────────────────────────────────────────────
// Uses SheetJS (xlsx) loaded dynamically to avoid bundle bloat.

async function downloadExcel(data: Record<string, any>, tables: ExtractTable[]) {
  // Dynamic import — only loaded when user clicks Export Excel
  let XLSX: any;
  try {
    XLSX = await import("xlsx");
  } catch {
    alert("Excel export requires the xlsx package. Run: npm install xlsx");
    return;
  }

  const wb = XLSX.utils.book_new();
  const name = (data.company_name ?? "document").replace(/\s+/g, "_");

  // Sheet 1: Document Info
  const infoRows = [
    ["Field", "Value"],
    ["Company",       data.company_name ?? ""],
    ["Document Type", data.doc_type     ?? ""],
    ["Fiscal Year",   data.fiscal_year  ?? ""],
    ["Period",        data.fiscal_period ?? ""],
    ["Currency",      data.currency     ?? ""],
    ["Reporting Date",data.reporting_date ?? ""],
    ["Audit Opinion", data.auditor_opinion ?? ""],
  ];
  const infoSheet = XLSX.utils.aoa_to_sheet(infoRows);
  infoSheet["!cols"] = [{ wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, infoSheet, "Document Info");

  // One sheet per document table
  const usedSheetNames = new Set<string>();
  for (const tbl of tables) {
    if (!tbl.rows.length) continue;
    let baseName = (tbl.title || `Table ${tbl.table_id}`).slice(0, 28);
    let sheetName = baseName;
    let counter = 2;
    while (usedSheetNames.has(sheetName)) {
      sheetName = `${baseName.slice(0, 25)} ${counter++}`;
    }
    usedSheetNames.add(sheetName);
    const headerRow = ["", ...tbl.col_headers.slice(1), ...(tbl.year_cols.length >= 2 ? ["YoY Δ%"] : [])];
    const dataRows  = tbl.rows.map(row => {
      if (row.is_group_header) return [row.row_label, ...tbl.col_headers.slice(1).map(() => "")];
      const vals = row.cells.map(c => {
        const n = parseFloat(c.value_text.replace(/[^0-9.\-]/g, "").replace(",", ""));
        return isNaN(n) ? c.value_text : n;
      });
      const yoyCell = tbl.year_cols.length >= 2
        ? (row.yoy_delta_pct !== null ? `${row.yoy_delta_pct > 0 ? "+" : ""}${row.yoy_delta_pct}%` : "")
        : [];
      return [row.row_label, ...vals, ...(Array.isArray(yoyCell) ? yoyCell : [yoyCell])];
    });

    const wsData  = [headerRow, ...dataRows];
    const ws      = XLSX.utils.aoa_to_sheet(wsData);

    // Style header row bold-ish by setting ! cols widths
    const colWidths = headerRow.map((h, i) => ({ wch: i === 0 ? 35 : 16 }));
    ws["!cols"] = colWidths;

    // Add unit note at bottom
    if (tbl.unit_label) {
      const noteRowIdx = wsData.length + 1;
      XLSX.utils.sheet_add_aoa(ws, [[`Values ${tbl.unit_label}`]], { origin: { r: noteRowIdx, c: 0 } });
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const filename = `${name}_${data.fiscal_year ?? "extract"}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ExtractPanel({ docId, onHighlightChunk }: ExtractPanelProps) {
  const [data,         setData]         = useState<Record<string, any> | null>(null);
  const [tables,       setTables]       = useState<ExtractTable[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState("");
  const [activeCellId, setActiveCellId] = useState<string | null>(null);

  const { expandedSections, toggleSection } = useAnalyzerStore();

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch(`/api/documents/${docId}/extract`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setData(d.extract ?? {});
          setTables(d.tables ?? []);
        } else {
          setError(d.error ?? "Failed to load extract data.");
        }
      })
      .catch(() => setError("Could not connect to server."))
      .finally(() => setLoading(false));
  }, [docId]);

  useEffect(() => { load(); }, [load]);

  const conf = (path: string): number | undefined =>
    (data?._confidence as Record<string, number> | undefined)?.[path];

  const gnd = (path: string): GroundingRef | undefined =>
    (data?._grounding as Record<string, GroundingRef> | undefined)?.[path];

  const handleHighlight = (g: GroundingRef) =>
    onHighlightChunk?.(g.chunk_id, g.cell_id, g.page);

  const handleCellClick = (cellId: string, page: number) => {
    setActiveCellId(prev => prev === cellId ? null : cellId);
    onHighlightChunk?.(cellId, cellId, page);
  };

  const countFields = (obj: Record<string, any> | undefined) =>
    obj ? Object.values(obj).filter(v => v !== null && v !== undefined).length : 0;

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-4 overflow-y-auto h-full">
        <Section id="s1" title="Document Info" accent="#32D583" skeleton expanded onToggle={() => {}} />
        <Section id="s2" title="Tables"        accent="#2193FD" skeleton expanded onToggle={() => {}} />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <div className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: "rgba(220,38,38,0.08)", color: "var(--al-error)", fontSize: 20 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className="text-sm font-medium text-center" style={{ color: "var(--al-error)" }}>{error}</p>
        <button onClick={load} className="text-xs px-4 py-2 rounded-lg font-medium"
          style={{ color: "var(--al-accent)", background: "var(--al-accent-soft)" }}>Retry</button>
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if ((!data || Object.keys(data).length === 0) && tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <div className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: "var(--al-accent-soft)", color: "var(--al-accent)" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </div>
        <p className="text-sm font-medium" style={{ color: "var(--al-text-secondary)" }}>No extract data available</p>
        <p className="text-xs text-center" style={{ color: "var(--al-subtle)", maxWidth: 260 }}>
          Process a financial document to extract structured tables and financial data.
        </p>
      </div>
    );
  }

  // ── Data ─────────────────────────────────────────────────────────────────
  const cur    = data?.currency ?? "";
  const is_    = data?.income_statement ?? {};
  const bs     = data?.balance_sheet ?? {};
  const cf     = data?.cash_flow ?? {};
  const km     = data?.key_metrics ?? {};
  const flags  = (data?.red_flags ?? []) as string[];
  const opinion      = data?.auditor_opinion as string | undefined;
  const opinionColor = OPINION_COLOR[opinion ?? ""] ?? "#64748b";

  const hasStructured = countFields(is_) > 0 || countFields(bs) > 0 ||
                        countFields(cf)  > 0 || countFields(km)  > 0;

  return (
    <div className="overflow-y-auto h-full">
      {/* Sticky summary */}
      {data && Object.keys(data).length > 0 && (
        <div className="p-4 pb-0">
          <SummaryBar data={data} />
        </div>
      )}

      <div className="px-4 pb-4">

        {/* ── Zone A: Structured fields (corporate schema) ── */}
        {data && (
          <Section id="document_info" title="Document Info" accent="#32D583" fieldCount={6}
            expanded={expandedSections.includes("document_info")} onToggle={() => toggleSection("document_info")}>
            <ExtractRow label="Company"        value={data.company_name  ?? "—"} />
            <ExtractRow label="Type"           value={data.doc_type      ?? "—"} />
            <ExtractRow label="Fiscal Year"    value={data.fiscal_year   ? String(data.fiscal_year) : "—"} />
            <ExtractRow label="Period"         value={data.fiscal_period ?? "—"} />
            <ExtractRow label="Currency"       value={cur || "—"} />
            <ExtractRow label="Reporting Date" value={data.reporting_date ?? "—"} />
          </Section>
        )}

        {countFields(is_) > 0 && (
          <Section id="income_statement" title="Income Statement" accent="#2193FD" fieldCount={countFields(is_)}
            expanded={expandedSections.includes("income_statement")} onToggle={() => toggleSection("income_statement")}>
            {is_.revenue          !== undefined && <ExtractRow label="Revenue"          value={fmt(is_.revenue, cur)}          confidence={conf("income_statement.revenue")}          grounding={gnd("income_statement.revenue")}          onHighlight={handleHighlight} />}
            {is_.gross_profit     !== undefined && <ExtractRow label="Gross Profit"     value={fmt(is_.gross_profit, cur)}     confidence={conf("income_statement.gross_profit")}     grounding={gnd("income_statement.gross_profit")}     onHighlight={handleHighlight} />}
            {is_.operating_income !== undefined && <ExtractRow label="Operating Income" value={fmt(is_.operating_income, cur)} confidence={conf("income_statement.operating_income")} grounding={gnd("income_statement.operating_income")} onHighlight={handleHighlight} />}
            {is_.net_income       !== undefined && <ExtractRow label="Net Income"       value={fmt(is_.net_income, cur)}       confidence={conf("income_statement.net_income")}       grounding={gnd("income_statement.net_income")}       onHighlight={handleHighlight} />}
            {is_.ebitda           !== undefined && <ExtractRow label="EBITDA"           value={fmt(is_.ebitda, cur)}           confidence={conf("income_statement.ebitda")}           grounding={gnd("income_statement.ebitda")}           onHighlight={handleHighlight} />}
            {is_.eps              !== undefined && <ExtractRow label="EPS"              value={fmt(is_.eps)}                   confidence={conf("income_statement.eps")}              grounding={gnd("income_statement.eps")}              onHighlight={handleHighlight} />}
          </Section>
        )}

        {countFields(bs) > 0 && (
          <Section id="balance_sheet" title="Balance Sheet" accent="#2193FD" fieldCount={countFields(bs)}
            expanded={expandedSections.includes("balance_sheet")} onToggle={() => toggleSection("balance_sheet")}>
            {bs.total_assets       !== undefined && <ExtractRow label="Total Assets"       value={fmt(bs.total_assets, cur)}       confidence={conf("balance_sheet.total_assets")}       grounding={gnd("balance_sheet.total_assets")}       onHighlight={handleHighlight} />}
            {bs.total_liabilities  !== undefined && <ExtractRow label="Total Liabilities"  value={fmt(bs.total_liabilities, cur)}  confidence={conf("balance_sheet.total_liabilities")}  grounding={gnd("balance_sheet.total_liabilities")}  onHighlight={handleHighlight} />}
            {bs.equity             !== undefined && <ExtractRow label="Total Equity"       value={fmt(bs.equity, cur)}             confidence={conf("balance_sheet.equity")}             grounding={gnd("balance_sheet.equity")}             onHighlight={handleHighlight} />}
            {bs.cash               !== undefined && <ExtractRow label="Cash & Equivalents" value={fmt(bs.cash, cur)}               confidence={conf("balance_sheet.cash")}               grounding={gnd("balance_sheet.cash")}               onHighlight={handleHighlight} />}
            {bs.debt               !== undefined && <ExtractRow label="Total Debt"         value={fmt(bs.debt, cur)}               confidence={conf("balance_sheet.debt")}               grounding={gnd("balance_sheet.debt")}               onHighlight={handleHighlight} />}
            {bs.current_assets     !== undefined && <ExtractRow label="Current Assets"     value={fmt(bs.current_assets, cur)}     confidence={conf("balance_sheet.current_assets")}     grounding={gnd("balance_sheet.current_assets")}     onHighlight={handleHighlight} />}
            {bs.current_liabilities !== undefined && <ExtractRow label="Current Liabilities" value={fmt(bs.current_liabilities, cur)} confidence={conf("balance_sheet.current_liabilities")} grounding={gnd("balance_sheet.current_liabilities")} onHighlight={handleHighlight} />}
          </Section>
        )}

        {countFields(cf) > 0 && (
          <Section id="cash_flow" title="Cash Flow" accent="#32D583" fieldCount={countFields(cf)}
            expanded={expandedSections.includes("cash_flow")} onToggle={() => toggleSection("cash_flow")}>
            {cf.operating            !== undefined && <ExtractRow label="Operating CF"   value={fmt(cf.operating, cur)}            confidence={conf("cash_flow.operating")}            grounding={gnd("cash_flow.operating")}            onHighlight={handleHighlight} />}
            {cf.investing            !== undefined && <ExtractRow label="Investing CF"   value={fmt(cf.investing, cur)}            confidence={conf("cash_flow.investing")}            grounding={gnd("cash_flow.investing")}            onHighlight={handleHighlight} />}
            {cf.financing            !== undefined && <ExtractRow label="Financing CF"   value={fmt(cf.financing, cur)}            confidence={conf("cash_flow.financing")}            grounding={gnd("cash_flow.financing")}            onHighlight={handleHighlight} />}
            {cf.free_cash_flow       !== undefined && <ExtractRow label="Free Cash Flow" value={fmt(cf.free_cash_flow, cur)}       confidence={conf("cash_flow.free_cash_flow")}       grounding={gnd("cash_flow.free_cash_flow")}       onHighlight={handleHighlight} />}
            {cf.capital_expenditures !== undefined && <ExtractRow label="CapEx"          value={fmt(cf.capital_expenditures, cur)} confidence={conf("cash_flow.capital_expenditures")} grounding={gnd("cash_flow.capital_expenditures")} onHighlight={handleHighlight} />}
          </Section>
        )}

        {countFields(km) > 0 && (
          <Section id="key_metrics" title="Key Metrics" accent="#FF5CFF" fieldCount={countFields(km)}
            expanded={expandedSections.includes("key_metrics")} onToggle={() => toggleSection("key_metrics")}>
            {km.gross_margin   !== undefined && <ExtractRow label="Gross Margin"  value={fmtPct(km.gross_margin)}   confidence={conf("key_metrics.gross_margin")} />}
            {km.profit_margin  !== undefined && <ExtractRow label="Net Margin"    value={fmtPct(km.profit_margin)}  confidence={conf("key_metrics.profit_margin")} />}
            {km.roe            !== undefined && <ExtractRow label="ROE"           value={fmtPct(km.roe)}            confidence={conf("key_metrics.roe")} />}
            {km.roa            !== undefined && <ExtractRow label="ROA"           value={fmtPct(km.roa)}            confidence={conf("key_metrics.roa")} />}
            {km.current_ratio  !== undefined && <ExtractRow label="Current Ratio" value={fmt(km.current_ratio)}     confidence={conf("key_metrics.current_ratio")} />}
            {km.debt_to_equity !== undefined && <ExtractRow label="Debt / Equity" value={fmt(km.debt_to_equity)}    confidence={conf("key_metrics.debt_to_equity")} />}
            {km.pe_ratio       !== undefined && <ExtractRow label="P/E Ratio"     value={fmt(km.pe_ratio)}          confidence={conf("key_metrics.pe_ratio")} />}
          </Section>
        )}

        {(opinion || flags.length > 0) && (
          <Section id="audit_risk" title="Audit & Risk" accent={opinionColor}
            expanded={expandedSections.includes("audit_risk")} onToggle={() => toggleSection("audit_risk")}>
            {opinion && (
              <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: "var(--al-border-light)" }}>
                <span className="text-xs" style={{ color: "var(--al-text-secondary)" }}>Auditor Opinion</span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                  style={{ background: `${opinionColor}14`, color: opinionColor }}>{opinion}</span>
              </div>
            )}
            {flags.map((flag, i) => (
              <div key={i} className="flex items-start gap-2 py-2 border-b last:border-0"
                style={{ borderColor: "var(--al-border-light)" }}>
                <div className="shrink-0 mt-0.5 w-4 h-4 rounded flex items-center justify-center"
                  style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L1 21h22L12 2zm0 4l7.53 13H4.47L12 6zm-1 5v4h2v-4h-2zm0 6v2h2v-2h-2z" />
                  </svg>
                </div>
                <span className="text-xs leading-relaxed" style={{ color: "#f59e0b" }}>{flag}</span>
              </div>
            ))}
          </Section>
        )}

        {/* ── Zone B: Document Tables ── */}
        {tables.length > 0 && (
          <>
            {hasStructured && (
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px" style={{ background: "var(--al-border)" }} />
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2"
                  style={{ color: "var(--al-subtle)" }}>Document Tables</span>
                <div className="flex-1 h-px" style={{ background: "var(--al-border)" }} />
              </div>
            )}
            {tables.map(tbl => (
              <TableGrid
                key={tbl.table_id}
                table={tbl}
                activeCellId={activeCellId}
                onCellClick={handleCellClick}
              />
            ))}
          </>
        )}

        {/* ── Export bar ── */}
        <div className="flex items-center gap-2 pt-2 pb-1 border-t mt-1" style={{ borderColor: "var(--al-border)" }}>
          <button onClick={() => data && downloadJSON(data)}
            className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: "var(--al-accent)", background: "var(--al-accent-soft)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            JSON
          </button>
          <button onClick={() => data && downloadCSV(data, data._confidence, tables)}
            className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: "var(--al-subtle)", background: "var(--al-border-light)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            CSV
          </button>
          <button onClick={() => data && downloadExcel(data, tables)}
            className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: "#059669", background: "rgba(5,150,105,0.08)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Excel
          </button>
        </div>
      </div>
    </div>
  );
}
