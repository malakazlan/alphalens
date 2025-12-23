import os
import uuid
import shutil
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse, FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr
import uvicorn
import json
import tempfile

# Import our document processing components and config
from document_processor import process_document
from chat_engine import get_answer_from_document
from config import settings
from auth import sign_up, sign_in, sign_out, get_user, verify_token, get_supabase_client
from storage_service import storage_service
from database_service import database_service
from llm_service import llm_service
import json

app = FastAPI(title="ALPHA LENS - Financial Document Analyzer MVP")

# Add CORS middleware to allow requests from a frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store user sessions (in production, use Redis or database)
user_sessions = {}  # {access_token: user_id}
# Note: Documents and processing status are now stored in Supabase Database

# Mount static files for serving HTML
app.mount("/static", StaticFiles(directory="static"), name="static") if os.path.exists("static") else None

class ChatQuery(BaseModel):
    document_id: str
    query: str

class ChatResponse(BaseModel):
    document_id: str
    query: str
    answer: str
    sources: List[dict] = []
    source: Optional[str] = None

# Authentication models
class SignUpRequest(BaseModel):
    email: EmailStr
    password: str

class SignInRequest(BaseModel):
    email: EmailStr
    password: str

class AuthResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    user: Optional[dict] = None
    access_token: Optional[str] = None
    error: Optional[str] = None

# Dependency to get current user
async def get_current_user(request: Request) -> dict:
    """Get current authenticated user from request"""
    # Try to get token from Authorization header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
    else:
        # Try to get from cookie
        token = request.cookies.get("access_token")
    
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Verify token and get user
    user = get_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    return user

# Authentication endpoints
@app.post("/api/auth/signup", response_model=AuthResponse)
async def signup_user(request: SignUpRequest):
    """Sign up a new user"""
    result = sign_up(request.email, request.password)
    
    if result["success"]:
        session = result.get("session")
        # Handle case where session might be None (email confirmation required)
        if not session:
            return AuthResponse(
                success=False,
                error="Please check your email to confirm your account before signing in."
            )
        
        access_token = session.access_token if hasattr(session, 'access_token') else None
        if not access_token:
            return AuthResponse(
                success=False,
                error="Failed to get access token. Please try again."
            )
        
        user_data = {
            "id": result["user"].id,
            "email": result["user"].email
        }
        
        # Store session
        user_sessions[access_token] = result["user"].id
        
        # Set cookie like login does
        response = JSONResponse(content={
            "success": True,
            "message": "User created successfully",
            "user": user_data,
            "access_token": access_token
        })
        response.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            secure=False,  # Set to True in production with HTTPS
            samesite="lax",
            max_age=60 * 60 * 24 * 7  # 7 days
        )
        return response
    else:
        return AuthResponse(
            success=False,
            error=result.get("error", "Sign up failed")
        )

@app.post("/api/auth/login", response_model=AuthResponse)
async def login_user(request: SignInRequest):
    """Sign in an existing user"""
    result = sign_in(request.email, request.password)
    
    if result["success"]:
        session = result.get("session")
        # Handle case where session might be None
        if not session:
            return AuthResponse(
                success=False,
                error="Failed to create session. Please try again."
            )
        
        access_token = session.access_token if hasattr(session, 'access_token') else None
        if not access_token:
            return AuthResponse(
                success=False,
                error="Failed to get access token. Please try again."
            )
        
        user_data = {
            "id": result["user"].id,
            "email": result["user"].email
        }
        
        # Store session
        user_sessions[access_token] = result["user"].id
        
        response = JSONResponse(content={
            "success": True,
            "message": "Login successful",
            "user": user_data,
            "access_token": access_token
        })
        # Set cookie
        response.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            secure=False,  # Set to True in production with HTTPS
            samesite="lax",
            max_age=60 * 60 * 24 * 7  # 7 days
        )
        return response
    else:
        return AuthResponse(
            success=False,
            error=result.get("error", "Invalid email or password")
        )

@app.post("/api/auth/logout")
async def logout_user(request: Request):
    """Sign out the current user"""
    token = request.cookies.get("access_token") or request.headers.get("Authorization", "").replace("Bearer ", "")
    
    if token:
        sign_out(token)
        if token in user_sessions:
            del user_sessions[token]
    
    response = JSONResponse(content={"success": True, "message": "Logged out successfully"})
    response.delete_cookie("access_token")
    return response

@app.get("/api/auth/session")
async def get_session(request: Request):
    """Get current user session"""
    token = request.cookies.get("access_token") or request.headers.get("Authorization", "").replace("Bearer ", "")
    
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    user = get_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    return {
        "success": True,
        "user": user
    }

@app.post("/api/auth/forgot-password")
async def forgot_password(email: EmailStr):
    """Request password reset"""
    from auth import reset_password
    result = reset_password(email)
    
    if result["success"]:
        return {"success": True, "message": "Password reset email sent"}
    else:
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to send reset email"))

# Protected document endpoints
@app.post("/documents/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """Upload a financial document for processing"""
    
    # Generate document ID
    document_id = str(uuid.uuid4())
    user_id = current_user["id"]
    
    try:
        # Read file content
        file_content = await file.read()
        
        # Upload file to Supabase Storage
        try:
            storage_path = storage_service.upload_file(
                user_id=user_id,
                document_id=document_id,
                file_content=file_content,
                filename=file.filename or "document.pdf",
                file_type="original"
            )
        except Exception as storage_error:
            error_msg = f"Storage upload failed: {str(storage_error)}"
            print(f"ERROR: {error_msg}")
            raise HTTPException(
                status_code=500, 
                detail=f"Failed to upload file to storage. Make sure Supabase Storage bucket 'documents' exists. Error: {str(storage_error)}"
            )
        
        # Create document record in database
        try:
            database_service.create_document(
                user_id=user_id,
                document_id=document_id,
                filename=file.filename or "document.pdf",
                file_path=storage_path,
                status="uploaded"
            )
        except Exception as db_error:
            error_msg = f"Database insert failed: {str(db_error)}"
            print(f"ERROR: {error_msg}")
            # Try to delete uploaded file from storage
            try:
                storage_service.delete_file(storage_path)
            except:
                pass
            raise HTTPException(
                status_code=500,
                detail=f"Failed to save document to database. Make sure the 'documents' table exists in Supabase. Run the SQL migration from migrations/001_create_documents_table.sql. Error: {str(db_error)}"
            )
        
        # Update processing status
        try:
            database_service.update_processing_status(
                document_id=document_id,
                user_id=user_id,
                status="uploaded",
                progress=0,
                message="Document uploaded, starting processing"
            )
        except Exception as status_error:
            print(f"Warning: Failed to update status: {str(status_error)}")
            # Continue anyway, status update is not critical
        
        # Create temporary file for processing (document processor needs local file)
        file_ext = os.path.splitext(file.filename)[1] if file.filename else '.pdf'
        if not file_ext:
            file_ext = '.pdf'
        
        # Create temp file and write content
        temp_file_path = tempfile.mktemp(suffix=file_ext)
        with open(temp_file_path, "wb") as buffer:
            buffer.write(file_content)
        
        # Start processing in the background
        background_tasks.add_task(
            process_document_background, 
            document_id, 
            user_id,
            temp_file_path
        )
        
        return {"document_id": document_id, "status": "processing"}
    
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        print(f"Error uploading document: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

def process_document_background(document_id: str, user_id: str, file_path: str):
    """Process document in the background and update status"""
    try:
        # Update status to processing
        database_service.update_processing_status(
            document_id=document_id,
            user_id=user_id,
            status="processing",
            progress=10,
            message="Started document processing"
        )
        
        # Update progress during processing
        database_service.update_processing_status(
            document_id=document_id,
            user_id=user_id,
            status="processing",
            progress=30,
            message="Calling Landing.AI ADE API..."
        )
        
        # Process the document
        result = process_document(file_path)
        
        # Update progress
        database_service.update_processing_status(
            document_id=document_id,
            user_id=user_id,
            status="processing",
            progress=90,
            message="Finalizing document data..."
        )
        
        # Upload processed data to Supabase Storage
        processed_data_json = json.dumps(result, default=str)
        processed_data_path = storage_service.upload_file(
            user_id=user_id,
            document_id=document_id,
            file_content=processed_data_json.encode('utf-8'),
            filename="processed_data.json",
            file_type="processed"
        )
        
        # Update document with processed data
        database_service.update_processed_data(
            document_id=document_id,
            user_id=user_id,
            processed_data_path=processed_data_path,
            processed_data=result
        )
        
        # Update status to complete
        database_service.update_processing_status(
            document_id=document_id,
            user_id=user_id,
            status="complete",
            progress=100,
            message="Document processing complete"
        )
        
        # Clean up temporary file
        if os.path.exists(file_path):
            os.unlink(file_path)
        
        print(f"✓ Document {document_id} processing completed successfully")
    
    except Exception as e:
        # Update status to error
        database_service.update_processing_status(
            document_id=document_id,
            user_id=user_id,
            status="error",
            progress=0,
            message=f"Error processing document: {str(e)}"
        )
        
        # Clean up temporary file
        if os.path.exists(file_path):
            os.unlink(file_path)
        
        # Log the error
        print(f"✗ Error processing document {document_id}: {str(e)}")
        import traceback
        traceback.print_exc()

@app.get("/documents/{document_id}/status")
async def get_document_status(document_id: str, current_user: dict = Depends(get_current_user)):
    """Get the processing status of a document"""
    user_id = current_user["id"]
    
    # Get document from database
    document = database_service.get_document(document_id, user_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Return status information
    return {
        "status": document.get("status", "unknown"),
        "progress": document.get("progress", 0),
        "message": document.get("status_message", "")
    }

@app.get("/documents/{document_id}")
async def get_document(document_id: str, current_user: dict = Depends(get_current_user)):
    """Get document details and processed results"""
    user_id = current_user["id"]
    
    # Get document from database
    document = database_service.get_document(document_id, user_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    doc_info = {
        "document_id": document_id,
        "filename": document.get("filename"),
        "status": document.get("status", "unknown"),
        "upload_time": document.get("upload_time"),
    }
    
    # Load processed data from storage if available
    processed_data_path = document.get("processed_data_path")
    if processed_data_path:
        try:
            processed_data_bytes = storage_service.download_file(processed_data_path)
            processed_data = json.loads(processed_data_bytes.decode('utf-8'))
            
            # Include processed data in response
            doc_info["summary"] = processed_data.get("summary", "")
            if "key_metrics" in processed_data:
                doc_info["key_metrics"] = processed_data["key_metrics"]
            if "metadata" in processed_data:
                doc_info["metadata"] = processed_data["metadata"]
            if processed_data.get("markdown"):
                doc_info["document_markdown"] = processed_data["markdown"]
            if processed_data.get("detected_chunks"):
                doc_info["detected_chunks"] = processed_data["detected_chunks"]
            if processed_data.get("tables"):
                doc_info["tables"] = processed_data["tables"]
        except Exception as e:
            print(f"Error loading processed data: {str(e)}")
            # Continue without processed data if loading fails
    
    return doc_info

@app.get("/documents/{document_id}/file")
async def download_document(document_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Download the original file for preview (PDF or image)"""
    user_id = current_user["id"]
    
    # Get document from database
    document = database_service.get_document(document_id, user_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    file_path = document.get("file_path")
    if not file_path:
        raise HTTPException(status_code=404, detail="Document file not found")
    
    filename = document.get("filename") or f"{document_id}.pdf"
    
    # Get access token from request for RLS
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        access_token = auth_header.split(" ")[1]
    else:
        access_token = request.cookies.get("access_token")
    
    try:
        # Download file from Supabase Storage (with user token for RLS)
        file_content = storage_service.download_file(file_path, access_token=access_token)
        
        # Detect media type from file extension
        file_ext = os.path.splitext(filename)[1].lower()
        media_type_map = {
            '.pdf': 'application/pdf',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.tiff': 'image/tiff',
            '.webp': 'image/webp'
        }
        media_type = media_type_map.get(file_ext, 'application/octet-stream')
        
        # Create temporary file for response
        temp_file_path = tempfile.mktemp(suffix=file_ext)
        with open(temp_file_path, "wb") as f:
            f.write(file_content)
        
        # Return file response (temp file will be cleaned up by OS eventually)
        # For production, consider using streaming response or keeping files in storage
        return FileResponse(path=temp_file_path, media_type=media_type, filename=filename)
    except Exception as e:
        print(f"Error downloading file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to download file: {str(e)}")

@app.post("/documents/chat", response_model=ChatResponse)
async def chat_with_document(query: ChatQuery, current_user: dict = Depends(get_current_user)):
    """Chat with a processed document"""
    document_id = query.document_id
    user_id = current_user["id"]
    
    # Get document from database
    document = database_service.get_document(document_id, user_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Check if document processing is complete
    if document.get("status") != "complete":
        raise HTTPException(
            status_code=400, 
            detail=f"Document processing not complete. Current status: {document.get('status')}"
        )
    
    # Load processed data from storage
    processed_data_path = document.get("processed_data_path")
    if not processed_data_path:
        raise HTTPException(status_code=400, detail="Processed data not found for document")
    
    try:
        processed_data_bytes = storage_service.download_file(processed_data_path)
        processed_data = json.loads(processed_data_bytes.decode('utf-8'))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load processed data: {str(e)}")
    
    # Vector store path (still local for now)
    vector_store_path = f"./data/vector_stores/{document_id}"
    
    # Query the document
    answer_data = get_answer_from_document(
        query.query,
        vector_store_path,
        processed_data
    )
    
    return {
        "document_id": document_id,
        "query": query.query,
        "answer": answer_data["answer"],
        "sources": answer_data.get("sources", []),
        "source": answer_data.get("source", "local_llm")
    }

@app.get("/documents/{document_id}/report")
async def generate_professional_report(document_id: str, current_user: dict = Depends(get_current_user)):
    """Generate a professional financial analysis report for a document"""
    user_id = current_user["id"]
    
    # Get document from database
    document = database_service.get_document(document_id, user_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Check if document processing is complete
    if document.get("status") != "complete":
        raise HTTPException(
            status_code=400, 
            detail=f"Document processing not complete. Current status: {document.get('status')}"
        )
    
    # Load processed data from storage
    processed_data_path = document.get("processed_data_path")
    if not processed_data_path:
        raise HTTPException(status_code=400, detail="Processed data not found for document")
    
    try:
        processed_data_bytes = storage_service.download_file(processed_data_path)
        processed_data = json.loads(processed_data_bytes.decode('utf-8'))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load processed data: {str(e)}")
    
    # Generate professional report using LLM
    try:
        professional_report = llm_service.generate_professional_financial_report(processed_data)
        return {
            "document_id": document_id,
            "filename": document.get("filename", "Unknown"),
            "report": professional_report,
            "generated_at": document.get("upload_time")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate report: {str(e)}")

@app.get("/documents")
async def list_documents(request: Request, current_user: dict = Depends(get_current_user)):
    """List all uploaded documents for the current user"""
    user_id = current_user["id"]
    
    # Get access token from request for RLS
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        access_token = auth_header.split(" ")[1]
    else:
        access_token = request.cookies.get("access_token")
    
    print(f"📋 Loading documents for user: {user_id}")
    
    # Get all documents for user from database (with access token for RLS)
    documents_list = database_service.get_user_documents(user_id, access_token=access_token)
    
    print(f"📋 Database returned {len(documents_list)} documents")
    
    results = []
    for doc in documents_list:
        result = {
            "document_id": doc.get("id"),
            "filename": doc.get("filename"),
            "status": doc.get("status", "unknown"),
            "upload_time": doc.get("upload_time", "unknown")
        }
        
        # Load processed data if available (but don't fail if it's missing)
        processed_data_path = doc.get("processed_data_path")
        if processed_data_path:
            try:
                # Use user token for RLS when downloading processed data
                processed_data_bytes = storage_service.download_file(processed_data_path, access_token=access_token)
                processed_data = json.loads(processed_data_bytes.decode('utf-8'))
                
                if processed_data.get("markdown"):
                    result["document_markdown"] = processed_data["markdown"]
                if processed_data.get("detected_chunks"):
                    result["detected_chunks"] = processed_data["detected_chunks"]
                if processed_data.get("tables"):
                    result["tables"] = processed_data["tables"]
                if processed_data.get("metadata"):
                    result["metadata"] = processed_data["metadata"]
            except Exception as e:
                print(f"⚠ Warning: Error loading processed data for {doc.get('id')}: {str(e)}")
                # Continue without processed data - document still exists
        
        results.append(result)
    
    print(f"✓ Returning {len(results)} documents to frontend")
    return results

# Debug endpoint to test Supabase connection
@app.get("/test/supabase")
async def test_supabase(current_user: dict = Depends(get_current_user)):
    """Test Supabase database and storage connection"""
    import traceback
    results = {
        "user_id": current_user["id"],
        "database_test": None,
        "storage_test": None,
        "documents_count": 0
    }
    
    # Test database
    try:
        docs = database_service.get_user_documents(current_user["id"])
        results["database_test"] = "SUCCESS"
        results["documents_count"] = len(docs)
        results["documents"] = docs[:5]  # First 5 docs
    except Exception as e:
        results["database_test"] = f"ERROR: {str(e)}"
        results["database_traceback"] = traceback.format_exc()
    
    # Test storage
    try:
        # Try to list files (this will fail if bucket doesn't exist)
        from auth import get_supabase_client
        client = get_supabase_client()
        files = client.storage.from_("documents").list(current_user["id"], limit=1)
        results["storage_test"] = "SUCCESS"
        results["storage_bucket_exists"] = True
    except Exception as e:
        results["storage_test"] = f"ERROR: {str(e)}"
        results["storage_traceback"] = traceback.format_exc()
        results["storage_bucket_exists"] = False
    
    return results

# Serve login page
@app.get("/login")
async def login_page():
    """Serve the login page"""
    if os.path.exists("login.html"):
        return FileResponse("login.html")
    raise HTTPException(status_code=404, detail="Login page not found")

# Serve dashboard
@app.get("/dashboard")
async def dashboard_page():
    """Serve the dashboard page"""
    if os.path.exists("index.html"):
        response = FileResponse("index.html")
        # Prevent caching to ensure fresh CSS/JS loads
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
    raise HTTPException(status_code=404, detail="Dashboard not found")

# Root redirect
@app.get("/")
async def root():
    """Redirect to login"""
    return RedirectResponse(url="/login")

if __name__ == "__main__":
    # Create data directories using settings
    settings.create_directories()
    
    # Start the FastAPI server
    uvicorn.run(
        app, 
        host=settings.HOST, 
        port=settings.PORT,
        log_level="debug" if settings.DEBUG else "info"

    )