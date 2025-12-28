# Alpha Lens - Deployment Guide

## Status: ✅ READY FOR DEPLOYMENT

All required files have been verified and updated for Render deployment.

## Required Files

### Core Application Files
- ✅ `app.py` - Main FastAPI application
- ✅ `auth.py` - Authentication module
- ✅ `config.py` - Configuration settings
- ✅ `chat_engine.py` - Chat functionality
- ✅ `llm_service.py` - LLM service
- ✅ `document_processor.py` - Document processing
- ✅ `storage_service.py` - Supabase storage
- ✅ `database_service.py` - Supabase database
- ✅ `vector_store.py` - Vector store
- ✅ `report_service.py` - Report generation

### Deployment Files
- ✅ `requirements.txt` - All dependencies with versions
- ✅ `Procfile` - Web service startup command
- ✅ `runtime.txt` - Python 3.11
- ✅ `render.yaml` - Render deployment configuration
- ✅ `.gitignore` - Excludes sensitive files

### Frontend Files
- ✅ `index.html` - Main page
- ✅ `login.html` - Login page
- ✅ `static/css/style.css` - Styles
- ✅ `static/js/main.js` - Main JavaScript
- ✅ `static/js/modules/` - All JavaScript modules

## Environment Variables

### Required (Must Set in Render Dashboard):
These are **required** for the application to work:

- `VISION_AGENT_API_KEY` - Landing.AI ADE API key (required for document processing)
- `OPENAI_API_KEY` - OpenAI API key (required for chat functionality)
- `SUPABASE_URL` - Supabase project URL (required for authentication & database)
- `SUPABASE_ANON_KEY` - Supabase anonymous key (required for authentication & database)

### Optional (Have Defaults - Don't Need to Set):
These have default values and work without setting:

- `ADE_ENDPOINT` - Default: `https://api.va.landing.ai/v1/ade`
- `HOST` - Default: `0.0.0.0` (Render uses this automatically)
- `PORT` - Default: `8000` (Render sets `$PORT` automatically - don't override)
- `DEBUG` - Default: `False` (set to `True` only for local development)
- `VECTOR_DB_PATH` - Default: `./data/vector_stores`
- `DOCUMENT_STORAGE_PATH` - Default: `./data/raw_docs`
- `EXTRACTED_DATA_PATH` - Default: `./data/extracted`
- `FINAL_OUTPUT_PATH` - Default: `./data/final_outputs`

### Not Used (Can Ignore):
These are in your .env but not used by the code:

- `SUPABASE_SERVICE_ROLE_KEY` - Not used in current implementation
- `ANTHROPIC_API_KEY` - Optional (only if using Claude instead of OpenAI)
- `GOOGLE_API_KEY` - Optional (only if using Gemini instead of OpenAI)

## Deployment Steps

### 1. Pre-Deployment Checklist
- [ ] All code committed to GitHub
- [ ] `requirements.txt` includes all dependencies
- [ ] `Procfile` is correct
- [ ] `render.yaml` is configured
- [ ] `.env` file is NOT in repository (in .gitignore)

### 2. Create Render Service

**Option A: Using render.yaml (Recommended)**
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click "New +" → "Blueprint"
3. Connect GitHub repository
4. Render will automatically detect `render.yaml`
5. Add environment variables in dashboard
6. Deploy

**Option B: Manual Configuration**
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click "New +" → "Web Service"
3. Connect GitHub repository
4. Configure:
   - **Name**: `alpha-lens`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`
5. Add environment variables
6. Deploy

### 3. Post-Deployment Verification

After deployment, verify:
- [ ] Application starts without errors
- [ ] Login/Signup works
- [ ] Document upload works
- [ ] Chat functionality works
- [ ] Reports generate correctly
- [ ] No console errors

## Quick Reference

### Files NOT to Commit:
- ❌ `.env` - Contains secrets
- ❌ `venv/` - Virtual environment
- ❌ `data/` - Local data files
- ❌ `__pycache__/` - Python cache
- ❌ `*.log` - Log files

### Build Commands:
```bash
# Local testing
pip install -r requirements.txt
uvicorn app:app --reload

# Production (Render)
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port $PORT
```

## Troubleshooting

### Common Issues

1. **Import Errors**: Ensure all dependencies are in `requirements.txt`
2. **Port Issues**: Use `$PORT` environment variable (Render sets this)
3. **Environment Variables**: Double-check all required vars are set
4. **Build Failures**: Check build logs in Render dashboard

## Support

For deployment issues, check:
- Render build logs
- Application logs in Render dashboard
- Environment variables configuration

---

**Last Updated**: 2024
**Version**: 1.0
**Status**: ✅ Production Ready

