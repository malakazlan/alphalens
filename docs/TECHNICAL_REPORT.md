# AlphaLens — Technical Architecture Report

*Final Year Project · Final Evaluation*

> A document-intelligence platform for financial analysts. Three surfaces — **Analyzer**, **Reports**, **FinBot** — built on a shared backend that turns long, unstructured PDFs (10-Ks, audits, prospectuses) into searchable, citable, and explainable data.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Topology](#2-system-topology)
3. [Authentication & Session](#3-authentication--session)
4. [Document Analyzer](#4-document-analyzer)
   - 4.7 [Finance-analyst Agent (V2.7)](#47-finance-analyst-agent-v27)
5. [Reports](#5-reports)
6. [FinBot](#6-finbot)
7. [Background Workers (ARQ)](#7-background-workers-arq)
8. [Data Model](#8-data-model)
9. [Deployment](#9-deployment)
10. [Observability & Operations](#10-observability--operations)
11. [Performance & Cost Engineering](#11-performance--cost-engineering)
12. [Security](#12-security)
13. [Glossary](#13-glossary)

---

## 1. Executive Summary

### 1.1 What AlphaLens does

AlphaLens helps users — analysts, students, finance professionals — work with large financial PDFs without manually reading them. A user uploads a 10-K, an annual report, or an audit. Within ~30 seconds the document is:

1. **Parsed** into structured chunks (titles, tables, figures, text passages) with per-element bounding boxes.
2. **Indexed** into a vector store so the contents can be searched by meaning, not just keywords.
3. **Summarised** as structured fields (company name, fiscal year, revenue, etc.) extracted from the page text.

The user can then:

- **Chat** with the document and receive answers grounded in citable cells, tables, figures, or paragraphs.
- **Generate a report** — multi-section analyst-style write-up (Full Analysis, Risk Report, Investor Memo, or a user-defined template) — and export it as a PDF.
- **Talk to FinBot**, a market-data assistant that can also reference the user's uploaded documents.

### 1.2 The three surfaces

| Surface | Job | Key technique |
|---|---|---|
| **Analyzer** | Read & query a single document | V2.6: RAG + 5-layer citation pipeline. V2.7: tool-calling finance-analyst agent with 9 finance tools (lookup_value, get_section, compute_ratio, compare_periods, decompose_change, detect_red_flags, list_figures, read_figure, query_freeform) — feature-flagged, see §4.7. |
| **Reports** | Produce a long-form analyst write-up | Per-section parallel generation + headless-Chromium PDF render |
| **FinBot** | Ask about markets, portfolios, news | Agent loop with 16 tools (yfinance, Finnhub, FRED, RAG over user docs) |

### 1.3 Why this is hard

Two problems make this non-trivial:

1. **Hallucination is fatal.** A user asks "what was the revenue in 2024?" and the model invents a plausible-looking but wrong number. In a financial context this is the worst possible failure. The system has to be conservative: cite, don't invent.
2. **Citations have to be precise.** When the system says "$1,915,655", the user must be able to click the citation chip and immediately see the exact table cell on the exact page that gave that number. Approximate is not acceptable.

The architecture below addresses both directly — through retrieval design, prompt engineering, multi-phase citation matching, and a post-generation grounding verifier (Section 4.5).

---

## 2. System Topology

### 2.1 High-level architecture

```
                              ┌────────────────────────┐
                              │     USER BROWSER       │
                              └───────────┬────────────┘
                                          │ HTTPS
                                          ▼
                              ┌────────────────────────┐
                              │       NETLIFY          │
                              │  Next.js  (Frontend)   │
                              │  alphalense.netlify.app│
                              └───────────┬────────────┘
                                          │ /api/* proxy
                                          ▼
                              ┌────────────────────────┐
                              │   CLOUDFLARE TUNNEL    │
                              │   api.alphalens.site   │
                              └───────────┬────────────┘
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
        ┌──────────────────┐                            ┌──────────────────┐
        │  alphalens-web   │  ─── enqueue job ─────▶    │  Upstash Redis   │
        │  FastAPI (x2)    │                            │   (ARQ Queue)    │
        │  Hetzner VM      │                            └─────────┬────────┘
        └────────┬─────────┘                                      │ pop
                 │                                                ▼
                 │                                     ┌──────────────────┐
                 │                                     │ alphalens-worker │
                 │                                     │  ARQ + Chromium  │
                 │                                     └────────┬─────────┘
                 │                                              │
   ┌─────────────┼──────────────────┬──────────────┐            │
   │             │                  │              │            │
   ▼             ▼                  ▼              ▼            ▼
┌────────┐  ┌─────────┐         ┌────────┐    ┌─────────┐  ┌──────────┐
│Supabase│  │ Qdrant  │         │ OpenAI │    │yfinance │  │Landing.AI│
│Postgres│  │ Cloud   │         │  API   │    │ Finnhub │  │   ADE    │
│  Auth  │  │ Vector  │         │ chat + │    │  FRED   │  │  Parse + │
│Storage │  │   DB    │         │ embed  │    │(markets)│  │  Extract │
└────────┘  └─────────┘         └────────┘    └─────────┘  └──────────┘
     ▲          ▲                    ▲                          ▲
     │          │                    │                          │
     └──────────┴──── worker also reads/writes these ───────────┘
```

### 2.2 Tech stack at a glance

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Next.js 14 (App Router) | SSR for SEO, file-based routing, React 18 |
| Backend | FastAPI (Python 3.11) | Async-native, type-checked, fast |
| Database | Supabase (Postgres) | Hosted Postgres + Auth + Storage in one |
| Vector DB | Qdrant Cloud | Sub-100ms search, payload filters, free tier |
| Queue | Upstash Redis + ARQ | Serverless Redis; ARQ is async-Python-friendly |
| LLM | OpenAI (gpt-4o / gpt-4o-mini) | Best chat + tool-use quality; prompt caching |
| Embeddings | OpenAI text-embedding-3-small (1536-dim) | Fast, cheap, strong on financial text |
| Doc parser | Landing.AI ADE (DPT-2-latest) | Structured chunks + tables + figures with bbox |
| PDF render | Playwright + Chromium | Real layout engine for analyst-grade PDFs |
| Frontend host | Netlify | Auto-build on git push to main |
| Backend host | Hetzner CCX (anorra-prod) | Dedicated VM; Docker Compose |
| Tunnel | Cloudflare Tunnel | TLS + DDoS protection without exposed ports |
| Observability | Sentry | Error tracking with source maps |

### 2.3 Where each thing runs

- **Browser** → loads the Next.js app from Netlify's CDN.
- **Next.js server** (on Netlify) → rewrites `/api/*` requests to `https://api.alphalens.site`.
- **Cloudflare Tunnel** (in the Docker stack on anorra-prod) → terminates TLS, forwards HTTP to the FastAPI container on a private network.
- **alphalens-web** → 2 Uvicorn workers behind the tunnel. Handles HTTP, talks to Supabase, Qdrant, Redis, OpenAI.
- **alphalens-worker** → no HTTP. Polls Redis for ARQ jobs (`process_document`, `render_report_pdf`). Has Chromium installed for PDF rendering.
- **Supabase / Qdrant / Upstash / OpenAI / ADE** → SaaS, called over HTTPS.

---

## 3. Authentication & Session

### 3.1 What it does (plain English)

The user signs up or logs in with email + password. The backend hands back a JWT (JSON Web Token) inside an `httpOnly` cookie. Every subsequent request automatically carries that cookie, so the user doesn't have to manage tokens manually. The backend verifies the JWT on every protected endpoint.

### 3.2 Login flow

```
   USER             FRONTEND              BACKEND              SUPABASE
   ────             ────────              ───────              ────────
    │                  │                     │                     │
    │  email + pw      │                     │                     │
    ├─────────────────▶│                     │                     │
    │                  │  POST /api/auth/    │                     │
    │                  │       login         │                     │
    │                  ├────────────────────▶│                     │
    │                  │                     │  sign_in_with_      │
    │                  │                     │      password(...)  │
    │                  │                     ├────────────────────▶│
    │                  │                     │                     │
    │                  │                     │◀────────────────────┤
    │                  │                     │  { user, JWT,       │
    │                  │                     │    refresh_token }  │
    │                  │  200 + Set-Cookie:  │                     │
    │                  │    access_token=…   │                     │
    │                  │   HttpOnly · 7-day  │                     │
    │                  │◀────────────────────┤                     │
    │  redirect to     │                     │                     │
    │   /dashboard     │                     │                     │
    │◀─────────────────┤                     │                     │
    │                  │                     │                     │
    │ ══════ every subsequent request sends the cookie ════════════│
    │                  │                     │                     │
    │  needs /docs     │                     │                     │
    ├─────────────────▶│  GET /api/documents │                     │
    │                  ├────────────────────▶│                     │
    │                  │                     │ get_current_user(): │
    │                  │                     │   decode JWT (HS256 │
    │                  │                     │   local fast path)  │
    │                  │  200 + JSON payload │                     │
    │                  │◀────────────────────┤                     │
```

### 3.3 JWT verification — fast path + fallback

Verifying every request through Supabase's network endpoint would add 100-300 ms per call. So the backend uses a **two-path verifier** ([`auth.py:80-117`](../backend/auth.py)):

1. **Fast path** — if `SUPABASE_JWT_SECRET` is set, decode the JWT locally with HMAC-SHA256 in microseconds.
2. **Fallback** — otherwise, call `supabase.auth.get_user(token)` over HTTPS.

In production both paths are valid; the fast path is the default. Failure in either raises `HTTPException(401)` and the request is rejected before reaching the route handler.

The verifier is exposed as a FastAPI dependency:

```python
@app.get("/api/documents")
async def list_documents(current_user: dict = Depends(get_current_user)):
    ...
```

Every protected endpoint declares the dependency. The result is a small `{ id, email, created_at }` dict.

### 3.4 RLS strategy

Supabase supports Row-Level Security (RLS) policies that filter rows in SQL. AlphaLens **does not rely on RLS** for protection because the backend connects with the service-role key (which bypasses RLS). Instead, every query in [`backend/db.py`](../backend/db.py) explicitly filters by `user_id`:

```python
def list_documents(user_id: str):
    return supabase.table("documents") \
        .select("*").eq("user_id", user_id).execute()
```

This is a deliberate trade-off: the service-role key gives more flexibility (e.g. cross-user analytics jobs), and ownership enforcement is centralised in repo functions which are easier to audit than scattered RLS policies. RLS policies *are* defined in the migrations as a defence-in-depth (every table has `user_id = auth.uid()` policies), but they're not the primary check.

### 3.5 Endpoint reference

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/signup` | Create user + return JWT cookie |
| POST | `/api/auth/login` | Verify password + return JWT cookie |
| POST | `/api/auth/logout` | Clear the cookie |
| GET | `/api/auth/session` | Return the current user (or 401) |
| POST | `/api/auth/forgot-password` | Trigger Supabase reset email |

---

## 4. Document Analyzer

The analyzer is the heart of AlphaLens. This section is the longest because it covers ingestion, indexing, retrieval, chat, and visualisation.

### 4.1 What the analyzer does

A user drops a PDF onto the dropzone. About 30 seconds later, the document is fully processed and the user can:

- Read it side-by-side with a chat panel.
- Ask questions and get answers with cell-level citations.
- Click any citation chip → the relevant region of the PDF is highlighted and scrolled into view.
- See parsed tables side-by-side with the source.
- See extracted structured data (company name, fiscal year, key figures).

### 4.2 Upload pipeline

```
   ┌──────────────────┐
   │ User drops PDF   │
   │  on Analyzer     │
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐
   │  Client:         │   sha256File()  →  hex digest
   │  hash file       │   (Web Crypto, sub-100ms)
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐
   │  POST  /api/     │
   │   documents/     │
   │   check-hash     │   ◀── short-circuits duplicate uploads
   └────────┬─────────┘
            │
            ▼
        ┌───────┐                  ┌────────────────────────┐
        │ dup?  ├── yes ─────────▶ │ redirect to existing   │
        └───┬───┘                  │  document_id           │
            │ no                   └────────────────────────┘
            ▼
   ┌──────────────────┐
   │  POST  /api/     │
   │   documents/     │   multipart  →  file + sha256_hash
   │   upload         │                  + action + parse_scope
   └────────┬─────────┘
            │
            ▼
   ┌────────────────────────────────────────────────────────┐
   │ Backend                                                │
   │  ├─ validate extension (.pdf .docx .html .png .jpg)    │
   │  ├─ validate size  ≤ 50 MB                             │
   │  ├─ upload to Supabase Storage                         │
   │  │     {user_id}/{doc_id}/original.{ext}               │
   │  ├─ INSERT INTO documents (status='queued')            │
   │  └─ pool.enqueue_job('process_document', …)            │
   └────────┬───────────────────────────────────────────────┘
            │
            ▼
   ┌──────────────────┐         ┌──────────────────┐
   │ 201 Created      │  ────▶  │ Frontend polls   │
   │ {document_id,    │         │ /status every 3s │
   │  status='queued'}│         └──────────────────┘
   └──────────────────┘
```

**Why the client hashes the file:**
- Saves bandwidth — `check-hash` can short-circuit before the multipart upload.
- The same hash is the dedupe key on the server.

**Why a queue and not synchronous processing:**
- Parsing a 100-page PDF can take 30-60 seconds. HTTP requests should not block that long. The ARQ queue (backed by Upstash Redis) absorbs the work; the frontend polls `/api/documents/{id}/status` every 3 seconds.

**Bulk upload** ([`POST /api/documents/bulk-upload`](../backend/app.py)):
- Up to 10 files per request, 250 MB combined.
- Each file hashed, deduped, stored, and enqueued independently.
- A single failing file doesn't poison the batch.

### 4.3 Worker processing pipeline

The ARQ worker picks up the job and runs a 12-stage pipeline. Each stage writes its progress to the `documents` row so the frontend's status bar reflects real progress.

```
   ╔════════════════════════════════════════════════════════════╗
   ║  ARQ Worker picks up  process_document(doc_id, user_id)    ║
   ╚════════════════════════════════════════════════════════════╝
                              │
                              ▼
   ┌────────────────────────────────────────────────────────────┐
   │  STAGE 1   ·   Download PDF from Storage         ░░░░░  5% │
   └────────────────────────────────────────────────────────────┘
                              │
                              ▼
   ┌────────────────────────────────────────────────────────────┐
   │  STAGE 2   ·   Financial Classifier (Cost Lever 0)         │
   │  PyPDF2 + keyword scoring (HIGH/MED/LOW tiers)   ░░░░░  7% │
   └─────────────┬──────────────────────────────────────────────┘
                 │
            ┌────▼────┐        ┌──────────────────────────────┐
            │financial│── no ─▶│  status = "rejected"  ✗ STOP │
            │  doc?   │        └──────────────────────────────┘
            └────┬────┘
                 │ yes
                 ▼
   ┌────────────────────────────────────────────────────────────┐
   │  STAGE 3   ·   ADE Cache lookup (Cost Lever 2)             │
   │  Key: SHA-256 + parse_scope                      ░░░░░  8% │
   └─────────────┬──────────────────────────────────────────────┘
                 │
            ┌────▼────┐
            │  cache  │── hit ─────────────────────┐
            │   hit?  │                            │
            └────┬────┘                            │
                 │ miss                            │ (skip 4-5)
                 ▼                                 │
   ┌────────────────────────────────────────────┐  │
   │  STAGE 4   · Page Filter (Cost Lever 1)    │  │
   │  Trim TOC, exhibits, blanks                │  │
   │  Only if parse_scope=core         ░░░  9%  │  │
   └─────────────┬──────────────────────────────┘  │
                 │                                 │
                 ▼                                 │
   ┌────────────────────────────────────────────┐  │
   │  STAGE 5   · ADE Parse                     │  │
   │  Landing.AI dpt-2-latest                   │  │
   │  Returns: markdown + chunks + groundings   │  │
   │                                ▓▓▓░░░ 40%  │  │
   └─────────────┬──────────────────────────────┘  │
                 │                                 │
                 ◀─────────────────────────────────┘
                 ▼
   ┌────────────────────────────────────────────────────────────┐
   │  STAGE 6   ·   Page-number remap                           │
   │  Map trimmed-PDF pages back to original    ▓▓▓░░  40%      │
   └─────────────┬──────────────────────────────────────────────┘
                 ▼
   ┌────────────────────────────────────────────────────────────┐
   │  STAGE 7   ·   Extract Filter (Cost Lever 3)               │
   │  Keep only financial-section markdown      ▓▓▓░░  45%      │
   └─────────────┬──────────────────────────────────────────────┘
                 ▼
   ┌────────────────────────────────────────────────────────────┐
   │  STAGE 8   ·   ADE Extract                                 │
   │  Pydantic schema → structured JSON         ▓▓▓▓░  55%      │
   │  (company_name, fiscal_year, revenue, ...)                 │
   └─────────────┬──────────────────────────────────────────────┘
                 ▼
   ┌────────────────────────────────────────────────────────────┐
   │  STAGE 9   ·   Persist groundings                          │
   │  INSERT INTO document_grounding (bbox per chunk) ▓▓▓▓ 58%  │
   └─────────────┬──────────────────────────────────────────────┘
                 ▼
   ┌────────────────────────────────────────────────────────────┐
   │  STAGE 10  ·   Section-aware chunking                      │
   │  Assign section_header to each chunk                       │
   │  Bbox guard: reject malformed boxes        ▓▓▓▓░  62%      │
   └─────────────┬──────────────────────────────────────────────┘
                 ▼
   ┌────────────────────────────────────────────────────────────┐
   │  STAGE 11  ·   Embeddings                                  │
   │  OpenAI text-embedding-3-small (1536-dim)  ▓▓▓▓▓  68%      │
   └─────────────┬──────────────────────────────────────────────┘
                 ▼
   ┌────────────────────────────────────────────────────────────┐
   │  STAGE 12  ·   Qdrant upsert                               │
   │  Batch upsert vectors + payloads            ▓▓▓▓▓▓  90%    │
   │  Collection: alphalens_documents                           │
   └─────────────┬──────────────────────────────────────────────┘
                 ▼
   ╔════════════════════════════════════════════════════════════╗
   ║  status = "complete"   ·   progress = 100  ·   ✓ DONE      ║
   ║  metadata populated, extract_data ready                    ║
   ╚════════════════════════════════════════════════════════════╝
```

Let's walk through each stage.

#### Stage 1 — Download

The worker downloads the PDF from Supabase Storage at `{user_id}/{doc_id}/original.{ext}` to a temporary file on disk. No transformation yet.

#### Stage 2 — Financial Classifier (Cost Lever 0)

Before calling the expensive ADE API, we cheaply check whether this PDF is actually a financial document. The classifier (`financial_classifier.py`) opens the first 25 pages with PyPDF2 and scores the text against three keyword tiers:

- **HIGH** (5 points each): "balance sheet", "statement of cash flows", "10-K", "audited financial statements", "consolidated income statement"
- **MED** (2 points): "fiscal year", "EBITDA", "operating income", "comprehensive income"
- **LOW** (1 point): "revenue", "expenses", "assets", "liabilities", "shareholders"

Acceptance rule: **≥1 HIGH** OR **≥3 MED with total score ≥10**.

A non-financial PDF (e.g. a recipe book) hits ~0 score → instant reject. Saves an ADE call (~$0.10 per doc) and worker minutes.

#### Stage 3 — ADE cache (Cost Lever 2)

The same PDF may be uploaded multiple times — by the same user, or by different users at the same firm. We cache ADE's parse+extract output keyed by file SHA-256 in Supabase Storage (`ade_cache/{sha256}.json`). 30-day TTL. Scope-aware: a `core`-scope cache hit cannot satisfy a `full`-scope request.

#### Stage 4 — Page Filter (Cost Lever 1)

ADE charges by page. A typical 10-K has 200+ pages but only ~80 are "interesting" financials — the rest are TOC, exhibits, signatures, blank pages, marketing imagery. The page filter (`page_filter.py`) uses regex + text heuristics to drop:

- Table of contents pages
- Exhibit indexes
- Signature/certification pages
- Pure-image pages with <100 chars of text
- Blank pages

Safety: hard cap at 60% skip rate. If the filter wants to remove >60% of pages, we fall back to sending the full PDF (we'd rather pay than miss data). Only fires when `parse_scope=core` (the default — user can choose `full` at upload time).

#### Stage 5 — ADE Parse

The trimmed (or full) PDF is sent to Landing.AI's `dpt-2-latest` Parse API. ADE returns:

- **Markdown** — the document as plain markdown with embedded chunk anchors (`<a id='cell-id'>`)
- **Chunks** — typed elements (text, title, table, table_cell, figure, page_header, page_footer, marginalia)
- **Grounding** — for each chunk: page number + normalised bounding box (`left`, `top`, `right`, `bottom` in 0-1 range)

#### Stage 6 — Page-number remap

If the page filter dropped pages, ADE sees a renumbered PDF. We remap each chunk's `page` field back to original-PDF coordinates so click-through lands on the right page.

#### Stage 7 — Extract filter (Cost Lever 3)

ADE Extract bills by input character count. We don't need to send marketing pages to the structured-field extractor — only the financial section markdown. The extract filter (`extract_filter.py`) keeps only chunks under recognised financial section headings + always keeps tables, key-value pairs, and titles. Safety fallback: if the filtered markdown drops below 5k chars (sign of an aggressive trim), we send the full markdown instead.

#### Stage 8 — ADE Extract

A Pydantic schema (`FinancialDocument` with fields like `company_name`, `fiscal_year`, `revenue`, `total_assets`, `currency`) is sent to ADE Extract. ADE returns a JSON document conforming to that schema. The result is later stored on `documents.extract_data` as JSONB.

#### Stage 9 — Grounding persistence

Each chunk's bbox is written to the `document_grounding` table:

```
doc_id | element_id | page | bbox_left | bbox_top | bbox_right | bbox_bottom | type
```

This table is the spatial index — when a chat answer cites cell `0-12`, the frontend looks up its bbox here to draw the highlight.

#### Stage 10 — Section-aware chunking

ADE sometimes classifies a section heading as "text" rather than "title" — that breaks our section-attribution downstream. We post-process: any short chunk whose plain text matches a known financial section pattern (`/cash flow|balance sheet|.../`) is treated as a section title. Every subsequent chunk inherits that `section_header`.

A **bbox guard** also runs here: any chunk whose bbox is missing or outside the [0,1] range is logged and stored with `bbox={}` so it doesn't render a ghost overlay in the viewer.

#### Stage 11 — Embedding

All chunks' markdown is sent to OpenAI `text-embedding-3-small` in batches. Returns 1536-dim float vectors. Cost: ~$0.02 per 1M tokens — about $0.0001 for a 100-page document.

#### Stage 12 — Qdrant upsert

The vectors + chunk payloads are upserted to Qdrant's `alphalens_documents` collection:

```python
{
  "id": uuid,
  "vector": [1536 floats],
  "payload": {
    "user_id": "...",
    "doc_id": "...",
    "chunk_id": "...",
    "chunk_type": "table_cell",
    "section_header": "Statement of Financial Position",
    "page": 8,
    "markdown": "Borrowings",
    "bbox": {"left": 0.12, "top": 0.45, "right": 0.85, "bottom": 0.48}
  }
}
```

`user_id` and `doc_id` are indexed (Qdrant payload index) so retrieval can filter to *this user's* *this document's* chunks with no full scan.

#### Stage final — Mark complete

`documents.status='complete'`, `extract_data` populated, `metadata` filled with `company_name`, `fiscal_year`, `currency`, `doc_type`. The frontend status poll picks this up and the user is redirected to the workspace.

### 4.4 Cost levers

The pipeline has four cost levers that together cut per-document cost by ~60%:

| Lever | Files | Effect | Always on? |
|---|---|---|---|
| 0 — Classifier | `financial_classifier.py` | Reject non-financial PDFs before paying ADE | Yes |
| 1 — Page filter | `page_filter.py` | Skip TOC/exhibits/blanks | Only `parse_scope=core` |
| 2 — ADE cache | `worker.py:69-191` | Re-uses identical-hash parse | Yes |
| 3 — Extract filter | `extract_filter.py` | Trims input to financial sections | Only `parse_scope=core` |

A user processing a 200-page 10-K with `core` scope: classifier passes, cache miss, page filter drops 60 pages (140 sent to ADE), extract filter trims markdown to ~40k chars. Saves roughly 30% on ADE Parse + 70% on ADE Extract.

### 4.5 Chat surface

This is the area we spent most engineering effort on. The chat must:

1. **Retrieve** the most relevant chunks for a question.
2. **Generate** an answer that quotes them.
3. **Cite** every value with a chip the user can click.
4. **Refuse** when the document doesn't contain an answer (no fabrication).

#### 4.5.1 Retrieval

```
   ┌──────────────┐
   │  User asks   │   e.g. "what was revenue in 2024?"
   │  a question  │
   └──────┬───────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │  SYNONYM EXPANSION               │   revenue → revenue, sales,
   │  Adds aliases from section       │             turnover, net sales
   │  buckets to the query            │
   └──────┬───────────────────────────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │  EMBED                           │   OpenAI text-embedding-3-small
   │  text → 1536-dim vector          │   (1 round-trip, ~150 ms)
   └──────┬───────────────────────────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │  QDRANT SEARCH                   │   filter user_id + doc_id (indexed)
   │  cosine similarity, top-15       │   payload returned with each hit
   └──────┬───────────────────────────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │  SECTION RERANK                  │   boost chunks whose section_header
   │  bucket-aware score boost        │   matches the question's bucket
   └──────┬───────────────────────────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │  Top-10 chunks → LLM context     │   ranked, deduplicated
   └──────────────────────────────────┘
```

- **Synonym expansion** — financial vocabulary varies across filings ("turnover" vs "revenue" vs "net sales"). The query is expanded with section-bucket aliases before embedding so a "revenue" question retrieves "sales" chunks.
- **Qdrant search** — embedding similarity, top-15.
- **Section rerank** — chunks whose `section_header` matches the question's detected bucket (e.g. "cash flow") get a score boost. This corrects for cases where embedding alone ranks a marginal off-topic chunk above an on-topic one.

The top-10 chunks become the LLM's context window.

#### 4.5.2 System prompt structure

The chat system prompt classifies the user's question into one of **9 types** ([`backend/app.py:3974`](../backend/app.py)):

| # | Type | Trigger words | Behaviour |
|---|---|---|---|
| 1 | DOCUMENT-LEVEL SYNTHESIS | "summary", "overview", "what is this document about" | 5-8 bullets of material figures |
| 2 | TOPIC LOOKUP | "what is X", "how much is Y" | Direct value with citation |
| 3 | SECTION SUMMARY | "summary of cash flow", "balance sheet overview" | 5-8 bullets of line items in that section |
| 4 | COMPARISON | "compare X vs Y", "YoY change" | Both values + delta in a small table |
| 5 | ANALYTICAL DECOMPOSITION | "why did X change", "what drove" | Walk through contributing components |
| 6 | REFINEMENT | "concise", "expand", "rewrite as table" | Modify the previous answer |
| 7 | PREDICTIVE | "forecast", "what if" | State that the document is historical; offer the trend |
| 8a | READ EXISTING FIGURE/CHART | "what does the chart show", "describe Figure N" | Read the figure chunk and quote its parsed data |
| 8b | GENERATE NEW CHART | "draw me a graph of X" | Decline (no rendering); provide data table |
| 9 | OFF-TOPIC | non-document questions | Decline with doc facts |

On top of these, the prompt has three **non-negotiable rules**:

- **Rule 0 — Grounding** (the anti-hallucination directive): every numeric value, percentage, date, and proper noun must appear verbatim in the retrieved context. Inventing a number is the worst failure of the system. If a value isn't in context, refuse for that value.
- **Strict attribution** — only cite cells/chunks that literally contain the value the model wrote. Don't cite a number from the assets side for a liabilities question even if it happens to match.
- **Synonym equivalence** — treat "revenue ≡ sales ≡ turnover", "net income ≡ profit for the year", etc. as the same concept so the model uses the document's exact term.

#### 4.5.3 Citation pipeline (V2.6 — five layers)

This is the most engineering-intensive subsystem. The user clicks a chip and lands on the exact source — but the chips have to be *correct*. The pipeline is layered defence-in-depth.

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  L1  ·  Bbox guard at ingest                                     │
   │       worker.py — reject malformed/empty boxes before Qdrant      │
   │       overlay endpoint filters any residue                       │
   └──────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  L2  ·  System Prompt                                            │
   │       Rule 0 — grounding (no invention)                          │
   │       Strict attribution (cell row label must be on-topic)        │
   │       Rule 8a — read existing figures as authoritative           │
   └──────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │   LLM streams answer with  [[chunk_id | label]]  markers          │
   └──────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  L3  ·  _find_all_matching_cells (citation matcher)              │
   │                                                                  │
   │   Phase 1   ─  value-match against scoped cells                   │
   │            ├─ header gate  (drop column headers / year-only)     │
   │            ├─ row-label gate  (token overlap with Q or A)        │
   │            ├─ polarity gate  (assets vs liabilities vs equity)   │
   │            └─ substring length guard (±1 char)                   │
   │                                                                  │
   │   Phase 1.5 ─ admit LLM-cited NON-CELL chunks (figure / text)    │
   │             (runs ALWAYS, not as fallback)                       │
   │                                                                  │
   │   Phase 2   ─ LLM-cited cells (fallback if Phase 1 empty)        │
   │             same gate stack — symmetric with Phase 1             │
   └──────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  L4  ·  Post-generation Grounding Verifier                       │
   │       Every cell chip's value MUST appear (normalised) in the    │
   │       final answer prose, or the chip is dropped.                │
   │       Last line of defence against false positives.              │
   └──────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  L5  ·  Frontend chip resolver                                   │
   │       Builds label (row · group · year → value)                  │
   │       Colour-codes by chunk_type — matches DocViewer palette     │
   │           table  → blue    #2193FD                               │
   │           figure → magenta #FF5CFF                               │
   │           text   → green   #32D583                               │
   └──────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  Visual reference chips render below the answer                  │
   │  Click chip  →  DocViewer scrolls + highlights same-colour box    │
   └──────────────────────────────────────────────────────────────────┘
```

Each layer has a specific job:

**L1 — Bbox guard.** Stops malformed/empty boxes from entering Qdrant. Without this, the viewer renders invisible ghost rectangles.

**L2 — Prompt.** Hard rules that make the model refuse to invent numbers. New "READ EXISTING FIGURE" rule so chart questions read parsed chart data instead of declining.

**L3 — Citation matcher.** When the LLM streams its answer, citation markers (`[[cell_id|label]]`) are extracted. The matcher then resolves them through:

- **Phase 1** — for each extracted number in the answer, scan all cells in scope; score by exact / contained value match. Apply gates:
  - **Header gate** — drop cells that are themselves column/row headers (year-only cells, "Presented in EUR" titles).
  - **Row-label gate** — the cell's row label must share at least one token with the question or the answer.
  - **Polarity gate** — assets-vs-liabilities-vs-equity discrimination. A "current liabilities" question rejects any cell whose row label or section reads as an asset.
  - **Substring length guard** — `$48,420` doesn't match `$498,420` even though the digits overlap; cell length must be ≤1 char longer than the value.

- **Phase 1.5** — admit LLM-cited *non-cell* chunks (figures, text) unconditionally. These don't have a single value to match against, so they take a different path. Polarity gate still applies. Runs in parallel with Phase 1 — not as a fallback.

- **Phase 2** — for cells: if Phase 1 returned nothing, fall back to the LLM's `[[id]]` markers. Same gate stack as Phase 1 (this used to be the asymmetric leak: cited cells were accepted without row-label or polarity checks).

**L4 — Grounding verifier.** Last seatbelt. After chips are built, walk through them: every cell-shaped chip's normalised value must appear in the set of values extracted from the final answer prose. If it doesn't, drop the chip. Catches false positives that slipped through earlier gates.

**L5 — Chip resolver (frontend).** Builds the chip label from the chunk's cross-cell context (row label, group header, year). Colour-codes by `chunk_type`:

| chunk_type | Accent | Glyph | Matches DocViewer overlay |
|---|---|---|---|
| `table` / `table_cell` | `#2193FD` blue | `T` | `overlay-box--table` |
| `figure` | `#FF5CFF` magenta | `F` | `overlay-box--figure` |
| `text` / other | `#32D583` green | `¶` | `overlay-box--text` |

Result: when the user clicks a magenta chip, the highlighted region in the PDF viewer is also magenta. Visual unity.

#### 4.5.4 Example end-to-end

User uploads BSTDB 2022 audited financials, asks **"tell me about borrowings"**:

1. Retrieval picks up chunks from page 9 (statement of financial position — `Borrowings 1,915,655`), page 11 (cash flows — `Proceeds from borrowings 326,811`), page 44, 45 (notes — currency and maturity breakdown).
2. LLM generates: *"As of 31 December 2022, the Bank had total borrowings of EUR 1,915,655 thousand [[0-12|Borrowings 2022]]..."*
3. Phase 1 matches `1,915,655` to cell `0-12` on page 9. Polarity check: question polarity = liabilities, cell row label = "Borrowings" → polarity = liabilities. Pass.
4. Phase 1 attempts to match other extracted values (`326,811`, etc.) to other cells.
5. Phase 1.5 admits any LLM-cited figure/text chunks (none in this case).
6. Phase 2 is skipped because Phase 1 found cells.
7. L4 verifies: each chip's cell value (`1,915,655`, `326,811`, etc.) appears in the answer.
8. Frontend renders 4-6 blue chips. User clicks the first → DocViewer scrolls to page 9 and draws a blue overlay on the cell.

### 4.6 Document viewer

The right pane is a PDF viewer (pdfjs-dist) with overlay rectangles on each chunk. Click a chunk → highlight + show its label. Click a chat chip → same highlight, scrolled into view. The viewer is page-virtualised so 200-page documents stay smooth.

### 4.7 Finance-analyst Agent (V2.7)

The V2.6 chat (§4.5) is a single-LLM-call architecture: retrieve chunks, hand them to GPT, stream the answer, gate the citations. It works well for direct questions. It struggled with analyst-grade reasoning: *"why did income drop?"*, *"how do I improve interest margin?"*, *"what should I worry about in this filing?"* — questions where the value comes from cross-statement linking, ratio computation, and forensic pattern detection that no amount of retrieval will produce on its own.

V2.7 replaces the single-call architecture with a **tool-calling agent**. Same chat endpoint, same chip UI, same DocViewer click-through. What changes is *how* the model arrives at the answer — it now investigates.

#### 4.7.1 Architecture

```
   ┌────────────────────────────────────────────────────────────────┐
   │                  FINANCE-ANALYST AGENT (one LLM)               │
   │                                                                │
   │  prompt = CFA-grade reasoning rules                            │
   │           + cross-statement reflexes                           │
   │           + recovery ladder                                    │
   │                                                                │
   │  can call any of 9 tools as many times as needed (max 6 rounds)│
   └────────────────────────────────┬───────────────────────────────┘
                                    │
        ┌──────────────┬─────────────┼──────────────┬───────────┐
        ▼              ▼             ▼              ▼           ▼
   ┌─────────┐  ┌────────────┐  ┌─────────┐  ┌────────────┐  ┌──────────┐
   │ lookup_ │  │get_section │  │list/read│  │ compute_   │  │ compare_ │
   │ value   │  │            │  │ figure  │  │ ratio      │  │ periods  │
   └─────────┘  └────────────┘  └─────────┘  └────────────┘  └──────────┘
                                                                       
        ┌──────────────┬──────────────┬──────────────┐                
        ▼              ▼              ▼              ▼                
   ┌──────────┐  ┌────────────┐  ┌──────────┐                       
   │decompose_│  │detect_red_ │  │ query_   │                       
   │ change   │  │ flags      │  │ freeform │                       
   └──────────┘  └────────────┘  └──────────┘                       
```

Behind a feature flag (`ANALYZER_AGENT_ENABLED`). When off, the V2.6 single-call path runs unchanged. When on, the chat endpoint routes through `backend/analyzer_agent/`.

#### 4.7.2 Why a single agent with tools, not multiple specialists

A natural design alternative is multiple specialist agents — one for profitability, one for liquidity, one for red flags — orchestrated together. We deliberately chose **single agent + tools** for V2.7 because:

| Multi-agent | Single agent + tools |
|---|---|
| 3–5x latency (sequential agent calls) | 1 agent, parallel tool calls per round |
| 3–5x cost (more LLM calls) | 1 LLM, only the tool dispatch budget |
| Coherence problem (specialists can disagree) | One model, one voice |
| Citation reconciliation between agents | Tools emit citations; agent aggregates |

Specialists become worth it only if the single-agent approach demonstrably caps out on quality. V2.7 ships the foundation; specialists are a measured future investment.

#### 4.7.3 The 9 tools

Every tool consumes a Pydantic args model and returns a `ToolResult { ok, summary, payload, citations, latency_ms }`. Citations bubble all the way up to the chip UI.

| # | Tool | Purpose | Citation source |
|---|---|---|---|
| 1 | `lookup_value(line_item, period)` | Single cell with synonym resolution + specificity-tier disambiguation | 1 cell |
| 2 | `get_section(name)` | Whole section's content; section-name alias map ("balance sheet" → SOFP) | N cells |
| 3 | `list_figures()` | Enumerate every parsed chart in the doc | — |
| 4 | `read_figure(query)` | Get figure content by id, "Figure N", or semantic phrase | 1 figure chunk |
| 5 | `compute_ratio(name, period)` | 14 standard ratios built from underlying cells (current, quick, D/E, ROE, ICR, etc.) | The numerator + denominator cells |
| 6 | `compare_periods(line_item, period_a, period_b)` | YoY/QoQ with absolute + percent delta; picks the exact-period match deterministically | Both cells |
| 7 | `decompose_change(parent_line_item, period_a, period_b)` | Rank sibling line items in the same section by absolute contribution to the parent's delta | All contributors |
| 8 | `detect_red_flags(category)` | 8 forensic checks: accrual divergence, AR-vs-revenue, goodwill concentration, negative working capital, going-concern language, material weakness, restatement, related-party, off-balance-sheet | Cells/chunks that triggered each flag |
| 9 | `query_freeform(question, top_k)` | Keyword retrieval safety net over all loaded chunks. Used when structured tools come up empty | Top-K chunks |

#### 4.7.4 The orchestrator loop

```
   ┌─────────────────────────────────────────────┐
   │  User question arrives via /chat            │
   └──────────────────┬──────────────────────────┘
                      │
                      ▼
   ┌─────────────────────────────────────────────┐
   │ Build DocContext (one-time per turn):       │
   │  cell_lookup, grounding, qdrant chunks,     │
   │  table grids, section map, doc metadata     │
   │  (reuses the prep already done by §4.5)     │
   └──────────────────┬──────────────────────────┘
                      │
                      ▼
   ┌─────────────────────────────────────────────┐
   │ Compose system prompt:                      │
   │   ANALYST_PERSONA + KNOWN_DOC_FACTS         │
   │   + REASONING_RULES (10 rules + Recovery)   │
   │   + TOOL_PROTOCOL + CITATION_RULES          │
   └──────────────────┬──────────────────────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │      TOOL LOOP              │  ◀──────────────────┐
        │   round = 0 .. 5            │                     │
        │   wall budget 20s, 6 rounds │                     │
        └──────────────┬──────────────┘                     │
                       ▼                                    │
   ┌─────────────────────────────────────────────┐         │
   │  OpenAI gpt-4o  with tools = get_tool_specs │         │
   │  (Pydantic args schemas → OpenAI JSON)      │         │
   └──────────────────┬──────────────────────────┘         │
                      │                                    │
              ┌───────▼────────┐                           │
              │ tool_calls in  │                           │
              │ assistant msg? │                           │
              └───────┬────────┘                           │
                      │                                    │
            ┌─────────┴──────────┐                         │
            │ YES                │ NO (final answer)       │
            ▼                    │                         │
   ┌────────────────┐            │                         │
   │ Execute tools  │            │                         │
   │ in PARALLEL    │            │                         │
   │ (asyncio.      │            │                         │
   │  gather)       │            │                         │
   └───────┬────────┘            │                         │
           ▼                     │                         │
   ┌────────────────┐            │                         │
   │ Aggregate &    │            │                         │
   │ dedupe         │            │                         │
   │ citations.     │            │                         │
   │ Stream SSE     │            │                         │
   │ 'tool' event   │            │                         │
   │ to UI.         │            │                         │
   │ Append tool    │            │                         │
   │ results to     │            │                         │
   │ messages.      ├───────────────────────────────────────┘
   └────────────────┘            │
                                 ▼
                       ┌─────────────────────┐
                       │ Stream final answer │
                       │ deltas via SSE.     │
                       │ Emit aggregated     │
                       │ chip payload.       │
                       │ Persist to          │
                       │ analyzer_messages.  │
                       └─────────────────────┘
```

Parallel tool execution per round means a question like *"compare revenue 2024 vs 2023 and net income vs 2023"* fires both `compare_periods` calls in one `asyncio.gather` — total latency = max(call_a, call_b), not call_a + call_b.

#### 4.7.5 The system prompt — what makes it analyst-grade, not generic

The prompt is the largest single artefact determining behaviour. It lives in [backend/analyzer_agent/prompt.py](../backend/analyzer_agent/prompt.py) as a separately diff-reviewable file. Five sections, each with a specific job:

| Section | Job |
|---|---|
| **Persona** | "Senior financial analyst, CFA charterholder, 12 years sell-side experience." Sets the voice — not a chatbot persona, an analyst brief. |
| **Reasoning rules (10)** | Concrete behaviours a generic GPT skips: ground every adjective in a number, cross-statement reflexes (NI → OCF, revenue → AR), required decomposition before conclusions, banned consultant-speak with bad/good examples, mandatory arithmetic. Plus Rule 11 (Recovery): never give up on the first empty tool — try synonyms, alternative tools, then `query_freeform`. |
| **Tool protocol** | When to call what. Concrete patterns: "call `list_figures` FIRST on anything that could be chart-related; don't claim 'no chart' without `read_figure`." Parallel-call guidance. |
| **Citation rules** | Strict attribution. One id per `[[ ]]` block (no stacking — the parser handles it, but the prompt discourages it). Cite at the level the answer claims things. |
| **Formatting** | Markdown, tables for ≥3 numbers, no greeting, start with the answer. |

A representative example from the reasoning rules:

```
7. NO CONSULTANT-SPEAK.
   Phrases like "consider deleveraging", "focus on operational
   efficiency", "improve cost controls", "enhance shareholder value"
   are BANNED unless paired with the specific line item, the
   specific amount, and the specific year you're referring to.
       Bad:  "Focus on cost control to improve margins."
       Good: "Operating expenses grew 14% YoY to $1.42B while
              revenue grew only 6% — the gap was driven primarily
              by SG&A ($612m → $698m, +14%) and R&D ($289m → $341m,
              +18%). At the 2024 SG&A/revenue ratio of 12.8%,
              recovery to that level would save ~$72m annually."
```

#### 4.7.6 Disambiguation — the specificity-tier system

A doc often has multiple rows whose labels overlap. BSTDB 2022 has both `Net interest income` (canonical, EUR 96,635) and `Net interest income (expense) on derivatives` (a sub-line, EUR 4,388). A naive substring match returns both; downstream tools pick iteration-order indices and report wrong numbers.

`lookup_value` ranks candidate rows by specificity:

```
   tier 0   row label EXACTLY equals an alias from the canonical bucket
   tier 1   row label EXACTLY equals the user's query string
   tier 2   row label has 0 extra tokens beyond the matched alias
   tier 3   row label has ≥1 extra token (a more-specific sub-line)
```

Only the **best tier present** is returned. `lookup_value("net interest income")` against BSTDB resolves to the canonical row (tier 0) and excludes the derivatives elaboration (tier 3). Cleaner than score-and-rank because the tiers are interpretable: an analyst can tell at a glance why one row beat another.

#### 4.7.7 Recovery ladder — never give up on the first empty tool

Documents label the same content differently — *"Balance Sheet"* vs *"Statement of Financial Position"* vs *"Consolidated Balance Sheet"*. Without explicit recovery instructions the LLM follows the path of least resistance: call one tool, get empty, refuse with "the document does not contain a balance sheet" — *while the document IS a balance sheet, just under a different label*.

Rule 11 in the prompt makes the failure-recovery ladder mandatory:

```
   (a) Re-call the SAME tool with a synonym
       e.g. get_section('balance sheet') empty →
            get_section('financial position'), get_section('assets')

   (b) Try a DIFFERENT tool from another angle
       e.g. for an asset overview →
            get_section('balance sheet')  OR
            lookup_value('total assets')  OR
            query_freeform('breakdown of assets')

   (c) Call query_freeform(question) as the LAST resort
```

Backed by an alias map (`_SECTION_ALIASES`) parallel to the line-item synonym table — six buckets (`balance_sheet`, `income_statement`, `cash_flow`, `comprehensive_income`, `changes_in_equity`, `notes`) each listing every surface form a doc might use.

#### 4.7.8 Red-flag detection — the forensic checks

`detect_red_flags` is a small framework, not a fixed list. Each check is its own function so failures stay isolated and the list is trivially extensible. Categories shipped:

| Category | Check |
|---|---|
| `earnings_quality` | Net income / OCF sign divergence (Sloan accruals) |
| `earnings_quality` | AR growth outpacing revenue growth (5pp threshold; Beneish DSRI cousin) |
| `balance_sheet_quality` | Goodwill > 20% of total assets |
| `liquidity_risk` | Negative working capital |
| `audit_signals` (text-pattern scan) | Going-concern language ("substantial doubt", "material uncertainty") |
| `audit_signals` | Material weakness in internal controls |
| `audit_signals` | Restatement of prior financials |
| `balance_sheet_quality` | Related-party transactions |
| `balance_sheet_quality` | Off-balance-sheet arrangements |
| `earnings_quality` | Non-recurring / one-time gain language |

Each triggered flag carries: name, severity (high / medium / low), explanation, measurements dict, and citations to the cells/chunks that triggered it.

#### 4.7.9 Citation flow — same chip UI as V2.6

Tools emit `CitationRef` objects, the orchestrator aggregates them, dedupes by `chunk_id`, and emits one `sources` SSE event at the end of the turn. The frontend chip renderer doesn't know whether the chunks came from V2.6's grounded-cell matcher or V2.7's tool-call results — same `chunk_id`, `chunk_type`, `page`, `bbox`, `llm_label`. Same colour palette (blue table / magenta figure / green text). Same click-to-DocViewer slide.

The difference is structural: in V2.6, citations are extracted from `[[id|label]]` markers the LLM emits *in the answer prose*, validated through a 5-layer pipeline (bbox guard → prompt rules → symmetric gates → grounding verifier → chip resolver). In V2.7, citations come *from tool results* — a tool physically cannot emit a chip for a cell it didn't fetch. The grounding guarantee is structural, not policed after the fact.

#### 4.7.10 Code layout

```
   backend/analyzer_agent/
   ├─ __init__.py             public surface: handle_chat_turn, build_doc_context
   ├─ prompt.py               ANALYST_PERSONA + 11 reasoning rules + tool protocol
   ├─ schemas.py              Pydantic args + ToolResult + CitationRef
   ├─ orchestrator.py         tool-calling loop, budgets, SSE streaming
   ├─ tools.py                all 9 tool implementations (single file by design;
   │                          ~1700 lines, tight & cross-referenced)
   └─ tests/
      ├─ __init__.py
      └─ smoke_20_prompts.py  20 diverse questions × BSTDB-2022 fixture
```

`backend/app.py` route handler gets one feature-flagged branch that calls `handle_chat_turn`. Nothing else changes — same chat endpoint, same persistence, same SSE contract.

#### 4.7.11 Budgets

| Budget | Default | Why |
|---|---|---|
| Tool rounds per turn | 6 | Enough for complex multi-step Qs; caps runaway loops |
| Wall-clock per turn | 20 s | User-perceptible threshold; force final synthesis if exceeded |
| Max tokens per LLM call | 4 096 | Tool dispatch is short; final answer is bounded |
| Parallel tool calls per round | unbounded | `asyncio.gather` over all calls in one round |

Cost vs V2.6 (estimated):

| Question shape | V2.6 LLM calls | V2.7 LLM calls | V2.7 cost multiplier |
|---|---|---|---|
| Simple lookup | 1 | 1–2 | ~1.2× |
| Section summary | 1 | 2 | ~1.5× |
| YoY comparison | 1 | 2–3 | ~2× |
| Deep analysis ("why did X drop?") | 1 | 4–5 | ~3× |

Mitigations: gpt-4o is used for both tool dispatch and synthesis (no need to route to mini for the dispatch step at our scale); the doc-facts prefix and tool descriptions are stable per doc, so OpenAI's prompt cache (≥1024-token prefix match) reuses the system block across turns within ~5 minutes — typically halving input-token cost after the first turn.

#### 4.7.12 Test coverage

| Test | Scope | Runtime |
|---|---|---|
| `test_chat_invariants.py` (33 tests, 30 subtests) | V2.6 contract still passes — guarantee that the new agent doesn't regress the existing chat | ~5 s |
| `smoke_20_prompts.py` | 20 diverse questions × BSTDB 2022 fixture × all 9 tools; deterministic, no OpenAI/Qdrant required; 20/20 pass | ~50 ms |

The smoke test is the gate of choice for any future change to the agent — it covers every tool category, the alias-resolution failure modes (the "tell me about the assets" case), the disambiguation tier system (canonical net interest income vs derivatives elaboration), and graceful failure (current ratio when the line item is absent).

---

## 5. Reports

### 5.1 What reports do

The user picks a document and a template. The system generates a multi-section analyst write-up — typically 7 sections, 3000 words — streaming each section in parallel. The user can regenerate any section, see version history, restore an earlier draft, and finally export the whole thing as a styled PDF.

### 5.2 Template system

Two kinds of templates:

**Built-in** ([`report_templates.py`](../backend/report_templates.py)) — code-defined dicts:

| Template | Sections | Word target |
|---|---|---|
| Full Analysis | 7 (Executive, Performance, Balance, Cash Flow, Ratios, Red Flags, Conclusion) | ~3000 |
| Executive Brief | 3 (Summary, Metrics, Conclusion) | ~800 |
| Risk Report | 4 (Summary, Liquidity, Red Flags, Conclusion) | ~1500 |
| Investor Memo | 5 (Summary, Performance, Growth, Risks, Outlook) | ~2000 |

**Custom** ([`report_templates_custom`](../supabase/migrations/) table) — user-defined. Each section: `{id, title, system_prompt, word_target, rag_query, rag_top_k, model}`. JSONB in Postgres.

### 5.3 Per-section generation pipeline

```
   ┌──────────────────────────────────────────────┐
   │  POST /api/documents/{doc_id}/report         │
   │  body: { template: 'full_analysis' OR uuid } │
   └──────────────────────┬───────────────────────┘
                          │
                          ▼
   ┌──────────────────────────────────────────────┐
   │  _resolve_template(template, user_id)        │
   │   built-in  →  TEMPLATES dict                │
   │   custom    →  load from Postgres            │
   │  returns: (template_id, [section_ids],       │
   │           {section_id: config_map})          │
   └──────────────────────┬───────────────────────┘
                          │
                          ▼
   ┌──────────────────────────────────────────────┐
   │  asyncio.Semaphore(3)  ·  fan-out             │
   │  one async task per section                  │
   └─┬──────────────┬──────────────┬──────────────┘
     │              │              │
     ▼              ▼              ▼
  ┌──────┐      ┌──────┐      ┌──────┐
  │ S₁   │      │ S₂   │      │ S₃   │   ... up to 7 sections
  │ Exec │      │ Exec │      │ Exec │
  │ Sum  │      │ Perf │      │ Bal  │
  └──┬───┘      └──┬───┘      └──┬───┘
     │             │             │
     └─────────────┴─────────────┘
                   │
                   │  Each task runs:
                   │
                   ▼
   ┌──────────────────────────────────────────────┐
   │  PER-SECTION TASK                            │
   │                                              │
   │   1. Per-section RAG                         │
   │      synonym expand + Qdrant + section       │
   │      rerank · top-K from section's config    │
   │                                              │
   │   2. Build section extract                   │
   │      structured-data subset for this section │
   │                                              │
   │   3. Compose system prompt                   │
   │      shared doc_facts prefix  →  OpenAI      │
   │      prompt-cache hit on sections 2..N       │
   │                                              │
   │   4. OpenAI streaming                        │
   │      model = fast (gpt-4o-mini) OR           │
   │              smart (gpt-4o) per config       │
   │      yield tokens → SSE delta events         │
   │                                              │
   │   5. Silent capture                          │
   │      INSERT report_versions row              │
   │      INSERT report_sources rows (per chunk)  │
   └──────────────────────┬───────────────────────┘
                          │
                          ▼
   ┌──────────────────────────────────────────────┐
   │  SSE  →  frontend, keyed by section_id       │
   │  multiple sections may stream concurrently   │
   └──────────────────────┬───────────────────────┘
                          │
                          ▼
   ┌──────────────────────────────────────────────┐
   │  UPDATE reports SET                          │
   │    status = 'complete',                      │
   │    word_count = SUM(...)                     │
   └──────────────────────────────────────────────┘
```

Key details:

- **Parallel** — three sections generate concurrently (`asyncio.Semaphore(3)`). Faster wall-clock than sequential.
- **Shared system prefix** — every section's prompt starts with the same `KNOWN DOCUMENT FACTS` + per-section rules block. OpenAI's prompt cache (>1024-token prefix match) kicks in, slashing cost by ~70% on repeated calls.
- **Model routing** — each section's config picks `fast` (gpt-4o-mini, structural sections like metrics) or `smart` (gpt-4o, analytical sections like Conclusion). Saves cost without quality loss on the easy sections.
- **SSE streaming** — each section's tokens stream to the frontend in real time, keyed by `section_id`. The UI shows multiple sections "Generating…" in parallel.

### 5.4 Audit trail (versions + sources)

Every section generation silently writes to two tables:

- **`report_versions`** — `(report_id, section_id, content, model, tokens_in, tokens_out, created_at)`. Append-only. Lets the user see history and restore a prior version.
- **`report_sources`** — `(report_id, section_id, chunk_id, page, section_header)`. One row per chunk that fed the section. The UI renders a "Sources" footer below each section with clickable page numbers that jump to the Analyzer.

On regeneration, the prior `report_sources` rows for that section are dropped and replaced; `report_versions` is append-only.

### 5.5 PDF export

```
   USER      FRONTEND        BACKEND        ARQ QUEUE     WORKER+CHROMIUM     STORAGE
   ────      ────────        ───────        ─────────     ────────────────    ───────
    │           │                │               │                │              │
    │  click    │                │               │                │              │
    │ Export PDF│                │               │                │              │
    ├──────────▶│                │               │                │              │
    │           │  POST /render- │               │                │              │
    │           │     pdf        │               │                │              │
    │           ├───────────────▶│               │                │              │
    │           │                │ set status=   │                │              │
    │           │                │   'queued'    │                │              │
    │           │                ├──────────────────────────────────────────────▶│
    │           │                │ enqueue job   │                │              │
    │           │                ├──────────────▶│                │              │
    │           │  202 {queued}  │               │                │              │
    │           │◀───────────────┤               │                │              │
    │           │                │               │ pop job        │              │
    │           │                │               ├───────────────▶│              │
    │           │ poll /pdf-     │               │                │ status=      │
    │           │ status (2s)    │               │                │ 'rendering'  │
    │           ├───────────────▶│               │                ├─────────────▶│
    │           │ 'rendering'    │               │                │              │
    │           │◀───────────────┤               │                │              │
    │           │                │               │                │ load report  │
    │           │                │               │                │ + doc        │
    │           │                │               │                │◀─────────────┤
    │           │                │               │                │ render Jinja │
    │           │                │                                │ → HTML       │
    │           │                │                                │              │
    │           │                │                                │ PdfRenderer  │
    │           │                │                                │ Chromium,    │
    │           │                │                                │ network-     │
    │           │                │                                │ blocked,     │
    │           │                │                                │ → pdf bytes  │
    │           │                │                                │              │
    │           │                │                                │ upload PDF   │
    │           │                │                                │ {user}/      │
    │           │                │                                │ reports/{id} │
    │           │                │                                ├─────────────▶│
    │           │                │                                │ status=      │
    │           │                │                                │ 'ready' +    │
    │           │                │                                │ pdf_url      │
    │           │                │                                ├─────────────▶│
    │           │ poll /pdf-     │                                │              │
    │           │ status         │                                │              │
    │           ├───────────────▶│                                │              │
    │           │ 'ready'        │                                │              │
    │           │◀───────────────┤                                │              │
    │           │ GET /pdf-url   │                                │              │
    │           ├───────────────▶│                                │              │
    │           │                │ generate signed URL            │              │
    │           │                │ (10-min TTL)                   │              │
    │           │                ├───────────────────────────────────────────────▶
    │           │ {url}          │                                │              │
    │           │◀───────────────┤                                │              │
    │ download  │                │                                │              │
    │ triggered │                │                                │              │
    │◀──────────┤                │                                │              │
```

**Why a worker, not the web container:**
- Chromium is ~300 MB. Putting it in the web image bloats every deploy and increases attack surface.
- The worker image (`Dockerfile.worker`) has Chromium via `playwright install --with-deps chromium`. Web image (`Dockerfile.web`) doesn't.

**Why network-blocked:**
- The PDF renderer is `await page.route("**/*", lambda route, request: route.abort())` — Chromium can't fetch a single byte from outside. All assets (fonts, logo) are inlined as base64. This prevents any external tracker or stylesheet from sneaking into a customer's PDF.

**Cold vs warm:** First render after worker boot ≈ 1.5 s (Chromium starts). Subsequent renders < 500 ms (browser persists, fresh `BrowserContext` per request).

---

## 6. FinBot

### 6.1 What FinBot does

A general financial-markets assistant. Unlike the Analyzer (one-doc-at-a-time), FinBot is conversational and can:

- Look up live stock quotes, fundamentals, news, dividends
- Compute portfolio P&L from the user's saved holdings
- Compare tickers side-by-side
- Read macro indicators (Fed funds, CPI, unemployment, 10Y)
- Read insider trades
- And — critically — **reference the user's own uploaded documents** through the same Qdrant store the Analyzer uses

### 6.2 Two-panel layout

```
┌─────────────────────────┬───────────────────────────────────────────┐
│                         │                                           │
│   📰  NEWS SIDEBAR      │   💬  CHAT                                │
│   (300 px)              │   (flex)                                  │
│                         │                                           │
│   - Carousel: 6 articles│   topbar: Portfolio · Watchlist · Pin     │
│     rotate every 6s     │                                           │
│   - Breaking: 5 articles│   message list                            │
│   - Refresh 5 min       │                                           │
│                         │   input + tool-call indicators            │
│                         │                                           │
└─────────────────────────┴───────────────────────────────────────────┘
```

News is aggregated from `yfinance`'s `.news` for 8 market tickers (SPY, AAPL, NVDA, TSLA, MSFT, AMZN, META, GOOGL) via the backend `/api/finbot/news` endpoint.

### 6.3 Agent loop

FinBot uses the OpenAI **tool-use** (function-calling) API. The model decides which tool(s) to call to answer the user; the backend executes them; the model continues with the results.

```
   ┌─────────────────────────────────────────┐
   │  User message arrives in conversation   │
   └────────────────────┬────────────────────┘
                        │
                        ▼
   ┌─────────────────────────────────────────┐
   │  Build messages array:                  │
   │    [system_prompt]                      │
   │  + [last 8 history turns]               │
   │  + [user message]                       │
   └────────────────────┬────────────────────┘
                        │
                        ▼
            ┌─────────────────────┐
            │  TOOL LOOP          │  ◀───────────────────┐
            │  round = 0..7       │                      │
            │  (max 8 rounds)     │                      │
            └──────────┬──────────┘                      │
                       │                                 │
                       ▼                                 │
   ┌─────────────────────────────────────────┐           │
   │  OpenAI gpt-4o-mini                     │           │
   │  with  tools = TOOLS  (16 schemas)      │           │
   └────────────────────┬────────────────────┘           │
                        │                                │
                  ┌─────▼─────┐                          │
                  │ tool call │                          │
                  │ in reply? │                          │
                  └─────┬─────┘                          │
                        │                                │
              ┌─────────┴─────────┐                      │
              │ YES               │ NO                   │
              ▼                   │                      │
   ┌────────────────────┐         │                      │
   │ Look up function   │         │                      │
   │ in TOOL_MAP        │         │                      │
   │ Inject user_id if  │         │                      │
   │ USER_CONTEXT_TOOLS │         │                      │
   └─────────┬──────────┘         │                      │
             ▼                    │                      │
   ┌────────────────────┐         │                      │
   │ asyncio.to_thread( │         │                      │
   │  fn, **args)       │         │                      │
   └─────────┬──────────┘         │                      │
             ▼                    │                      │
   ┌────────────────────┐         │                      │
   │ SSE: type='tool',  │         │                      │
   │  name, args        │         │                      │
   └─────────┬──────────┘         │                      │
             ▼                    │                      │
   ┌────────────────────┐         │                      │
   │ Append tool result │         │                      │
   │ to messages        ├─────────────────────────────────┘
   └────────────────────┘         │                      
                                  ▼                      
                       ┌─────────────────────┐
                       │  Final answer       │
                       │  Stream delta SSE   │
                       └──────────┬──────────┘
                                  ▼
                       ┌─────────────────────┐
                       │  Persist user +     │
                       │  assistant message  │
                       │  to finbot_messages │
                       └─────────────────────┘
```

Hard cap: 8 tool rounds per turn. Prevents runaway loops if the model gets confused.

### 6.4 Tool catalog

16 tools available to the agent ([`backend/finbot.py:826-1097`](../backend/finbot.py)):

| Tool | Provider | Purpose |
|---|---|---|
| `get_quote` | yfinance | Live price, change, volume, market cap |
| `get_fundamentals` | yfinance | P/E, EPS, margins, ROE, beta, dividend yield |
| `get_price_history` | yfinance | OHLCV + 1d–5y performance |
| `get_news` | yfinance | Recent headlines for a ticker |
| `compare_stocks` | yfinance | Side-by-side metrics for 2-5 tickers |
| `get_portfolio_pnl` | yfinance + DB | Live P&L on user's saved holdings |
| `add_to_watchlist` | DB | Save ticker + optional alert thresholds |
| `get_earnings_calendar` | yfinance | Next earnings date + estimates |
| `get_dividends` | yfinance | Yield, payout ratio, last 5 payments |
| `get_insider_trades` | Finnhub | Recent insider transactions |
| `get_macro_indicators` | FRED | Fed funds, CPI, unemployment, 10Y yield |
| `get_technical_indicators` | yfinance | RSI, MACD, SMA50/200, EMA20 |
| `get_options_chain` | yfinance | Calls + puts near-the-money |
| `list_user_documents` | Postgres | List the user's completed Analyzer docs |
| `query_user_document` | Qdrant + OpenAI | RAG-search inside one of the user's docs |
| `render_chart` | (frontend hint) | Build price-line chart spec for UI |

Some tools require user context (`get_portfolio_pnl`, `add_to_watchlist`, `list_user_documents`, `query_user_document`). The backend automatically injects `user_id` for those before calling — the LLM never sees user IDs.

### 6.5 Active-doc enrichment

A user can **pin a document** to a FinBot conversation. The `finbot_conversations` table has an `active_doc_id` column. When set:

- The system prompt is enriched with the doc's top-line financials (income statement, balance sheet, cash flow, key metrics) extracted from `documents.extract_data`.
- FinBot can answer "what's revenue trend for the company in my pinned doc?" without first calling `list_user_documents` and `query_user_document`.

This is the "A-only" doc picker described in the project history — clicking the pin button calls `PATCH /api/finbot/conversations/{id}/active-doc`.

### 6.6 Market data providers

| Provider | Used for | Notes |
|---|---|---|
| **yfinance** | Quotes, fundamentals, news, dividends, options, technicals, history | Most tools |
| **Finnhub** | Insider trades only | Requires `FINNHUB_API_KEY` |
| **FRED** (St. Louis Fed) | Macro indicators only | Requires `FRED_API_KEY` |

No caching layer — each tool call hits the upstream provider live. yfinance has its own short-TTL cache internally. For an FYP-scale workload this is fine; production would add Redis caching at the tool level.

### 6.7 Persistence

| Table | Purpose |
|---|---|
| `finbot_profile` | User's risk tolerance, time horizon, goals, currency preference |
| `finbot_holdings` | Portfolio positions (ticker, qty, cost basis, currency, account type) |
| `finbot_watchlist` | Saved tickers + optional price alerts |
| `finbot_conversations` | Chat threads; `active_doc_id` pins a doc |
| `finbot_messages` | Full chat history; `tool_calls` JSONB stores the model's tool invocations |

---

## 7. Background Workers (ARQ)

### 7.1 Job queue architecture

```
   ┌────────────────────┐                       ┌────────────────────┐
   │  alphalens-web     │                       │  Upstash Redis     │
   │                    │  ── enqueue ──────▶   │                    │
   │  FastAPI           │    pool.enqueue_      │   ARQ queue        │
   │  (2 Uvicorn        │    job(...)           │   (serverless)     │
   │   workers)         │                       │                    │
   └────────────────────┘                       └─────────┬──────────┘
                                                          │
                                                          │ pop job
                                                          ▼
                                              ┌────────────────────────┐
                                              │  alphalens-worker      │
                                              │                        │
                                              │  ARQ worker process    │
                                              │  max_jobs = 4 (parallel)│
                                              │  job_timeout = 50 min  │
                                              │  keep_result = 1 h     │
                                              │                        │
                                              │  Functions registered: │
                                              │  ┌──────────────────┐  │
                                              │  │ process_document │  │
                                              │  └──────────────────┘  │
                                              │  ┌──────────────────┐  │
                                              │  │ render_report_pdf│  │
                                              │  └──────────────────┘  │
                                              └────────────────────────┘
```

**ARQ** (Async Redis Queue) is a Python library that uses Redis as a job broker. We chose ARQ over Celery because:

- Async-native (matches our FastAPI codebase)
- Tiny dependency footprint
- Works with Upstash's serverless Redis (no separate broker to host)

### 7.2 Worker functions

| Function | Purpose | Timeout | Triggered by |
|---|---|---|---|
| `process_document` | Run the 12-stage document pipeline | 50 min | Upload endpoints |
| `render_report_pdf` | Generate a styled PDF from a report | 60 s (job_timeout cap) | Report toolbar |

Worker config: `max_jobs=4` (4 concurrent jobs per worker), `keep_result=3600` (retain results 1 hour for the web container to poll).

The PDF renderer is lazy-started — the Chromium browser is launched on the first `render_report_pdf` invocation and reused across calls. Each render gets a fresh `BrowserContext` (clean cookies, storage, service workers). On worker shutdown, the browser is closed cleanly.

### 7.3 Image split rationale

Two Docker images instead of one:

| Image | Content | Size |
|---|---|---|
| `alphalens-web` (`Dockerfile.web`) | Python + FastAPI deps | ~250 MB |
| `alphalens-worker` (`Dockerfile.worker`) | Same base + Chromium + Playwright deps | ~550 MB |

**Why split?** Chromium is heavy. The web container restarts often (during deploys); pulling ~300 MB of extra image every restart wastes bandwidth and slows rollouts. The worker reboots less frequently. Splitting keeps the critical path (web) lean.

---

## 8. Data Model

### 8.1 Postgres tables

Grouped by surface.

**Auth (Supabase native)**

```
auth.users
├─ id (uuid, PK)
├─ email
├─ created_at
└─ confirmed_at
```

**Documents**

```
documents
├─ id (uuid, PK)
├─ user_id (FK auth.users)
├─ filename, file_path
├─ sha256_hash (dedupe key)
├─ status (queued|parsing|extracting|indexing|complete|error|rejected|deleting)
├─ progress (0-100), status_message
├─ metadata (jsonb: company_name, fiscal_year, doc_type, currency, parse_scope, ...)
├─ extract_data (jsonb: structured financial fields from ADE Extract)
└─ created_at, updated_at

document_grounding
├─ doc_id (FK), element_id
├─ page, bbox_left, bbox_top, bbox_right, bbox_bottom, type
└─ Purpose: spatial index for chat citation highlights
```

**Analyzer Chat**

```
analyzer_conversations
├─ id, user_id, doc_id (FK documents)
├─ title
└─ created_at, updated_at

analyzer_messages
├─ id, conversation_id, user_id
├─ role (user|assistant)
├─ content (text)
├─ sources (jsonb: chunk array for citation chips)
└─ created_at
```

**Reports**

```
reports
├─ id, user_id, doc_id (FK documents)
├─ template (string: built-in id OR custom UUID)
├─ sections (jsonb: { section_id → { title, markdown, status, word_count, ... } })
├─ status, word_count
├─ pdf_status (idle|queued|rendering|ready|error)
├─ pdf_url, pdf_rendered_at, pdf_size_bytes, pdf_status_message
└─ created_at, updated_at

report_versions
├─ id, report_id, user_id, section_id
├─ content, model, tokens_in, tokens_out
└─ created_at
   (append-only; per-section regeneration history)

report_sources
├─ id, report_id, user_id, section_id
├─ chunk_id, page, section_header
└─ created_at
   (audit trail: which chunks fed which section)

report_templates_custom
├─ id, user_id, name, description
├─ sections (jsonb: [{ id, title, system_prompt, word_target, rag_query, rag_top_k, model }])
└─ created_at, updated_at
```

**FinBot**

```
finbot_profile (user_id PK)
├─ risk_tolerance, time_horizon, goals[]
├─ liquidity_needs, tax_country, currency_preference
└─ onboarding_completed_at

finbot_holdings
├─ id, user_id, ticker, quantity, cost_basis, currency
├─ account_type (taxable|retirement|isa|other)
├─ opened_at, closed_at, deleted_at (soft delete)
└─ created_at, updated_at

finbot_watchlist
├─ id, user_id, ticker
├─ alert_above, alert_below
├─ UNIQUE(user_id, ticker)
└─ created_at, updated_at

finbot_conversations
├─ id, user_id, active_doc_id (nullable FK documents)
├─ title, pinned, archived_at
└─ created_at, updated_at

finbot_messages
├─ id, conversation_id, user_id
├─ role (user|assistant|tool)
├─ content, tool_calls (jsonb)
├─ tokens_prompt, tokens_completion
└─ created_at
```

Every user-data table has RLS policies (`user_id = auth.uid()`) as defence-in-depth.

### 8.2 Qdrant collection

One collection: `alphalens_documents`.

```
Vector: 1536 floats (text-embedding-3-small)
Distance: COSINE

Indexed payload fields (for fast filtering):
  user_id   (KEYWORD)
  doc_id    (KEYWORD)

Full payload per point:
  chunk_id        - string
  user_id         - uuid
  doc_id          - uuid
  chunk_type      - text|title|table|table_cell|figure|...
  section_header  - inherited from preceding title chunk
  page            - 0-indexed
  markdown        - the chunk text
  bbox            - {left, top, right, bottom} in [0,1]
```

A typical retrieval query filters by `user_id` AND `doc_id` first, then runs vector similarity on the filtered subset. Sub-50ms latency for typical document sizes.

### 8.3 Storage buckets

One Supabase Storage bucket: `documents` (private).

| Path | Content | Lifecycle |
|---|---|---|
| `{user_id}/{doc_id}/original.{ext}` | Raw uploaded PDF | Until user deletes the doc |
| `{user_id}/{doc_id}/processed.json` | Cached ADE markdown + grounding | Until user deletes the doc |
| `{user_id}/reports/{report_id}.pdf` | Generated report PDF | Until user deletes the report |
| `ade_cache/{sha256}.json` | Global ADE parse cache (Cost Lever 2) | 30 days |

All downloads issued as signed URLs (default 1h TTL; PDF download URLs are 10-min).

---

## 9. Deployment

### 9.1 Hetzner anorra-prod

A Hetzner Cloud CCX-class VM running Ubuntu + Docker. Hosts two stacks side-by-side, isolated by network:

- `anorra` — a separate project (172.20.0.0/16)
- `alphalens` — this project (172.30.0.0/16)

### 9.2 Docker Compose

```yaml
services:
  alphalens-web:        # Dockerfile.web (no Chromium), 1 CPU, 1 GB RAM
  alphalens-worker:     # Dockerfile.worker (+ Chromium), 2 CPU, 2 GB RAM
  cloudflared:          # Cloudflare Tunnel, 256 MB RAM
```

No host ports are bound. All ingress goes through Cloudflare Tunnel.

### 9.3 Cloudflare Tunnel

```
Internet → Cloudflare edge → tunnel token → cloudflared container → alphalens_web
```

The DNS record `api.alphalens.site` is a CNAME to Cloudflare's tunnel hostname. TLS terminates at Cloudflare. The container itself never has a public IP. Bonus: free DDoS protection.

### 9.4 Netlify frontend

The Next.js app is hosted on Netlify with:

- Auto-deploy on push to `main`
- `BACKEND_URL=https://api.alphalens.site` environment variable
- Next.js `rewrites()` proxies `/api/*` to that backend

The user's browser only ever talks to Netlify; Netlify's Next.js runtime forwards API calls to the backend on every request.

### 9.5 Idempotent deploy

`deploy/deploy.sh` is idempotent and safe to re-run:

```bash
git fetch origin main && git reset --hard origin/main
export SENTRY_RELEASE=$(git rev-parse --short HEAD)
docker compose build --pull
docker compose up -d --remove-orphans
```

Sentry releases are auto-tagged with the commit short SHA so errors are attributable to a specific build.

---

## 10. Observability & Operations

### 10.1 Health endpoints

| Endpoint | Purpose |
|---|---|
| `GET /livez` | Liveness — does the process respond? |
| `GET /readyz` | Readiness — can it reach DB + Qdrant + Redis? |
| `GET /health` | Detailed status (Supabase, Qdrant, Redis OK/fail) |

Docker Compose uses `/livez` for the web container's healthcheck (30s interval).

### 10.2 Structured logs

Every chat turn writes a single JSON line covering: doc_id, model, retrieval mode (full-context vs RAG), token usage, latency, citation count, intent classification. This makes it trivial to answer ops questions like:

- "What % of chats are refusals?"
- "How often does the model use full-context vs RAG?"
- "Which intents are most common?"

### 10.3 Sentry

Both web and worker init Sentry on startup. DSN, environment, and release are env-controlled. Silent no-op when DSN unset (local dev). Source maps uploaded at frontend build time so JS stack traces are readable.

---

## 11. Performance & Cost Engineering

### 11.1 The four cost levers (recap)

| Lever | Saves on | Mechanism | Typical reduction |
|---|---|---|---|
| 0 Classifier | ADE calls | Reject non-financial PDFs early | 100% on rejected docs |
| 1 Page filter | ADE Parse pages | Skip TOC/exhibits/blanks | ~30% on long filings |
| 2 ADE cache | All ADE calls | Re-use identical SHA-256 parse | 100% on cache hit |
| 3 Extract filter | ADE Extract chars | Trim to financial sections | ~70% on long filings |

### 11.2 OpenAI prompt caching

For reports, every section's system prompt starts with the same multi-thousand-token doc-facts + rules prefix. OpenAI's prompt cache kicks in when ≥1024 tokens match the start of a recent request. Effect: ~50% off input cost on the second through Nth section of a report.

### 11.3 Rate limits

Per-endpoint with `slowapi`:

| Endpoint | Limit | Reason |
|---|---|---|
| `/api/auth/signup` | 3 / 15 min | Anti-bot |
| `/api/auth/login` | 5 / 15 min | Anti-brute-force |
| `/api/auth/forgot-password` | 3 / hour | Anti-spam |
| `/api/documents/{id}/report` | 5 / hour | Each call is expensive (LLM) |
| `/api/reports/{id}/render-pdf` | 12 / hour | Each call is expensive (Chromium) |
| `/api/reports/{id}/regenerate-section` | 10 / hour | LLM cost |
| `/api/documents/bulk-upload` | 20 / hour | Storage + queue pressure |
| `/api/finbot/conversations/{id}/messages` | 20 / min | Tool-call cost |
| `/api/report-templates/custom` (POST) | 30 / hour | DB writes |

---

## 12. Security

### 12.1 Auth

- Passwords are never seen by AlphaLens — Supabase Auth handles them.
- JWTs are httpOnly cookies, not localStorage — protects against XSS exfiltration.
- Token TTL: 7 days. Refresh handled by Supabase.

### 12.2 RLS as defence-in-depth

Even though the backend uses the service-role key and enforces ownership in Python, every user-data table has an RLS policy of `user_id = auth.uid()`. If a future code path ever forgets the manual filter (e.g. uses the anon key by mistake), RLS catches it.

### 12.3 Signed URLs

Files in Supabase Storage are private. Downloads always use short-TTL signed URLs (1 hour for documents, 10 minutes for report PDFs). The signed URL only works for the bearer who holds it, for that duration.

### 12.4 CSP + security headers

`next.config.mjs` sets:

- `Content-Security-Policy` — limits where scripts, styles, fonts, frames may load from
- `X-Frame-Options: DENY` — anti-clickjacking
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

PDF rendering in the worker has its own seatbelt: Chromium is fully network-blocked, so a malicious link in a report can never reach an external server during render.

### 12.5 Anti-hallucination as a security property

In a financial-document tool, an invented number is not just a bug — it's a trust failure that can mislead a user's decisions. The Rule 0 grounding directive + post-generation verifier (Section 4.5) are treated as security controls. They are tested with chat-invariant unit tests that fail the build if the model produces a value with no source.

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **ADE** | Agentic Document Engineering — Landing.AI's parsing API |
| **Agent (V2.7)** | The tool-calling finance-analyst surface (§4.7). One LLM with 9 finance tools, feature-flagged behind `ANALYZER_AGENT_ENABLED`. |
| **ARQ** | Async Redis Queue — Python job queue library |
| **bbox** | Bounding box; `{left, top, right, bottom}` in [0,1] coordinates |
| **CFA** | Chartered Financial Analyst — professional designation. The agent's system prompt is written to a CFA-grade reasoning standard. |
| **Chunk** | A typed sub-element of a parsed document (text, title, table_cell, figure, …) |
| **DocContext** | Per-document, per-turn working set the agent's tools share (cell_lookup, grounding, table grids, section map). |
| **DPT-2** | Landing.AI's document-parsing transformer |
| **Embedding** | A 1536-dim vector representation of a chunk's meaning |
| **FY** | Fiscal Year |
| **JWT** | JSON Web Token — encoded user identity, signed by Supabase |
| **Polarity gate** | V2.6 citation gate that rejects e.g. asset cells for liabilities questions |
| **RAG** | Retrieval-Augmented Generation — feed relevant chunks to the LLM |
| **Recovery ladder** | The V2.7 agent's mandatory failure-recovery sequence: (a) re-call tool with synonym, (b) try alternative tool, (c) `query_freeform` as last resort. |
| **RLS** | Row-Level Security — Postgres policies that filter rows per user |
| **Specificity tier** | The V2.7 `lookup_value` disambiguation rank that prefers canonical row labels over more-specific sub-line elaborations. |
| **SSE** | Server-Sent Events — streaming HTTP response, one event per LLM token chunk |
| **Tool call** | The agent's mechanism for fetching data — OpenAI returns `tool_calls` in its assistant message; orchestrator executes them and feeds results back. |
| **ToolResult** | Pydantic envelope every tool returns: `{ok, summary, payload, citations, latency_ms}`. Keeps the I/O contract uniform across all 9 tools. |
| **TTL** | Time-To-Live — how long a cached / signed item stays valid |
| **V2.6 chat** | The single-LLM-call analyzer chat. Default when `ANALYZER_AGENT_ENABLED=false`. |
| **V2.7 agent** | The tool-calling chat. Active when `ANALYZER_AGENT_ENABLED=true`. |

---

*End of report.*
