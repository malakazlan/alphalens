# API_DESIGN.md — Alpha Lens v2 API Design

## 1. Base URL
- **Development:** `http://localhost:8000`
- **Production:** `https://{app-name}.onrender.com`

## 2. Authentication
All endpoints except `/`, `/api/auth/login`, `/api/auth/signup`, `/api/auth/forgot-password` require:
```
Authorization: Bearer {supabase_jwt_access_token}
```
Token is also accepted via HTTP-only cookie `access_token`.

## 3. Standard Response Format

### Success
```json
{"success": true, "data": {...}}
```

### Error
```json
{"success": false, "error": "Error message", "detail": "Optional detail"}
```

### SSE Stream
`Content-Type: text/event-stream`
Each line: `data: {json}\n\n`

---

## 4. Auth Endpoints

### POST /api/auth/signup
Create a new user account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "min6chars"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "User created successfully",
  "user": {"id": "uuid", "email": "user@example.com"},
  "access_token": "supabase_jwt"
}
```
Sets HTTP-only cookie `access_token` (7-day expiry, SameSite=Lax, Secure in production).

**Response 400:**
```json
{"success": false, "error": "Email already in use"}
```

---

### POST /api/auth/login
Authenticate an existing user.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Login successful",
  "user": {"id": "uuid", "email": "user@example.com"},
  "access_token": "supabase_jwt"
}
```
Sets HTTP-only cookie `access_token`.

**Response 401:**
```json
{"success": false, "error": "Invalid email or password"}
```

---

### POST /api/auth/logout
Sign out the current user.

**Headers:** Authorization required

**Response 200:**
```json
{"success": true}
```
Clears `access_token` cookie.

---

### GET /api/auth/session
Verify current session and return user info.

**Headers:** Authorization required

**Response 200:**
```json
{
  "success": true,
  "user": {"id": "uuid", "email": "user@example.com"}
}
```

**Response 401:**
```json
{"success": false, "error": "Not authenticated"}
```

---

### POST /api/auth/forgot-password
Send password reset email.

**Request:**
```json
{"email": "user@example.com"}
```

**Response 200:**
```json
{"success": true, "message": "Password reset email sent"}
```

---

## 5. Document Endpoints

### POST /api/documents/check-hash
Check if a document with this SHA256 hash already exists for the user (dedup check).

**Headers:** Authorization required

**Request:**
```json
{"sha256_hash": "abcdef1234..."}
```

**Response 200 (duplicate found):**
```json
{
  "exists": true,
  "document_id": "existing-doc-uuid",
  "filename": "annual_report.pdf",
  "status": "complete"
}
```

**Response 200 (no duplicate):**
```json
{"exists": false}
```

---

### POST /api/documents/upload
Upload a new document for processing.

**Headers:** Authorization required, Content-Type: multipart/form-data

**Form fields:**
- `file`: The document file (PDF, DOCX, PNG, etc.)
- `sha256_hash`: Pre-computed SHA256 hex digest of file bytes
- `action`: `"parse"` | `"extract"` | `"chat"` (which tab to open after processing)

**Response 201:**
```json
{
  "success": true,
  "document_id": "new-doc-uuid",
  "filename": "annual_report.pdf",
  "status": "queued",
  "message": "Document queued for processing"
}
```

**Response 400:**
```json
{"success": false, "error": "File type not supported"}
```

**Response 409 (duplicate):**
```json
{
  "success": false,
  "error": "Duplicate document",
  "existing_document_id": "uuid"
}
```

---

### GET /api/documents
List all documents for the current user.

**Headers:** Authorization required

**Response 200:**
```json
{
  "success": true,
  "documents": [
    {
      "id": "uuid",
      "filename": "annual_report.pdf",
      "status": "complete",
      "upload_time": "2024-01-15T10:30:00Z",
      "metadata": {
        "page_count": 45,
        "company_name": "Acme Corp",
        "fiscal_year": 2023,
        "currency": "USD",
        "doc_type": "annual_report"
      }
    }
  ]
}
```

---

### GET /api/documents/{document_id}
Get a single document record with full metadata and extract data.

**Headers:** Authorization required

**Response 200:**
```json
{
  "success": true,
  "document": {
    "id": "uuid",
    "filename": "annual_report.pdf",
    "status": "complete",
    "upload_time": "2024-01-15T10:30:00Z",
    "file_path": "user-uuid/doc-uuid/original.pdf",
    "metadata": {"page_count": 45, "company_name": "Acme Corp", ...},
    "extract_data": {
      "doc_type": "annual_report",
      "company_name": "Acme Corp",
      "fiscal_year": 2023,
      "currency": "USD",
      "income_statement": {...},
      "balance_sheet": {...},
      "cash_flow": {...},
      "key_metrics": {...},
      "red_flags": ["Going concern doubt"],
      "auditor_opinion": "Qualified"
    }
  }
}
```

**Response 404:**
```json
{"success": false, "error": "Document not found"}
```

---

### GET /api/documents/{document_id}/status
SSE endpoint for real-time processing status updates.

**Headers:** Authorization required

**Response:** `Content-Type: text/event-stream`

```
data: {"type": "status", "status": "queued", "progress": 0, "message": "Waiting in queue..."}

data: {"type": "status", "status": "parsing", "progress": 20, "message": "ADE parsing document..."}

data: {"type": "status", "status": "extracting", "progress": 50, "message": "Extracting financial data..."}

data: {"type": "status", "status": "indexing", "progress": 80, "message": "Building search index..."}

data: {"type": "status", "status": "complete", "progress": 100, "message": "Processing complete"}

data: {"type": "error", "message": "ADE API error: rate limit exceeded"}
```

---

### GET /api/documents/{document_id}/file
Get a signed URL to download the original document file (for PDF.js viewer).

**Headers:** Authorization required

**Response 200:**
```json
{
  "success": true,
  "signed_url": "https://supabase-storage-url/...",
  "expires_in": 3600,
  "content_type": "application/pdf"
}
```

---

### GET /api/documents/{document_id}/markdown
Get the ADE-parsed markdown for the document.

**Headers:** Authorization required

**Response 200:**
```json
{
  "success": true,
  "markdown": "# Annual Report 2023\n\n...",
  "chunks": [
    {
      "id": "uuid",
      "type": "title",
      "markdown": "Annual Report 2023",
      "page": 0,
      "bbox": {"left": 0.1, "top": 0.05, "right": 0.9, "bottom": 0.12},
      "section_header": ""
    },
    {
      "id": "uuid2",
      "type": "table",
      "markdown": "<table id='2-1'>...</table>",
      "page": 2,
      "bbox": {"left": 0.06, "top": 0.15, "right": 0.94, "bottom": 0.55},
      "section_header": "Income Statement"
    }
  ]
}
```

---

### DELETE /api/documents/{document_id}
Delete a document and all associated data (grounding, chat history, Qdrant points, storage files).

**Headers:** Authorization required

**Response 200:**
```json
{"success": true, "message": "Document deleted"}
```

---

## 6. Chat Endpoints

### POST /api/chat/stream
Send a chat message and receive a streaming SSE response.

**Headers:** Authorization required, Content-Type: application/json

**Request:**
```json
{
  "document_id": "doc-uuid",
  "query": "What was the revenue growth rate?",
  "session_id": "session-uuid"
}
```

**Response:** `Content-Type: text/event-stream`

```
data: {"type": "token", "content": "Revenue"}

data: {"type": "token", "content": " grew"}

data: {"type": "token", "content": " by 12.5%"}

data: {"type": "done", "best_chunks": ["chunk-uuid-1", "chunk-uuid-2"], "reasoning": "Found revenue data in Income Statement section on page 3."}

data: {"type": "grounding", "bboxes": [
  {"element_id": "chunk-uuid-1", "page": 3, "box": {"left": 0.1, "top": 0.3, "right": 0.9, "bottom": 0.45}, "type": "chunkTable"},
  {"element_id": "3-5", "page": 3, "box": {"left": 0.7, "top": 0.35, "right": 0.88, "bottom": 0.40}, "type": "tableCell"}
]}
```

---

### GET /api/chat/history/{document_id}
Get conversation history for a document session.

**Headers:** Authorization required

**Query params:**
- `session_id` (optional) — get specific session; if omitted, returns most recent session
- `limit` (optional, default 50) — max messages to return

**Response 200:**
```json
{
  "success": true,
  "session_id": "session-uuid",
  "messages": [
    {
      "id": "msg-uuid",
      "role": "user",
      "content": "What was the revenue?",
      "created_at": "2024-01-15T10:35:00Z"
    },
    {
      "id": "msg-uuid-2",
      "role": "assistant",
      "content": "Revenue was $5.2B for fiscal year 2023...",
      "best_chunks": ["chunk-uuid-1"],
      "created_at": "2024-01-15T10:35:02Z"
    }
  ]
}
```

---

### DELETE /api/chat/history/{document_id}
Clear chat history for a document (optionally scoped to session_id).

**Headers:** Authorization required

**Query params:**
- `session_id` (optional)

**Response 200:**
```json
{"success": true, "message": "Chat history cleared"}
```

---

### GET /api/chat/suggestions/{document_id}
Get AI-generated example prompts based on the document content.

**Headers:** Authorization required

**Response 200:**
```json
{
  "success": true,
  "suggestions": [
    "What was the net income for fiscal year 2023?",
    "How does the current ratio compare to the industry standard?",
    "What are the main risk factors mentioned?",
    "Summarize the cash flow from operations."
  ]
}
```

---

## 7. Extract Endpoints

### GET /api/documents/{document_id}/extract
Get the structured financial extract data with grounding info per field.

**Headers:** Authorization required

**Response 200:**
```json
{
  "success": true,
  "extract": {
    "doc_type": {"value": "annual_report", "chunk_id": "uuid", "page": 0, "bbox": {...}},
    "company_name": {"value": "Acme Corp", "chunk_id": "uuid2", "page": 0, "bbox": {...}},
    "fiscal_year": {"value": 2023, "chunk_id": "uuid3", "page": 0, "bbox": {...}},
    "currency": {"value": "USD", "chunk_id": null, "page": null, "bbox": null},
    "income_statement": {
      "revenue": {"value": 5200000000, "chunk_id": "uuid4", "page": 3, "bbox": {...}},
      "net_income": {"value": 520000000, "chunk_id": "uuid5", "page": 3, "bbox": {...}}
    },
    "balance_sheet": {...},
    "cash_flow": {...},
    "key_metrics": {...},
    "red_flags": ["Revenue declined 15% YoY"],
    "auditor_opinion": "Unqualified/Clean"
  }
}
```

---

## 8. Report Endpoints

### POST /api/reports/generate
Generate an AI financial analysis report for a document.

**Headers:** Authorization required

**Request:**
```json
{"document_id": "doc-uuid"}
```

**Response:** `Content-Type: text/event-stream`

```
data: {"type": "section_start", "section": "Executive Summary"}

data: {"type": "token", "content": "Acme Corp reported strong"}

data: {"type": "section_end", "section": "Executive Summary"}

data: {"type": "section_start", "section": "Revenue & Profitability"}

data: {"type": "token", "content": "..."}

data: {"type": "done", "report_id": "report-uuid"}
```

---

### GET /api/reports/{document_id}
Get the most recent generated report for a document.

**Headers:** Authorization required

**Response 200:**
```json
{
  "success": true,
  "report": {
    "id": "report-uuid",
    "doc_id": "doc-uuid",
    "html_content": "<h2>Executive Summary</h2><p>...</p>",
    "created_at": "2024-01-15T11:00:00Z"
  }
}
```

**Response 404:**
```json
{"success": false, "error": "No report generated yet for this document"}
```

---

### GET /api/reports/{document_id}/pdf
Export the report as a PDF file.

**Headers:** Authorization required

**Response 200:** `Content-Type: application/pdf`
Binary PDF file download.

---

## 9. FinBot Endpoints

### POST /api/finbot/chat/stream
Send a message to FinBot and receive a streaming SSE response.

**Headers:** Authorization required

**Request:**
```json
{
  "session_id": "finbot-session-uuid",
  "message": "What is the current price of Apple stock?"
}
```

**Response:** `Content-Type: text/event-stream`

```
data: {"type": "tool_call", "tool": "get_stock_quote", "args": {"symbol": "AAPL"}}

data: {"type": "token", "content": "Apple (AAPL) is currently"}

data: {"type": "token", "content": " trading at $182.45"}

data: {"type": "done", "tools_used": [{"tool": "get_stock_quote", "args": {"symbol": "AAPL"}}]}
```

---

### GET /api/finbot/news
Get financial news for the FinBot sidebar.

**Headers:** Authorization required

**Query params:**
- `category` (optional, default "general") — "general" | "crypto" | "forex" | "merger"
- `limit` (optional, default 10, max 20)

**Response 200:**
```json
{
  "success": true,
  "news": [
    {
      "title": "Fed signals rate cuts ahead",
      "source": "Reuters",
      "url": "https://...",
      "date": "2024-01-15 09:30",
      "summary": "Federal Reserve officials signaled...",
      "category": "general",
      "image": "https://..."
    }
  ]
}
```

---

### DELETE /api/finbot/chat/{session_id}
Clear FinBot conversation history for a session.

**Headers:** Authorization required

**Response 200:**
```json
{"success": true}
```

---

## 10. SSE Event Format Reference

All SSE endpoints emit newline-delimited JSON after `data: `.

### Universal Events
```
data: {"type": "error", "message": "Description of error"}
data: {"type": "done"}
```

### Chat-specific Events
```
data: {"type": "token", "content": "partial text"}
data: {"type": "done", "best_chunks": ["uuid1", "uuid2"], "reasoning": "..."}
data: {"type": "grounding", "bboxes": [{"element_id": "uuid", "page": 0, "box": {"left":0.1,"top":0.2,"right":0.9,"bottom":0.4}, "type": "chunkTable"}]}
```

### Report-specific Events
```
data: {"type": "section_start", "section": "Executive Summary"}
data: {"type": "token", "content": "partial text"}
data: {"type": "section_end", "section": "Executive Summary"}
data: {"type": "done", "report_id": "uuid"}
```

### FinBot-specific Events
```
data: {"type": "tool_call", "tool": "get_stock_quote", "args": {"symbol": "AAPL"}}
data: {"type": "token", "content": "partial text"}
data: {"type": "done", "tools_used": [...]}
```

### Document Status Events
```
data: {"type": "status", "status": "queued|parsing|extracting|indexing|complete|error", "progress": 0-100, "message": "..."}
```

---

## 11. Error Codes

| HTTP Status | When |
|-------------|------|
| 200 | Success |
| 201 | Resource created (document upload) |
| 400 | Bad request (invalid input, unsupported file type) |
| 401 | Not authenticated (missing or invalid JWT) |
| 403 | Authenticated but not authorized (wrong user for this resource) |
| 404 | Resource not found |
| 409 | Conflict (duplicate document hash) |
| 429 | Rate limited (ADE or OpenAI rate limit propagated) |
| 500 | Internal server error |
| 503 | ADE or OpenAI service unavailable |

---

## 12. Request Size Limits

- Document upload: 100 MB max (Render.com limit; ADE handles up to 1 GB via parse_jobs but we limit upload)
- Chat message: 4000 chars max
- FinBot message: 2000 chars max

---

## 13. FastAPI StreamingResponse Pattern

```python
# app.py — SSE endpoint pattern used for all streaming endpoints
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import json

@app.post("/api/chat/stream")
async def chat_stream(
    body: ChatQuery,
    current_user: dict = Depends(get_current_user)
):
    async def event_generator():
        async for event in chat_engine.stream(
            document_id=body.document_id,
            query=body.query,
            session_id=body.session_id,
            user_id=current_user["id"]
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"  # Disable Nginx buffering on Render
        }
    )
```
