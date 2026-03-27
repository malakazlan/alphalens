"use client";
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

interface IconRailProps {
  filesOpen: boolean;
  onToggleFiles: () => void;
  onHome: () => void;
  onUpload: () => void;
}

export default function IconRail({ filesOpen, onToggleFiles, onHome, onUpload }: IconRailProps) {
  const router = useRouter();

  return (
    <aside
      className="shrink-0 flex flex-col items-center py-3 gap-1"
      style={{
        width: 52,
        background: "var(--al-bg-soft)",
        borderRight: "1px solid var(--al-border)",
        zIndex: 20,
        height: "100%",
      }}
    >
      {/* AlphaLens Logo — click → root homepage */}
      <button
        onClick={() => router.push("/")}
        title="AlphaLens Home"
        className="w-9 h-9 mb-4 rounded-xl overflow-hidden flex items-center justify-center transition-opacity hover:opacity-80"
        style={{ background: "var(--al-bg-secondary)" }}
      >
        <Image
          src="/images/ALPHA LENS LOGO.png"
          alt="AlphaLens"
          width={28}
          height={28}
          style={{ objectFit: "contain" }}
        />
      </button>

      {/* Home */}
      <RailBtn title="Analyzer Home" active={false} onClick={onHome}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </RailBtn>

      {/* Files */}
      <RailBtn title="Documents" active={filesOpen} onClick={onToggleFiles}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </RailBtn>

      {/* Upload — green accent */}
      <RailBtn title="Upload Document" active={false} onClick={onUpload} accent>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </RailBtn>
    </aside>
  );
}

function RailBtn({
  children,
  title,
  active,
  onClick,
  accent,
}: {
  children: React.ReactNode;
  title: string;
  active: boolean;
  onClick: () => void;
  accent?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150"
      style={{
        background: accent
          ? "var(--al-accent)"
          : active || hovered
          ? "var(--al-accent-soft)"
          : "transparent",
        color: accent
          ? "#ffffff"
          : active || hovered
          ? "var(--al-accent)"
          : "var(--al-text)",
      }}
    >
      {children}
    </button>
  );
}
