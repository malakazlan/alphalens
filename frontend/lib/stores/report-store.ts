import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/* ── Types ────────────────────────────────────────────────────────── */
// Built-in template ids are a known string literal union; custom templates
// are user-owned UUIDs from public.report_templates_custom. The store
// holds the raw string so both flow through the same code paths.
export type BuiltinTemplate =
  | "full_analysis"
  | "executive_brief"
  | "risk_report"
  | "investor_memo";
export type ReportTemplate = BuiltinTemplate | (string & {});

export interface SectionState {
  id: string;
  title: string;
  markdown: string;
  status: "pending" | "generating" | "done" | "error";
  error?: string;
  wordCount?: number;
}

export interface ReportMeta {
  id: string;
  doc_id: string;
  template: ReportTemplate;
  status: string;
  word_count: number;
  created_at: string;
  updated_at?: string;
}

/* ── Store ────────────────────────────────────────────────────────── */
interface ReportState {
  selectedDocId: string | null;
  activeReportId: string | null;
  template: ReportTemplate;
  sections: Record<string, SectionState>;
  generating: boolean;
  generatingSection: string | null;
  reportList: ReportMeta[];

  setSelectedDoc: (docId: string | null) => void;
  setActiveReport: (reportId: string | null) => void;
  setTemplate: (t: ReportTemplate) => void;
  setGenerating: (v: boolean) => void;
  setGeneratingSection: (s: string | null) => void;
  setSections: (s: Record<string, SectionState>) => void;
  updateSection: (sectionId: string, update: Partial<SectionState>) => void;
  appendSectionText: (sectionId: string, text: string) => void;
  setReportList: (list: ReportMeta[]) => void;
  reset: () => void;
}

export const useReportStore = create<ReportState>()(
  persist(
    (set) => ({
      selectedDocId: null,
      activeReportId: null,
      template: "full_analysis",
      sections: {},
      generating: false,
      generatingSection: null,
      reportList: [],

      setSelectedDoc: (docId) =>
        set({ selectedDocId: docId, activeReportId: null, sections: {}, generating: false }),
      setActiveReport: (reportId) => set({ activeReportId: reportId }),
      setTemplate: (t) => set({ template: t }),
      setGenerating: (v) => set({ generating: v }),
      setGeneratingSection: (s) => set({ generatingSection: s }),
      setSections: (s) => set({ sections: s }),
      updateSection: (sectionId, update) =>
        set((state) => ({
          sections: {
            ...state.sections,
            [sectionId]: { ...state.sections[sectionId], ...update },
          },
        })),
      appendSectionText: (sectionId, text) =>
        set((state) => ({
          sections: {
            ...state.sections,
            [sectionId]: {
              ...state.sections[sectionId],
              markdown: (state.sections[sectionId]?.markdown ?? "") + text,
            },
          },
        })),
      setReportList: (list) => set({ reportList: list }),
      reset: () =>
        set({
          selectedDocId: null,
          activeReportId: null,
          template: "full_analysis",
          sections: {},
          generating: false,
          generatingSection: null,
          reportList: [],
        }),
    }),
    {
      name: "al-report",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? sessionStorage : undefined!
      ),
      partialize: (state) => ({
        selectedDocId: state.selectedDocId,
        activeReportId: state.activeReportId,
        template: state.template,
      }),
    }
  )
);
