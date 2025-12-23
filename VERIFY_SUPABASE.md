# How to Verify Supabase Setup

## Step 1: Check Database Table

1. Go to **Supabase Dashboard** → **Table Editor**
2. Look for the `documents` table in the `public` schema
3. You should see your document with:
   - `id`: UUID
   - `user_id`: UUID (your user ID)
   - `filename`: Your file name
   - `file_path`: Storage path
   - `status`: Document status

**If table doesn't exist:**
- Go to **SQL Editor**
- Run the SQL from `migrations/001_create_documents_table.sql`

## Step 2: Check Row Level Security (RLS)

1. Go to **Supabase Dashboard** → **Authentication** → **Policies**
2. Or go to **Table Editor** → Select `documents` table → Click **"RLS policies"** tab
3. You should see 4 policies:
   - ✅ "Users can view own documents" (SELECT)
   - ✅ "Users can insert own documents" (INSERT)
   - ✅ "Users can update own documents" (UPDATE)
   - ✅ "Users can delete own documents" (DELETE)

**If policies are missing:**
- Go to **SQL Editor**
- Run this SQL:
```sql
-- Enable RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view own documents"
  ON documents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own documents"
  ON documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own documents"
  ON documents FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own documents"
  ON documents FOR DELETE
  USING (auth.uid() = user_id);
```

## Step 3: Test RLS Policy Directly

1. Go to **SQL Editor**
2. Run this query (replace `YOUR_USER_ID` with your actual user ID from the table):
```sql
-- This should return your documents when run as authenticated user
Unable to load preview. Please try again.

Unexpected server response (500) while retrieving PDF "http://127.0.0.1:8000/documents/90979413-b549-48a8-ab83-deb61b8d0bb9/file?cache=1766510354102".```

**If this returns 0 rows but you see data in Table Editor:**
- RLS is blocking the query
- The issue is that `auth.uid()` is NULL (no user context)

## Step 4: Check Storage Bucket

1. Go to **Supabase Dashboard** → **Storage**
2. You should see a bucket named `documents`
3. Click on it → You should see folders with your `user_id`
4. Inside should be your uploaded files

**If bucket doesn't exist:**
- Create it: **Storage** → **New bucket** → Name: `documents` → **Private** (unchecked public)

## Step 5: Check Storage Policies

1. Go to **Storage** → `documents` bucket → **Policies** tab
2. You should see 4 policies:
   - ✅ "Users can upload own files" (INSERT)
   - ✅ "Users can view own files" (SELECT)
   - ✅ "Users can update own files" (UPDATE)
   - ✅ "Users can delete own files" (DELETE)

**If policies are missing:**
- Create them (see `SUPABASE_SETUP.md`)

## Step 6: Test with Service Role Key (Bypass RLS)

⚠️ **WARNING**: Only for testing! Don't use service role key in production frontend!

1. Go to **Supabase Dashboard** → **Settings** → **API**
2. Copy the **Service Role Key** (not the anon key!)
3. Temporarily update your `.env`:
   ```env
   SUPABASE_ANON_KEY=your-service-role-key-here
   ```
4. Restart server and test
5. **If this works**, the issue is RLS - we need to pass user token properly
6. **Revert the change** after testing!

## Step 7: Check User ID Match

1. In **Table Editor**, check the `user_id` in your document
2. In your app, check what `user_id` is being used (from console logs)
3. They should match exactly!

**If they don't match:**
- Different user account
- Token is for different user

## Step 8: Check API Logs

1. Go to **Supabase Dashboard** → **Logs** → **API Logs**
2. Look for errors when you try to load documents
3. Common errors:
   - `permission denied for table documents` → RLS issue
   - `relation "documents" does not exist` → Table not created
   - `invalid input syntax for type uuid` → UUID format issue

## Quick Diagnostic Query

Run this in **SQL Editor** to see everything:

```sql
-- Check if table exists
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'documents'
);

-- Check RLS status
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'documents';

-- Check policies
SELECT * FROM pg_policies 
WHERE tablename = 'documents';

-- Count documents (bypasses RLS if you have admin access)
SELECT COUNT(*) FROM documents;

-- See all documents (bypasses RLS if you have admin access)
SELECT id, user_id, filename, status FROM documents LIMIT 10;
```

## Common Issues & Solutions

### Issue: "No documents found" but data exists in table
**Cause**: RLS is blocking the query
**Solution**: Make sure we're passing the user's JWT token to Supabase client

### Issue: "permission denied"
**Cause**: RLS policies not set up or incorrect
**Solution**: Run the policy creation SQL (Step 2)

### Issue: "relation does not exist"
**Cause**: Table not created
**Solution**: Run the migration SQL (Step 1)

### Issue: User ID mismatch
**Cause**: Different user account or token issue
**Solution**: Check user ID in table vs. what's in your token

