"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/routes";

interface Conversation {
  id:          string;
  title:       string;
  pinned:      boolean;
  updated_at:  string;
  archived_at: string | null;
}

// Topbar dropdown that lists the user's recent conversations and lets them
// jump between them or start a new chat. Loaded lazily on open to avoid
// a fetch on every chat-page mount.
export default function ConversationsMenu({
  activeConversationId,
}: {
  activeConversationId: string | null;
}) {
  const router = useRouter();
  const [open,    setOpen]    = useState(false);
  const [items,   setItems]   = useState<Conversation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res  = await fetch("/api/finbot/conversations", { credentials: "include" });
      const data = await res.json();
      if (data.success) setItems(data.conversations ?? []);
    } catch { /* silent */ }
    setLoading(false);
  }

  // Load on first open; refresh on subsequent opens to catch new chats.
  useEffect(() => {
    if (open) refresh();
  }, [open]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/finbot/conversations/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) return;
      setItems(prev => (prev ?? []).filter(c => c.id !== id));
      if (id === activeConversationId) {
        router.push(ROUTES.finbot);
      }
    } catch { /* silent */ }
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: open ? "#f3f4f6" : "transparent",
          border: "1px solid #e5e7eb",
          color: "#374151",
          borderRadius: 8,
          padding: "5px 13px",
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
          transition: "all 0.2s",
        }}
      >
        Conversations ▾
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 320,
            maxHeight: 420,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            boxShadow: "0 16px 40px rgba(0,0,0,0.12)",
            zIndex: 100,
            padding: 6,
          }}
        >
          <button
            onClick={() => { setOpen(false); router.push(ROUTES.finbot); }}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(5,150,105,0.08)",
              border: "1px solid rgba(5,150,105,0.18)",
              color: "var(--al-accent)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              marginBottom: 6,
            }}
          >
            + New chat
          </button>

          {loading && items === null && (
            <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: "#9ca3af" }}>
              Loading…
            </div>
          )}

          {items !== null && items.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: "#9ca3af" }}>
              No saved conversations yet.
            </div>
          )}

          {items?.map(c => {
            const active = c.id === activeConversationId;
            return (
              <div
                key={c.id}
                style={{
                  display:   "flex",
                  alignItems: "center",
                  gap:        4,
                  padding:    "2px 4px",
                  borderRadius: 8,
                  background: active ? "rgba(5,150,105,0.06)" : "transparent",
                  marginBottom: 2,
                }}
              >
                <button
                  onClick={() => { setOpen(false); router.push(ROUTES.finbotConversation(c.id)); }}
                  style={{
                    flex: 1,
                    textAlign: "left",
                    padding: "8px 10px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    minWidth: 0,
                  }}
                >
                  <div style={{
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    color: active ? "var(--al-accent)" : "#111827",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {c.pinned ? "📌 " : ""}{c.title}
                  </div>
                  <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 2 }}>
                    {new Date(c.updated_at).toLocaleString()}
                  </div>
                </button>
                <button
                  onClick={() => handleDelete(c.id)}
                  title="Delete"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#9ca3af",
                    cursor: "pointer",
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
