"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import ActionCards from "@/components/analyzer/ActionCards";
import ProcessingStatus from "@/components/analyzer/ProcessingStatus";
import IconRail from "@/components/analyzer/IconRail";
import DocumentRail from "@/components/analyzer/DocumentRail";
import DocViewer, { ChunkOverlay } from "@/components/analyzer/DocViewer";
import ParsePanel from "@/components/analyzer/ParsePanel";
import ExtractPanel from "@/components/analyzer/ExtractPanel";
import ChatPanel from "@/components/analyzer/ChatPanel";
import { sha256File } from "@/lib/hash";
import { useAnalyzerStore } from "@/lib/stores/analyzer-store";

type ViewState    = "home" | "uploading" | "processing" | "workspace";
type WorkspaceTab = "parse" | "extract" | "chat";

// ── Signed URL cache (sessionStorage, 50-min TTL) ────────────────────────────
const _SIGNED_URL_TTL = 50 * 60 * 1000;

function _getCachedSignedUrl(docId: string): string | null {
  try {
    const raw = sessionStorage.getItem(`su_${docId}`);
    if (!raw) return null;
    const { url, exp } = JSON.parse(raw);
    if (Date.now() < exp) return url as string;
    sessionStorage.removeItem(`su_${docId}`);
  } catch {}
  return null;
}

function _setCachedSignedUrl(docId: string, url: string): void {
  try {
    sessionStorage.setItem(`su_${docId}`, JSON.stringify({ url, exp: Date.now() + _SIGNED_URL_TTL }));
  } catch {}
}

interface Doc {
  id: string;
  filename: string;
  status: string;
  upload_time: string;
  metadata?: Record<string, unknown>;
}

export default function AnalyzerPage() {
  const [view,               setView]               = useState<ViewState>("home");
  const [docs,               setDocs]               = useState<Doc[]>([]);
  const [selectedDoc,        setSelectedDoc]        = useState<Doc | null>(null);
  const [processingId,       setProcessingId]       = useState<string | null>(null);
  const [processingFilename, setProcessingFilename] = useState("");
  const [error,              setError]              = useState<string | null>(null);
  const [loadingDocs,        setLoadingDocs]        = useState(true);
  const [signedUrl,          setSignedUrl]          = useState<string>("");

  // Chunk overlay state — fetched once per doc, shared between DocViewer & ParsePanel
  const [parseChunks,       setParseChunks]       = useState<ChunkOverlay[]>([]);
  const [selectedChunkId,   setSelectedChunkId]   = useState<string | null>(null);
  const [secondaryChunkIds, setSecondaryChunkIds] = useState<string[]>([]);
  // Label map: chunk_id → "N - TypeName" — built once in openDoc, shared with ParsePanel
  const [chunkLabelMap, setChunkLabelMap] = useState<Map<string, string>>(new Map());

  // ── Zustand store — persisted session state ────────────────────────────────
  const store = useAnalyzerStore();
  const activeTab      = store.activeTab as WorkspaceTab;
  const setActiveTab   = store.setActiveTab;
  const docViewerWidth = store.docViewerWidth;
  const setDocViewerWidth = store.setDocViewerWidth;
  const filesOpen      = store.filesOpen;
  const setFilesOpen   = store.setFilesOpen;

  // ── Resizable panel divider ─────────────────────────────────────────────────
  const [isDragging,  setIsDragging]  = useState(false);
  const [localWidth,  setLocalWidth]  = useState<number | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef  = useRef({ x: 0, width: 0 });

  // During drag: localWidth (plain state, no storage writes per frame)
  // At rest: docViewerWidth (persisted in Zustand/sessionStorage)
  const displayWidth = localWidth ?? docViewerWidth;

  function handleDividerMouseDown(e: React.MouseEvent) {
    isDraggingRef.current = true;
    setIsDragging(true);
    setLocalWidth(docViewerWidth);
    dragStartRef.current = { x: e.clientX, width: docViewerWidth };
    e.preventDefault();
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDraggingRef.current) return;
      const next = Math.max(280, Math.min(900, dragStartRef.current.width + (e.clientX - dragStartRef.current.x)));
      setLocalWidth(next);
    }
    function onMouseUp() {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      setLocalWidth(w => { if (w !== null) setDocViewerWidth(w); return null; });
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
  }, [setDocViewerWidth]);

  // ── Document list ───────────────────────────────────────────────────────────
  const fetchDocs = useCallback(async () => {
    try {
      const res  = await fetch("/api/documents", { credentials: "include" });
      const data = await res.json();
      if (data.success) setDocs(data.documents);
    } catch {}
    setLoadingDocs(false);
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  useEffect(() => {
    const inProgress = docs.some(d => !["complete", "error"].includes(d.status));
    if (!inProgress) return;
    // Exponential backoff: 4s → 8s → 16s → 32s → 60s cap
    let delay = 4000;
    let t: ReturnType<typeof setTimeout>;
    function schedule() {
      t = setTimeout(async () => {
        await fetchDocs();
        delay = Math.min(delay * 2, 60000);
        schedule();
      }, delay);
    }
    schedule();
    return () => clearTimeout(t);
  }, [docs, fetchDocs]);

  // ── Session restore — reopen doc from store if available ──────────────────
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || loadingDocs || docs.length === 0) return;
    restoredRef.current = true;

    const savedDocId = store.selectedDocId;
    if (!savedDocId) return;

    const doc = docs.find(d => d.id === savedDocId);
    if (doc && doc.status === "complete") {
      openDoc(doc);
    } else {
      // Doc deleted or not complete — clear stale reference
      store.setSelectedDoc(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingDocs, docs]);

  // ── Open doc — fetch signed URL + chunk overlays + grounding ───────────────
  async function openDoc(doc: Doc) {
    setSelectedDoc(doc);
    setSelectedChunkId(null);
    setParseChunks([]);
    setChunkLabelMap(new Map());
    setFilesOpen(false);
    store.setSelectedDoc(doc.id);

    if (doc.status !== "complete") return;

    try {
      // Check sessionStorage cache before hitting the API (50-min TTL, URLs expire at 60 min)
      const cachedUrl = _getCachedSignedUrl(doc.id);

      const [urlRes, chunksRes, groundingRes] = await Promise.all([
        cachedUrl ? Promise.resolve(null) : fetch(`/api/documents/${doc.id}/file-url`, { credentials: "include" }),
        fetch(`/api/documents/${doc.id}/chunks/overlays`, { credentials: "include" }),
        fetch(`/api/documents/${doc.id}/grounding`,       { credentials: "include" }),
      ]);

      const [urlData, chunksData, groundingData] = await Promise.all([
        urlRes ? urlRes.json() : Promise.resolve(null),
        chunksRes.json(),
        groundingRes.json(),
      ]);

      if (cachedUrl) {
        setSignedUrl(cachedUrl);
      } else if (urlData?.success) {
        setSignedUrl(urlData.url);
        _setCachedSignedUrl(doc.id, urlData.url);
      }

      const overlays: ChunkOverlay[] = [];

      if (chunksData.success) {
        const allChunks = [...(chunksData.chunks as any[])].sort((a, b) => {
          const pd = (a.page ?? 0) - (b.page ?? 0);
          if (pd !== 0) return pd;
          const at = a.bbox?.top ?? 0, bt = b.bbox?.top ?? 0;
          if (Math.abs(at - bt) > 0.01) return at - bt;
          return (a.bbox?.left ?? 0) - (b.bbox?.left ?? 0);
        });

        const NOISE_SET = new Set(["page_number", "page_header", "page_footer"]);
        const labelMap = new Map<string, string>();
        let labelIdx = 1;
        for (const c of allChunks) {
          if (NOISE_SET.has(c.chunk_type) || c.chunk_type === "table_cell") continue;
          if (!c.bbox || Object.keys(c.bbox).length === 0) continue;
          const typeCapitalized = c.chunk_type
            .split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
          labelMap.set(c.chunk_id, `${labelIdx} - ${typeCapitalized}`);
          labelIdx++;
        }

        for (const c of allChunks) {
          const label = labelMap.get(c.chunk_id);
          if (!label) continue;
          overlays.push({
            chunk_id:   c.chunk_id,
            chunk_type: c.chunk_type,
            page:       c.page ?? 0,
            bbox:       c.bbox,
            label,
          });
        }

        setChunkLabelMap(new Map(labelMap));
      }

      if (groundingData.success && groundingData.grounding) {
        const g = groundingData.grounding as Record<string, any>;
        for (const [elementId, entry] of Object.entries(g)) {
          if (entry.type === "tableCell" && entry.bbox) {
            overlays.push({
              chunk_id:   elementId,
              chunk_type: "table_cell",
              page:       entry.page ?? 0,
              bbox:       entry.bbox,
              label:      "tableCell",
            });
          }
        }
      }

      setParseChunks(overlays);
    } catch {}

    setView("workspace");
  }

  // ── Upload ───────────────────────────────────────────────────────────────────
  async function handleFileSelect(file: File, action: string) {
    setError(null);
    setView("uploading");
    try {
      const hash      = await sha256File(file);
      const checkRes  = await fetch("/api/documents/check-hash", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha256_hash: hash }),
      });
      const checkData = await checkRes.json();

      if (checkData.exists) {
        await fetchDocs();
        setSelectedDoc({ id: checkData.document_id, filename: checkData.filename, status: checkData.status, upload_time: "" });
        setView("home");
        return;
      }

      const form = new FormData();
      form.append("file", file);
      form.append("sha256_hash", hash);
      form.append("action", action);

      const uploadRes  = await fetch("/api/documents/upload", { method: "POST", credentials: "include", body: form });
      const uploadData = await uploadRes.json();

      if (!uploadData.success) { setError(uploadData.error ?? "Upload failed"); setView("home"); return; }

      setProcessingId(uploadData.document_id);
      setProcessingFilename(file.name);
      setView("processing");
      await fetchDocs();
    } catch {
      setError("Upload failed. Please try again.");
      setView("home");
    }
  }

  function handleProcessingComplete() {
    fetchDocs();
    setView("home");
    setProcessingId(null);
  }

  // ── Delete document ──────────────────────────────────────────────────────────
  async function handleDeleteDoc(docId: string) {
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (data.success) {
        // Clear signed URL cache for this doc
        try { sessionStorage.removeItem(`su_${docId}`); } catch {}
        if (selectedDoc?.id === docId) handleGoHome();
        setDocs(prev => prev.filter(d => d.id !== docId));
      }
    } catch {}
  }

  // ── Retry failed document ────────────────────────────────────────────────────
  async function handleRetryDoc(docId: string) {
    try {
      await fetch(`/api/documents/${docId}/retry`, { method: "POST", credentials: "include" });
      await fetchDocs();
    } catch {}
  }

  // ── Go home — clears workspace state ────────────────────────────────────────
  function handleGoHome() {
    setView("home");
    setSelectedChunkId(null);
    setParseChunks([]);
    setChunkLabelMap(new Map());
    setFilesOpen(false);
    store.setSelectedDoc(null);
  }

  // ── Chat chunk select — primary + secondary highlights ─────────────────────
  function handleChatChunkSelect(id: string | null, secondary?: string[]) {
    setSecondaryChunkIds(secondary ?? []);
    if (!id) { setSelectedChunkId(null); return; }
    if (id === selectedChunkId) {
      setSelectedChunkId(null);
      requestAnimationFrame(() => setSelectedChunkId(id));
    } else {
      setSelectedChunkId(id);
    }
  }

  // ── Extract highlight — select chunk from extract field grounding ───────────
  function handleExtractHighlight(chunkId: string, cellId?: string, page?: number) {
    // Prefer cell ID (table cell) for precise highlighting, fall back to chunk ID
    const targetId = cellId ?? chunkId;
    if (targetId === selectedChunkId) {
      setSelectedChunkId(null);
      requestAnimationFrame(() => setSelectedChunkId(targetId));
    } else {
      setSelectedChunkId(targetId);
    }
  }

  // ── Workspace view — IconRail + file drawer + PDF + divider + right panel ───
  if (view === "workspace" && selectedDoc) {
    return (
      <div
        className="flex flex-1 min-h-0"
        style={{
          overflow:   "clip",
          userSelect: isDragging ? "none" : undefined,
        }}
      >
        {/* Icon Rail */}
        <IconRail
          filesOpen={filesOpen}
          onToggleFiles={() => setFilesOpen(!filesOpen)}
          onHome={handleGoHome}
          onUpload={handleGoHome}
        />

        {/* Content area — overflow:clip prevents scrollIntoView from shifting layout */}
        <div className="flex flex-1 relative min-h-0" style={{ overflow: "clip" }}>

          {/* File drawer overlay */}
          {filesOpen && (
            <>
              <div
                className="absolute inset-0 z-40"
                style={{ background: "rgba(0,0,0,0.18)" }}
                onClick={() => setFilesOpen(false)}
              />
              <div
                className="absolute left-0 top-0 h-full z-50 shadow-2xl"
                style={{ width: 256 }}
              >
                <DocumentRail
                  documents={docs}
                  selectedId={selectedDoc.id}
                  onSelect={openDoc}
                  onDelete={handleDeleteDoc}
                  onRetry={handleRetryDoc}
                  loading={loadingDocs}
                />
              </div>
            </>
          )}

          {/* PDF Viewer */}
          <div
            className="flex flex-col shrink-0 min-h-0"
            style={{ width: displayWidth, minWidth: 280, maxWidth: 900 }}
          >
            {/* Header — filename only */}
            <div
              className="px-4 py-3 border-b flex items-center gap-3 shrink-0"
              style={{ background: "var(--al-bg-soft)", borderColor: "var(--al-border)" }}
            >
              <span className="text-sm font-semibold truncate" style={{ color: "var(--al-text)" }}>
                {selectedDoc.filename}
              </span>
            </div>

            <DocViewer
              signedUrl={signedUrl}
              chunks={parseChunks}
              selectedChunkId={selectedChunkId}
              secondaryChunkIds={secondaryChunkIds}
              onChunkClick={id => { setSecondaryChunkIds([]); setSelectedChunkId(id); }}
            />
          </div>

          {/* Draggable divider */}
          <div
            onMouseDown={handleDividerMouseDown}
            className="shrink-0 self-stretch relative"
            style={{
              width:      14,
              cursor:     "col-resize",
              background: "transparent",
              zIndex:     10,
            }}
          >
            {/* Visual line centered in the hit area */}
            <div
              className="absolute inset-y-0 pointer-events-none"
              style={{
                left: 6, width: 2,
                background: "var(--al-accent)",
                opacity: isDragging ? 1 : 0.6,
                transition: isDragging ? "none" : "opacity 0.15s",
              }}
            />
            {/* Center drag handle pill */}
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-[3px] pointer-events-none"
              style={{
                padding:      "6px 4px",
                background:   "var(--al-accent)",
                borderRadius: 6,
                zIndex:       11,
              }}
            >
              <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#fff" }} />
              <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#fff" }} />
              <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#fff" }} />
            </div>
          </div>

          {/* Right panel — overflow:clip prevents scrollIntoView from shifting this */}
          <div className="flex flex-col flex-1 min-w-0 min-h-0" style={{ overflow: "clip" }}>
            <div
              className="flex border-b shrink-0"
              style={{ borderColor: "var(--al-border)", background: "var(--al-bg-soft)" }}
            >
              {(["parse", "extract", "chat"] as WorkspaceTab[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="px-5 py-3 text-sm font-medium capitalize transition-all border-b-2"
                  style={{
                    borderBottomColor: activeTab === tab ? "var(--al-accent)" : "transparent",
                    color:             activeTab === tab ? "var(--al-accent)" : "var(--al-subtle)",
                    background:        "transparent",
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* All three panels stay mounted — display:none hides inactive ones.
                This preserves scroll position, chat history, and search state
                across tab switches (instant switch, no refetch). */}
            <div className="flex-1 min-h-0 relative">
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ display: activeTab === "parse" ? "block" : "none" }}
              >
                <ParsePanel
                  docId={selectedDoc.id}
                  selectedChunkId={selectedChunkId}
                  onChunkSelect={id => setSelectedChunkId(id)}
                  labelMap={chunkLabelMap}
                />
              </div>
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ display: activeTab === "extract" ? "block" : "none" }}
              >
                <ExtractPanel
                  docId={selectedDoc.id}
                  onHighlightChunk={handleExtractHighlight}
                />
              </div>
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ display: activeTab === "chat" ? "block" : "none" }}
              >
                <ChatPanel
                  docId={selectedDoc.id}
                  parseChunks={parseChunks}
                  onChunkSelect={handleChatChunkSelect}
                />
              </div>
            </div>
          </div>

        </div>
      </div>
    );
  }

  // ── Home / uploading / processing — original layout unchanged ───────────────
  return (
    <div className="flex flex-1 min-h-0">
      <DocumentRail documents={docs} selectedId={selectedDoc?.id} onSelect={openDoc} onDelete={handleDeleteDoc} onRetry={handleRetryDoc} loading={loadingDocs} />

      <main className="flex-1 overflow-y-auto px-8 py-10">
        {error && (
          <div
            className="mb-6 px-4 py-3 rounded-xl text-sm font-medium flex items-center justify-between"
            style={{ background: "rgba(220,38,38,0.08)", color: "var(--al-error)", border: "1px solid rgba(220,38,38,0.15)" }}
          >
            {error}
            <button onClick={() => setError(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {view === "uploading" && (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-4">
              <div
                className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin"
                style={{ borderColor: "var(--al-accent-light)", borderTopColor: "var(--al-accent)" }}
              />
              <p className="text-sm font-medium" style={{ color: "var(--al-text-secondary)" }}>Preparing upload…</p>
            </div>
          </div>
        )}

        {view === "processing" && processingId && (
          <div className="flex items-center justify-center pt-8">
            <ProcessingStatus
              documentId={processingId}
              filename={processingFilename}
              onComplete={handleProcessingComplete}
              onCancel={() => { setView("home"); fetchDocs(); }}
            />
          </div>
        )}

        {view === "home" && (
          <div className="max-w-6xl mx-auto w-full">
            {/* ── Header block (eyebrow + title + lede + stats) ─────────────── */}
            <div className="mb-10">
              {/* Eyebrow pill */}
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "5px 12px", borderRadius: 100,
                background: "rgba(5,150,105,0.07)",
                border: "1px solid rgba(5,150,105,0.2)",
                marginBottom: 14,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#059669" }} />
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "#059669", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Document Intelligence
                </span>
              </div>

              <h1 style={{
                fontSize: "clamp(30px,3.4vw,46px)",
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: "-0.032em",
                marginBottom: 12,
              }}>
                <span style={{ color: "var(--al-text)" }}>Document </span>
                <span className="landing-gradient-text">Analyzer</span>
              </h1>
              <p style={{
                fontSize: 15.5, color: "var(--al-text-secondary)",
                lineHeight: 1.65, maxWidth: 580,
              }}>
                Drop a financial PDF — annual report, 10-K, prospectus, audit. AlphaLens parses, extracts structured fields, and indexes it for chat-grade interrogation with <span style={{ color: "var(--al-text)", fontWeight: 500 }}>cell-level citations</span>.
              </p>

              {/* Stats row */}
              <div style={{
                display: "flex", gap: 28, flexWrap: "wrap",
                marginTop: 22,
                paddingTop: 18,
                borderTop: "1px dashed rgba(0,0,0,0.09)",
              }}>
                {[
                  { v: String(docs.length), l: "documents filed" },
                  { v: "≤ 50 MB", l: "per document" },
                  { v: "~30s", l: "avg. processing" },
                  { v: "JSON · CSV · Excel", l: "export formats" },
                ].map(s => (
                  <div key={s.l} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{
                      fontSize: 15, fontWeight: 700, color: "var(--al-text)",
                      letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums",
                    }}>{s.v}</div>
                    <div style={{
                      fontSize: 11, color: "var(--al-subtle)",
                      letterSpacing: "0.02em",
                    }}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Cards (unchanged) ────────────────────────────────────────── */}
            <ActionCards onFileSelect={handleFileSelect} />

            {/* ── Tips / best practices (matches design mock marginalia) ──── */}
            <div style={{
              marginTop: 56,
              display: "grid", gridTemplateColumns: "1fr 1fr",
              gap: 16,
            }} className="tips-grid">
              {[
                {
                  t: "Cite, don't paraphrase",
                  d: <>Every figure AlphaLens returns is tagged with its source cell ID — like <code style={{
                    fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 12,
                    background: "var(--al-card)", padding: "1px 6px",
                    border: "1px solid var(--al-border)", color: "#2563eb",
                    borderRadius: 3,
                  }}>[0-13]</code> — pointing back to the exact location on the parsed PDF.</>,
                },
                {
                  t: "On document hygiene",
                  d: "Best results: text-based PDFs with selectable copy. Scanned documents work via OCR but with reduced cell-level grounding accuracy. Multi-year tables produce side-by-side comparisons automatically.",
                },
              ].map(tip => (
                <div key={tip.t} style={{
                  padding: "18px 22px",
                  background: "rgba(5,150,105,0.03)",
                  borderLeft: "3px solid #059669",
                  borderRadius: "0 14px 14px 0",
                  border: "1px solid rgba(5,150,105,0.12)",
                  borderLeftWidth: 3,
                }}>
                  <div style={{
                    fontSize: 13.5, fontWeight: 600,
                    color: "var(--al-text)",
                    letterSpacing: "-0.01em",
                    marginBottom: 6,
                  }}>{tip.t}</div>
                  <div style={{
                    fontSize: 13, color: "var(--al-text-secondary)",
                    lineHeight: 1.6,
                  }}>{tip.d}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
