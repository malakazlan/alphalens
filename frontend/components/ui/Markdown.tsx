"use client";
import React from "react";

/**
 * Safe React-rendered Markdown. Returns React nodes — never builds HTML
 * strings, so untrusted input (LLM output, news headlines, etc.) cannot
 * inject script tags. Drop-in replacement for `dangerouslySetInnerHTML`.
 *
 * Supported syntax:
 *   - Headers: # / ## / ### / ####
 *   - **bold**, *italic*, `inline code`
 *   - Code blocks: ```language\n...\n```
 *   - Pipe tables: | a | b |\n|---|---|\n| 1 | 2 |
 *   - Lists: - / * / 1.
 *   - Blockquotes: >
 *   - Horizontal rule: ---
 *   - Paragraphs separated by blank lines
 */

/* ── Inline parser: bold / italic / code ─────────────────────────────────── */
// Returns React nodes from a single line of text. All replacements are done
// via array-of-nodes rebuilding — text content is never inserted as HTML.
function inline(text: string): React.ReactNode[] {
  const tokens: { type: "text" | "code" | "bold" | "italic"; content: string }[] = [];
  let cursor = 0;
  // Walk the string, matching the FIRST of (`code`, **bold**, *italic*) at
  // each position. Order matters: backtick beats asterisk so `**` inside code
  // stays literal.
  const regex = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|(?<!\*)\*([^*\n]+?)\*(?!\*)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > cursor) tokens.push({ type: "text", content: text.slice(cursor, m.index) });
    if (m[1] !== undefined)      tokens.push({ type: "code",   content: m[1] });
    else if (m[2] !== undefined) tokens.push({ type: "bold",   content: m[2] });
    else if (m[3] !== undefined) tokens.push({ type: "italic", content: m[3] });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) tokens.push({ type: "text", content: text.slice(cursor) });

  return tokens.map((t, i) => {
    if (t.type === "code")   return <code key={i} className="md-inline-code">{t.content}</code>;
    if (t.type === "bold")   return <strong key={i}>{t.content}</strong>;
    if (t.type === "italic") return <em key={i}>{t.content}</em>;
    return <React.Fragment key={i}>{t.content}</React.Fragment>;
  });
}

/* ── Block-level parser ──────────────────────────────────────────────────── */
function parse(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let key = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Code block (```lang ... ```) ──────────────────────────────────────
    const codeStart = line.match(/^```(\w*)\s*$/);
    if (codeStart) {
      const lang = codeStart[1] || "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      nodes.push(
        <pre key={key++} className="md-code-block" data-lang={lang}>
          <code>{buf.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // ── Pipe table ─────────────────────────────────────────────────────────
    if (line.startsWith("|") && lines[i + 1]?.match(/^\|[\s\-:|]+\|/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      // tableLines[0] = header, tableLines[1] = separator, rest = body
      const [headerRow, , ...bodyRows] = tableLines;
      const parseRow = (row: string) => row.split("|").slice(1, -1).map(c => c.trim());
      const headers = parseRow(headerRow);
      nodes.push(
        <div key={key++} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {headers.map((h, hi) => (
                  <th key={hi}>{inline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => {
                const cells = parseRow(row);
                return (
                  <tr key={ri}>
                    {cells.map((c, ci) => <td key={ci}>{inline(c)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // ── Headers ────────────────────────────────────────────────────────────
    if (/^# (.+)/.test(line))      { nodes.push(<h1 key={key++} className="md-h1">{inline(line.slice(2))}</h1>); i++; continue; }
    if (/^## (.+)/.test(line))     { nodes.push(<h2 key={key++} className="md-h2">{inline(line.slice(3))}</h2>); i++; continue; }
    if (/^### (.+)/.test(line))    { nodes.push(<h3 key={key++} className="md-h3">{inline(line.slice(4))}</h3>); i++; continue; }
    if (/^#### (.+)/.test(line))   { nodes.push(<h4 key={key++} className="md-h4">{inline(line.slice(5))}</h4>); i++; continue; }

    // ── Horizontal rule ────────────────────────────────────────────────────
    if (/^[-*_]{3,}$/.test(line.trim())) {
      nodes.push(<hr key={key++} className="md-hr" />);
      i++;
      continue;
    }

    // ── Blockquote ─────────────────────────────────────────────────────────
    if (/^> /.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^> /.test(lines[i])) {
        buf.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <blockquote key={key++} className="md-blockquote">
          {inline(buf.join(" "))}
        </blockquote>
      );
      continue;
    }

    // ── Unordered list ─────────────────────────────────────────────────────
    if (/^[-*] (.+)/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] (.+)/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*] /, ""));
        i++;
      }
      nodes.push(
        <ul key={key++} className="md-ul">
          {items.map((it, ii) => <li key={ii}>{inline(it)}</li>)}
        </ul>
      );
      continue;
    }

    // ── Ordered list ───────────────────────────────────────────────────────
    if (/^\d+\. (.+)/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. (.+)/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      nodes.push(
        <ol key={key++} className="md-ol">
          {items.map((it, ii) => <li key={ii}>{inline(it)}</li>)}
        </ol>
      );
      continue;
    }

    // ── Blank line ─────────────────────────────────────────────────────────
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── Paragraph (consume consecutive non-blank, non-block lines) ────────
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("|") &&
      !/^[-*] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i]) &&
      !/^> /.test(lines[i]) &&
      !/^[-*_]{3,}$/.test(lines[i].trim())
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) {
      nodes.push(
        <p key={key++} className="md-p">
          {inline(para.join(" "))}
        </p>
      );
    }
  }

  return nodes;
}

export default function Markdown({ text }: { text: string }) {
  return <>{parse(text)}</>;
}
