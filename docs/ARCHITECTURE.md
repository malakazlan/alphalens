# ARCHITECTURE.md — Alpha Lens v2 System Architecture

## 1. High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT (Browser)                              │
│  Next.js 14 App Router — Vercel                                         │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │  Home /      │  │  Analyzer     │  │  Report      │  │  FinBot   │ │
│  │  landing     │  │  /analyzer    │  │  /report     │  │  /finbot  │ │
│  └──────────────┘  └───────────────┘  └──────────────┘  └───────────┘ │
│         │                  │                  │                  │      │
│  PDF.js viewer     shadcn/ui components   SSE streaming    SSE streaming│
└─────────────────────────────────────────────────────────────────────────┘
                              │ HTTPS REST + SSE
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       FastAPI Backend — Render.com                      │
│                                                                         │
│  app.py            Routing, auth middleware, CORS                       │
│  auth.py           Supabase JWT verification                            │
│  document_processor.py   ADE orchestration (parse/extract/split)       │
│  chat_engine.py    RAG pipeline, section-aware retrieval, SSE           │
│  report_service.py GPT-4o report generation with SSE                   │
│  finbot_service.py Agentic loop, yfinance/Finnhub tools, SSE           │
│  vector_store.py   Qdrant client (upsert, search)                      │
│  llm_service.py    OpenAI GPT-4o / GPT-4o-mini wrappers               │
│  config.py         Environment variable management                      │
│  database_service.py  Supabase DB CRUD (documents, grounding, history) │
│  storage_service.py   Supabase Storage upload/download                 │
└──────────┬───────────────────────────────────────────────────┬──────────┘
           │                                                   │
           │ Enqueue job                                        │ API calls
           ▼                                                   ▼
┌─────────────────────┐        ┌──────────────────────────────────────────┐
│  ARQ Worker         │        │  External Services                        │
│  (Render.com)       │        │                                           │
│                     │        │  ┌────────────────┐  ┌─────────────────┐ │
│  process_document   │        │  │  Landing.AI ADE│  │  OpenAI API     │ │
│  task:              │        │  │  parse_jobs    │  │  GPT-4o-mini    │ │
│  1. Download file   │◄──────►│  │  extract()     │  │  GPT-4o         │ │
│  2. parse_jobs      │        │  │  split()       │  │  text-embed-3sm │ │
│  3. extract()       │        │  └────────────────┘  └─────────────────┘ │
│  4. Chunk + enrich  │        │                                           │
│  5. Qdrant upsert   │        │  ┌────────────────┐  ┌─────────────────┐ │
│  6. Save grounding  │        │  │  yfinance      │  │  Finnhub        │ │
│  7. Update status   │        │  │  (stock data)  │  │  (news)         │ │
└──────────┬──────────┘        │  └────────────────┘  └─────────────────┘ │
           │                   └──────────────────────────────────────────┘
           │ Redis queue
           ▼
┌─────────────────────┐
│  Upstash Redis      │
│  (task queue +      │
│   pub/sub status)   │
└─────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                       Supabase (BaaS)                                   │
│                                                                         │
│  Auth: JWT-based email/password authentication                          │
│                                                                         │
│  Database (PostgreSQL with RLS):                                        │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │  documents   │  │ document_grounding│  │  chat_history            │  │
│  │  id, user_id │  │ doc_id, element_id│  │  doc_id, user_id, role  │  │
│  │  filename    │  │ page, bbox        │  │  content, timestamp      │  │
│  │  status      │  │ type, chunk_id   │  │  best_chunks             │  │
│  │  sha256_hash │  └──────────────────┘  └──────────────────────────┘  │
│  │  metadata    │  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │  file_path   │  │  finbot_history  │  │  reports                 │  │
│  └──────────────┘  │  user_id, role   │  │  doc_id, user_id, html   │  │
│                    │  content, ts     │  │  created_at              │  │
│                    └──────────────────┘  └──────────────────────────┘  │
│                                                                         │
│  Storage (documents bucket — RLS: folder = auth.uid()):                 │
│  {user_id}/{doc_id}/original.pdf                                        │
│  {user_id}/{doc_id}/processed.json   (ADE parse result cache)          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                       Qdrant Cloud (Vector DB)                          │
│                                                                         │
│  Collection: alphalens_documents                                        │
│  Vectors: 1536-dim (text-embedding-3-small)                             │
│  Payload (metadata) per point:                                          │
│    chunk_id (UUID — ADE element ID)                                    │
│    doc_id                                                               │
│    user_id                                                              │
│    chunk_type (text, table, title, figure, etc.)                       │
│    section_header (nearest preceding title chunk text)                 │
│    page (0-indexed)                                                     │
│    markdown (chunk text)                                                │
│  Filter: user_id + doc_id for scoped retrieval                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Module Structure

### 2.1 Backend Modules (FastAPI — Python 3.11+)

```
backend/
├── app.py                  # FastAPI app, routes, middleware, SSE endpoints
├── auth.py                 # Supabase auth: sign_up, sign_in, verify_token, get_user
├── config.py               # Settings from env vars (pydantic BaseSettings)
├── document_processor.py   # ADE orchestration: parse_jobs, extract, section chunking
├── chat_engine.py          # RAG pipeline: embed query → Qdrant search → GPT-4o-mini → SSE
├── llm_service.py          # OpenAI client wrapper: embeddings, chat completions
├── vector_store.py         # Qdrant client: create collection, upsert points, search
├── report_service.py       # Report generation: GPT-4o + structured extract data → SSE
├── finbot_service.py       # FinBot agentic loop: tools, OpenAI function calling, SSE
├── database_service.py     # Supabase DB: documents, grounding, chat_history CRUD
├── storage_service.py      # Supabase Storage: upload, download, signed URLs
├── worker.py               # ARQ worker: process_document task definition
└── schemas.py              # Pydantic models for financial data + API request/response
```

### 2.2 Frontend Modules (Next.js 14 App Router)

```
frontend/
├── app/
│   ├── layout.tsx              # Root layout: fonts, global CSS, auth provider
│   ├── page.tsx                # Landing page (public, before login)
│   ├── login/
│   │   └── page.tsx            # Login/signup page
│   ├── dashboard/              # Protected routes (require auth)
│   │   ├── layout.tsx          # Dashboard layout: header nav + auth guard
│   │   ├── page.tsx            # Home section
│   │   ├── analyzer/
│   │   │   └── page.tsx        # Analyzer: initial + result states
│   │   ├── report/
│   │   │   └── page.tsx        # Report generation
│   │   └── finbot/
│   │       └── page.tsx        # FinBot two-panel chat
│   └── api/                    # Next.js API routes (thin proxies to FastAPI)
│       └── [...]/route.ts      # Optional: only if needed for auth token forwarding
├── components/
│   ├── ui/                     # shadcn/ui generated components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   ├── textarea.tsx
│   │   ├── tabs.tsx
│   │   ├── badge.tsx
│   │   ├── scroll-area.tsx
│   │   └── separator.tsx
│   ├── layout/
│   │   ├── Header.tsx          # Top navigation bar
│   │   └── Footer.tsx          # Footer with links
│   ├── auth/
│   │   ├── LoginForm.tsx       # Email/password login
│   │   └── SignupForm.tsx      # Email/password signup
│   ├── analyzer/
│   │   ├── ActionCards.tsx     # Parse/Extract/Chat upload cards
│   │   ├── DocumentRail.tsx    # Left icon-rail sidebar
│   │   ├── DocumentFlyout.tsx  # Flyout panel with doc list
│   │   ├── PDFViewer.tsx       # PDF.js wrapper with bbox overlay
│   │   ├── ParsePanel.tsx      # Markdown/JSON parse output
│   │   ├── ExtractPanel.tsx    # Structured financial schema display
│   │   ├── ChatPanel.tsx       # RAG chat with streaming + citations
│   │   ├── CitationSidebar.tsx # Shows chunk sources for last answer
│   │   └── ProcessingStatus.tsx # Upload/processing progress
│   ├── report/
│   │   ├── ReportViewer.tsx    # Renders streaming report sections
│   │   └── ExportButton.tsx    # PDF export trigger
│   └── finbot/
│       ├── FinBotSidebar.tsx   # News carousel + breaking news
│       ├── FinBotChat.tsx      # Chat panel with streaming
│       └── NewsCard.tsx        # Individual news item card
├── lib/
│   ├── api.ts                  # API client: fetch wrappers with auth headers
│   ├── auth.ts                 # Auth context: token storage, session management
│   ├── sse.ts                  # SSE client: EventSource wrapper for streaming
│   └── pdf-highlight.ts        # PDF.js bbox overlay utilities
├── hooks/
│   ├── useDocuments.ts         # Document list + upload state
│   ├── useChat.ts              # Chat state + SSE stream management
│   ├── useReport.ts            # Report generation state
│   └── useFinBot.ts            # FinBot chat state + SSE
└── styles/
    └── globals.css             # Tailwind base + custom CSS variables (v1 color theme)
```

---

## 3. Data Flow Diagrams

### 3.1 Document Processing Flow (Async)

```
User uploads PDF
      │
      ▼
Frontend → POST /api/documents/upload (multipart)
      │
      ▼
Backend:
  1. Compute SHA256 hash of bytes
  2. Query documents table: SELECT WHERE sha256_hash = ? AND user_id = ?
  3. If found: return existing doc_id (skip processing)
  4. If new:
     a. Generate UUID → doc_id
     b. Upload bytes → Supabase Storage: {user_id}/{doc_id}/original.pdf
     c. Insert documents row (status="uploading")
     d. Enqueue ARQ job: process_document(doc_id, user_id, file_path, access_token)
     e. Return {doc_id, status="queued"}

ARQ Worker:
  1. Download file from Supabase Storage
  2. Update status="parsing"
  3. ADE: job = client.parse_jobs.create(document=Path(file), model="dpt-2-latest")
     Poll every 15s: status = client.parse_jobs.get(job.job_id)
     Until status.status == "completed"
  4. ADE result: parse_response = status.data
     - parse_response.markdown (full doc markdown)
     - parse_response.chunks (list of Chunk objects with id, type, grounding)
     - parse_response.grounding (element_id → {page, box, type} dict)
  5. Update status="extracting"
  6. ADE: extract_response = client.extract(
         schema=pydantic_to_json_schema(FinancialDocument),
         markdown=parse_response.markdown
     )
  7. Update status="indexing"
  8. Section-aware chunking:
     a. Walk parse_response.chunks in document order
     b. Track current_section_header = ""
     c. For each chunk: if chunk.type == "title": current_section_header = chunk.markdown (stripped)
     d. For all other chunk types: attach metadata.section_header = current_section_header
  9. Persist grounding dict to Supabase (document_grounding table):
     For each (element_id, grounding_data) in parse_response.grounding:
       INSERT (doc_id, element_id, page, bbox_left, bbox_top, bbox_right, bbox_bottom, type)
  10. Build embeddings: embed all chunk.markdown texts via text-embedding-3-small (batch)
  11. Upsert to Qdrant:
      collection = "alphalens_documents"
      For each chunk + embedding:
        point_id = deterministic UUID from chunk.id
        vector = embedding (1536-dim)
        payload = {chunk_id, doc_id, user_id, chunk_type, section_header, page, markdown, bbox}
  12. Cache parse_response.model_dump_json() → Supabase Storage: {user_id}/{doc_id}/processed.json
  13. Update documents row: status="complete", metadata={page_count, company_name, fiscal_year, ...}

Frontend: polls GET /api/documents/{doc_id}/status (SSE)
  On status="complete": load document viewer + extract data
```

### 3.2 Chat Flow (RAG-first with Streaming)

```
User types query in Chat tab
      │
      ▼
Frontend → POST /api/chat/stream (SSE endpoint)
  Body: {document_id, query, session_id}

Backend chat_engine.py:
  1. Load conversation history from Supabase (last N turns)
  2. Embed query: query_embedding = embed_text(query)  [text-embedding-3-small]
  3. Qdrant search:
     results = qdrant_client.search(
       collection_name="alphalens_documents",
       query_vector=query_embedding,
       query_filter=Filter(must=[
         FieldCondition(key="doc_id", match=MatchValue(value=doc_id)),
         FieldCondition(key="user_id", match=MatchValue(value=user_id))
       ]),
       limit=8,
       with_payload=True
     )
  4. Build context string from results:
     For each result: include section_header + chunk markdown
     Format: "### {section_header}\n{markdown}\n\n"
  5. Check total context tokens < 30000 → if small doc, use full markdown instead (v1 full-context fallback)
  6. Prompt assembly (analyst prompt from v1, adapted):
     System: "You are a financial analyst assistant. Return JSON: {answer, reasoning, best_chunks: [UUID, ...]}"
     User: "{context}\n\nConversation history:\n{history}\n\nQuestion: {query}"
  7. Stream GPT-4o-mini response via OpenAI streaming API
  8. SSE events:
     data: {"type": "token", "content": "..."}  (for each streamed token)
     data: {"type": "done", "best_chunks": [...], "reasoning": "..."}
  9. After stream: resolve best_chunks → query Supabase document_grounding table for bboxes
  10. SSE final event: {"type": "grounding", "bboxes": [{element_id, page, box, type}, ...]}
  11. Save {user_message, assistant_response, best_chunks, session_id} to Supabase chat_history

Frontend:
  - Renders tokens as they arrive (streaming text)
  - On "done" event: shows reasoning, requests grounding
  - On "grounding" event: draws bbox rectangles on PDF.js canvas, scrolls to first citation page
  - Citation sidebar populated with chunk sources
```

### 3.3 FinBot Flow (Agentic with Streaming)

```
User sends message
      │
      ▼
Frontend → POST /api/finbot/chat/stream (SSE)
  Body: {session_id, message}

Backend finbot_service.py:
  1. Load conversation from Supabase finbot_history (last 20 turns)
  2. Agentic loop (max 5 iterations):
     a. POST to OpenAI: model=gpt-4o-mini, tools=FINBOT_TOOLS, stream=True
     b. If finish_reason == "tool_calls":
        - Execute tool (get_stock_quote, get_price_history, etc.)
        - SSE: {"type": "tool_call", "tool": name, "args": {}}
        - Append tool result to messages
     c. If finish_reason == "stop":
        - Stream tokens: SSE {"type": "token", "content": "..."}
        - Break loop
  3. SSE: {"type": "done"}
  4. Save conversation to Supabase finbot_history

Frontend:
  - Shows tool call indicator ("Fetching market data...")
  - Renders streaming tokens
  - Renders final response with markdown (bold numbers, tables for comparisons)
```

---

## 4. Database Schema (Supabase PostgreSQL)

### Table: documents
```sql
CREATE TABLE documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  file_path       TEXT NOT NULL,
  sha256_hash     TEXT,
  status          TEXT NOT NULL DEFAULT 'uploading',
    -- uploading | queued | parsing | extracting | indexing | complete | error
  progress        INTEGER DEFAULT 0,
  status_message  TEXT,
  metadata        JSONB DEFAULT '{}',
    -- {page_count, company_name, fiscal_year, currency, doc_type}
  extract_data    JSONB DEFAULT '{}',
    -- Full FinancialDocument extract() result
  upload_time     TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_sha256 ON documents(sha256_hash, user_id);

-- RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_documents" ON documents
  FOR ALL USING (auth.uid() = user_id);
```

### Table: document_grounding
```sql
CREATE TABLE document_grounding (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  element_id  TEXT NOT NULL,
    -- chunk UUID, table ID (0-1), cell ID (0-2), etc.
  page        INTEGER NOT NULL,
  bbox_left   FLOAT NOT NULL,
  bbox_top    FLOAT NOT NULL,
  bbox_right  FLOAT NOT NULL,
  bbox_bottom FLOAT NOT NULL,
  element_type TEXT,
    -- chunkText | chunkTable | chunkFigure | tableCell
  chunk_id    UUID,
    -- For cells: links back to parent chunk UUID
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_grounding_doc_element ON document_grounding(doc_id, element_id);
CREATE INDEX idx_grounding_doc_id ON document_grounding(doc_id);

-- RLS
ALTER TABLE document_grounding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_grounding" ON document_grounding
  FOR ALL USING (auth.uid() = user_id);
```

### Table: chat_history
```sql
CREATE TABLE chat_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  best_chunks TEXT[],
    -- Array of element_id strings cited by this assistant message
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_history_session ON chat_history(session_id, created_at);
CREATE INDEX idx_chat_history_doc ON chat_history(doc_id, user_id);

-- RLS
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_chat" ON chat_history
  FOR ALL USING (auth.uid() = user_id);
```

### Table: finbot_history
```sql
CREATE TABLE finbot_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content     TEXT NOT NULL,
  tool_name   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_finbot_session ON finbot_history(session_id, created_at);

-- RLS
ALTER TABLE finbot_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_finbot" ON finbot_history
  FOR ALL USING (auth.uid() = user_id);
```

### Table: reports
```sql
CREATE TABLE reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  html_content TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_reports" ON reports
  FOR ALL USING (auth.uid() = user_id);
```

---

## 5. Qdrant Collection Structure

```python
# Collection: alphalens_documents (single collection, filtered per user/doc)
# Vector size: 1536 (text-embedding-3-small)
# Distance: Cosine

# Point structure:
{
  "id": "7d58c5cf-e4f5-4a7e-ba34-0cd7bc6a6506",  # ADE chunk UUID
  "vector": [0.1, -0.3, ...],                      # 1536-dim embedding
  "payload": {
    "chunk_id": "7d58c5cf-e4f5-4a7e-ba34-0cd7bc6a6506",
    "doc_id": "abc123",
    "user_id": "user-uuid",
    "chunk_type": "table",           # ADE type: text|table|title|figure|...
    "section_header": "Income Statement",  # Nearest preceding title chunk
    "page": 3,
    "markdown": "<table id='3-1'>...</table>",
    "bbox_left": 0.06,
    "bbox_top": 0.12,
    "bbox_right": 0.94,
    "bbox_bottom": 0.45
  }
}
```

---

## 6. ARQ Worker Architecture

```python
# worker.py
from arq import create_pool
from arq.connections import RedisSettings

REDIS_SETTINGS = RedisSettings.from_dsn(os.environ["UPSTASH_REDIS_URL"])

async def process_document(ctx, doc_id: str, user_id: str, file_path: str, access_token: str):
    """Main async processing task."""
    # ... full ADE pipeline (see data flow 3.1)

class WorkerSettings:
    functions = [process_document]
    redis_settings = REDIS_SETTINGS
    max_jobs = 5
    job_timeout = 3600  # 1 hour for large docs
```

---

## 7. SSE Event Format

All streaming endpoints return `text/event-stream` with these event types:

```
# Chat streaming:
data: {"type": "token", "content": "Revenue"}
data: {"type": "token", "content": " grew"}
data: {"type": "done", "best_chunks": ["uuid1", "uuid2"], "reasoning": "..."}
data: {"type": "grounding", "bboxes": [{"element_id": "uuid1", "page": 3, "box": {"left":0.1,"top":0.2,"right":0.9,"bottom":0.4}, "type": "chunkTable"}]}
data: {"type": "error", "message": "..."}

# Report streaming:
data: {"type": "section_start", "section": "Executive Summary"}
data: {"type": "token", "content": "..."}
data: {"type": "section_end", "section": "Executive Summary"}
data: {"type": "done"}

# FinBot streaming:
data: {"type": "tool_call", "tool": "get_stock_quote", "args": {"symbol": "AAPL"}}
data: {"type": "token", "content": "Apple"}
data: {"type": "done"}

# Document status:
data: {"type": "status", "status": "parsing", "progress": 30}
data: {"type": "status", "status": "complete", "progress": 100}
```
