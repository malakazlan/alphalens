# ALPHA LENS - Complete System Architecture Report

## Table of Contents
1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Architecture Diagram](#architecture-diagram)
4. [Backend Architecture](#backend-architecture)
5. [Frontend Architecture](#frontend-architecture)
6. [Data Flow](#data-flow)
7. [Module Breakdown](#module-breakdown)
8. [API Endpoints](#api-endpoints)
9. [Database Schema](#database-schema)
10. [Storage Structure](#storage-structure)
11. [Security & Authentication](#security--authentication)
12. [Key Workflows](#key-workflows)

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
4. Create vector store (for semantic search)
5. Save processed data to storage

**Output**: `financial_data.json` with structured financial information

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
**Purpose**: Intelligent chat with documents using LLM

**Key Functions**:
- `get_answer_from_document(query, vector_store_path, financial_data, document_id, conversation_history_context)` - Main chat function
- `classify_query_intent(query, financial_data)` - Classify query intent
- `get_conversation_context(document_id, max_turns)` - Get conversation history
- `save_conversation(document_id, query, answer)` - Save conversation
- `generate_follow_up_suggestions(...)` - Generate follow-up questions
- `analyze_financial_trends(...)` - Analyze trends
- `compare_financial_metrics(...)` - Compare metrics
- `build_context_blocks(relevant_chunks, financial_data)` - Build context
- `extract_citations_with_visual_refs(...)` - Extract citations

**Query Intent Classification**:
- `trend` - Questions about trends/changes
- `comparison` - Comparison requests
- `calculation` - Calculation requests
- `summary` - Summary requests
- `financial_term` - Financial term definitions
- `financial_analysis` - General financial analysis
- `off_topic` - Non-document questions

**Conversation Memory**:
- In-memory storage: `conversation_history[document_id] = [{query, answer, timestamp}, ...]`
- Last 20 turns per document
- Used for context in follow-up questions

**Response Format**:
```python
{
    "answer": str,
    "sources": List[Dict],  # Citations with page references
    "source": str,  # "gpt-3.5-turbo", "trend_analysis", etc.
    "intent": str,
    "follow_up_suggestions": List[str]
}
```

#### 9. `llm_service.py` - LLM Service
**Purpose**: OpenAI integration for chat and reports

**Class**: `LLMService` (singleton)

**Key Methods**:
- `generate_response(query, context, financial_data)` - Basic response generation
- `generate_finance_response(query, metadata, key_metrics, context_blocks, ...)` - Finance-specific response
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

### 2. Chat Flow

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
    ├─→ Download processed_data.json from storage
    ├─→ Call chat_engine.get_answer_from_document()
    │   ├─→ Classify query intent
    │   ├─→ Get conversation context (if document_id provided)
    │   ├─→ Handle special intents (trend, comparison, summary)
    │   ├─→ Search vector store (similarity_search)
    │   ├─→ Build context blocks
    │   ├─→ Call LLM (llm_service.generate_finance_response())
    │   ├─→ Extract citations
    │   ├─→ Generate follow-up suggestions
    │   └─→ Save conversation
    └─→ Return response
        ↓
Frontend: displayChatMessage()
    ├─→ Display answer
    ├─→ Display citations
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

**Document Version**: 1.0  
**Last Updated**: 2024  
**Maintained By**: ALPHA LENS Development Team

