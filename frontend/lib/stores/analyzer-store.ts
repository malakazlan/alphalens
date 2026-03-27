import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ChunkOverlay } from "@/components/analyzer/DocViewer";

/* ── Cached data per document ─────────────────────────────────────── */
export interface CachedDocData {
  signedUrl: string;
  signedUrlExpiry: number; // epoch ms — URLs expire after ~60 min
  parseChunks: ChunkOverlay[];
  chunkLabelMap: Record<string, string>; // chunk_id → "N - TypeName"
  extractData: Record<string, unknown> | null;
  extractLoadedAt: number; // epoch ms — for stale-while-revalidate
}

/* ── Store shape ──────────────────────────────────────────────────── */
interface AnalyzerState {
  // Session state (persisted to sessionStorage)
  selectedDocId: string | null;
  activeTab: "parse" | "extract" | "chat";
  docViewerWidth: number;
  filesOpen: boolean;
  expandedSections: string[];

  // In-memory cache (NOT persisted — too large)
  cachedDocs: Record<string, Partial<CachedDocData>>;

  // Actions
  setSelectedDoc: (docId: string | null) => void;
  setActiveTab: (tab: "parse" | "extract" | "chat") => void;
  setDocViewerWidth: (w: number) => void;
  setFilesOpen: (open: boolean) => void;
  setExpandedSections: (sections: string[]) => void;
  toggleSection: (section: string) => void;

  cacheDocData: (docId: string, data: Partial<CachedDocData>) => void;
  getCachedDoc: (docId: string) => Partial<CachedDocData> | undefined;
  invalidateDoc: (docId: string) => void;
  clearAll: () => void;
}

const DEFAULT_EXPANDED = ["document_info", "income_statement"];

export const useAnalyzerStore = create<AnalyzerState>()(
  persist(
    (set, get) => ({
      selectedDocId: null,
      activeTab: "parse",
      docViewerWidth: 460,
      filesOpen: false,
      expandedSections: [...DEFAULT_EXPANDED],
      cachedDocs: {},

      setSelectedDoc: (docId) => set({ selectedDocId: docId }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      setDocViewerWidth: (w) => set({ docViewerWidth: w }),
      setFilesOpen: (open) => set({ filesOpen: open }),
      setExpandedSections: (sections) => set({ expandedSections: sections }),
      toggleSection: (section) =>
        set((s) => ({
          expandedSections: s.expandedSections.includes(section)
            ? s.expandedSections.filter((x) => x !== section)
            : [...s.expandedSections, section],
        })),

      cacheDocData: (docId, data) =>
        set((s) => ({
          cachedDocs: {
            ...s.cachedDocs,
            [docId]: { ...(s.cachedDocs[docId] ?? {}), ...data },
          },
        })),

      getCachedDoc: (docId) => get().cachedDocs[docId],

      invalidateDoc: (docId) =>
        set((s) => {
          const { [docId]: _, ...rest } = s.cachedDocs;
          return { cachedDocs: rest };
        }),

      clearAll: () =>
        set({
          selectedDocId: null,
          activeTab: "parse",
          docViewerWidth: 460,
          filesOpen: false,
          expandedSections: [...DEFAULT_EXPANDED],
          cachedDocs: {},
        }),
    }),
    {
      name: "al-analyzer",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? sessionStorage : undefined!
      ),
      // Only persist lightweight session state — NOT cached doc data
      partialize: (state) => ({
        selectedDocId: state.selectedDocId,
        activeTab: state.activeTab,
        docViewerWidth: state.docViewerWidth,
        filesOpen: state.filesOpen,
        expandedSections: state.expandedSections,
      }),
    }
  )
);
