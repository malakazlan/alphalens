# Render Deployment Guide for ALPHA LENS

## Prerequisites

1. **GitHub Repository**: Your code must be pushed to GitHub
2. **Render Account**: Sign up at [render.com](https://render.com) (free tier available)
3. **Environment Variables**: Prepare all required API keys and credentials

## Step-by-Step Deployment

### 1. Prepare Your Repository

Ensure these files are in your repository root:

- ✅ `requirements.txt` - All Python dependencies with versions
- ✅ `Procfile` - Web service startup command
- ✅ `runtime.txt` - Python version specification
- ✅ `.env.example` - Template for environment variables
- ✅ `.gitignore` - Excludes sensitive files

### 2. Push to GitHub

```bash
git add .
git commit -m "Ready for Render deployment"
git push origin main
```

### 3. Create Web Service on Render

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account if not already connected
4. Select your repository: `alpha_lens`
5. Click **"Connect"**

### 4. Configure Service Settings

#### Basic Settings:
- **Name**: `alpha-lens` (or your preferred name)
- **Region**: Choose closest to your users
- **Branch**: `main` (or your default branch)
- **Root Directory**: Leave empty (root of repo)
- **Runtime**: `Python 3`
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`

#### Environment Variables:
Add all required environment variables:

```
VISION_AGENT_API_KEY=your_vision_agent_api_key
ADE_ENDPOINT=https://api.va.landing.ai/v1/ade
OPENAI_API_KEY=your_openai_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

**Important**: 
- Never commit `.env` file to GitHub
- Add all secrets in Render dashboard only
- Use Render's environment variable section

### 5. Advanced Settings (Optional)

#### Health Check:
- **Health Check Path**: `/` or `/health` (if you add a health endpoint)
- **Health Check Interval**: 300 seconds

#### Auto-Deploy:
- ✅ **Auto-Deploy**: Enabled (deploys on every push to main branch)

#### Scaling:
- **Instance Type**: Free tier (512 MB RAM) or upgrade for production
- **Instance Count**: 1 (can scale later)

### 6. Deploy

1. Click **"Create Web Service"**
2. Render will:
   - Clone your repository
   - Install dependencies from `requirements.txt`
   - Start your application
3. Monitor the build logs for any errors
4. Once deployed, you'll get a URL like: `https://alpha-lens.onrender.com`

### 7. Post-Deployment Verification

#### Check Application:
1. Visit your Render URL
2. Test login/signup
3. Test document upload
4. Test chat functionality
5. Test report generation

#### Check Logs:
1. Go to Render Dashboard → Your Service → Logs
2. Monitor for any errors or warnings
3. Check application startup logs

## Common Issues & Solutions

### Issue 1: Build Fails - Missing Dependencies

**Error**: `ModuleNotFoundError: No module named 'X'`

**Solution**:
- Check `requirements.txt` includes all packages
- Ensure all packages have version numbers
- Check build logs for specific missing package
- Add missing package to `requirements.txt`

### Issue 2: Application Crashes on Startup

**Error**: Application starts then crashes

**Solution**:
- Check environment variables are set correctly
- Verify all required API keys are provided
- Check application logs for specific error
- Ensure `Procfile` command is correct

### Issue 3: Static Files Not Loading

**Error**: CSS/JS files return 404

**Solution**:
- Verify `static/` directory exists in repository
- Check `app.py` mounts static files correctly
- Ensure static files are not in `.gitignore`

### Issue 4: Database Connection Errors

**Error**: Cannot connect to Supabase

**Solution**:
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are correct
- Check Supabase project is active
- Verify RLS policies are configured
- Check network connectivity from Render

### Issue 5: Port Binding Error

**Error**: `Address already in use`

**Solution**:
- Ensure `Procfile` uses `$PORT` environment variable
- Render automatically sets `PORT` - don't hardcode it
- Use: `uvicorn app:app --host 0.0.0.0 --port $PORT`

### Issue 6: Timeout During Build

**Error**: Build times out

**Solution**:
- Reduce dependencies if possible
- Use specific versions (not `>=` or `latest`)
- Check for unnecessary large packages
- Consider using build cache

## Environment Variables Checklist

Before deploying, ensure you have:

- [ ] `VISION_AGENT_API_KEY` - Landing.AI API key
- [ ] `OPENAI_API_KEY` - OpenAI API key (or other LLM)
- [ ] `SUPABASE_URL` - Your Supabase project URL
- [ ] `SUPABASE_ANON_KEY` - Your Supabase anon key
- [ ] Optional: `HOST`, `PORT`, `DEBUG` (have defaults)

## File Structure Verification

Ensure your repository has:

```
alpha_lens/
├── app.py                 # Main FastAPI application
├── requirements.txt       # Python dependencies
├── Procfile              # Render startup command
├── runtime.txt           # Python version
├── .env.example          # Environment variable template
├── .gitignore           # Git ignore rules
├── auth.py              # Authentication module
├── config.py            # Configuration
├── chat_engine.py       # Chat functionality
├── llm_service.py       # LLM service
├── document_processor.py # Document processing
├── storage_service.py   # Supabase storage
├── database_service.py  # Supabase database
├── vector_store.py      # Vector store
├── static/              # Static files (CSS, JS)
│   ├── css/
│   └── js/
├── index.html           # Main HTML
└── login.html           # Login page
```

## Monitoring & Maintenance

### View Logs:
- Render Dashboard → Your Service → Logs
- Real-time logs available
- Historical logs stored

### Update Application:
1. Push changes to GitHub
2. Render auto-deploys (if enabled)
3. Monitor build logs
4. Verify deployment success

### Update Environment Variables:
1. Render Dashboard → Your Service → Environment
2. Add/Edit variables
3. Save changes
4. Service restarts automatically

## Cost Considerations

### Free Tier:
- 512 MB RAM
- 0.1 CPU
- 750 hours/month (enough for 24/7)
- Sleeps after 15 minutes of inactivity

### Paid Tiers:
- More RAM and CPU
- No sleep (always on)
- Better performance
- Custom domains

## Security Best Practices

1. ✅ Never commit `.env` file
2. ✅ Use Render's environment variables for secrets
3. ✅ Enable HTTPS (automatic on Render)
4. ✅ Use strong API keys
5. ✅ Regularly rotate API keys
6. ✅ Monitor access logs
7. ✅ Keep dependencies updated

## Support

- **Render Docs**: https://render.com/docs
- **Render Support**: support@render.com
- **Render Community**: https://community.render.com

## Deployment Checklist

Before going live:

- [ ] All environment variables set
- [ ] Application starts successfully
- [ ] Login/signup works
- [ ] Document upload works
- [ ] Chat functionality works
- [ ] Reports generate correctly
- [ ] Static files load
- [ ] No errors in logs
- [ ] Performance acceptable
- [ ] HTTPS enabled (automatic)

---

**Last Updated**: [Date]
**Version**: 1.0

