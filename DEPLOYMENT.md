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

### Required (Set in Render Dashboard):
- `VISION_AGENT_API_KEY` - Landing.AI API key
- `OPENAI_API_KEY` - OpenAI API key
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anon key

### Optional (Have defaults):
- `PYTHON_VERSION` - Default: `3.11.0` (set in render.yaml)
- `HOST` - Default: `0.0.0.0`
- `PORT` - Set automatically by Render
- `DEBUG` - Default: `False`

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

