# Quick Supabase Connection Check

## Step 1: Check if Supabase is Connected

Visit this URL while logged in:
```
http://localhost:8000/test/supabase
```

This will show you:
- ✅ Database connection status
- ✅ Storage bucket status  
- ✅ Number of documents saved
- ❌ Any errors

## Step 2: Common Issues & Fixes

### Issue 1: "relation 'documents' does not exist"
**Fix**: Run the SQL migration
1. Go to Supabase Dashboard → SQL Editor
2. Copy SQL from `migrations/001_create_documents_table.sql`
3. Paste and click "Run"

### Issue 2: "Bucket not found" or "Storage bucket doesn't exist"
**Fix**: Create the storage bucket
1. Go to Supabase Dashboard → Storage
2. Click "New bucket"
3. Name: `documents`
4. Public: ❌ Unchecked (Private)
5. Click "Create bucket"

### Issue 3: "Permission denied" or "Row Level Security"
**Fix**: Set up RLS policies
1. Go to Supabase Dashboard → Storage → `documents` bucket → Policies
2. Create 4 policies (see SUPABASE_SETUP.md)

### Issue 4: "SUPABASE_URL and SUPABASE_ANON_KEY must be set"
**Fix**: Check your `.env` file
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

## Step 3: Verify Setup

After fixing issues, test again:
1. Upload a document
2. Check `/test/supabase` endpoint
3. Check Supabase Dashboard:
   - Storage → `documents` bucket → Should see files
   - Database → `documents` table → Should see records

## Step 4: Check Server Logs

When uploading, watch for:
- ✅ `✓ File uploaded successfully to: {path}`
- ❌ `ERROR: ...` messages

These will tell you exactly what's wrong.

