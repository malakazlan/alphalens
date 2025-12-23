# ALPHA LENS - Deployment Verification Checklist

## Pre-Deployment Checklist

### 1. Code Repository
- [ ] All code committed to GitHub
- [ ] Repository is public or Render has access
- [ ] No sensitive data in code (API keys, passwords)
- [ ] `.env` file is in `.gitignore`
- [ ] `.env.example` exists with template

### 2. Required Files
- [ ] `requirements.txt` - All dependencies with versions ✅
- [ ] `Procfile` - Web service command ✅
- [ ] `runtime.txt` - Python version (3.11) ✅
- [ ] `.gitignore` - Excludes sensitive files ✅
- [ ] `app.py` - Main application file ✅
- [ ] All Python modules present

### 3. Dependencies Verification
- [ ] All packages in `requirements.txt` have versions
- [ ] No missing dependencies
- [ ] All imports can be resolved
- [ ] Test local installation: `pip install -r requirements.txt`

### 4. Environment Variables
- [ ] `VISION_AGENT_API_KEY` - Landing.AI API key
- [ ] `OPENAI_API_KEY` - OpenAI API key
- [ ] `SUPABASE_URL` - Supabase project URL
- [ ] `SUPABASE_ANON_KEY` - Supabase anon key
- [ ] Optional variables documented

### 5. Configuration Files

#### requirements.txt
```txt
✅ fastapi==0.104.1
✅ uvicorn==0.24.0.post1
✅ python-multipart==0.0.6
✅ pydantic==2.4.2
✅ pydantic[email]==2.4.2
✅ email-validator==2.3.0
✅ requests==2.31.0
✅ numpy==1.26.4
✅ PyPDF2==3.0.1
✅ python-dotenv==1.1.1
✅ landingai-ade>=0.21.2
✅ openai>=1.12.0
✅ beautifulsoup4==4.12.2
✅ supabase>=2.24.0
```

#### Procfile
```txt
✅ web: uvicorn app:app --host 0.0.0.0 --port $PORT
```

#### runtime.txt
```txt
✅ python-3.11
```

### 6. Application Structure
- [ ] `app.py` - Main FastAPI app
- [ ] `auth.py` - Authentication
- [ ] `config.py` - Configuration
- [ ] `chat_engine.py` - Chat functionality
- [ ] `llm_service.py` - LLM service
- [ ] `document_processor.py` - Document processing
- [ ] `storage_service.py` - Supabase storage
- [ ] `database_service.py` - Supabase database
- [ ] `vector_store.py` - Vector store
- [ ] `static/` - Static files directory
- [ ] `index.html` - Main page
- [ ] `login.html` - Login page

### 7. Static Files
- [ ] `static/css/style.css` exists
- [ ] `static/js/main.js` exists
- [ ] `static/js/modules/reports.js` exists
- [ ] All static assets accessible

### 8. Database Setup
- [ ] Supabase project created
- [ ] Database table created (`documents`)
- [ ] RLS policies configured
- [ ] Storage bucket created (`documents`)
- [ ] Storage policies configured

## Deployment Steps

### Step 1: Verify GitHub Repository
```bash
# Check all files are committed
git status

# Verify requirements.txt is up to date
cat requirements.txt

# Push to GitHub
git add .
git commit -m "Ready for Render deployment"
git push origin main
```

### Step 2: Create Render Service
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click "New +" → "Web Service"
3. Connect GitHub repository
4. Select repository: `alpha_lens`

### Step 3: Configure Service

#### Basic Settings:
- **Name**: `alpha-lens`
- **Environment**: `Python 3`
- **Region**: Choose closest region
- **Branch**: `main`
- **Root Directory**: (leave empty)
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`

#### Environment Variables:
Add these in Render dashboard:
```
VISION_AGENT_API_KEY=your_key_here
ADE_ENDPOINT=https://api.va.landing.ai/v1/ade
OPENAI_API_KEY=your_key_here
SUPABASE_URL=your_url_here
SUPABASE_ANON_KEY=your_key_here
```

### Step 4: Deploy
1. Click "Create Web Service"
2. Monitor build logs
3. Wait for deployment to complete
4. Note the service URL

## Post-Deployment Verification

### 1. Application Startup
- [ ] Service starts without errors
- [ ] No import errors in logs
- [ ] Application accessible at Render URL
- [ ] Health check passes (if configured)

### 2. Authentication
- [ ] Login page loads
- [ ] Can create new account
- [ ] Can login with credentials
- [ ] Can logout
- [ ] Session persists

### 3. Document Upload
- [ ] Upload interface works
- [ ] Can upload PDF files
- [ ] Upload progress shows
- [ ] Processing starts
- [ ] Processing completes

### 4. Document Viewing
- [ ] Document list shows uploaded files
- [ ] Can view document preview
- [ ] PDF renders correctly
- [ ] Document metadata displays

### 5. Chat Functionality
- [ ] Chat interface loads
- [ ] Can ask questions
- [ ] Responses appear
- [ ] Citations work
- [ ] Math questions work
- [ ] Financial term questions work
- [ ] General knowledge questions work

### 6. Reports Module
- [ ] Reports section loads
- [ ] Can generate reports
- [ ] Report structure complete
- [ ] Can export as Markdown
- [ ] Can export as JSON
- [ ] Loading spinner works

### 7. Data Persistence
- [ ] Documents persist after logout
- [ ] Documents persist after server restart
- [ ] No duplicate documents
- [ ] Recent Files works
- [ ] Pre-saved Documents works

### 8. Performance
- [ ] Page loads < 3 seconds
- [ ] API responses < 2 seconds
- [ ] Upload works smoothly
- [ ] Processing completes in reasonable time
- [ ] Chat responses timely

### 9. Error Handling
- [ ] Invalid inputs handled gracefully
- [ ] Network errors handled
- [ ] API errors handled
- [ ] User-friendly error messages
- [ ] No crashes

## Common Deployment Issues

### Issue: Build Fails
**Check:**
- All dependencies in `requirements.txt`
- All packages have versions
- Python version matches `runtime.txt`
- Build logs for specific errors

### Issue: Application Crashes
**Check:**
- Environment variables set correctly
- All API keys valid
- Supabase connection works
- Application logs for errors

### Issue: Static Files 404
**Check:**
- `static/` directory exists
- Files not in `.gitignore`
- `app.py` mounts static files
- File paths correct

### Issue: Database Errors
**Check:**
- Supabase credentials correct
- RLS policies configured
- Storage bucket exists
- Network connectivity

## Rollback Plan

If deployment fails:
1. Check build logs for errors
2. Fix issues in code
3. Update `requirements.txt` if needed
4. Push fixes to GitHub
5. Render will auto-redeploy

## Monitoring

### Render Dashboard
- Monitor logs in real-time
- Check service health
- View metrics
- Set up alerts

### Application Logs
- Check for errors
- Monitor performance
- Track usage
- Debug issues

## Success Criteria

✅ Application deploys successfully
✅ All features work
✅ No critical errors
✅ Performance acceptable
✅ Data persists correctly
✅ Security measures in place

---

**Last Updated**: [Date]
**Version**: 1.0

