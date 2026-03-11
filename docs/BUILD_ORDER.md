# BUILD_ORDER.md — Alpha Lens v2 Phase-by-Phase Build Plan

## Overview

The build is organized into 6 phases. Each phase produces working, deployable software. Later phases build on earlier ones. Phases 1-3 are strictly sequential. Phases 4-5 can be partially parallelized once their Phase 3 dependencies are met.

**Ground rule:** Never break what's working. Each phase ends with a deployable state.

---

## Phase 1: Foundation
**Goal:** Running Next.js frontend + FastAPI backend with auth, deployed end-to-end.

**Duration prerequisite:** Must complete before any other phase.

### 1A — Backend Foundation
1. Create `backend/` directory, copy v1 Python files as starting point
2. Update `config.py` to pydantic `BaseSettings` (reads from env vars + `.env`)
3. Update `auth.py` — no changes needed (Supabase auth preserved)
4. Update `app.py`:
   - Remove static file serving (frontend is on Vercel now)
   - Remove serving HTML files (login.html, index.html)
   - Keep all `/api/auth/*` endpoints
   - Add CORS: set `allow_origins=[VERCEL_FRONTEND_URL]` (not `*` in production)
   - Keep session cookie behavior
5. Create `schemas.py` with all Pydantic models (FinancialDocument, IncomeStatement, BalanceSheet, CashFlowStatement, KeyMetrics, API request/response models)
6. Update `requirements.txt`:
   - Add: `qdrant-client`, `arq`, `aiohttp`
   - Keep all existing pinned packages
7. Deploy to Render.com as web service — verify `/api/auth/login` works

### 1B — Frontend Foundation (parallel with 1A)
1. `npx create-next-app@14 frontend --typescript --tailwind --app`
2. Set up Tailwind with custom CSS variables (v1 color theme)
3. Install shadcn/ui: `npx shadcn-ui@latest init`
4. Add shadcn components: button, card, input, textarea, tabs, badge, scroll-area, separator, progress
5. Create `lib/auth.ts` (AuthContext, token storage)
6. Create `lib/api.ts` (apiFetch, streamSSE)
7. Create `app/layout.tsx` (Inter font, globals, AuthProvider)
8. Create `app/login/page.tsx` (LoginForm + SignupForm — port from v1 login.html)
9. Create `app/dashboard/layout.tsx` (auth guard + Header)
10. Create `components/layout/Header.tsx` (port from v1 index.html header)
11. Create `components/layout/Footer.tsx` (port from v1 footer)
12. Set `NEXT_PUBLIC_API_URL` on Vercel — verify login flow works end-to-end

**Phase 1 done when:** User can sign up, log in, see empty dashboard, log out. Auth works between Vercel frontend and Render backend.

---

## Phase 2: Document Upload + Supabase Schema
**Goal:** Documents can be uploaded, stored, and listed. DB schema complete.

**Depends on:** Phase 1 complete.

### 2A — Supabase Schema
1. Run SQL migrations in Supabase:
   - `documents` table (add `sha256_hash` column to v1 schema)
   - `document_grounding` table (new)
   - `chat_history` table (new)
   - `finbot_history` table (new)
   - `reports` table (new)
   - All RLS policies
2. Verify existing v1 RLS policies on `documents` still work

### 2B — Backend Upload Endpoints
1. Implement `POST /api/documents/check-hash` (SHA256 dedup check)
2. Update `storage_service.py` — no major changes needed
3. Update `database_service.py` — add `sha256_hash` to create_document
4. Implement `POST /api/documents/upload`:
   - Accept multipart file
   - SHA256 dedup check
   - Upload to Supabase Storage
   - Insert documents row (status="queued")
   - Return doc_id (job will be queued in Phase 3)
   - For now: trigger sync processing as placeholder
5. Implement `GET /api/documents` (list user docs)
6. Implement `GET /api/documents/{id}` (get single doc)
7. Implement `DELETE /api/documents/{id}` (delete doc + storage)
8. Implement `GET /api/documents/{id}/file` (signed URL for PDF.js)

### 2C — Frontend Upload Flow (parallel with 2B)
1. Create `app/dashboard/page.tsx` (Home section — port v1 hero + features grid)
2. Create `app/dashboard/analyzer/page.tsx` (initial state only)
3. Create `components/analyzer/ActionCards.tsx` (3 cards)
4. Implement SHA256 hashing via Web Crypto API:
   ```typescript
   const buffer = await file.arrayBuffer();
   const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
   const hash = Array.from(new Uint8Array(hashBuffer))
     .map(b => b.toString(16).padStart(2, '0')).join('');
   ```
5. Upload flow: hash check → upload → show doc in pre-saved list
6. Create `components/analyzer/DocumentRail.tsx` (icon sidebar)
7. Create `components/analyzer/DocumentFlyout.tsx` (doc list flyout)
8. Implement `useDocuments` hook (fetch list, poll status)

**Phase 2 done when:** User can upload a PDF, it appears in the pre-saved docs list, SHA256 dedup works.

---

## Phase 3: ADE Processing + Qdrant Integration
**Goal:** Documents processed asynchronously by ADE. Chunks in Qdrant. Grounding in Supabase.

**Depends on:** Phase 2 complete. **This is the most critical phase.**

### 3A — ARQ Worker Setup
1. Create `worker.py`:
   - Define `WorkerSettings` with `process_document` task
   - Configure ARQ with `UPSTASH_REDIS_URL`
   - `job_timeout = 3600` (1 hour max for large docs)
2. Deploy worker as second Render.com service (same repo, different start command: `python -m arq worker.WorkerSettings`)
3. Update `app.py` upload endpoint to enqueue ARQ job instead of sync processing

### 3B — ADE Processing Pipeline (core of Phase 3)
Implement `document_processor.py` v2:

```
Step 1: Download file from Supabase Storage
Step 2: Update status="parsing"
Step 3: Parse with parse_jobs (async):
  client = AsyncLandingAIADE(http_client=DefaultAioHttpClient())
  job = await client.parse_jobs.create(document=Path(tmp_file), model="dpt-2-latest")
  while True:
    status = await client.parse_jobs.get(job.job_id)
    if status.status == "completed": break
    await asyncio.sleep(15)
  parse_response = status.data

Step 4: Section-aware chunking:
  current_section = ""
  enriched_chunks = []
  for chunk in parse_response.chunks:  # in document order
    if chunk.type == "title":
      current_section = strip_html_and_anchors(chunk.markdown)
    enriched_chunk = {
      "id": chunk.id,
      "type": chunk.type,
      "markdown": chunk.markdown,
      "page": chunk.grounding.page,
      "bbox": chunk.grounding.box.__dict__,
      "section_header": current_section
    }
    enriched_chunks.append(enriched_chunk)

Step 5: Update status="extracting"
Step 6: ADE extract():
  extract_response = await client.extract(
    schema=pydantic_to_json_schema(FinancialDocument),
    markdown=parse_response.markdown
  )

Step 7: Update status="indexing"
Step 8: Persist grounding to Supabase document_grounding table:
  For each (element_id, grounding) in parse_response.grounding:
    INSERT (doc_id, user_id, element_id, page, bbox_*, element_type)

Step 9: Cache processed.json to Supabase Storage

Step 10: Embed chunks (batch):
  texts = [c["markdown"] for c in enriched_chunks]
  embeddings = openai_client.embeddings.create(model="text-embedding-3-small", input=texts)

Step 11: Upsert to Qdrant:
  qdrant_client.upsert(
    collection_name="alphalens_documents",
    points=[
      PointStruct(
        id=str(uuid5(NAMESPACE_URL, chunk["id"])),  # deterministic UUID
        vector=embedding,
        payload={
          "chunk_id": chunk["id"],
          "doc_id": doc_id,
          "user_id": user_id,
          "chunk_type": chunk["type"],
          "section_header": chunk["section_header"],
          "page": chunk["page"],
          "markdown": chunk["markdown"][:2000],
          **chunk["bbox"]
        }
      )
      for chunk, embedding in zip(enriched_chunks, embeddings)
    ]
  )

Step 12: Save extract_data to documents table
Step 13: Update status="complete"
```

### 3C — Qdrant Client Setup (parallel with 3B)
1. Create `vector_store.py` v2:
   - Replace file-based JSON with Qdrant client
   - `ensure_collection_exists()` — creates if not exists
   - `upsert_chunks(chunks, embeddings, doc_id, user_id)`
   - `search(query_embedding, doc_id, user_id, top_k=8) → List[ScoredPoint]`
   - Filter: `must=[doc_id match, user_id match]`

### 3D — Document Status SSE (parallel with 3B)
1. Implement `GET /api/documents/{id}/status` SSE endpoint
2. ARQ worker publishes status updates to Upstash Redis pub/sub channel `doc_status:{doc_id}`
3. SSE endpoint subscribes to that channel, yields events

### 3E — Frontend Processing State
1. Create `components/analyzer/ProcessingStatus.tsx`
2. Implement `useDocumentStatus` hook (connects to SSE status stream)
3. Show progress bar with stage messages
4. On status="complete" → transition to result state

**Phase 3 done when:** Upload a PDF → worker processes it via ADE → chunks in Qdrant → grounding in Supabase → frontend shows "complete".

---

## Phase 4: Parse + Extract Tabs + PDF Viewer
**Goal:** Parse and Extract tabs fully functional with PDF viewer.

**Depends on:** Phase 3 complete.

**Can be parallelized:** 4A and 4B can be built simultaneously.

### 4A — Parse Tab + PDF Viewer
1. Implement `GET /api/documents/{id}/markdown` endpoint
2. Implement `GET /api/documents/{id}/file` (signed URL — already in Phase 2 but now used)
3. Create `components/analyzer/PDFViewer.tsx`:
   - Load PDF.js from CDN
   - `renderAllPages()` — all pages vertically stacked
   - `highlightBbox()` — draw emerald rectangles on canvas
   - `clearHighlights()` — re-render page without overlay
   - `scrollToPage()` — smooth scroll
4. Create `components/analyzer/ParsePanel.tsx`:
   - Markdown view (react-markdown or raw HTML render for ADE tables)
   - JSON view (scrollable `<pre>` with chunks data)
   - Chunk click → triggers PDF highlight
5. Wire up analyzer result state layout:
   - DocumentRail (from Phase 2)
   - PDFViewer (left panel)
   - Resize handle (pure CSS/mouse events)
   - ParsePanel (right panel)

### 4B — Extract Tab
1. Implement `GET /api/documents/{id}/extract` endpoint
2. Backend: query documents.extract_data + resolve grounding for each field
3. Create `components/analyzer/ExtractPanel.tsx`:
   - 6 sections with proper grouping
   - Field rows with formatted values
   - Click-to-highlight bbox in PDF viewer
   - Red flags amber badges
   - Auditor opinion colored badge
4. `lib/format.ts` — formatCurrency(), formatPercentage() helpers

**Phase 4 done when:** Upload doc → Parse tab shows markdown + JSON → Extract tab shows financial fields → clicking fields highlights source in PDF viewer.

---

## Phase 5: Chat + Report + FinBot (can partially parallelize)
**Goal:** All 3 interactive features working with SSE streaming.

**Depends on:** Phase 4 complete (for chat). Phase 3 complete (for report and finbot).

**5A, 5B, 5C can be built in parallel by different developers.**

### 5A — Chat Tab (RAG + Streaming + Citations)
1. Update `chat_engine.py` v2:
   - Remove in-memory conversation_history dict
   - Load history from Supabase chat_history table
   - Use Qdrant similarity_search() (from Phase 3 vector_store.py)
   - Section-aware context: include section_header in LLM context
   - Implement `stream()` async generator:
     - Yield token events
     - Yield done event with best_chunks
     - Resolve best_chunks → query document_grounding table → yield grounding event
   - Save messages to Supabase chat_history after streaming
2. Implement `POST /api/chat/stream` SSE endpoint in app.py
3. Implement `GET /api/chat/history/{doc_id}` endpoint
4. Implement `DELETE /api/chat/history/{doc_id}` endpoint
5. Implement `GET /api/chat/suggestions/{doc_id}` (5 GPT-generated prompts based on doc type)
6. Create `components/analyzer/ChatPanel.tsx`:
   - Connect to `POST /api/chat/stream` SSE
   - Render streaming tokens in real-time
   - On "done" event: show sources button
   - On "grounding" event: call PDFViewer.highlightBboxes()
   - Load history on mount
   - Clear chat button
7. Create `components/analyzer/CitationSidebar.tsx`
8. Implement `useChat` hook

### 5B — Report Section
1. Update `report_service.py` v2:
   - Remove in-memory state
   - Source data from: documents.extract_data + Qdrant RAG (top-k chunks per section)
   - GPT-4o streaming response
   - 8 sections: Executive Summary | Revenue & Profitability | Balance Sheet Health | Cash Flow | Key Metrics | Red Flags | Auditor Opinion | Investment Outlook
   - Save completed report HTML to Supabase reports table
2. Implement `POST /api/reports/generate` SSE endpoint
3. Implement `GET /api/reports/{doc_id}` endpoint
4. Implement `GET /api/reports/{doc_id}/pdf` (server-side via xhtml2pdf)
5. Create `app/dashboard/report/page.tsx`
6. Create `components/report/ReportViewer.tsx` (streaming section renderer)
7. Create `components/report/ExportButton.tsx`

### 5C — FinBot Section
1. Update `finbot_service.py` v2:
   - Replace in-memory `self.conversations` dict with Supabase finbot_history
   - Implement streaming: use `stream=True` in OpenAI call
   - Yield tool_call events before executing tools
   - Yield token events during final response
   - Save to Supabase after done
2. Implement `POST /api/finbot/chat/stream` SSE endpoint
3. Implement `GET /api/finbot/news` endpoint (port from v1 get_news_feed)
4. Implement `DELETE /api/finbot/chat/{session_id}` endpoint
5. Create `app/dashboard/finbot/page.tsx`
6. Create `components/finbot/FinBotSidebar.tsx` (port from v1 finbot section HTML)
7. Create `components/finbot/FinBotChat.tsx` (port from v1 finbot chat HTML)
8. Create `components/finbot/NewsCard.tsx`
9. Implement `useFinBot` hook

**Phase 5 done when:** Chat answers questions with streaming + bbox highlights. Report generates and exports. FinBot fetches live data with streaming.

---

## Phase 6: Polish, Security, Performance
**Goal:** Production-ready. All edge cases handled.

**Depends on:** Phase 5 complete.

### 6A — Security Hardening
1. CORS: change `allow_origins=["*"]` → `allow_origins=[VERCEL_URL]`
2. Cookies: `secure=True` (HTTPS only on Render.com)
3. Rate limiting: add `slowapi` to limit `/api/chat/stream` to 20 req/min per user
4. Input validation: max file size 100MB, query length caps
5. ADE response validation: handle partial/null fields gracefully
6. Never log JWT tokens or API keys in Render.com logs

### 6B — Error Handling
1. All SSE streams: yield error event on exception (not 500 response)
2. ADE timeout: if parse_jobs polling exceeds 45 minutes → mark document as error
3. OpenAI rate limit: catch `RateLimitError` → SSE error event with retry message
4. Qdrant unreachable: fall back to keyword search on cached chunks
5. FinBot tool failure: continue loop with error result (not crash)

### 6C — Performance
1. Qdrant collection: create HNSW index if not exists (default in Qdrant, verify)
2. Batch embeddings: ensure all chunk embeddings are batched (not 1-by-1)
3. Supabase queries: add indexes (already in schema SQL from ARCHITECTURE.md)
4. Next.js: enable ISR for public landing page
5. PDF viewer: lazy-load pages below the fold (IntersectionObserver)
6. Pre-signed URLs: cache in sessionStorage for 50 minutes (expires in 60)

### 6D — UX Polish
1. Fade-in animations on Home feature cards (port from v1 `.fade-in-up`)
2. Loading skeletons for all async data
3. Toast notifications for:
   - Upload success / error
   - Processing complete
   - Chat error
4. Empty states for all list components
5. Document name truncation in rail flyout (max 30 chars + ellipsis)
6. Mobile responsive: test Analyzer, FinBot, Report on 375px viewport
7. Keyboard shortcuts:
   - Enter to send chat
   - Cmd/Ctrl+K to focus chat input
   - Esc to close citation sidebar

---

## Build Parallelization Map

```
Phase 1A (Backend) ──────────────────────────────────┐
Phase 1B (Frontend) ──────────────────────────────────┤
                                                       ▼
Phase 2A (DB Schema) ─────────────────────────────────┐
Phase 2B (Backend Upload) ────────────────────────────┤
Phase 2C (Frontend Upload) ────────────────────────────┤
                                                       ▼
Phase 3A (ARQ Worker) ─────────────────────────────────┐
Phase 3B (ADE Pipeline) ────────────────── (critical) ─┤
Phase 3C (Qdrant Client) ──────────────────────────────┤
Phase 3D (Status SSE) ─────────────────────────────────┤
Phase 3E (Frontend Status) ────────────────────────────┤
                                                       ▼
Phase 4A (PDF Viewer + Parse) ─────────────────────────┐  (parallel)
Phase 4B (Extract Tab) ────────────────────────────────┤  (parallel)
                                                       ▼
Phase 5A (Chat) ───────────────────────────────────────┐  (parallel)
Phase 5B (Report) ─────────────────────────────────────┤  (parallel)
Phase 5C (FinBot) ─────────────────────────────────────┤  (parallel)
                                                       ▼
Phase 6 (Polish) ──────────────────────────────────────┘
```

---

## Critical Path

The longest chain that determines minimum total build time:

```
Phase 1 → Phase 2 → Phase 3B (ADE Pipeline) → Phase 4A (PDF Viewer) → Phase 5A (Chat)
```

Everything else can be parallelized around this critical path.

---

## Files to Create (Complete List)

### Backend (new or significantly changed from v1)
```
worker.py              # NEW — ARQ worker
schemas.py             # NEW — all Pydantic schemas
vector_store.py        # REWRITE — Qdrant instead of file-based JSON
document_processor.py  # REWRITE — parse_jobs async, section-aware chunking
chat_engine.py         # REWRITE — Qdrant search, Supabase history, SSE streaming
llm_service.py         # UPDATE — add streaming, keep existing completions
report_service.py      # REWRITE — GPT-4o, RAG-sourced, SSE streaming
finbot_service.py      # UPDATE — add SSE streaming, Supabase history persistence
database_service.py    # UPDATE — add grounding, chat_history, finbot_history tables
app.py                 # UPDATE — new endpoints, SSE routes, Qdrant/ARQ init
config.py              # UPDATE — pydantic BaseSettings, add QDRANT_URL, QDRANT_API_KEY, UPSTASH_REDIS_URL
requirements.txt       # UPDATE — add qdrant-client, arq, aiohttp
```

### Frontend (all new — Next.js 14)
```
All files listed in ARCHITECTURE.md section 2.2
```

### Infrastructure
```
Supabase migrations (SQL)
Render.com: web service config (build command, start command)
Render.com: worker service config
Vercel: vercel.json (minimal, Next.js auto-detected)
.env.example (template with all required environment variables)
```

---

## Environment Variables Required

### Backend (Render.com)
```
OPENAI_API_KEY=
VISION_AGENT_API_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
QDRANT_URL=
QDRANT_API_KEY=
UPSTASH_REDIS_URL=
FINNHUB_API_KEY=
DEBUG=false
VERCEL_FRONTEND_URL=https://your-app.vercel.app
```

### Frontend (Vercel)
```
NEXT_PUBLIC_API_URL=https://your-app.onrender.com
```

---

## Definition of Done per Phase

| Phase | Done When |
|-------|-----------|
| 1 | Login/signup works. Frontend on Vercel. Backend on Render. Cookie auth end-to-end. |
| 2 | Upload PDF → appears in Pre-saved docs. SHA256 dedup works. |
| 3 | Upload PDF → background worker processes → ADE parses → chunks in Qdrant → grounding in Supabase → status="complete". |
| 4 | Select doc → PDF renders in viewer → Parse tab shows markdown → Extract tab shows financial fields → clicking field highlights bbox in PDF. |
| 5 | Chat answers questions with SSE streaming + bbox citations. Report generates and streams. FinBot fetches live data with streaming. |
| 6 | CORS locked. Rate limiting active. All error cases handled gracefully. Mobile-responsive. Production deploy verified. |
