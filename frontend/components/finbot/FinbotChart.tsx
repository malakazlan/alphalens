"use client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

// Server-side chart spec shape. Keep loose — we accept anything the agent
// emits, but only `price_line` is currently rendered.
export interface ChartSpec {
  type:     string;          // "price_line" — others ignored gracefully.
  ticker?:  string;
  period?:  string;
  perf_pct?: number | null;
  data?:    { date: string; close: number }[];
}

export default function FinbotChart({ spec }: { spec: ChartSpec }) {
  if (spec?.type !== "price_line" || !Array.isArray(spec.data) || spec.data.length === 0) {
    return null;
  }

  const closes = spec.data.map(d => d.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  // Pad y-axis a bit so the line never touches the top/bottom edge.
  const pad = (max - min) * 0.08 || 1;
  const yDomain: [number, number] = [Math.max(0, min - pad), max + pad];

  const isUp = (spec.perf_pct ?? 0) >= 0;
  const lineColor = isUp ? "#059669" : "#dc2626";

  return (
    <div
      style={{
        marginTop: 8,
        background: "#fff",
        border: "1px solid #eaecf0",
        borderRadius: 12,
        padding: "12px 14px 4px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", letterSpacing: "-0.01em" }}>
          {spec.ticker ?? "Chart"}{spec.period ? ` · ${spec.period}` : ""}
        </div>
        {typeof spec.perf_pct === "number" && (
          <div style={{
            fontSize: 12, fontWeight: 600,
            color: isUp ? "#047857" : "#b91c1c",
            fontVariantNumeric: "tabular-nums",
          }}>
            {isUp ? "+" : ""}{spec.perf_pct.toFixed(2)}%
          </div>
        )}
      </div>
      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer>
          <LineChart data={spec.data} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickFormatter={d => {
                // Compact YYYY-MM-DD → MMM DD for narrower x-axis.
                const parts = String(d).split("-");
                if (parts.length !== 3) return String(d);
                const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                const mIdx = Number(parts[1]) - 1;
                return `${months[mIdx] ?? parts[1]} ${parts[2]}`;
              }}
              minTickGap={20}
            />
            <YAxis
              domain={yDomain}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              width={50}
            />
            <Tooltip
              contentStyle={{
                background: "#fff",
                border: "1px solid #eaecf0",
                borderRadius: 8,
                fontSize: 12,
                padding: "6px 10px",
              }}
              labelStyle={{ color: "#6b7280", fontSize: 11 }}
              formatter={(v) => [
                typeof v === "number" ? `$${v.toFixed(2)}` : String(v),
                "Close",
              ]}
            />
            <Line
              type="monotone"
              dataKey="close"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
