# Deployment Checklist for Render

## ✅ Pre-Deployment Checks

### 1. Files Verification
- [x] `app.py` - Main FastAPI application
- [x] `requirements.txt` - All dependencies listed
- [x] `render.yaml` - Render configuration
- [x] `Procfile` - Process definition
- [x] `runtime.txt` - Python version (optional but recommended)
- [x] `index.html` - Main dashboard page
- [x] `login.html` - Login page
- [x] `static/` directory with CSS, JS, and images
- [x] `.gitignore` - Properly configured

### 2. Code Issues Fixed
- [x] Fixed API key mismatch: `VISION_AGENT_API_KEY` in config.py matches render.yaml
- [x] Root route exists (`/`)
- [x] Login route exists (`/login`)
- [x] Static files mount configured
- [x] All imports are correct

### 3. Environment Variables Required
Make sure these are set in Render Dashboard → Environment:
- `VISION_AGENT_API_KEY` - Your Landing.AI API key
- `OPENAI_API_KEY` - Your OpenAI API key
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anonymous key

### 4. GitHub Repository
- [x] All files committed
- [x] All files pushed to GitHub
- [x] Repository is accessible

## 🚀 Deployment Steps

### Step 1: Verify GitHub Repository
```bash
git status
git log --oneline -3
```
Should show all files committed and pushed.

### Step 2: Create Render Service
1. Go to https://dashboard.render.com
2. Click "New +" → "Web Service"
3. Connect GitHub account
4. Select repository: `malakazlan/alphalens`

### Step 3: Configure Service
**If using render.yaml (Automatic):**
- Render will auto-detect and use `render.yaml`
- Just verify the settings

**If configuring manually:**
- **Name**: `alpha-lens`
- **Environment**: `Python 3`
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- **Python Version**: `3.11.0` (or leave default)

### Step 4: Add Environment Variables
In Render Dashboard → Your Service → Environment:
1. Click "Add Environment Variable"
2. Add each variable:
   - `VISION_AGENT_API_KEY` = (your key)
   - `OPENAI_API_KEY` = (your key)
   - `SUPABASE_URL` = (your URL)
   - `SUPABASE_ANON_KEY` = (your key)

### Step 5: Deploy
1. Click "Create Web Service"
2. Wait for build to complete (5-10 minutes)
3. Check logs for any errors

## 🔍 Troubleshooting

### If GitHub Clone Fails (500 Error)
1. **Wait 5 minutes** - GitHub may be experiencing issues
2. **Check repository access** - Ensure repo is public or Render has access
3. **Retry deployment** - Click "Manual Deploy" → "Deploy latest commit"
4. **Clear build cache** - Settings → Clear build cache → Retry

### If Build Fails
1. Check build logs for specific error
2. Verify `requirements.txt` has all dependencies
3. Check Python version compatibility
4. Ensure all imports are correct

### If App Crashes on Start
1. Check runtime logs
2. Verify all environment variables are set
3. Check if port is correctly set to `$PORT`
4. Verify `app.py` has correct startup code

### Common Issues
- **Module not found**: Add to `requirements.txt`
- **Port binding error**: Ensure using `$PORT` in start command
- **Environment variable missing**: Add in Render dashboard
- **Static files not loading**: Verify `static/` directory exists and is mounted

## 📝 Post-Deployment

1. Test the root URL: `https://your-app.onrender.com`
2. Test login page: `https://your-app.onrender.com/login`
3. Test static files: `https://your-app.onrender.com/static/css/style.css`
4. Test API endpoints
5. Monitor logs for any runtime errors

## ⚠️ Free Tier Limitations

- App sleeps after 15 minutes of inactivity
- First request after sleep takes ~50 seconds
- Consider upgrading for production use

