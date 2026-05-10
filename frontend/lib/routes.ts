// Single source of truth for every URL in the app.
//
// Every component that navigates should `import { ROUTES } from "@/lib/routes"`
// and use these constants (or helpers) — no hard-coded route strings inside
// components. When a path changes, this file is the only edit.

export const ROUTES = {
  home:      "/",
  login:     "/login",

  dashboard: "/dashboard",
  analyzer:  "/dashboard/analyzer",
  report:    "/dashboard/report",
  finbot:    "/dashboard/finbot",

  // FinBot sub-surfaces.
  finbotPortfolio: "/dashboard/finbot/portfolio",
  finbotWatchlist: "/dashboard/finbot/watchlist",

  // Helpers for resource-addressable URLs.
  analyzerDoc:         (docId: string) => `/dashboard/analyzer/${docId}`,
  reportDoc:           (reportId: string) => `/dashboard/report/${reportId}`,
  finbotConversation:  (conversationId: string) => `/dashboard/finbot/${conversationId}`,
} as const;
