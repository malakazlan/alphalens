# Testing Supabase Integration

## Quick Test Checklist

### 1. Check if Database Table Exists
Run this in Supabase SQL Editor:
```sql
SELECT * FROM documents LIMIT 5;
```

If you get an error "relation does not exist", run the migration:
- Go to SQL Editor
- Copy SQL from `migrations/001_create_documents_table.sql`
- Run it

### 2. Check if Storage Bucket Exists
- Go to Supabase Dashboard → Storage
- You should see a bucket named `documents`
- If not, create it (see SUPABASE_SETUP.md)

### 3. Check Server Logs
When you upload a document, check your server console for:
- `✓ File uploaded successfully to: {user_id}/{document_id}/original.pdf`
- Any ERROR messages

### 4. Test Database Connection
Add this test endpoint to `app.py` temporarily:

```python
@app.get("/test/db")
async def test_database(current_user: dict = Depends(get_current_user)):
    """Test database connection"""
    try:
        docs = database_service.get_user_documents(current_user["id"])
        return {
            "success": True,
            "user_id": current_user["id"],
            "document_count": len(docs),
            "documents": docs
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }
```

Then visit: `http://localhost:8000/test/db`

### 5. Common Issues

#### Issue: "relation 'documents' does not exist"
**Solution**: Run the SQL migration from `migrations/001_create_documents_table.sql`

#### Issue: "Bucket not found"
**Solution**: Create the `documents` bucket in Supabase Storage

#### Issue: "Permission denied" or "Row Level Security"
**Solution**: Check RLS policies are set up correctly (see SUPABASE_SETUP.md)

#### Issue: Documents upload but don't appear after login
**Possible causes**:
1. Database table doesn't exist → Run migration
2. RLS policies blocking access → Check policies
3. Error in database service → Check server logs
4. Wrong user_id → Check if user_id matches

### 6. Debug Steps

1. **Check server logs** when uploading:
   - Look for "ERROR:" messages
   - Look for "✓ File uploaded successfully"

2. **Check Supabase Dashboard**:
   - Storage → `documents` bucket → Should see files
   - Database → `documents` table → Should see records

3. **Check browser console**:
   - Open DevTools → Network tab
   - Upload a document
   - Check the response from `/documents/upload`

4. **Verify environment variables**:
   ```bash
   # In your .env file
   SUPABASE_URL=your_project_url
   SUPABASE_ANON_KEY=your_anon_key
   ```

### 7. Manual Database Check

Run this SQL to see all documents:
```sql
SELECT 
    id,
    user_id,
    filename,
    status,
    upload_time,
    created_at
FROM documents
ORDER BY created_at DESC;
```

If you see your documents here but not in the app, the issue is in the frontend or API response.

