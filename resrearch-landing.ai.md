# Landing.AI ADE: comprehensive technical brief

**Landing.AI's Agentic Document Extraction (ADE) is an API-first document intelligence platform that converts visually complex documents into structured, grounded data using a specialized vision model called DPT-2.** ADE achieved **99.16% accuracy on the DocVQA benchmark** and has processed billions of pages. Unlike OCR+LLM approaches that flatten documents to text, ADE treats documents as visual systems — preserving layout, spatial relationships, and structural elements. The platform provides three modular APIs (Parse → Split → Extract) with every extracted element tied to **normalized bounding box coordinates** for full traceability.

This brief covers all eight requested dimensions: the chat UI/UX, the complete API surface, large document handling, ambiguous query resolution, table cell understanding, RAG architecture patterns, visual grounding mechanics, and Python SDK usage.

---

## 1. The document chat UI/UX and visual grounding overlay

Landing.AI's interactive experience lives in the **Playground at va.landing.ai**, a web-based demo featuring a two-pane layout: the document viewer on the left and an extracted data/chat panel on the right. After uploading a document, users access a "Chat with Document" tool — an LLM layered on top of ADE's parsed output. The critical architectural detail: **the chat pipeline never sees the original images**. It operates solely on the structured markdown/JSON output from the Parse API.

When a user asks a question (e.g., "What is the patient's glucose level?"), the system returns three things: the correct answer, an explanation of reasoning, and **visual grounding** linking the answer to the exact source location in the document. For tables, this goes down to the individual cell level. The system also auto-generates suggested prompts based on document content and includes safeguards — it refuses to generate information not present in the source document, preventing hallucination.

The citation system works through **element IDs embedded as HTML anchors** in the parsed markdown. Each chunk begins with `<a id='UUID'></a>`, and the LLM is prompted to return `best_chunks` referencing specific chunk IDs. The UI maps those IDs back to their bounding boxes in the grounding dictionary and draws highlight rectangles on the rendered PDF page. Landing.AI's Part 2 blog tutorial demonstrates this exact pattern in a Streamlit app: the LLM returns structured JSON (`{answer, reasoning, best_chunks}`), and the app uses OpenCV to overlay green bounding box rectangles at the coordinates specified in each chunk's grounding data.

---

## 2. The ADE API: parse(), extract(), and split() in full detail

### parse() — the foundation of every workflow

The Parse API (`POST /v1/ade/parse`) converts documents into structured data. It accepts either a file upload (`document`) or a URL (`document_url`), with an optional `model` parameter (use `dpt-2-latest` for the current model) and an optional `split="page"` parameter to organize output by page.

**The response (`ParseResponse`) contains five top-level fields:**

```python
{
  "markdown": "<complete markdown content>",   # Full document as Markdown
  "chunks": [...],                              # Array of Chunk objects
  "splits": [...],                              # Page/section splits (if requested)
  "grounding": {...},                           # Element ID → bbox mapping
  "metadata": {...}                             # filename, page_count, duration_ms, credits, job_id
}
```

Each **Chunk object** contains:
```json
{
  "id": "7d58c5cf-e4f5-4a7e-ba34-0cd7bc6a6506",
  "type": "text",
  "markdown": "<a id='7d58c5cf-...'></a>\n\nSKU\nWH-2847-BLK",
  "grounding": {
    "page": 0,
    "box": { "left": 0.0663, "top": 0.0951, "right": 0.4665, "bottom": 0.2678 }
  }
}
```

Chunk types span **14 categories** in DPT-2: `text`, `table`, `figure`, `card`, `attestation`, `scan_code`, `logo`, `form`, `key_value`, `title`, `page_header`, `page_footer`, `page_number`, and `error`. The markdown representation uses page break comments (`<!-- PAGE BREAK -->`), HTML anchor tags for chunk IDs, and full HTML table markup with cell-level IDs.

### How element IDs in the markdown map to grounding data

There are **three distinct ID formats**:

- **Chunk IDs** are UUIDs (e.g., `7d58c5cf-e4f5-4a7e-ba34-0cd7bc6a6506`), embedded as `<a id='UUID'></a>` in markdown
- **Table IDs** follow `{page}-{base62_seq}` (e.g., `<table id="0-1">` for the first table on page 0)
- **Cell IDs** follow the same `{page}-{seq}` pattern (e.g., `<td id="0-2">`, `<td id="0-3">`)
- **Spreadsheet IDs** use Excel notation (e.g., `Sheet 1-A1`, `Sheet 1-B2`)

The **top-level `grounding` dictionary** is keyed by these element IDs and provides richer metadata than the chunk-level grounding, including the `type` field with more specific values (`chunkText`, `chunkTable`, `chunkFigure`, `tableCell`) and, critically, the `position` field for table cells.

### extract() — schema-driven structured data extraction

The Extract API (`POST /v1/ade/extract`) takes a JSON schema and markdown from a prior parse call, then uses LLM reasoning to pull structured fields. The Python SDK provides a `pydantic_to_json_schema()` utility for converting Pydantic models:

```python
from landingai_ade import LandingAIADE
from landingai_ade.lib import pydantic_to_json_schema
from pydantic import BaseModel, Field

class InvoiceFields(BaseModel):
    vendor_name: str = Field(description="The vendor's full legal name")
    total_amount: float = Field(description="Total invoice amount in USD")
    line_items: list[dict] = Field(description="Array of line items with description and price")

client = LandingAIADE()
parse_response = client.parse(document=Path("invoice.pdf"), model="dpt-2-latest")
extract_response = client.extract(
    schema=pydantic_to_json_schema(InvoiceFields),
    markdown=parse_response.markdown
)
```

The extract output includes the extracted data conforming to the schema, plus an `id` for the source chunk. **Crucially, Extract does not include bounding boxes directly** — you must map the returned chunk `id` back to the Parse response's grounding dictionary to locate the source region. This is the correct approach for building grounded extraction pipelines.

### split() — multi-document PDF separation

The Split API (`POST /v1/ade/split`) classifies pages into sub-documents using user-defined rules. Each rule has a `name`, `description`, and optional `identifier` (a field that distinguishes instances, like an invoice number or date):

```python
split_response = client.split(
    split_class=[
        {"name": "Bank Statement", "description": "Account activity summary"},
        {"name": "Pay Stub", "description": "Employee earnings", "identifier": "Pay Stub Date"}
    ],
    markdown=parse_response.markdown,
    model="split-latest"
)
for split in split_response.splits:
    print(f"{split.classification}: pages {split.pages}, identifier={split.identifier}")
```

Each split in the response contains `classification`, `identifier`, `pages` (array of page numbers), `markdown` (content for that sub-document), and `chunks` (array of chunk IDs). Unmatched pages appear under "Uncategorized." The system uses **instance detection** — recognizing repeated identifiers like invoice numbers to find document boundaries even without explicit separators.

---

## 3. How ADE handles documents with 100+ tables

Landing.AI addresses large document processing at two levels: **infrastructure** (getting the document parsed) and **retrieval** (getting relevant answers from the parsed output).

At the infrastructure level, the ADE library **automatically splits large PDFs** into manageable chunks that respect API rate limits, processes them in **parallel using a thread pool**, and stitches results back together as a single coherent output. This has been tested on **1,000+ page PDFs**. Configurable parameters include `BATCH_SIZE` (default 4 files in parallel), `MAX_WORKERS` (default 5 threads per file), and exponential-backoff retry logic. For production workloads, the **Parse Jobs API** (`/v1/ade/parse/jobs`) provides async processing for files up to 1,000 pages or 1 GB, with polling for completion and support for Zero Data Retention (ZDR) workflows.

For retrieval, Landing.AI explicitly recommends **chunked RAG** rather than full-context for large documents. Their Part 2 blog tutorial states: "Instead of dumping all evidence into the context window for each LLM query, store each chunk in a vector database. When the user queries, perform a semantic search to grab only the relevant chunks." The benefits they cite: reduced token usage, improved relevance and speed, and scaling to large corpora without memory issues. Their helper scripts repository includes dedicated RAG workflows using **ChromaDB** for vector storage.

The `split="page"` parameter on the Parse API organizes output chunks by page, giving you natural boundaries for chunking. Large tables spanning multiple pages are handled with **boundary overlap** to maintain context across page breaks. ADE also supports **large table extraction with thousands of rows** — DPT-2's region decomposition approach breaks complex tables into smaller regions for independent parallel processing, then reassembles them.

---

## 4. How ADE handles ambiguous queries like "what is revenue?"

ADE's approach to disambiguating queries operates across multiple layers, none of which involve a single "disambiguation engine." Instead, the architecture is designed so that **ambiguity is resolved through structural context, grounding, and schema design**.

**Structural context from parsing.** ADE's parse output preserves the document's visual hierarchy. A financial statement parsed by ADE produces separate typed chunks — the income statement's revenue line is a distinct chunk from the balance sheet's reference to revenue. Each chunk carries its page number, position, and surrounding context (headers, section titles). When this structured output feeds into a vector database, retrieval naturally surfaces chunks with their structural context intact.

**Schema-driven extraction eliminates ambiguity.** Rather than asking "what is revenue?" of a raw document, the correct ADE pattern is to define a precise Pydantic schema: `income_statement_revenue: float = Field(description="Total revenue from the Income Statement")` vs. `cash_flow_from_operations: float = Field(description="Revenue referenced in cash flow statement")`. The Extract API uses LLM reasoning against the full markdown to find the right value for each field, using the document's visual structure to disambiguate.

**Visual grounding as disambiguation.** Even when the LLM selects an answer, the grounding system proves which specific location the answer came from. If a user asks "what is revenue?" in the chat interface, the system returns the answer **and** highlights the exact table cell on the exact page. The user can immediately verify whether the system chose the income statement, the balance sheet, or the cash flow statement. The best_chunks mechanism in the LLM response enables the UI to show multiple matching locations when appropriate.

**RAG retrieval with section context.** When building a chat system over ADE output, each chunk stored in the vector database should include metadata: page number, chunk type, and importantly the surrounding section headers. A query like "in the balance sheet, what is revenue?" naturally retrieves chunks from the balance sheet section due to keyword and semantic overlap, while "income statement revenue" retrieves from the income statement. The chunk's grounding data confirms the source.

---

## 5. Table cell relationships: how ADE represents header-cell dependencies

ADE's table extraction through DPT-2 provides a **three-level grounding hierarchy** that explicitly encodes cell relationships:

**Level 1 — `chunkTable`**: The entire table as a semantic unit, with one bounding box covering the full table region. This is the chunk-level entry with a UUID.

**Level 2 — `table`**: The HTML `<table>` element with an ID like `0-1`, providing precise table boundaries (slightly different from the chunk-level box which may include surrounding context).

**Level 3 — `tableCell`**: Each individual cell with its own ID (`0-2`, `0-3`, etc.) and critically, a `position` field:

```json
{
  "0-2": {
    "box": { "left": 0.025, "top": 0.347, "right": 0.504, "bottom": 0.545 },
    "page": 0,
    "type": "tableCell",
    "position": { "row": 0, "col": 0, "rowspan": 1, "colspan": 1, "chunk_id": "54905c88-..." }
  }
}
```

The **`position.row` and `position.col` values** (zero-indexed) encode the cell's location in the table grid. Combined with the HTML table markup in the markdown (which preserves the complete `<tr>/<td>` structure with IDs), any downstream system can reconstruct the full relationship: a cell at `row: 3, col: 2` inherits meaning from the header cell at `row: 0, col: 2` (column header) and the label at `row: 3, col: 0` (row label). **Merged cells are represented via `rowspan` and `colspan`** values greater than 1.

The markdown output for tables uses full HTML with cell-level IDs:
```html
<table id="0-1">
<tr><td id="0-2">Account Type</td><td id="0-3">APY</td></tr>
<tr><td id="0-4">Checking</td><td id="0-5">0.25%</td></tr>
<tr><td id="0-6">Savings</td><td id="0-7">3.30%</td></tr>
</table>
```

For the chat system to reason about "in the balance sheet, what is revenue?" vs. "in the income statement, what is revenue?", the correct pattern is to leverage section context. ADE's chunks include `title` and `text` chunks that precede table chunks, so the markdown flow reads: `[title: "Balance Sheet"] → [table: assets and liabilities]` vs. `[title: "Income Statement"] → [table: revenue and expenses]`. When these chunks are stored in a vector database with their page numbers and positions, retrieval naturally associates each table with its section header. The LLM receiving the retrieved chunks sees the section title alongside the table data and can correctly identify which table contains the relevant "revenue" row.

---

## 6. The recommended RAG architecture for chat-over-document systems

Landing.AI prescribes a clear architectural pattern, documented across their official guides, helper scripts, and the DeepLearning.AI course. The recommended approach is **parse once, chunk into a vector store, retrieve semantically, generate with grounding**.

**Step 1: Parse once with ADE.** Convert documents to markdown + chunks with grounding metadata. This is the most expensive step and should only happen once per document. ADE's parsed output is so complete that an LLM can answer **99.16% of DocVQA questions** using only the parsed markdown — never seeing the original image.

**Step 2: Store chunks in a vector database.** Each chunk is naturally sized for retrieval. Store each chunk with its metadata: `chunk_id`, `chunk_type`, `page` number, `bbox` coordinates, and the surrounding section context. Landing.AI's helper scripts demonstrate this with **ChromaDB** and **OpenAI embeddings**.

**Step 3: Retrieve relevant chunks via semantic search.** When a user queries, embed the query and retrieve the top-k matching chunks. This is far more efficient than passing the entire document into the LLM context window, especially for 100+ page documents.

**Step 4: Generate answers with an LLM, return best_chunks.** Pass retrieved chunks as context to GPT-4o (or similar). Prompt the LLM to return structured JSON: `{answer, reasoning, best_chunks}`. The `best_chunks` field contains the chunk IDs that the LLM relied on for its answer.

**Step 5: Map chunk IDs back to grounding for visual citation.** Use the chunk IDs to look up bounding box coordinates in the parse response's grounding dictionary. Render highlight overlays on the PDF page at those coordinates.

Landing.AI's production case study (Eolas Medical) follows this exact pattern in healthcare, achieving a **90% improvement in retrieval speed** and **78% rise in clinician trust**. Their Snowflake integration demonstrates the same flow: parse → flatten to chunked table → index in Cortex Search → RAG queries with semantic search and grounded citations. The DeepLearning.AI course adds an AWS deployment pattern: S3 upload triggers ADE parsing → Bedrock Knowledge Base → Strands Agents for Q&A.

The key insight from Landing.AI: **do not use full-context for large documents**. Their blog explicitly states that vector-based chunked retrieval "reduces token usage, improves relevance and speed, and scales to a large corpus without memory issues." However, for small documents (under ~20 pages), passing the full parsed markdown directly to the LLM is acceptable and simpler.

---

## 7. Visual grounding: the bounding box coordinate system and highlighting mechanics

**All bounding box coordinates use normalized values between 0 and 1**, where `(0, 0)` is the top-left corner and `(1, 1)` is the bottom-right corner of the page. The format is `{ left, top, right, bottom }` in the current API (the legacy `agentic-doc` library used abbreviated keys `l, t, r, b`).

To convert to pixel coordinates for rendering overlays:
```python
pixel_x1 = int(box.left * image_width)
pixel_y1 = int(box.top * image_height)
pixel_x2 = int(box.right * image_width)
pixel_y2 = int(box.bottom * image_height)
```

The **end-to-end grounding workflow** for building a citation system:

1. **Parse** the document → receive chunks with IDs and bounding boxes
2. **Store** chunks in vector DB with grounding metadata
3. **Retrieve** relevant chunks at query time
4. **Generate** answer with LLM, which returns `best_chunks` chunk IDs
5. **Look up** each chunk ID in the grounding dictionary → get `page` + `box`
6. **Render** the PDF page as an image (Landing.AI's tutorial uses PyMuPDF at 200 DPI)
7. **Draw** rectangle overlays at the pixel coordinates using OpenCV or similar

For table cells specifically, the grounding dictionary provides cell-level bounding boxes. If the LLM's answer references a specific cell value, you can highlight just that cell rather than the entire table — enabling precise "point to the exact number" citation in the UI.

The **grounding `type` values** are more specific than chunk types: `chunkText`, `chunkTable`, `chunkFigure`, `tableCell`, etc. Confidence scores (0.0–1.0) are available for both chunk-level and cell-level grounding when using DPT-2, enabling quality indicators in the UI.

---

## 8. Python SDK: landingai-ade package and correct usage patterns

The current official package is **`landingai-ade`** (`pip install landingai-ade`), which replaced the deprecated `agentic-doc` library. It's auto-generated using Stainless from the API spec and requires Python 3.9+.

### Client initialization and core methods

```python
from landingai_ade import LandingAIADE, AsyncLandingAIADE
from landingai_ade.lib import pydantic_to_json_schema
from pathlib import Path

# Sync client (reads VISION_AGENT_API_KEY from env by default)
client = LandingAIADE(timeout=480.0, max_retries=2)

# Parse
parse_resp = client.parse(document=Path("file.pdf"), model="dpt-2-latest")

# Extract
extract_resp = client.extract(schema=schema_json, markdown=parse_resp.markdown)

# Split
split_resp = client.split(
    split_class=[{"name": "Invoice", "description": "..."}],
    markdown=parse_resp.markdown, model="split-latest"
)
```

### Async client for concurrent operations

```python
import asyncio
from landingai_ade import AsyncLandingAIADE, DefaultAioHttpClient

async def process():
    async with AsyncLandingAIADE(http_client=DefaultAioHttpClient()) as client:
        response = await client.parse(document=Path("file.pdf"), model="dpt-2-latest")
        return response

# Install async support: pip install 'landingai-ade[aiohttp]'
```

The async client has **identical method signatures** to the sync client — just prepend `await`. Use `DefaultAioHttpClient` for better concurrency in batch operations.

### Parse Jobs for large files (up to 1,000 pages)

```python
# Create async job
job = client.parse_jobs.create(document=Path("large.pdf"), model="dpt-2-latest")

# Poll for completion (recommended: every 15-30 seconds)
import time
while True:
    status = client.parse_jobs.get(job.job_id)
    if status.status == "completed":
        break
    time.sleep(15)

# Access results
print(status.data.markdown[:200])
print(f"Chunks: {len(status.data.chunks)}")

# For results >1MB, download from status.output_url
# For ZDR: use document_url and output_save_url with pre-signed cloud storage URLs
```

### Response handling and error management

All responses are Pydantic models with `to_json()`, `to_dict()`, and `model_fields_set` for distinguishing null vs. missing. The SDK auto-retries on status codes 408, 409, 429, and 500+ with **exponential backoff** (0.5s initial, up to 8s, 2 retries). Configuration uses `VISION_AGENT_API_KEY` for authentication and optionally `LANDINGAI_ADE_BASE_URL` for custom endpoints. Set `LANDINGAI_ADE_LOG=debug` for detailed logging.

### API regions

- **US**: `https://api.va.landing.ai/v1/ade/`
- **EU**: `https://api.va.eu-west-1.landing.ai/v1/ade/`

Select via `environment="production"` (US default) or `environment="eu"`.

---

## A note on the alphalens repository

The repository at `github.com/malakazlan/alphalens` could not be accessed — the GitHub user `malakazlan` does not appear to have a public profile, and the repository is not indexed by any search engine. It is likely either **private, deleted, or renamed**. No connection between "alphalens" and Landing.AI's ADE was found in public sources. To review the existing codebase against ADE best practices, authenticated access to the repository would be needed.

---

## Conclusion

Landing.AI's ADE platform is fundamentally a **parsing and extraction API**, not a complete chat application. The chat experience demonstrated in their Playground is a thin LLM layer on top of the structured parse output — a pattern they encourage developers to replicate. The correct architectural approach for building a chat-over-document system is: parse once with DPT-2, store grounded chunks in a vector database with full metadata (page, type, bbox, section context), retrieve semantically at query time, generate answers with chunk-ID citations, and map citations back to bounding boxes for visual grounding overlays.

The most important design decisions to get right: use **chunked RAG** (not full context) for documents over ~20 pages; define **precise Pydantic schemas** for extraction to avoid ambiguity; store **section headers alongside table chunks** to enable context-aware retrieval; and always preserve the **grounding dictionary from the parse response** — it's the bridge between LLM answers and visual proof in the document.