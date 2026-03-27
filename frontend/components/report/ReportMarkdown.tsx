"use client";
import React from "react";

/* ── Inline bold parser ───────────────────────────────────────────── */
function inlineBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} style={{ fontWeight: 700, color: "var(--al-text)" }}>
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

/* ── Render markdown text → React nodes ───────────────────────────── */
export function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let key = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Table detection
    if (line.startsWith("|") && lines[i + 1]?.match(/^\|[-| :]+\|/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const [headerRow, , ...bodyRows] = tableLines;
      const headers = headerRow.split("|").filter((c) => c.trim());
      nodes.push(
        <div
          key={key++}
          className="overflow-x-auto my-4 rounded-xl border"
          style={{ borderColor: "var(--al-border)" }}
        >
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr
                style={{
                  background: "linear-gradient(90deg, var(--al-accent), #10b981)",
                  color: "#fff",
                }}
              >
                {headers.map((h, j) => (
                  <th
                    key={j}
                    className="px-3 py-2.5 text-left font-semibold uppercase tracking-wide"
                  >
                    {h.trim()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => {
                const cells = row.split("|").filter((c) => c.trim());
                return (
                  <tr
                    key={ri}
                    style={{
                      background:
                        ri % 2 === 0 ? "var(--al-card)" : "var(--al-bg-soft)",
                    }}
                  >
                    {cells.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-3 py-2 border-t"
                        style={{
                          borderColor: "var(--al-border)",
                          color: "var(--al-text)",
                        }}
                      >
                        {inlineBold(cell.trim())}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (line.startsWith("## ")) {
      nodes.push(
        <h2
          key={key++}
          className="text-base font-bold mt-7 mb-2 pl-3 py-1 rounded-r-lg"
          style={{
            color: "var(--al-accent)",
            borderLeft: "4px solid var(--al-accent)",
            background: "var(--al-accent-soft)",
          }}
        >
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith("### ")) {
      nodes.push(
        <h3
          key={key++}
          className="text-sm font-bold mt-4 mb-1"
          style={{ color: "var(--al-text)" }}
        >
          {line.slice(4)}
        </h3>
      );
    } else if (line.startsWith("#### ")) {
      nodes.push(
        <h4
          key={key++}
          className="text-xs font-bold mt-3 mb-0.5 uppercase tracking-wide"
          style={{ color: "var(--al-text-secondary)" }}
        >
          {line.slice(5)}
        </h4>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      nodes.push(
        <div
          key={key++}
          className="flex gap-2 text-xs leading-relaxed mb-1 ml-2"
        >
          <span
            className="mt-0.5 shrink-0 font-bold"
            style={{ color: "var(--al-accent)" }}
          >
            ▸
          </span>
          <span style={{ color: "var(--al-text)" }}>
            {inlineBold(line.slice(2))}
          </span>
        </div>
      );
    } else if (line.startsWith("> ")) {
      nodes.push(
        <blockquote
          key={key++}
          className="my-3 pl-4 py-2 rounded-r-lg text-xs italic leading-relaxed"
          style={{
            borderLeft: "4px solid var(--al-accent)",
            background: "var(--al-accent-soft)",
            color: "var(--al-text-secondary)",
          }}
        >
          {inlineBold(line.slice(2))}
        </blockquote>
      );
    } else if (line.match(/^[-*_]{3,}$/)) {
      nodes.push(
        <hr
          key={key++}
          className="my-4"
          style={{ borderColor: "var(--al-border)" }}
        />
      );
    } else if (line.trim() === "") {
      nodes.push(<div key={key++} className="h-2" />);
    } else {
      nodes.push(
        <p
          key={key++}
          className="text-xs leading-relaxed mb-1"
          style={{ color: "var(--al-text)" }}
        >
          {inlineBold(line)}
        </p>
      );
    }

    i++;
  }
  return nodes;
}

/* ── Component wrapper ────────────────────────────────────────────── */
export default function ReportMarkdown({ text }: { text: string }) {
  return <>{renderMarkdown(text)}</>;
}
