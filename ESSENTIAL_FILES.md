# Essential Files for Deployment

## ✅ Core Application Files (REQUIRED)
- `app.py` - Main FastAPI application
- `auth.py` - Authentication utilities
- `chat_engine.py` - Chat/AI integration
- `config.py` - Configuration management
- `document_processor.py` - Document processing logic
- `landing_ai_chat.py` - Landing.AI chat integration
- `llm_service.py` - LLM service
- `vector_store.py` - Vector store operations

## ✅ Frontend Files (REQUIRED)
- `index.html` - Main dashboard page
- `login.html` - Login/signup page
- `static/css/style.css` - All CSS styles
- `static/js/main.js` - All JavaScript
- `static/img/` - Images (logo, home illustration)

## ✅ Deployment Files (REQUIRED)
- `requirements.txt` - Python dependencies
- `Procfile` - Process definition for Render
- `render.yaml` - Render service configuration
- `runtime.txt` - Python version specification
- `.gitignore` - Git ignore rules

## ✅ Documentation (OPTIONAL but recommended)
- `README.md` - Project documentation
- `DEPLOYMENT_CHECKLIST.md` - Deployment guide

## ❌ Removed Files (NOT NEEDED)
- `setup.bat` - Local Windows setup script
- `setup.sh` - Local Linux/Mac setup script
- `Dockerfile` - Docker configuration (using Render instead)
- `docker-compose.yml` - Docker compose (using Render instead)
- `GITHUB_503_SOLUTION.md` - Temporary troubleshooting doc
- `img/` - Duplicate image directory (using `static/img/` instead)

## 📝 Notes
- All images are now in `static/img/` and referenced via `/static/img/`
- Login page updated to use `/static/img/` path
- Only essential files remain for clean deployment

