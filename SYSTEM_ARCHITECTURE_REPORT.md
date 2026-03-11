# ALPHA LENS - Complete System Architecture Report

## Table of Contents
1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Architecture Diagram](#architecture-diagram)
4. [Backend Architecture](#backend-architecture)
5. [Chat & Citation Pipeline (Current Implementation)](#chat--citation-pipeline-current-implementation)
6. [Frontend Architecture](#frontend-architecture)
7. [Data Flow](#data-flow)
8. [Module Breakdown](#module-breakdown)
9. [API Endpoints](#api-endpoints)
10. [Database Schema](#database-schema)
11. [Storage Structure](#storage-structure)
12. [Security & Authentication](#security--authentication)
13. [Key Workflows](#key-workflows)
14. [Known Limitations & Gaps](#known-limitations--gaps)

---

## System Overview

**ALPHA LENS** is a financial document analysis platform that uses AI to extract, analyze, and enable conversational queries on financial documents. The system integrates Landing.AI's ADE (Automated Document Extraction) API for document processing and OpenAI for intelligent chat responses.

### Core Capabilities
- **Document Upload & Processing**: Upload PDF financial documents, extract structured data using Landing.AI ADE
- **Intelligent Chat**: Ask questions about documents with context-aware responses
- **Vector Search**: Semantic search across document content
- **Professional Reports**: Generate comprehensive financial analysis reports
- **User Management**: Secure authentication and document isolation per user

---

## Technology Stack

### Backend
- **Framework**: FastAPI (Python 3.10+)
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **Storage**: Supabase Storage (S3-compatible)
- **Authentication**: Supabase Auth (JWT-based)
- **AI Services**:
  - Landing.AI ADE API (Document extraction)
  - OpenAI GPT-3.5/GPT-4 (Chat & reports)
- **Vector Store**: Local file-based (JSON) with similarity search
- **PDF Processing**: PyPDF2

### Frontend
- **Framework**: Vanilla JavaScript (ES6+)
- **UI**: HTML5, CSS3
- **PDF Rendering**: PDF.js
- **HTTP Client**: Fetch API

### Infrastructure
- **Deployment**: Render.com (configured via `render.yaml`, `Procfile`)
- **Environment**: Python virtual environment
- **Dependencies**: Managed via `requirements.txt`

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   HTML/CSS    │  │  JavaScript   │  │   PDF.js     │        │
│  │   (UI/UX)     │  │  (Modules)    │  │  (Viewer)    │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS/REST API
┌──────────────────────────────┴──────────────────────────────────┐
│                    FASTAPI BACKEND (app.py)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Auth       │  │  Document     │  │    Chat      │         │
│  │  Endpoints   │  │  Endpoints    │  │  Endpoints   │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└───────┬───────────────┬───────────────┬───────────────┬─────────┘
        │               │               │               │
┌───────┴────┐  ┌────────┴───────┐  ┌───┴────────┐  ┌──┴──────────┐
│  Supabase │  │  Document       │  │  Chat      │  │  Vector     │
│  Auth/DB  │  │  Processor      │  │  Engine    │  │  Store      │
│           │  │                 │  │            │  │             │
│  - Users  │  │  - Landing.AI   │  │  - LLM     │  │  - Similarity│
│  - Docs   │  │    ADE API      │  │    Service │  │    Search   │
│  - Status │  │  - PDF Extract   │  │  - Intent  │  │  - Chunks   │
└───────────┘  └─────────────────┘  │  - History │  └────────────┘
                                    │  - Context │
┌───────────────────────────────────┴────────────┘
│              Supabase Storage
│  - Original PDFs
│  - Processed JSON
│  - User-isolated folders
└────────────────────────────────────────────────
```

---

## Backend Architecture

### Core Modules

#### 1. `app.py` - Main FastAPI Application
**Purpose**: Entry point, API routing, request handling

**Key Components**:
- FastAPI app initialization
- CORS middleware configuration
- Authentication dependency (`get_current_user`)
- API endpoint definitions
- Background task management

**Endpoints**:
- `/api/auth/*` - Authentication (signup, signin, signout, session)
- `/documents/upload` - Document upload
- `/documents` - List user documents
- `/documents/{id}` - Get document details
- `/documents/{id}/file` - Download document
- `/documents/chat` - Chat with document
- `/documents/{id}/report` - Generate report
- `/documents/{id}/status` - Get processing status

**Dependencies**:
- `auth.py` - User authentication
- `database_service.py` - Database operations
- `storage_service.py` - File storage
- `document_processor.py` - Document processing
- `chat_engine.py` - Chat functionality
- `llm_service.py` - LLM integration

#### 2. `config.py` - Configuration Management
**Purpose**: Centralized configuration from environment variables

**Key Settings**:
- Landing.AI ADE API key and endpoint
- OpenAI/Anthropic/Google API keys
- Supabase credentials (URL, anon key)
- File paths (storage, vector stores, extracted data)
- Server configuration (host, port, debug)

**Pattern**: Singleton `Settings` class with `create_directories()` method

#### 3. `auth.py` - Authentication Service
**Purpose**: Supabase authentication wrapper

**Functions**:
- `get_supabase_client()` - Initialize Supabase client
- `sign_up(email, password)` - User registration
- `sign_in(email, password)` - User login
- `sign_out(access_token)` - User logout
- `get_user(access_token)` - Get user from JWT token
- `verify_token(access_token)` - Validate JWT token
- `reset_password(email)` - Password reset

**Security**: Uses Supabase Auth with JWT tokens

#### 4. `database_service.py` - Database Operations
**Purpose**: Supabase database operations with RLS (Row Level Security)

**Class**: `DatabaseService` (singleton)

**Key Methods**:
- `_get_client(access_token)` - Get Supabase client with RLS token
- `create_document(...)` - Create document record
- `get_document(document_id, user_id, access_token)` - Get document
- `get_user_documents(user_id, access_token)` - List user documents
- `get_document_by_filename(...)` - Check for duplicates
- `update_document(...)` - Update document fields
- `update_processing_status(...)` - Update status/progress
- `update_processed_data(...)` - Save processed data path
- `delete_document(...)` - Delete document

**RLS**: All operations require `access_token` for user-scoped queries

#### 5. `storage_service.py` - File Storage Service
**Purpose**: Supabase Storage operations

**Class**: `StorageService` (singleton, bucket: "documents")

**Key Methods**:
- `_get_client_with_token(access_token)` - Get client with RLS token
- `upload_file(user_id, document_id, file_content, filename, file_type, access_token)` - Upload file
- `download_file(storage_path, access_token)` - Download file
- `get_public_url(storage_path, expires_in)` - Generate signed URL
- `delete_file(storage_path)` - Delete file
- `delete_folder(user_id, document_id)` - Delete entire folder

**Storage Structure**: `{user_id}/{document_id}/{file_type}.{ext}`
- `original.pdf` - Original uploaded file
- `processed.json` - Processed financial data

**RLS**: Storage policies enforce user isolation (first folder = `auth.uid()`)

#### 6. `document_processor.py` - Document Processing
**Purpose**: Process PDF documents using Landing.AI ADE API

**Key Functions**:
- `process_document(file_path)` - Main processing function
- `get_ade_client()` - Initialize Landing.AI ADE SDK
- `call_landing_ai_ade_parse(file_path)` - Call ADE Parse API
- `map_to_financial_schema(ade_response, pdf_text)` - Map ADE response to schema
- `extract_text_from_pdf(file_path)` - Extract raw text from PDF
- `mock_ade_processing(...)` - Mock processing for testing

**Processing Flow**:
1. Extract text from PDF (PyPDF2)
2. Call Landing.AI ADE Parse API (all pages)
3. Map ADE response to financial schema:
   - `metadata` (document type, company, date)
   - `detected_chunks` (tables, text, marginal notes)
   - `tables` (structured table data)
   - `key_metrics` (extracted financial metrics)
   - `document_markdown` (full markdown representation)
   - `ade_grounding` (element ID → bounding box), persisted for chat-time citations
4. Create vector store (for semantic search)
5. Save processed data to storage

**Table parsing**: `parse_table_rows()` uses `_any_cell_is_year(cells)` and `looks_like_header(cells)` so the first row can be treated as the header when it contains 4-digit years; column keys then become year labels (e.g. `"2019"`, `"2018"`) for year-aware lookup in the chat engine.

**Output**: `financial_data.json` (and optionally markdown/grounding from `ade_parse_response.json`) with structured financial information and grounding for citations.

#### 7. `vector_store.py` - Vector Store Management
**Purpose**: Create and manage vector embeddings for semantic search

**Key Functions**:
- `create_vector_store(financial_data, pdf_text, vector_store_path, ...)` - Create vector store
- `split_text(text, chunk_size, chunk_overlap)` - Split text into chunks
- `similarity_search(query, vector_store_path, top_k)` - Search similar chunks

**Storage Format**: JSON files
- `vectors.json` - Vector embeddings with metadata
- `financial_data.json` - Processed financial data

**Chunking Strategy**:
- Default chunk size: 1000 characters
- Overlap: 200 characters
- Includes: PDF text chunks, metadata, key metrics, tables

**Search**: Simple text-based similarity (can be enhanced with embeddings)

#### 8. `chat_engine.py` - Chat Engine
**Purpose**: Intelligent chat with documents using a three-layer pipeline (structured table → full-context LLM → RAG) with year-aware lookups, comparison/sum, and visual citations.

**Main Entry**:
- `get_answer_from_document(query, vector_store_path, financial_data, document_id, conversation_history_context)` — Orchestrates greeting, math, glossary guard, intent, year guard, sum, Layer 1, Layer 2, Layer 3; returns answer, sources, source label, intent, follow_up_suggestions.

**Query Parsing & Guards**:
- `_parse_query(query, financial_data)` — Returns `years`, `section_hint`, `question_type`, `metric`. Uses `_parse_years_from_query`, `_extract_section_hint`, `_classify_question_type`, `_extract_query_entity`.
- `_parse_years_from_query(query)` — List of 4-digit years in query (regex `19xx|20xx`).
- `_extract_section_hint(query)` — Detects section/table names (e.g. "Statement of Financial Position", "balance sheet").
- `_classify_question_type(query)` — Returns `definition` | `value` | `comparison` | `reasoning` | `summary`; avoids misclassifying "Statement of Changes in Equity" as trend.
- `_get_document_years(financial_data)` — Set of years present in any table (from headers or first row).
- Glossary bypass: value-lookup regex (year or "how much"/"what is the value") skips `is_financial_term_question` when matched.

**Table Lookup Helpers**:
- `_is_note_value(val)` — True if string looks like a Note reference (e.g. "11", "3.1"), not an amount.
- `_resolve_column_map(header, rows)` — Maps year strings and `"note"` to column keys; supports generic headers by reading first row.
- `_lookup_single_value(financial_data, metric, year_str)` — Best-matching row for metric, value for given year (or first non-Note column); skips pseudo-header row; returns `(value_str, table_id, page, col_key)` or `None`.
- `structured_table_lookup(query, financial_data)` — Layer 1: entity + row match, year-aware and Note-skipping column selection, confidence-gated (discard if returned column does not match requested year). Returns answer + citations or `None`.

**Comparison & Sum**:
- `compare_financial_metrics(financial_data, query)` — Tries two-year table lookup (metric + two years) first; returns difference or both values; falls back to key_metrics comparison.
- `_sum_metric_two_years(query, financial_data)` — Parses two years and metric, looks up both values, returns sum sentence or `None`.

**Full-Context Path (Layer 2)**:
- `_build_full_context(financial_data)` — Converts `financial_data["markdown"]` to LLM-readable text with inline element IDs; returns `None` if over `_FULL_CONTEXT_TOKEN_LIMIT` (30k).
- `_parse_id_citations(answer_text, grounding, detected_chunks, financial_data)` — Extracts `[[id]]` from LLM response, maps IDs to grounding (page, box), builds sources list for frontend.

**Other**:
- `classify_query_intent(query, financial_data)` — Returns trend | comparison | calculation | summary | financial_analysis; includes guard so "Statement of Changes" / "changes in equity" does not force trend.
- `get_conversation_context(document_id, max_turns)` — Conversation history for context.
- `save_conversation(document_id, query, answer)` — Persist turn.
- `generate_follow_up_suggestions(...)` — Follow-up questions.
- `analyze_financial_trends(...)` — Trend data from financial_data.
- `build_context_blocks(relevant_chunks, financial_data)` — Context for RAG path.
- `extract_citations_with_visual_refs(...)` — Citations from RAG path.

**Query Intent Classification**:
- `trend` — Trends/changes (but not when section name contains "change", e.g. Statement of Changes in Equity).
- `comparison` — Compare/difference (two-year table path first).
- `calculation` — Sum/total (two-year sum path when two years in query).
- `summary` — Summarize/overview.
- `financial_term` — Definitions (only when query has no year and no value-seeking phrasing).
- `financial_analysis` — Default / value lookups.

**Conversation Memory**:
- In-memory: `conversation_history[document_id] = [{query, answer, timestamp}, ...]`; last 20 turns per document.

**Response Format**:
```python
{
    "answer": str,
    "sources": List[Dict],  # Citations: chunk_id, page, box, type, visual_ref
    "source": str,  # "structured_table", "full_context", "rag_fallback", "year_not_found", etc.
    "intent": str,
    "follow_up_suggestions": List[str]
}
```

#### 9. `llm_service.py` - LLM Service
**Purpose**: OpenAI integration for chat, full-context answers with citations, and reports

**Class**: `LLMService` (singleton)

**Key Methods**:
- `generate_response(query, context, financial_data)` - Basic response generation
- `generate_finance_response(query, metadata, key_metrics, context_blocks, ...)` - Finance-specific response (RAG path)
- `generate_full_context_response(full_context_text, query, financial_data)` - **Layer 2**: Sends full document text (with inline element IDs) and query to LLM; system prompt instructs analyst-style answers and `[[id]]` citations only for grounded content; no hallucination beyond document. Used when document is under token limit (~30k).
- `generate_document_summary(financial_data)` - Generate document summary
- `generate_professional_financial_report(financial_data)` - Generate comprehensive report
- `enhance_trend_analysis(query, trend_data, financial_data)` - Enhance trend analysis
- `enhance_comparison(query, comparison_data, financial_data)` - Enhance comparison

**Models Used**:
- GPT-3.5-turbo (chat, summaries)
- GPT-4 (professional reports)

**Prompt Engineering**:
- Context-aware prompts with document data
- Citation instructions
- Format preferences (bullets, lists)
- Simple vs. detailed responses

#### 10. `report_service.py` - Report Generation Service
**Purpose**: Generate professional financial analysis reports

**Class**: `DocumentStructureAnalyzer`
- Analyzes document structure
- Identifies sections, tables, relationships
- Processes all detected chunks

**Integration**: Used by `llm_service.generate_professional_financial_report()`

---

## Chat & Citation Pipeline (Current Implementation)

This section describes the **current production behavior** of the chat and citation system as implemented. It reflects all changes made for year-aware lookups, full-context LLM path, visual grounding, and guard logic.

### Three-Layer Answer Pipeline

The chat engine uses a **three-layer pipeline** to answer questions. Only one layer returns the final answer per query.

| Layer | Name | When it runs | What it does |
|-------|------|--------------|--------------|
| **Layer 1** | Structured table lookup | Simple value questions (single metric, single year or no year, no section hint). Confidence-gated. | Searches `financial_data["tables"]` for a row matching the query entity; picks value by **year** (column header) and **skips Note columns**. Returns raw value + cell citations or `None`. No LLM. |
| **Layer 2** | Full-context LLM | When Layer 1 returns nothing or low confidence, and document markdown is available and under token limit (~30k). | Builds full document text from ADE markdown with inline element IDs (`_build_full_context`). Sends to `llm_service.generate_full_context_response()`. LLM returns answer with `[[id]]` citations. Backend maps IDs to `ade_grounding` for bounding boxes. |
| **Layer 3** | RAG fallback | When full-context is missing or document exceeds token limit, or when Layer 2 returns no answer. | `similarity_search()` on vector store → build context blocks → LLM with retrieved chunks. Citations from value-match or chunk metadata. |

**Token limit:** `_FULL_CONTEXT_TOKEN_LIMIT = 30000`. If estimated markdown tokens exceed this, `_build_full_context()` returns `None` and Layer 2 is skipped (Layer 3 RAG is used for that document).

### Query Parsing & Guards (Before Layers)

- **Structured query metadata:** `_parse_query()` returns `years`, `section_hint`, `question_type`, `metric`. Used to gate Layer 1 and to detect value vs definition vs trend.
- **Year availability check:** `_get_document_years(financial_data)` collects all years present in table headers/first rows. If the user asks for a year that does not exist in the document (e.g. 2010 when only 2018/2019 exist), the engine returns early: *"The document does not contain data for [year]. Available years: [list]."* Source: `year_not_found`. No LLM call.
- **Glossary bypass:** If the query contains a 4-digit year or phrases like "how much", "what is the value", "what was the amount", the engine does **not** route to the financial glossary. Only pure definition questions (no year, no value-seeking phrasing) go to `handle_financial_term_question`.
- **Intent guard:** Queries containing "Statement of Changes in Equity" (or similar section names with the word "change") do **not** trigger `trend` intent. They fall through to value lookup or full-context so that section-scoped value questions are answered correctly.

### Document Processor: Table Headers & Grounding

- **Year-row as header:** In `parse_table_rows()` (document_processor), the first row of a table can be treated as the header even when it contains digits. Helper `_any_cell_is_year(cells)` returns true if any cell is a 4-digit year (e.g. 2018, 2019). If `looks_like_header(cells)` or `_any_cell_is_year(cells)` is true for the first row, that row becomes the header. So tables get column names like `"2019"`, `"2018"` instead of generic `"Column 3"`, `"Column 4"` when the first row contains years.
- **Grounding persistence:** The processor stores `ade_grounding` (element ID → bounding box) in the financial data so that at chat time the backend can map LLM citations (`[[id]]`) to page and box for the PDF viewer. Markdown and grounding can come from ADE parse/parse_response and are stored in `financial_data` or loaded from `ade_parse_response.json` at runtime where applicable.

### Chat Engine: Helpers for Tables & Years

- **`_parse_years_from_query(query)`** — Returns list of 4-digit years (regex `19xx|20xx`) mentioned in the query.
- **`_is_note_value(val)`** — Returns true if the string looks like a Note/reference cell (e.g. "11", "3.1", "7.a"), not a financial amount. Used to skip Note columns when choosing the value column.
- **`_resolve_column_map(header, rows)`** — Builds a map from semantic names to column keys: (1) if header cells are year strings, maps year → column; (2) if headers are generic ("Column 1", …), inspects the first data row for year or "Note" and builds the same map. Works for any number of columns (2, 3, 4, …).
- **`_lookup_single_value(financial_data, metric, year_str)`** — Finds the best-matching row for a metric across all tables, skips pseudo-header first row (when it contains year values), and returns the cell value for the given year (or first non-Note column if no year). Returns `(value_str, table_id, page, col_key)` or `None`. Used by comparison and sum logic.

### Structured Table Lookup (Layer 1) — Detailed Behavior

- **Entity extraction:** `_extract_query_entity(query)` gets the metric/label from the query (e.g. "Loans to staff", "Total assets").
- **Row matching:** Across all tables, each row is scored by label overlap (entity in label, label in entity, or word overlap). Best score wins.
- **Pseudo-header skip:** If the first row of a table has cells that are 4-digit years, that row is skipped (treated as header row, not data).
- **Column selection (year-aware, Note-skipping):** (1) Parse years from query. (2) If a table has a column header equal to that year (from `_resolve_column_map`), prefer that column for the value. (3) Otherwise, take the first non-Note column (using `_is_note_value`) that looks like an amount. (4) If the user asked for a specific year and the returned column is not that year’s column, the result is discarded (confidence gate) and the pipeline falls through to Layer 2.
- **Output:** Returns a dict with `answer`, `label`, `column`, `citations` (cell-level), `table_id`, `table_title`, or `None` if no confident match.

### Comparison & Sum (Before Layer 1)

- **Comparison (two years):** For queries like "difference between X in 2018 and 2019" or "compare X 2018 vs 2019", `compare_financial_metrics()` first tries a two-year table lookup: parse two years and metric from the query, call `_lookup_single_value` for each year. If both values are found, it returns the difference (or both values for "compare"). If that fails, it falls back to the generic key_metrics comparison.
- **Sum (two years):** If intent is `calculation` (or query contains "sum") and the query has exactly two years, `_sum_metric_two_years(query, financial_data)` runs: parse metric and both years, look up both values via `_lookup_single_value`, return the sum and optional sentence. If it returns a result, that is used; otherwise the pipeline continues to Layer 1 and beyond.

### Full-Context LLM (Layer 2) — Citation Flow

- **Input:** `_build_full_context(financial_data)` converts `financial_data["markdown"]` (ADE markdown) into a single text string with inline element IDs preserved (e.g. `[0-q]`, `[3-c]`). Tables are flattened to lines with cell text and cell ID. This string is sent to the LLM as the document content.
- **Prompt:** `generate_full_context_response()` uses a **financial analyst** system prompt: answer only from the document, use the requested year’s column only, if the user specifies a section (e.g. "in the balance sheet") use only that section, never fabricate — if not in the document say so clearly, cite element IDs as `[[id]]` after each value.
- **Output:** LLM returns plain text with `[[id]]` markers. `_parse_id_citations()` extracts those IDs, looks up each in `ade_grounding`, and builds the `sources` list with `page`, `box`, and optional `visual_ref` for the frontend. If the LLM response contains phrases like "I cannot find" or "does not contain", the current implementation may fall through to Layer 3 instead of returning that answer (known nuance).

### Response Source Labels

Answers are tagged with a `source` field for analytics and debugging: `greeting`, `math_calculator`, `financial_glossary`, `general_knowledge`, `trend_analysis`, `comparison_analysis`, `gpt-3.5-turbo` (summary), `table_sum`, `structured_table`, `full_context`, `year_not_found`, `rag_fallback`, `local_llm`.

---

## Frontend Architecture

### File Structure
```
static/
├── css/
│   └── style.css          # All styles (4567 lines)
├── js/
│   ├── main.js            # Core initialization
│   └── modules/
│       ├── auth.js        # Authentication
│       ├── chat.js        # Chat functionality
│       ├── content.js     # Content display
│       ├── documents.js   # Document management
│       ├── navigation.js  # Navigation
│       ├── reports.js     # Report generation
│       ├── ui-components.js # UI state management
│       ├── utils.js       # Utilities
│       └── viewer.js      # PDF viewer
└── img/
    ├── ALPHA LENS LOGO.png
    └── home.png
```

### Module Breakdown

#### 1. `main.js` - Core Initialization
**Purpose**: Coordinate all modules, handle initialization

**Key Responsibilities**:
- PDF.js setup and worker configuration
- DOM element caching
- Event listener setup (upload, file selection)
- Window resize handling for PDF viewer
- Module coordination

**Dependencies**: All other modules

#### 2. `modules/auth.js` - Authentication
**Purpose**: Handle user authentication

**Functions**:
- `signUp(email, password)`
- `signIn(email, password)`
- `signOut()`
- `checkAuth()` - Check if user is authenticated
- `getAccessToken()` - Get JWT token from cookies/localStorage

**Storage**: JWT token in cookies and localStorage

#### 3. `modules/documents.js` - Document Management
**Purpose**: Handle document upload, listing, selection

**Key Functions**:
- `uploadDocument(file)` - Upload document
- `loadDocuments()` - Load user documents
- `selectDocument(documentId)` - Select document for viewing
- `pollDocumentStatus(documentId)` - Poll processing status
- `processFileUpload(file, action)` - Process file upload

**State Management**:
- Document list
- Selected document
- Processing status

#### 4. `modules/viewer.js` - PDF Viewer
**Purpose**: Render PDF documents

**Key Functions**:
- `renderDocumentPreview(documentId)` - Render document preview
- `renderPdfPage(pageNum)` - Render specific page
- `renderAllPdfPages()` - Render all pages
- `createPdfCanvas(pageNum, pdfDoc)` - Create canvas for page

**Features**:
- Multi-page rendering
- Page navigation
- Responsive canvas sizing
- Chrome-specific fixes

#### 5. `modules/chat.js` - Chat Functionality
**Purpose**: Handle chat interactions

**Key Functions**:
- `sendChatMessage(query, documentId)` - Send chat message
- `displayChatMessage(query, answer, sources)` - Display message
- `handleChatResponse(response)` - Process chat response
- `showFollowUpSuggestions(suggestions)` - Show follow-up questions

**Features**:
- Real-time chat
- Citation display
- Follow-up suggestions
- Conversation history

#### 6. `modules/content.js` - Content Display
**Purpose**: Display document content and analysis

**Key Functions**:
- `displayDocumentContent(document)` - Display document
- `displayFinancialData(financialData)` - Display financial data
- `displayKeyMetrics(metrics)` - Display key metrics
- `displayTables(tables)` - Display tables

#### 7. `modules/ui-components.js` - UI State Management
**Purpose**: Manage UI states (initial, loading, result)

**Key Functions**:
- `showAnalyzerInitialState()` - Show initial state
- `showAnalyzerLoadingState()` - Show loading spinner
- `showAnalyzerResultState()` - Show result state
- `updateLoadingProgress(progress, message)` - Update progress

**States**:
- `initial` - No document selected
- `loading` - Processing document
- `result` - Document ready for interaction

#### 8. `modules/reports.js` - Report Generation
**Purpose**: Generate and display professional reports

**Key Functions**:
- `generateReport(documentId)` - Generate report
- `displayReport(report)` - Display report
- `downloadReport(report, filename)` - Download report

#### 9. `modules/navigation.js` - Navigation
**Purpose**: Handle navigation between views

**Key Functions**:
- `navigateToDocuments()` - Navigate to documents list
- `navigateToChat()` - Navigate to chat
- `navigateToReports()` - Navigate to reports

#### 10. `modules/utils.js` - Utilities
**Purpose**: Shared utility functions

**Functions**:
- `formatDate(date)` - Format dates
- `formatCurrency(amount)` - Format currency
- `debounce(func, wait)` - Debounce function
- `throttle(func, limit)` - Throttle function

---

## Data Flow

### 1. Document Upload Flow

```
User selects file
    ↓
Frontend: processFileUpload()
    ↓
POST /documents/upload
    ↓
Backend: upload_document()
    ├─→ Check duplicate (database_service.get_document_by_filename())
    ├─→ Upload to storage (storage_service.upload_file())
    ├─→ Create DB record (database_service.create_document())
    └─→ Start background processing (process_document_background())
        ↓
    Background: process_document_background()
        ├─→ Update status: "processing"
        ├─→ Call document_processor.process_document()
        │   ├─→ Extract PDF text
        │   ├─→ Call Landing.AI ADE Parse API
        │   ├─→ Map to financial schema
        │   ├─→ Create vector store
        │   └─→ Save processed data
        ├─→ Upload processed.json to storage
        ├─→ Update DB: processed_data_path, status="complete"
        └─→ Cleanup temp files
```

### 2. Chat Flow (Current Three-Layer Pipeline)

```
User types query
    ↓
Frontend: sendChatMessage(query, documentId)
    ↓
POST /documents/chat
    ↓
Backend: chat_with_document()
    ├─→ Verify user authentication
    ├─→ Get document from DB
    ├─→ Download processed_data.json (and inject markdown/ade_grounding if from ade_parse_response)
    ├─→ Call chat_engine.get_answer_from_document()
    │   ├─→ Greeting / math / irrelevant → immediate return
    │   ├─→ Value-lookup guard: if year or "how much" → skip financial glossary
    │   ├─→ Classify intent (trend, comparison, calculation, summary, financial_analysis)
    │   ├─→ Trend → analyze_financial_trends + enhance_trend_analysis → return
    │   ├─→ Comparison → compare_financial_metrics (two-year table lookup first, else key_metrics) → return
    │   ├─→ Summary → generate_document_summary or fallback → return
    │   ├─→ _parse_query(): years, section_hint, question_type
    │   ├─→ Year guard: if requested year not in document → return "year_not_found" message
    │   ├─→ Sum (calculation + 2 years) → _sum_metric_two_years → return if result
    │   ├─→ Layer 1: structured_table_lookup (confidence-gated: year column must match if year in query)
    │   │   └─→ If hit: return answer + citations (source: structured_table)
    │   ├─→ Layer 2: _build_full_context() → if under token limit, generate_full_context_response()
    │   │   └─→ _parse_id_citations() → return answer + citations (source: full_context)
    │   ├─→ Layer 3: similarity_search → build_context_blocks → LLM (generate_response / finance path)
    │   │   └─→ Return answer + citations (source: rag_fallback or local_llm)
    │   ├─→ Generate follow-up suggestions
    │   └─→ Save conversation
    └─→ Return response
        ↓
Frontend: displayChatMessage()
    ├─→ Display answer
    ├─→ Display citations (with chunk_id / page / box for PDF highlight where supported)
    └─→ Display follow-up suggestions
```

### 3. Document List Flow

```
User navigates to documents
    ↓
Frontend: loadDocuments()
    ↓
GET /documents
    ↓
Backend: list_documents()
    ├─→ Verify authentication
    ├─→ Get user documents (database_service.get_user_documents())
    └─→ Return document list
        ↓
Frontend: displayDocuments()
    └─→ Render document list
```

### 4. Report Generation Flow

```
User requests report
    ↓
Frontend: generateReport(documentId)
    ↓
GET /documents/{id}/report
    ↓
Backend: generate_professional_report()
    ├─→ Get document from DB
    ├─→ Download processed_data.json
    ├─→ Call llm_service.generate_professional_financial_report()
    │   └─→ Use report_service for structure analysis
    └─→ Return report
        ↓
Frontend: displayReport(report)
    └─→ Render formatted report
```

---

## API Endpoints

### Authentication Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/auth/signup` | Register new user | No |
| POST | `/api/auth/signin` | Login user | No |
| POST | `/api/auth/signout` | Logout user | Yes |
| GET | `/api/auth/session` | Get current session | Yes |
| POST | `/api/auth/forgot-password` | Request password reset | No |

### Document Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/documents/upload` | Upload document | Yes |
| GET | `/documents` | List user documents | Yes |
| GET | `/documents/{id}` | Get document details | Yes |
| GET | `/documents/{id}/file` | Download document file | Yes |
| GET | `/documents/{id}/status` | Get processing status | Yes |
| POST | `/documents/chat` | Chat with document | Yes |
| GET | `/documents/{id}/report` | Generate report | Yes |

### Response Models

**ChatResponse**:
```python
{
    "document_id": str,
    "query": str,
    "answer": str,
    "sources": List[Dict],  # Citations
    "source": str,  # "gpt-3.5-turbo", etc.
    "intent": str,  # "trend", "comparison", etc.
    "follow_up_suggestions": List[str]
}
```

**Document**:
```python
{
    "id": str,
    "user_id": str,
    "filename": str,
    "file_path": str,
    "processed_data_path": str,
    "status": str,  # "uploaded", "processing", "complete", "error"
    "progress": int,  # 0-100
    "status_message": str,
    "upload_time": str,
    "metadata": Dict
}
```

---

## Database Schema

### Table: `documents`

```sql
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    processed_data_path TEXT,
    status TEXT NOT NULL DEFAULT 'uploaded',
    progress INTEGER DEFAULT 0,
    status_message TEXT,
    metadata JSONB,
    upload_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_upload_time ON documents(upload_time DESC);

-- RLS Policies
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Users can only see their own documents
CREATE POLICY "Users can view own documents"
    ON documents FOR SELECT
    USING (auth.uid() = user_id);

-- Users can only insert their own documents
CREATE POLICY "Users can insert own documents"
    ON documents FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can only update their own documents
CREATE POLICY "Users can update own documents"
    ON documents FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can only delete their own documents
CREATE POLICY "Users can delete own documents"
    ON documents FOR DELETE
    USING (auth.uid() = user_id);
```

### Status Values
- `uploaded` - File uploaded, processing not started
- `processing` - Currently being processed
- `complete` - Processing complete, ready for use
- `error` - Processing failed

---

## Storage Structure

### Supabase Storage Bucket: `documents`

**Path Structure**:
```
{user_id}/{document_id}/original.pdf
{user_id}/{document_id}/processed.json
```

**Example**:
```
a1b2c3d4-e5f6-7890-abcd-ef1234567890/
  └── doc-12345-67890-abcde/
      ├── original.pdf
      └── processed.json
```

### Storage Policies (RLS)

**INSERT Policy**: Users can upload files to their own folder
```sql
bucket_id = 'documents' AND
(string_to_array(storage.objects.name, '/'))[1] = auth.uid()::text
```

**SELECT Policy**: Users can download files from their own folder
```sql
bucket_id = 'documents' AND
(string_to_array(storage.objects.name, '/'))[1] = auth.uid()::text
```

**UPDATE Policy**: Users can update files in their own folder
```sql
bucket_id = 'documents' AND
(string_to_array(storage.objects.name, '/'))[1] = auth.uid()::text
```

**DELETE Policy**: Users can delete files from their own folder
```sql
bucket_id = 'documents' AND
(string_to_array(storage.objects.name, '/'))[1] = auth.uid()::text
```

---

## Security & Authentication

### Authentication Flow

1. **User Registration/Login**:
   - User submits email/password
   - Supabase Auth validates credentials
   - Returns JWT `access_token` and `refresh_token`
   - Frontend stores token in cookies and localStorage

2. **Request Authentication**:
   - Frontend sends `Authorization: Bearer {access_token}` header
   - Backend extracts token via `get_current_user()` dependency
   - Verifies token with `auth.get_user(access_token)`
   - Extracts `user_id` from JWT payload

3. **Row Level Security (RLS)**:
   - All database queries include `access_token` in Supabase client
   - RLS policies automatically filter by `auth.uid()`
   - Users can only access their own documents

4. **Storage Security**:
   - Storage paths must start with `{user_id}/`
   - Storage RLS policies enforce user isolation
   - Files are private (no public access)

### Security Features

- **JWT Tokens**: Secure, stateless authentication
- **HTTPS Only**: All API calls over HTTPS
- **CORS**: Configured for specific origins (production)
- **Input Validation**: Pydantic models for request validation
- **Error Handling**: No sensitive data in error messages
- **Token Expiration**: JWT tokens expire (handled by Supabase)

---

## Key Workflows

### Workflow 1: Complete Document Processing

```
1. User uploads PDF
   ├─→ File saved to Supabase Storage
   ├─→ Document record created in database
   └─→ Background processing started

2. Background Processing
   ├─→ Extract text from PDF (PyPDF2)
   ├─→ Call Landing.AI ADE Parse API
   │   └─→ Returns: chunks, tables, metadata
   ├─→ Map ADE response to financial schema
   ├─→ Create vector store for semantic search
   └─→ Save processed.json to storage

3. Update Database
   ├─→ Update status: "complete"
   ├─→ Save processed_data_path
   └─→ Update metadata

4. Frontend Polling
   ├─→ Poll /documents/{id}/status
   └─→ When status="complete", load document
```

### Workflow 2: Chat with Document

```
1. User selects document
   ├─→ Frontend loads document details
   └─→ Display document preview

2. User asks question
   ├─→ Frontend sends POST /documents/chat
   └─→ Backend processes query

3. Query Processing
   ├─→ Classify intent (trend, comparison, etc.)
   ├─→ Get conversation context (if available)
   ├─→ Search vector store for relevant chunks
   ├─→ Build context blocks
   ├─→ Call LLM with context
   ├─→ Extract citations
   ├─→ Generate follow-up suggestions
   └─→ Save conversation

4. Display Response
   ├─→ Show answer
   ├─→ Show citations with page references
   └─→ Show follow-up suggestions
```

### Workflow 3: Report Generation

```
1. User requests report
   ├─→ Frontend calls GET /documents/{id}/report
   └─→ Backend generates report

2. Report Generation
   ├─→ Load processed_data.json
   ├─→ Analyze document structure (report_service)
   ├─→ Call LLM (GPT-4) with comprehensive prompt
   │   ├─→ Executive Summary
   │   ├─→ Financial Metrics Analysis
   │   ├─→ Table Insights
   │   ├─→ Risk Assessment
   │   └─→ Validation & Reliability
   └─→ Return formatted report

3. Display Report
   ├─→ Render formatted report
   └─→ Option to download
```

---

## Environment Variables

### Required Variables

```bash
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Landing.AI ADE
VISION_AGENT_API_KEY=land_xxxxx
ADE_ENDPOINT=https://api.va.landing.ai/v1/ade

# OpenAI (for chat and reports)
OPENAI_API_KEY=sk-xxxxx

# Optional: Other LLMs
ANTHROPIC_API_KEY=sk-ant-xxxxx
GOOGLE_API_KEY=xxxxx
```

### Optional Variables

```bash
# Server
HOST=0.0.0.0
PORT=8000
DEBUG=False

# Paths (defaults provided)
VECTOR_DB_PATH=./data/vector_stores
DOCUMENT_STORAGE_PATH=./data/raw_docs
EXTRACTED_DATA_PATH=./data/extracted
FINAL_OUTPUT_PATH=./data/final_outputs
```

---

## Deployment

### Render.com Configuration

**Files**:
- `render.yaml` - Infrastructure as code
- `Procfile` - Process definition
- `runtime.txt` - Python version

**Process**:
```bash
web: uvicorn app:app --host 0.0.0.0 --port $PORT
```

**Build Command**:
```bash
pip install -r requirements.txt
```

**Environment Variables**: Set in Render dashboard

---

## Performance Considerations

### Optimizations

1. **Background Processing**: Document processing runs asynchronously
2. **Vector Store Caching**: Vector stores saved locally for fast retrieval
3. **Lazy Loading**: Processed data only loaded when needed
4. **Pagination**: Document lists can be paginated (currently shows all)
5. **Chunking Strategy**: Optimized chunk sizes for balance between context and speed

### Scalability

1. **Database**: Supabase PostgreSQL scales automatically
2. **Storage**: Supabase Storage scales with S3-compatible API
3. **Vector Store**: Currently file-based; can migrate to dedicated vector DB (Pinecone, Weaviate)
4. **Conversation History**: Currently in-memory; should migrate to database for production

---

## Future Enhancements

### Planned Improvements

1. **Vector Database**: Migrate to dedicated vector DB (Pinecone/Weaviate)
2. **Conversation History**: Store in database instead of memory
3. **Real-time Updates**: WebSocket for real-time status updates
4. **Batch Processing**: Support multiple document uploads
5. **Export Features**: Export chat conversations, reports
6. **Advanced Analytics**: Dashboard with document analytics
7. **Multi-language Support**: Support for non-English documents
8. **Document Comparison**: Compare multiple documents
9. **Custom Prompts**: Allow users to customize LLM prompts
10. **API Rate Limiting**: Implement rate limiting for API endpoints

---

## Known Limitations & Gaps

- **No section metadata on tables/chunks**: Tables and chunks are not tagged with section type (e.g. "balance sheet", "income statement"). Queries like "balance sheet revenue" cannot be structurally scoped; Layer 1 uses first matching row/table.
- **Full-context skipped for large documents**: When document markdown exceeds the token limit (~30k), Layer 2 is skipped. Large documents only get Layer 1 (table lookup) and Layer 3 (RAG); no full-document LLM answer with ID-based citations.
- **Layer 1 table ambiguity**: With many similar tables, structured table lookup can pick the first matching row. No disambiguation by section or table title.
- **Sum-of-two-years routing**: `_sum_metric_two_years` can in some cases return a single year's value due to routing or column resolution; edge cases exist for alternate column naming.
- **"I cannot find" and RAG fallback**: When Layer 2 returns a refusal (e.g. "I cannot find"), some code paths may still fall through to Layer 3 (RAG) instead of returning that refusal as the final answer; behavior may vary by prompt and response parsing.
- **Conversation memory**: Stored in-memory only; not persisted to DB. Restart or new process loses history.
- **Vector store**: File-based JSON; no dedicated vector DB. Scale and concurrency are limited.

---

## Conclusion

ALPHA LENS is a comprehensive financial document analysis platform with:
- **Robust Architecture**: Modular, scalable design
- **Secure Authentication**: JWT-based with RLS
- **Intelligent Chat**: Context-aware responses with conversation memory
- **Professional Reports**: Comprehensive financial analysis
- **User Isolation**: Complete data isolation per user
- **Production Ready**: Deployed on Render.com with proper error handling

The system is designed for extensibility and can be enhanced with additional features as needed.

---

**Document Version**: 1.1  
**Last Updated**: March 2025  
**Maintained By**: ALPHA LENS Development Team

