"use client";
import { useEffect, useRef, useState } from "react";
import type { SectionState } from "@/lib/stores/report-store";

interface SectionTOCProps {
  sections: Record<string, SectionState>;
  sectionOrder: string[];
  activeSection: string | null;
  onJump: (sectionId: string) => void;
  wordCount: number;
  generatedAt?: string;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: (
    <span
      className="block w-2.5 h-2.5 rounded-full border-2 shrink-0"
      style={{ borderColor: "var(--al-border)" }}
    />
  ),
  generating: (
    <span
      className="block w-2.5 h-2.5 rounded-full shrink-0 animate-pulse"
      style={{ background: "var(--al-accent)" }}
    />
  ),
  done: (
    <span
      className="block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ background: "var(--al-accent)" }}
    />
  ),
  error: (
    <span
      className="block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ background: "#dc2626" }}
    />
  ),
};

export default function SectionTOC({
  sections,
  sectionOrder,
  activeSection,
  onJump,
  wordCount,
  generatedAt,
}: SectionTOCProps) {
  return (
    <nav
      className="flex flex-col shrink-0 border-r h-full"
      style={{
        width: 180,
        borderColor: "var(--al-border)",
        background: "var(--al-bg)",
      }}
    >
      <div
        className="px-3 py-3 border-b shrink-0"
        style={{ borderColor: "var(--al-border)" }}
      >
        <p
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--al-subtle)" }}
        >
          Sections
        </p>
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-2">
        {sectionOrder.map((sid) => {
          const sec = sections[sid];
          if (!sec) return null;
          const active = activeSection === sid;
          return (
            <button
              key={sid}
              onClick={() => onJump(sid)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors mb-0.5"
              style={{
                background: active ? "var(--al-accent-soft)" : "transparent",
              }}
            >
              {STATUS_ICON[sec.status] ?? STATUS_ICON.pending}
              <span
                className="text-[11px] font-medium truncate"
                style={{
                  color: active ? "var(--al-accent)" : "var(--al-text)",
                }}
              >
                {sec.title}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer stats */}
      <div
        className="px-3 py-3 border-t shrink-0"
        style={{ borderColor: "var(--al-border)" }}
      >
        {wordCount > 0 && (
          <p className="text-[10px] mb-0.5" style={{ color: "var(--al-subtle)" }}>
            {wordCount.toLocaleString()} words
          </p>
        )}
        {generatedAt && (
          <p className="text-[10px]" style={{ color: "var(--al-subtle)" }}>
            {formatRelativeTime(generatedAt)}
          </p>
        )}
      </div>
    </nav>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
