# Supabase Setup Instructions

## Step 1: Create Storage Bucket

1. Go to your Supabase Dashboard: https://app.supabase.com
2. Select your project
3. Navigate to **Storage** in the left sidebar
4. Click **"New bucket"**
5. Configure the bucket:
   - **Name**: `documents`
   - **Public bucket**: ❌ **UNCHECKED** (Private)
   - **File size limit**: `50 MB` (or your preferred limit)
   - **Allowed MIME types**: Leave empty (allows all types)
6. Click **"Create bucket"**

## Step 2: Set Up Storage Policies

1. In the Storage section, click on the `documents` bucket
2. Go to **"Policies"** tab
3. Click **"New Policy"**
4. Create these policies:

### Policy 1: Users can upload their own files
- **Policy name**: `Users can upload own files`
- **Allowed operation**: `INSERT`
- **Policy definition**:
```sql
(bucket_id = 'documents'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])
```

### Policy 2: Users can view their own files
- **Policy name**: `Users can view own files`
- **Allowed operation**: `SELECT`
- **Policy definition**:
```sql
(bucket_id = 'documents'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])
```

### Policy 3: Users can update their own files
- **Policy name**: `Users can update own files`
- **Allowed operation**: `UPDATE`
- **Policy definition**:
```sql
(bucket_id = 'documents'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])
```

### Policy 4: Users can delete their own files
- **Policy name**: `Users can delete own files`
- **Allowed operation**: `DELETE`
- **Policy definition**:
```sql
(bucket_id = 'documents'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])
```

## Step 3: Create Database Table

1. Go to **SQL Editor** in Supabase Dashboard
2. Click **"New query"**
3. Copy and paste the SQL from `migrations/001_create_documents_table.sql`
4. Click **"Run"** to execute the migration

The SQL will:
- Create the `documents` table
- Create indexes for faster queries
- Set up Row Level Security (RLS) policies
- Ensure users can only access their own documents

## Step 4: Verify Environment Variables

Make sure your `.env` file has:
```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

You can find these in:
- Supabase Dashboard → **Settings** → **API**
- **Project URL** = `SUPABASE_URL`
- **anon public** key = `SUPABASE_ANON_KEY`

## Step 5: Test the Setup

1. Start your FastAPI server:
```bash
python app.py
```

2. Try uploading a document through your frontend
3. Check Supabase:
   - **Storage**: Should see files in `documents/{user_id}/{document_id}/`
   - **Database**: Should see records in `documents` table

## Troubleshooting

### Error: "Bucket not found"
- Make sure the bucket name is exactly `documents` (case-sensitive)
- Or update `storage_service.py` to use your bucket name

### Error: "Permission denied"
- Check that RLS policies are set up correctly
- Verify storage policies allow user access

### Error: "Table does not exist"
- Run the SQL migration in Supabase SQL Editor
- Check that the table was created successfully

## File Structure in Storage

Files will be stored as:
```
documents/
  └── {user_id}/
      └── {document_id}/
          ├── original.pdf (or .jpg, .png, etc.)
          └── processed_data.json
```

This ensures:
- ✅ User isolation (each user has their own folder)
- ✅ Organized structure (each document in its own folder)
- ✅ Easy cleanup (delete entire folder when deleting document)

