# TECH_STACK.md — Alpha Lens v2 Technology Stack

All technologies below are LOCKED. Do not change any entry.

---

## Frontend

### Next.js 14 (App Router)
- **Version:** 14.x (latest stable)
- **Why:** React Server Components for fast initial load, App Router for nested layouts (dashboard shell wrapping section pages), built-in SSE support via `fetch` with streaming, file-based routing matches the 4-section structure.
- **Deployment:** Vercel (zero-config, automatic preview deployments per branch)
- **Key features used:** Server Components for auth-protected layouts, Client Components for interactive PDF viewer and chat, Route Handlers for any thin backend proxying needed
- **Connection to rest of stack:** Calls FastAPI backend via `fetch` with `Authorization: Bearer {token}` header. Receives SSE streams for chat/report/finbot.

### Tailwind CSS
- **Version:** 3.x
- **Why:** Utility-first CSS matches the component-by-component build approach. Works perfectly with shadcn/ui.
- **v1 color theme preserved:** Custom CSS variables in `globals.css` match the v1 emerald palette:
  ```css
  --accent: #059669;
  --accent-hover: #047857;
  --accent-2: #10b981;
  --accent-3: #34d399;
  --text: #0f172a;
  --text-secondary: #475569;
  --bg: #ffffff;
  --bg-soft: #fafbfc;
  ```

### shadcn/ui
- **Version:** Latest (component library, not a package — components are copied into `components/ui/`)
- **Why:** Unstyled-by-default components (Button, Card, Tabs, Input, Textarea, ScrollArea, Badge) that inherit Tailwind and can be precisely styled to match v1 aesthetic. No opinionated design system fighting the existing look.
- **Components used:** Button, Card, Tabs, TabsContent, Input, Textarea, ScrollArea, Badge, Separator, Sheet (mobile nav), Progress

### PDF.js
- **Version:** 3.11.174 (same as v1, pinned for stability)
- **Why:** Industry-standard PDF rendering in browser canvas. Required for bbox overlay: bounding box coordinates from ADE grounding dict are normalized (0-1), converted to pixel coords using canvas dimensions, then `ctx.strokeRect()` draws highlight rectangles.
- **Source:** CDN — `cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js`
- **Connection:** PDFViewer component wraps pdf.js; receives bbox data from chat response grounding events.

---

## Backend

### FastAPI (Python 3.11+)
- **Version:** 0.104.1 (pinned from v1 requirements.txt)
- **Why:** Async-native, SSE support via `StreamingResponse` with `text/event-stream`, automatic OpenAPI docs, Pydantic v2 integration, fast enough for I/O-bound document processing tasks.
- **Deployment:** Render.com (web service + background worker service)
- **Key patterns:**
  - `StreamingResponse` for all SSE endpoints (chat, report, finbot, document status)
  - `BackgroundTasks` for lightweight async work (deprecated in v2 — replaced by ARQ)
  - `Depends(get_current_user)` auth middleware on all protected routes
  - CORS: allow_origins configured to Vercel frontend URL (not `*` in production)

### Python 3.11+
- **Why:** Structural pattern matching, better error messages, performance improvements. ADE SDK and ARQ both support 3.11+.

### uvicorn
- **Version:** 0.24.0.post1 (pinned)
- **Why:** ASGI server for FastAPI. Single-process on Render.com web service.

---

## Document Intelligence

### landingai-ade (Landing.AI ADE SDK)
- **Version:** 1.2.0 (pinned from v1 requirements.txt)
- **Package:** `pip install landingai-ade`
- **Why:** Replaced deprecated `agentic-doc`. Auto-generated from ADE API spec with Pydantic response models.
- **Auth:** `VISION_AGENT_API_KEY` environment variable
- **Three APIs used:**
  1. `parse_jobs.create()` + `parse_jobs.get()` — async parsing for large docs (up to 1000 pages). All documents go through parse_jobs, not sync `parse()`.
  2. `extract(schema, markdown)` — schema-driven structured field extraction from parsed markdown
  3. `split(split_class, markdown)` — multi-document PDF classification (used when a single upload contains multiple financial documents)
- **Model:** `dpt-2-latest` for parse_jobs and extract; `split-latest` for split
- **Client:** `AsyncLandingAIADE` with `DefaultAioHttpClient` for concurrent operations in worker

### AsyncLandingAIADE + DefaultAioHttpClient
- **Install:** `pip install 'landingai-ade[aiohttp]'`
- **Why async:** Worker processes docs asynchronously; parse_jobs polling is naturally async (await + asyncio.sleep)

---

## Task Queue

### ARQ
- **Version:** Latest compatible with Python 3.11
- **Why:** Async Redis-based task queue for Python. Replaces the v1 synchronous `BackgroundTasks` approach. Supports job retries, timeouts (up to 1 hour for large ADE jobs), multiple workers.
- **Connection:** Worker pulls jobs from Upstash Redis queue. FastAPI enqueues via `arq.create_pool()`.

### Upstash Redis
- **Version:** Managed Redis service (serverless)
- **Why:** Serverless Redis compatible with ARQ. No self-managed Redis server. Free tier covers development; production uses pay-per-request pricing.
- **Connection string:** `UPSTASH_REDIS_URL` environment variable
- **Use cases:** ARQ job queue, job result storage, optional pub/sub for real-time status updates

---

## Vector Database

### Qdrant Cloud
- **Version:** Qdrant Cloud managed service (latest stable Qdrant server)
- **Client:** `qdrant-client` Python package
- **Why:** Persistent, cloud-hosted vector store replacing the v1 file-based JSON approach. Supports metadata filtering (filter by `doc_id` + `user_id`) for per-document scoped retrieval. Scales to millions of chunks.
- **Collection design:** Single collection `alphalens_documents` with payload filtering — avoids per-user collection creation overhead.
- **Connection:** `QDRANT_URL` + `QDRANT_API_KEY` environment variables

---

## Embeddings

### OpenAI text-embedding-3-small
- **Model:** `text-embedding-3-small`
- **Dimensions:** 1536
- **Why:** Same as v1 — best cost/performance ratio for financial text. Consistent with the production embedding model already generating vectors in v1.
- **Usage:** Embed ADE chunk markdown at indexing time; embed user query at retrieval time. Batched embedding for efficiency (up to 2048 texts per API call).

---

## LLM

### GPT-4o-mini (simple queries + FinBot)
- **Model ID:** `gpt-4o-mini`
- **Why:** Fast, cheap, sufficient for document Q&A and FinBot tool calling. 128K context window handles large chunks.
- **Used in:** chat_engine.py (RAG chat), finbot_service.py (agentic loop)

### GPT-4o (complex + reports)
- **Model ID:** `gpt-4o`
- **Why:** Superior reasoning for multi-section financial report generation. Higher cost justified by report quality.
- **Used in:** report_service.py (full report generation)

### OpenAI Python SDK
- **Version:** `openai==2.24.0` (pinned from v1)
- **Auth:** `OPENAI_API_KEY` environment variable
- **Features used:** `client.chat.completions.create(stream=True)` for SSE streaming, `client.embeddings.create()` for batch embeddings

---

## Authentication / Database / Storage

### Supabase
- **Version:** `supabase>=2.24.0` Python client
- **Auth:** Email/password via Supabase Auth. JWT tokens issued by Supabase, verified by FastAPI via `client.auth.get_user(token)`.
- **Database:** PostgreSQL with Row Level Security (RLS) policies on all tables. RLS ensures users can only access their own documents, grounding, chat history, and reports. All existing RLS policies are preserved from v1.
- **Storage:** `documents` bucket with RLS: first path component must equal `auth.uid()`. Path format: `{user_id}/{doc_id}/original.pdf`. Used to store original PDFs and processed JSON cache.
- **Keep from v1:** All existing tables, RLS policies, storage bucket configuration, and auth flows are preserved. v2 adds new tables (`document_grounding`, `chat_history`, `finbot_history`, `reports`).

---

## Deployment

### Vercel (Frontend)
- **Why:** Zero-config Next.js deployment, automatic HTTPS, global CDN, preview deployments per PR, instant rollbacks.
- **Config:** `vercel.json` minimal config — Next.js is auto-detected.
- **Environment variables:** `NEXT_PUBLIC_API_URL` pointing to Render.com FastAPI URL.

### Render.com (Backend + Worker)
- **Web Service:** FastAPI app (`uvicorn app:app --host 0.0.0.0 --port $PORT`)
- **Worker Service:** ARQ worker (`python -m arq worker.WorkerSettings`)
- **Why:** Simple Python deployment, free tier available for development, environment variable management, automatic deploys from git.
- **Environment variables:** All secrets (OPENAI_API_KEY, VISION_AGENT_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, QDRANT_URL, QDRANT_API_KEY, UPSTASH_REDIS_URL, FINNHUB_API_KEY)

---

## Market Data

### yfinance
- **Version:** `>=0.2.36`
- **Why:** Free, no API key required. Provides real-time quotes, historical prices, company info. Used by FinBot `get_stock_quote`, `get_price_history`, `calculate_investment_return`, `compare_stocks` tools.
- **Limitations:** Unofficial API, rate limits apply. Acceptable for demo/production given FinBot's query rate.

### finnhub-python
- **Version:** `>=2.4.19`
- **Why:** Official Finnhub SDK. Provides company news and general market news for FinBot news sidebar. Requires `FINNHUB_API_KEY`.

---

## Supporting Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| `pydantic` | >=2.11.7,<3.0.0 | Data validation, financial schemas, API request/response models |
| `python-dotenv` | 1.1.1 | .env file loading in development |
| `python-multipart` | 0.0.6 | Multipart file upload parsing in FastAPI |
| `requests` | 2.31.0 | HTTP client for any direct ADE REST calls |
| `numpy` | 2.0.2 | Cosine similarity calculations for vector search fallback |
| `PyPDF2` | 3.0.1 | Fallback PDF text extraction when ADE is unavailable |
| `beautifulsoup4` | 4.12.2 | HTML parsing for ADE table extraction cleanup |
| `xhtml2pdf` | 0.2.16 | Server-side PDF generation for report export |
| `PyJWT` | Latest | Decoding JWT tokens for user_id extraction |

---

## Version Pinning Strategy

All versions are pinned in `requirements.txt` to match v1 exactly, except:
- `supabase>=2.24.0` (minimum version, allow patch updates)
- `yfinance>=0.2.36` (allow minor updates for API compatibility)
- `finnhub-python>=2.4.19` (allow minor updates)
- New packages (qdrant-client, arq) pinned after testing
