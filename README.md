# Alpha Lens - Financial Document Analyzer

A professional financial document analysis platform powered by Landing.AI Agentic Document Extraction (ADE) and OpenAI. Analyze PDFs, extract structured data, and chat with your documents using context-aware AI with visual references.

## Features

- **Document Upload & Processing**: Upload PDF documents and extract structured financial data via Landing.AI ADE
- **Intelligent Parsing**: Automatic detection of tables, table cells, text, charts, and marginalia with bounding boxes
- **Parse, Extract, Chat**: Three-panel analyzer with Markdown/JSON views, key metrics extraction, and document chat
- **AI Chat with Visual References**: Ask questions about your document; answers include clickable citations that highlight the exact cells or regions on the PDF
- **Full-Context Reasoning**: Chat engine feeds the full document (with element IDs) to the LLM for accurate, citation-grounded answers
- **User Authentication**: Secure login/signup with Supabase

## Tech Stack

- **Backend**: FastAPI, Python 3.11+
- **Frontend**: HTML, CSS, JavaScript (vanilla)
- **Document AI**: Landing.AI ADE (Agentic Document Extraction, DPT-2)
- **LLM**: OpenAI GPT-4o-mini
- **Authentication**: Supabase
- **PDF Rendering**: PDF.js

## Setup

### Prerequisites

- Python 3.11+
- Supabase account
- Landing.AI API key (VISION_AGENT_API_KEY)
- OpenAI API key

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd alpha_lens
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Create a `.env` file:
```env
VISION_AGENT_API_KEY=your_landing_ai_key
OPENAI_API_KEY=your_openai_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

5. Run the application:
```bash
uvicorn app:app --reload
```

6. Open your browser and navigate to `http://localhost:8000`

## Deployment to Render

The application is production-ready for Render deployment.

1. **Push your code to GitHub**

2. **Create a Web Service on Render**:
   - Connect your GitHub repository
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`

3. **Add Environment Variables**:
   - `VISION_AGENT_API_KEY`: Landing.AI ADE API key
   - `OPENAI_API_KEY`: OpenAI API key
   - `SUPABASE_URL`: Supabase project URL
   - `SUPABASE_ANON_KEY`: Supabase anon key

4. Deploy. Your app will be available at your Render URL.

## Project Structure

```
alpha_lens/
├── app.py                 # FastAPI application, routes, chat API
├── document_processor.py  # ADE integration, financial schema mapping
├── chat_engine.py         # Full-context chat, structured lookup, citations
├── llm_service.py        # OpenAI LLM integration
├── vector_store.py       # Embeddings, hybrid search (RAG fallback)
├── auth.py               # Supabase authentication
├── config.py             # Configuration management
├── requirements.txt      # Python dependencies
├── render.yaml           # Render deployment config
├── static/               # CSS, JS, images
├── index.html            # Main frontend (analyzer, chat, document viewer)
├── login.html            # Login/signup page
└── .env                  # Environment variables (not in git)
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `VISION_AGENT_API_KEY` | Landing.AI ADE API key | Yes |
| `OPENAI_API_KEY` | OpenAI API key (GPT-4o-mini) | Yes |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | Yes |
| `ADE_ENDPOINT` | Landing.AI ADE endpoint | No (default provided) |
| `HOST` | Server host | No |
| `PORT` | Server port | No |

## License

MIT License

## Support

For issues or questions, please open an issue on GitHub.
