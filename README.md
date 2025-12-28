# Alpha Lens - Financial Document Analyzer

A professional financial document analysis platform powered by Landing.AI ADE and GPT-3.5-turbo.

## Features

- 📄 **Document Upload & Processing**: Upload PDF documents and extract structured financial data
- 🔍 **Intelligent Parsing**: Automatic detection of tables, text, charts, and marginalia
- 💬 **AI Chat Assistant**: Chat with your documents using GPT-3.5-turbo with document references
- 📊 **Interactive Visualization**: View documents with detected regions and parsed data side-by-side
- 🔐 **User Authentication**: Secure login/signup with Supabase

## Tech Stack

- **Backend**: FastAPI, Python
- **Frontend**: HTML, CSS, JavaScript
- **AI/ML**: Landing.AI ADE, OpenAI GPT-3.5-turbo
- **Authentication**: Supabase
- **PDF Rendering**: PDF.js

## Setup

### Prerequisites

- Python 3.11+
- Supabase account
- Landing.AI API key
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
LANDING_AI_API_KEY=your_landing_ai_key
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

### Prerequisites

- GitHub repository with your code
- Render account (free tier available)

### Quick Deployment Steps

1. **Push your code to GitHub**:
```bash
git add .
git commit -m "Ready for deployment"
git push origin main
```

2. **Create a new Web Service on Render**:
   - Go to [Render Dashboard](https://dashboard.render.com)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select your repository

3. **Configure the service**:
   - **Name**: `alpha-lens` (or your preferred name)
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`

4. **Add Environment Variables** (Required):
   - `VISION_AGENT_API_KEY`: Your Landing.AI API key
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_ANON_KEY`: Your Supabase anon key
   - `PYTHON_VERSION`: `3.11.0` (optional, defaults in render.yaml)

5. **Deploy**:
   - Click "Create Web Service"
   - Render will automatically build and deploy your application
   - Your app will be available at `https://alpha-lens.onrender.com` (or your custom domain)

### Using render.yaml (Recommended)

The project includes a `render.yaml` file for automated deployment:

1. Ensure `render.yaml` is in your repository root
2. In Render Dashboard, select "New +" → "Blueprint"
3. Connect your GitHub repository
4. Render will automatically detect and use `render.yaml`
5. Add environment variables in Render dashboard (they won't be synced from render.yaml for security)

## Project Structure

```
alpha_lens/
├── app.py                 # FastAPI application
├── document_processor.py  # Document processing logic
├── chat_engine.py        # Chat/AI integration
├── auth.py               # Authentication utilities
├── config.py             # Configuration management
├── vector_store.py       # Vector store operations
├── requirements.txt      # Python dependencies
├── render.yaml          # Render deployment config
├── Procfile             # Process file for deployment
├── static/              # Static files (CSS, JS, images)
│   ├── css/
│   ├── js/
│   └── img/
├── index.html           # Main frontend page
├── login.html           # Login/signup page
└── .env                 # Environment variables (not in git)
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `VISION_AGENT_API_KEY` | Landing.AI ADE API key | ✅ Yes | - |
| `OPENAI_API_KEY` | OpenAI API key for GPT-3.5-turbo | ✅ Yes | - |
| `SUPABASE_URL` | Supabase project URL | ✅ Yes | - |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | ✅ Yes | - |
| `ADE_ENDPOINT` | Landing.AI ADE endpoint | ❌ No | `https://api.va.landing.ai/v1/ade` |
| `HOST` | Server host | ❌ No | `0.0.0.0` |
| `PORT` | Server port | ❌ No | `8000` (Render sets automatically) |
| `DEBUG` | Debug mode | ❌ No | `False` |

## Development

### Running Locally

```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

### Testing

The application includes:
- Document upload and processing
- Authentication flow
- Chat functionality
- PDF rendering with overlays

## License

MIT License

## Support

For issues or questions, please open an issue on GitHub.
