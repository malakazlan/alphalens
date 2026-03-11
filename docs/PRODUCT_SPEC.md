# PRODUCT_SPEC.md — Alpha Lens v2 Full Product Specification

## 1. Product Overview

Alpha Lens is an AI-powered financial document intelligence platform. Users upload financial PDFs (annual reports, 10-Ks, earnings, balance sheets, etc.), the system parses them with Landing.AI ADE, extracts structured financial data, and provides three surfaces to interact with that data: a structured Analyzer view, AI-generated Reports, and a FinBot financial assistant with live market data.

**Core Value:** Turn dense financial PDFs into searchable, queryable, citable structured data in minutes.

---

## 2. Product Structure — 4 Sections (Locked)

### Section 1: Home
Marketing/onboarding landing page shown to authenticated users before they select a feature.

**What stays from v1:**
- Hero headline: "Transform Your Financial Analysis"
- Gradient text on hero subtitle
- Feature cards grid (4 cards: Advanced Analysis, Smart Reports, Portfolio Optimizer, AI Assistant)
- "Analyze a Document" CTA button → navigates to Analyzer
- Footer with social links and brand tagline

**What changes in v2:**
- Rebuilt in Next.js 14 App Router as a proper `/` page component
- Feature cards now accurately reflect the 4 real sections (Analyzer, Report, FinBot, and a placeholder for Portfolio Optimizer)
- Hero illustration replaced with animated SVG or Lottie (same visual style)
- Animated background gradients preserved (emerald glow pattern)

---

### Section 2: Analyzer (Core Feature)
The primary product surface. Powered by Landing.AI ADE. Every other section depends on documents processed here.

#### 2.1 Initial State (No Document Selected)
Three action cards:
- **Parse** — Upload a document, ADE parses it to structured markdown + chunks
- **Extract** — Upload a document, ADE extracts financial schema fields
- **Chat** — Upload a document, then chat with it via RAG

Below the action cards: **Pre-saved Documents** list — all documents previously uploaded by the user, pulled from Supabase.

**Dedup check (v2 new):** Before processing, SHA256 hash of file bytes is compared against existing document records. If a match exists, the user is shown the existing result instead of reprocessing.

#### 2.2 Processing State
Progress indicator shown while ADE processes the document asynchronously (via ARQ worker + Upstash Redis). Shows stages:
1. Uploading to storage
2. Queued for processing
3. ADE parsing (parse_jobs polling)
4. Extracting financial schema
5. Building vector index in Qdrant
6. Complete

**v2 change:** Processing is async via ARQ worker. Frontend polls `GET /api/documents/{id}/status` via SSE or polling until `status == "complete"`.

#### 2.3 Result State (Document Loaded)
Two-panel workspace layout (matches v1 visual structure):

**Left: Document Viewer**
- PDF rendered via PDF.js
- Full page-by-page rendering (all pages)
- **v2 new: Citation bbox overlay** — when LLM returns `best_chunks` with grounding data, the corresponding bounding boxes are drawn as green highlight rectangles on the correct PDF page. Clicking a citation in the chat scrolls to the page and highlights the exact region.
- Resizable divider between viewer and right panel (preserved from v1)

**Workspace Rail (left icon sidebar, preserved from v1):**
- Logo icon
- Home button (back to Analyzer initial state)
- Documents flyout panel (list of user's docs with badge count)
- Upload button
- User avatar / initials at bottom

**Right Panel — 3 Tabs:**

**Parse Tab:**
- Shows ADE-parsed markdown with syntax highlighting
- Toggle between Markdown view and JSON view (full chunks + grounding data)
- **v2 new:** Clicking a chunk in JSON view highlights its bbox in the PDF viewer

**Extract Tab:**
- Displays structured financial schema extracted by ADE `extract()`
- Organized by statement type: FinancialDocument metadata, IncomeStatement, BalanceSheet, CashFlowStatement, KeyMetrics
- Red flags list
- Auditor opinion
- Confidence scores per field (from ADE)

**Chat Tab (RAG-first, document-grounded):**
- Streaming chat interface (SSE)
- Section-aware retrieval: queries are matched against chunks that carry `section_header` metadata
- LLM returns `{answer, reasoning, best_chunks: [UUID, ...]}` JSON
- `best_chunks` are resolved to bounding boxes → highlight overlaid on PDF viewer
- Citation sidebar shows which chunks were used, with page + section info
- Example prompts generated from document content on first load
- Conversation history persisted to Supabase per (user, document) pair
- Clear chat button resets to fresh session

**What stays from v1 chat:**
- Glass card panel styling
- Chat input with send button (arrow icon)
- Example prompts section
- Message bubbles (user right, assistant left)
- Chat icon header graphic

**What changes in v2 chat:**
- In-memory history → Supabase-persisted
- Full context dump → RAG-first (top-k chunks, section-aware)
- No streaming → SSE streaming tokens
- Page-level citation → cell-level bbox overlay via PDF.js
- No section metadata → `section_header` on every chunk

---

### Section 3: Report
AI-generated financial analysis report for a processed document.

**What stays from v1:**
- Report section accessible from nav
- Document-scoped (user selects which document to report on)

**What changes in v2 (v1 had "Coming Soon"):**
- Full implementation:
  - Select document from list
  - GPT-4o generates a multi-section financial report:
    - Executive Summary
    - Revenue & Profitability Analysis
    - Balance Sheet Health
    - Cash Flow Analysis
    - Key Ratios & Metrics
    - Red Flags
    - Auditor Opinion
    - Investment Outlook (educational, not advice)
  - Report rendered as styled HTML/PDF in the UI
  - Export to PDF button (client-side via browser print or server-side via xhtml2pdf)
  - Report data sourced from ADE `extract()` output + RAG-retrieved chunks for narrative

---

### Section 4: FinBot
AI financial chatbot with live market data. Completely separate from document chat.

**What stays from v1:**
- Two-panel layout: dark news sidebar (left) + chat panel (right)
- News sidebar: "Featured Insights" carousel + "Breaking News" list (Finnhub)
- Chat panel: topbar, messages area, sticky input with textarea
- OpenAI function-calling agentic loop (max 5 iterations)
- Tools: `get_stock_quote`, `get_price_history`, `get_financial_news`, `calculate_investment_return`, `compare_stocks`
- System prompt: finance-only, live data required, disclaimer on investment advice
- Quick-chip buttons: AAPL Price, Compare Stocks, Invest $500, Gold Price, Market News
- Clear chat button

**What changes in v2:**
- In-memory sessions → Supabase-persisted conversation history per user
- SSE streaming for FinBot responses (token-by-token)
- FinBot is a proper Next.js page with its own route (`/finbot`)
- News polling interval configurable

---

## 3. User Flows

### 3.1 New User Registration
1. User visits `/` (landing page — not same as app home)
2. Clicks "Get Started" → `/login`
3. Selects "Sign Up" tab, enters email + password
4. Supabase creates account, returns JWT
5. Redirected to `/dashboard` (App Home section)

### 3.2 Document Upload & Processing
1. User navigates to Analyzer section
2. Clicks action card (Parse / Extract / Chat) or Upload button in rail
3. File picker opens — accepts: PDF, DOCX, DOC, HTML, PNG, JPG, JPEG, TIFF, WEBP
4. Frontend computes SHA256 hash of file, sends to `POST /api/documents/check-hash`
5. If duplicate found: user shown existing document result
6. If new: `POST /api/documents/upload` → file stored in Supabase Storage at `{user_id}/{doc_id}/original.pdf`
7. ARQ job queued → worker starts async processing:
   a. Download file from Supabase Storage
   b. `parse_jobs.create()` → poll until complete
   c. Walk chunks in order, attach `section_header` to each chunk (nearest preceding title chunk)
   d. `extract(FinancialDocument)` → structured schema
   e. Persist grounding dict to Supabase (`document_grounding` table)
   f. Upsert chunks to Qdrant (`{user_id}_{doc_id}` namespace/collection)
   g. Update document status to "complete"
8. Frontend receives SSE status update → loads result state

### 3.3 Chat with Document
1. User selects document, clicks Chat tab
2. Conversation history loaded from Supabase
3. User types query → `POST /api/chat` with `{document_id, query, session_id}`
4. Backend: embed query → Qdrant similarity search (top-8) with section filter
5. Retrieved chunks (with section_header metadata) passed to GPT-4o-mini
6. LLM returns `{answer, reasoning, best_chunks: [UUID, ...]}` as streaming SSE
7. Frontend renders tokens as they arrive
8. On stream complete: resolve `best_chunks` UUIDs → bbox coordinates from Supabase grounding
9. Draw highlight rectangles on PDF.js canvas for each grounding bbox
10. Citation sidebar shows chunk source (page, section, type)
11. Message + citations saved to Supabase

### 3.4 Generate Report
1. User navigates to Reports section
2. Selects document from dropdown (only "complete" docs)
3. Clicks "Generate Report"
4. `POST /api/reports/generate` → returns SSE stream
5. GPT-4o generates report sections using extract data + RAG chunks
6. Report renders section by section as streaming completes
7. User clicks "Export PDF" → triggers browser print / server PDF generation

### 3.5 FinBot Chat
1. User navigates to FinBot section
2. News sidebar loads (Finnhub general news)
3. User types question or clicks chip
4. `POST /api/finbot/chat` → SSE stream
5. Backend runs agentic loop (OpenAI + tools)
6. Tokens streamed to frontend as they arrive
7. When tool calls occur, a "Fetching data..." indicator shown
8. Final response rendered with markdown formatting

---

## 4. Authentication & Authorization
- Supabase Auth (email/password)
- JWT stored in HTTP-only cookie + localStorage backup
- All API endpoints require `Authorization: Bearer {token}`
- Supabase RLS policies: documents, grounding, chat_history tables scoped to `auth.uid()`
- Supabase Storage RLS: `{user_id}/` prefix = `auth.uid()` required

---

## 5. Data Isolation
- Qdrant: one collection per user (`alphalens_{user_id}`), or one collection per document (`doc_{doc_id}`) — filtered by user_id metadata
- Supabase: all tables have `user_id` column with RLS `WHERE user_id = auth.uid()`
- No cross-user data leakage possible

---

## 6. Supported Document Types
- PDF (primary — all features)
- DOCX, DOC (parse only — no bbox overlay since not PDF)
- HTML, HTM (parse only)
- PNG, JPG, JPEG, TIFF, WEBP (images — ADE can parse, no PDF viewer)

For non-PDF types: Parse and Extract tabs work, Chat tab works via RAG, but PDF viewer shows "Preview not available for this file type."

---

## 7. Constraints & Non-Goals for v2
- No mobile-native app (responsive web only)
- No real-time collaboration
- No multi-document chat (single document per session)
- No portfolio tracking or portfolio optimizer (shown as "Coming Soon" in nav)
- No email notifications for processing completion
- No OAuth social login (email/password only)
- Maximum document size: 1 GB / 1000 pages (ADE parse_jobs limit)
