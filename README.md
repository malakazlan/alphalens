# Alpha Lens

**Reason with your financial documents.** A production-ready financial document analyzer powered by Landing.AI Agentic Document Extraction (ADE) and OpenAI. Upload PDFs, extract structured data, and chat with your documents using context-aware AI with cell-level visual references.

## Features

- **Document Upload & Processing** — Upload PDFs and extract structured financial data via Landing.AI ADE (DPT-2)
- **Region-Aware Extraction** — Automatic detection of tables, table cells, text, charts, and marginalia with bounding boxes
- **Parse, Extract, Chat** — Three-panel analyzer with Markdown/JSON views, key metrics, and document chat
- **Full-Context Chat** — Feeds the entire document (with element IDs) to the LLM for accurate, citation-grounded answers — no RAG retrieval gaps
- **Visual References** — Clickable citations that highlight the exact cells or regions on the PDF (Landing.AI-style)
- **Structured Table Lookup** — Direct value lookups for simple questions (e.g. "how much is tuition fee?") without LLM calls
- **Currency & Context** — Automatic currency detection (PKR, USD, EUR, etc.) and document metadata injection
- **User Authentication** — Secure login/signup with Supabase
- **FinBot** — Market news feed and financial insights (optional)
- **PDF Reports** — Generate downloadable reports from extracted data

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | FastAPI, Python 3.11+ |
| Frontend | HTML, CSS, JavaScript (vanilla) |
| Document AI | Landing.AI ADE (Agentic Document Extraction, DPT-2) |
| LLM | OpenAI GPT-4o-mini |
| Auth & Storage | Supabase |
| PDF Rendering | PDF.js |
| Embeddings | OpenAI text-embedding-3-small (RAG fallback) |

## How It Works

1. **Upload** — User uploads a PDF; backend stores it in Supabase and queues processing.
2. **Extract** — Landing.AI ADE parses the document and returns markdown with embedded element IDs plus a grounding dict (ID → bounding box).
3. **Map** — `document_processor` maps ADE output to a financial schema (metadata, key metrics, tables, detected chunks).
4. **Chat** — For each query:
   - Greetings → instant response
   - Simple value lookups → structured table search (no LLM)
   - General questions → full document context + LLM; LLM cites `[[id]]`; backend maps IDs to grounding for visual highlights

## Setup

### Prerequisites

- Python 3.11+
- Supabase account
- Landing.AI API key (`VISION_AGENT_API_KEY`)
- OpenAI API key (`OPENAI_API_KEY`)

### Installation

```bash
git clone https://github.com/YOUR_ORG/alpha_lens.git
cd alpha_lens

python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate

pip install -r requirements.txt
```

Create a `.env` file:

```env
VISION_AGENT_API_KEY=your_landing_ai_key
OPENAI_API_KEY=your_openai_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

Run the application:

```bash
uvicorn app:app --reload
```

Open `http://localhost:8000` in your browser.

## Deployment (Render)

The app is production-ready for Render.

1. Push your code to GitHub.
2. Create a Web Service on Render and connect your repo.
3. **Build Command**: `pip install -r requirements.txt`
4. **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`
5. Add environment variables in the Render dashboard:
   - `VISION_AGENT_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`
   - Optional: `FINNHUB_API_KEY` (FinBot news feed)

Or use the included `render.yaml` for one-click setup.

## Project Structure

```
alpha_lens/
├── app.py                 # FastAPI app, routes, chat API
├── document_processor.py  # ADE integration, financial schema, grounding
├── chat_engine.py         # Full-context chat, structured lookup, ID citations
├── llm_service.py        # OpenAI LLM (full-context + RAG fallback)
├── vector_store.py       # Embeddings, hybrid search (RAG fallback)
├── auth.py               # Supabase authentication
├── storage_service.py    # Supabase storage
├── database_service.py   # Supabase database
├── report_service.py     # PDF report generation
├── finbot_service.py     # Market news, FinBot
├── config.py             # Configuration
├── requirements.txt
├── render.yaml           # Render deployment config
├── static/               # CSS, JS, images
├── index.html            # Main frontend (analyzer, chat, viewer)
└── login.html            # Login/signup
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `VISION_AGENT_API_KEY` | Landing.AI ADE API key | Yes |
| `OPENAI_API_KEY` | OpenAI API key | Yes |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_ANON_KEY` | Supabase anon key | Yes |
| `ADE_ENDPOINT` | Landing.AI ADE endpoint | No (default) |
| `FINNHUB_API_KEY` | Finnhub API (FinBot) | No |
| `HOST`, `PORT` | Server config | No |

## License

MIT License

## Support

For issues or questions, open an issue on GitHub.
