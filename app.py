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
from report_service import report_service

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
    intent: Optional[str] = None
    follow_up_suggestions: List[str] = []

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
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """Upload a financial document for processing"""
    
    # Generate document ID
    document_id = str(uuid.uuid4())
    user_id = current_user["id"]
    
    # Get access token from request for RLS
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        access_token = auth_header.split(" ")[1]
    else:
        access_token = request.cookies.get("access_token")
    
    try:
        # Read file content
        file_content = await file.read()
        
        if not file_content:
            raise HTTPException(status_code=400, detail="File is empty")
        
        # Check for duplicate document (same filename for same user)
        filename = file.filename or "document.pdf"
        existing_doc = database_service.get_document_by_filename(user_id, filename, access_token=access_token)
        if existing_doc:
            raise HTTPException(
                status_code=409, 
                detail=f"Document '{filename}' already exists. Please use a different filename or delete the existing document first."
            )
        
        # Upload file to Supabase Storage
        try:
            storage_path = storage_service.upload_file(
                user_id=user_id,
                document_id=document_id,
                file_content=file_content,
                filename=file.filename or "document.pdf",
                file_type="original",
                access_token=access_token  # Pass access token for RLS
            )
            print(f"✓ File uploaded to storage: {storage_path}")
        except Exception as storage_error:
            error_msg = f"Storage upload failed: {str(storage_error)}"
            print(f"ERROR: {error_msg}")
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=500, 
                detail=f"Failed to upload file to storage: {str(storage_error)}"
            )
        
        # Always save to database - the list endpoint will only show 3 most recent
        # This ensures all documents are accessible even if not in recent files list
        try:
            print(f"🔍 Creating document in database with user_id: {user_id}")
            print(f"🔍 Access token provided: {'Yes' if access_token else 'No'}")
            if access_token:
                print(f"🔍 Access token preview: {access_token[:50]}...")
            
            database_service.create_document(
                user_id=user_id,
                document_id=document_id,
                filename=file.filename or "document.pdf",
                file_path=storage_path,
                status="uploaded",
                access_token=access_token  # Pass access token for RLS
            )
            print(f"✓ Document saved to database: {document_id}")
            
            # Update processing status
            try:
                database_service.update_processing_status(
                    document_id=document_id,
                    user_id=user_id,
                    status="uploaded",
                    progress=0,
                    message="Document uploaded, starting processing",
                    access_token=access_token  # Pass access token for RLS
                )
            except Exception as status_error:
                print(f"Warning: Failed to update status: {str(status_error)}")
                import traceback
                traceback.print_exc()
                # Continue anyway, status update is not critical
        except Exception as db_error:
            error_msg = f"Database insert failed: {str(db_error)}"
            print(f"ERROR: {error_msg}")
            import traceback
            traceback.print_exc()
            # Try to delete uploaded file from storage
            try:
                storage_service.delete_file(storage_path)
            except:
                pass
            raise HTTPException(
                status_code=500,
                detail=f"Failed to save document to database: {str(db_error)}"
            )
        
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
            temp_file_path,
            access_token  # Pass access token for RLS in background processing
        )
        
        return {
            "document_id": document_id, 
            "status": "processing",
            "message": "Document uploaded and processing started"
        }
    
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        error_msg = f"Error uploading document: {str(e)}"
        print(f"ERROR: {error_msg}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

def process_document_background(document_id: str, user_id: str, file_path: str, access_token: Optional[str] = None):
    """Process document in the background and update status"""
    try:
        print(f"🔄 Starting background processing for document: {document_id}")
        
        # Update status to processing
        try:
            database_service.update_processing_status(
                document_id=document_id,
                user_id=user_id,
                status="processing",
                progress=10,
                message="Started document processing",
                access_token=access_token  # Pass access token for RLS
            )
        except Exception as e:
            print(f"Warning: Failed to update status: {str(e)}")
            import traceback
            traceback.print_exc()
        
        print(f"📤 Calling Landing.AI ADE API for document processing...")
        
        # Update progress
        try:
            database_service.update_processing_status(
                document_id=document_id,
                user_id=user_id,
                status="processing",
                progress=30,
                message="Calling Landing.AI ADE API...",
                access_token=access_token  # Pass access token for RLS
            )
        except Exception as e:
            print(f"Warning: Failed to update status: {str(e)}")
            import traceback
            traceback.print_exc()
        
        # Process the document (this calls Landing.AI)
        result = process_document(file_path)
        
        print(f"✓ Document processed successfully. Detected {len(result.get('detected_chunks', []))} chunks")
        
        # Update progress
        try:
            database_service.update_processing_status(
                document_id=document_id,
                user_id=user_id,
                status="processing",
                progress=90,
                message="Finalizing document data...",
                access_token=access_token  # Pass access token for RLS
            )
        except Exception as e:
            print(f"Warning: Failed to update status: {str(e)}")
            import traceback
            traceback.print_exc()
        
        # Upload processed data to Supabase Storage
        processed_data_json = json.dumps(result, default=str)
        try:
            processed_data_path = storage_service.upload_file(
                user_id=user_id,
                document_id=document_id,
                file_content=processed_data_json.encode('utf-8'),
                filename="processed.json",
                file_type="processed",
                access_token=access_token  # Pass access token for RLS
            )
            print(f"✓ Processed data uploaded to storage: {processed_data_path}")
        except Exception as e:
            print(f"ERROR: Failed to upload processed data: {str(e)}")
            import traceback
            traceback.print_exc()
            processed_data_path = None
        
        # Update document with processed data
        if processed_data_path:
            try:
                database_service.update_processed_data(
                    document_id=document_id,
                    user_id=user_id,
                    processed_data_path=processed_data_path,
                    processed_data=result,
                    access_token=access_token  # Pass access token for RLS
                )
                
                # Update status to complete
                database_service.update_processing_status(
                    document_id=document_id,
                    user_id=user_id,
                    status="complete",
                    progress=100,
                    message="Document processing complete",
                    access_token=access_token  # Pass access token for RLS
                )
                print(f"✓ Document {document_id} processing completed successfully")
            except Exception as e:
                print(f"ERROR: Failed to update database with processed data: {str(e)}")
                import traceback
                traceback.print_exc()
        
        # Clean up temporary file
        if os.path.exists(file_path):
            try:
                os.unlink(file_path)
            except Exception as e:
                print(f"Warning: Failed to delete temp file: {str(e)}")
        
    except Exception as e:
        error_msg = f"Error processing document: {str(e)}"
        print(f"✗ {error_msg}")
        import traceback
        traceback.print_exc()
        
        # Update status to error
        try:
            database_service.update_processing_status(
                document_id=document_id,
                user_id=user_id,
                status="error",
                progress=0,
                message=error_msg
            )
        except Exception as db_error:
            print(f"ERROR: Failed to update error status: {str(db_error)}")
        
        # Clean up temporary file
        if os.path.exists(file_path):
            try:
                os.unlink(file_path)
            except:
                pass

@app.get("/documents/{document_id}/status")
async def get_document_status(document_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Get the processing status of a document"""
    user_id = current_user["id"]
    
    # Get access token from request for RLS
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        access_token = auth_header.split(" ")[1]
    else:
        access_token = request.cookies.get("access_token")
    
    # Get document from database (with access token for RLS)
    document = database_service.get_document(document_id, user_id, access_token=access_token)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Return status information
    return {
        "status": document.get("status", "unknown"),
        "progress": document.get("progress", 0),
        "message": document.get("status_message", "")
    }

@app.get("/documents/{document_id}")
async def get_document(document_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Get document details and processed results"""
    user_id = current_user["id"]
    
    # Get access token from request for RLS
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        access_token = auth_header.split(" ")[1]
    else:
        access_token = request.cookies.get("access_token")
    
    # Get document from database (with access token for RLS)
    document = database_service.get_document(document_id, user_id, access_token=access_token)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    doc_info = {
        "document_id": document_id,
        "filename": document.get("filename"),
        "status": document.get("status", "unknown"),
        "upload_time": document.get("upload_time"),
    }
    
    # Check if file exists in storage
    file_path = document.get("file_path")
    file_missing = False
    if file_path:
        try:
            # Try to check if file exists (this will fail if file is missing)
            storage_service.download_file(file_path, access_token=access_token)
        except Exception as e:
            print(f"⚠️ File not found in storage: {file_path} - {str(e)}")
            file_missing = True
            # Mark document as having missing file
            doc_info["file_missing"] = True
            doc_info["error_message"] = "File was deleted from storage"
    
    # Load processed data from storage if available
    processed_data_path = document.get("processed_data_path")
    if processed_data_path:
        try:
            # Use user token for RLS when downloading processed data
            processed_data_bytes = storage_service.download_file(processed_data_path, access_token=access_token)
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
            print(f"⚠️ Error loading processed data: {str(e)}")
            # Mark as missing processed data
            if not doc_info.get("file_missing"):
                doc_info["processed_data_missing"] = True
            # Continue without processed data if loading fails
    
    return doc_info

@app.get("/documents/{document_id}/file")
async def download_document(document_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Download the original file for preview (PDF or image)"""
    user_id = current_user["id"]
    
    print(f"📄 Request to download file for document: {document_id}, user: {user_id}")
    
    # Get access token from request for RLS
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        access_token = auth_header.split(" ")[1]
    else:
        access_token = request.cookies.get("access_token")
    
    # Get document from database (with access token for RLS)
    document = database_service.get_document(document_id, user_id, access_token=access_token)
    if not document:
        print(f"❌ Document not found in database: {document_id}")
        raise HTTPException(status_code=404, detail="Document not found")
    
    file_path = document.get("file_path")
    if not file_path:
        print(f"❌ Document file_path is missing for document: {document_id}")
        print(f"   Document data: {list(document.keys())}")
        raise HTTPException(status_code=404, detail="Document file path not found in database")
    
    filename = document.get("filename") or f"{document_id}.pdf"
    print(f"📁 File path: {file_path}, Filename: {filename}")
    
    if not access_token:
        print(f"⚠️ Warning: No access token found in request headers or cookies")
    
    try:
        print(f"🔍 Downloading file from storage: {file_path}")
        # Download file from Supabase Storage (with user token for RLS)
        try:
            file_content = storage_service.download_file(file_path, access_token=access_token)
        except Exception as storage_error:
            error_msg = str(storage_error)
            print(f"❌ File not found in storage: {file_path}")
            print(f"   Error: {error_msg}")
            # Return a helpful error message
            raise HTTPException(
                status_code=404, 
                detail=f"File not found in storage. The file may have been deleted. Original path: {file_path}"
            )
        
        if not file_content:
            print(f"❌ File content is empty for: {file_path}")
            raise HTTPException(status_code=404, detail="File content is empty")
        
        print(f"✓ File downloaded successfully: {len(file_content)} bytes")
        
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
        
        print(f"✓ Returning file response: {filename} ({media_type})")
        # Return file response (temp file will be cleaned up by OS eventually)
        # For production, consider using streaming response or keeping files in storage
        return FileResponse(path=temp_file_path, media_type=media_type, filename=filename)
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        print(f"❌ Error downloading file: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to download file: {str(e)}")

@app.post("/documents/chat", response_model=ChatResponse)
async def chat_with_document(query: ChatQuery, request: Request, current_user: dict = Depends(get_current_user)):
    """Chat with a processed document"""
    document_id = query.document_id
    user_id = current_user["id"]
    
    # Get access token from request for RLS
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        access_token = auth_header.split(" ")[1]
    else:
        access_token = request.cookies.get("access_token")
    
    # Get document from database (with access token for RLS)
    document = database_service.get_document(document_id, user_id, access_token=access_token)
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
        # Pass access token for RLS
        processed_data_bytes = storage_service.download_file(processed_data_path, access_token=access_token)
        processed_data = json.loads(processed_data_bytes.decode('utf-8'))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load processed data: {str(e)}")
    
    # Vector store path (still local for now)
    vector_store_path = f"./data/vector_stores/{document_id}"
    
    # Query the document with conversation context
    answer_data = get_answer_from_document(
        query.query,
        vector_store_path,
        processed_data,
        document_id=document_id
    )
    
    return {
        "document_id": document_id,
        "query": query.query,
        "answer": answer_data["answer"],
        "sources": answer_data.get("sources", []),
        "source": answer_data.get("source", "local_llm"),
        "intent": answer_data.get("intent", "financial_analysis"),
        "follow_up_suggestions": answer_data.get("follow_up_suggestions", [])
    }

@app.get("/documents/{document_id}/report")
async def generate_professional_report(document_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Generate a professional financial analysis report for a document"""
    user_id = current_user["id"]
    
    # Get access token from request for RLS
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        access_token = auth_header.split(" ")[1]
    else:
        access_token = request.cookies.get("access_token")
    
    # Get document from database (with access token for RLS)
    document = database_service.get_document(document_id, user_id, access_token=access_token)
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
        # Pass access token for RLS
        processed_data_bytes = storage_service.download_file(processed_data_path, access_token=access_token)
        processed_data = json.loads(processed_data_bytes.decode('utf-8'))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load processed data: {str(e)}")
    
    # Generate document report using separate report service (doesn't affect chat)
    # IMPORTANT: Only processes THIS specific document - no cross-document access
    try:
        # Validate that processed_data belongs to this document
        if not processed_data:
            raise HTTPException(status_code=400, detail="No processed data available for this document")
        
        # Verify document_id matches (additional safety check)
        processed_metadata = processed_data.get("metadata", {})
        
        # Use the new report_service which is completely separate from chat
        # Pass document_id explicitly to ensure report is scoped to this document only
        # Use summary_mode=True for fastest generation (only explains sections, no full tables)
        document_report = report_service.generate_document_report(
            processed_data,  # Only this document's data
            document_id=document_id,  # Explicit document ID for validation
            fast_mode=True,  # Fast mode: show parsed data immediately, skip slow LLM
            summary_mode=True  # Summary mode: explain sections only, skip full table generation
        )
        
        return {
            "document_id": document_id,
            "filename": document.get("filename", "Unknown"),
            "report": document_report,
            "generated_at": document.get("upload_time")
        }
    except Exception as e:
        print(f"❌ Error generating report for document {document_id}: {str(e)}")
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
    # Documents are already sorted by upload_time DESC (most recent first)
    documents_list = database_service.get_user_documents(user_id, access_token=access_token)
    
    print(f"📋 Database returned {len(documents_list)} documents")
    
    # Return all documents for the user (no limit)
    results = []
    for doc in documents_list:
        result = {
            "document_id": doc.get("id"),
            "filename": doc.get("filename"),
            "status": doc.get("status", "unknown"),
            "upload_time": doc.get("upload_time", "unknown"),
            "progress": doc.get("progress", 0),
            "status_message": doc.get("status_message", "")
        }
        
        # OPTIMIZATION: Don't load processed data here - it's only needed when viewing a specific document
        # The /documents/{id} endpoint handles loading full processed data when needed
        # This prevents downloading processed.json for all documents on every list request
        
        results.append(result)
    
    print(f"✓ Returning {len(results)} documents to frontend")
    return results

# Debug endpoint to test Supabase connection
@app.get("/test/supabase")
async def test_supabase(current_user: dict = Depends(get_current_user)):
    """Test Supabase database and storage connection - DIAGNOSTIC TOOL"""
    import traceback
    results = {
        "user_id": current_user["id"],
        "database_table_exists": None,
        "database_rls_enabled": None,
        "database_policies_count": None,
        "database_test": None,
        "storage_bucket_exists": None,
        "storage_policies_count": None,
        "storage_test": None,
        "documents_count": 0,
        "env_variables": {
            "SUPABASE_URL": "SET" if os.getenv("SUPABASE_URL") else "NOT SET",
            "SUPABASE_ANON_KEY": "SET" if os.getenv("SUPABASE_ANON_KEY") else "NOT SET"
        }
    }
    
    # Test environment variables
    try:
        from config import settings
        results["env_variables"]["SUPABASE_URL_from_config"] = "SET" if settings.SUPABASE_URL else "NOT SET"
        results["env_variables"]["SUPABASE_ANON_KEY_from_config"] = "SET" if settings.SUPABASE_ANON_KEY else "NOT SET"
    except:
        pass
    
    # Test database - check if table exists
    try:
        from auth import get_supabase_client
        client = get_supabase_client()
        
        # Try to query the table
        try:
            response = client.table("documents").select("id").limit(1).execute()
            results["database_table_exists"] = True
            results["database_test"] = "SUCCESS - Table exists"
        except Exception as table_error:
            error_str = str(table_error)
            if "does not exist" in error_str or "relation" in error_str.lower():
                results["database_table_exists"] = False
                results["database_test"] = "ERROR: Table 'documents' does not exist! Run migration SQL."
            else:
                results["database_table_exists"] = "UNKNOWN"
                results["database_test"] = f"ERROR: {error_str}"
        
        # Try to get user documents
        try:
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                access_token = auth_header.split(" ")[1]
            else:
                access_token = None
            
            docs = database_service.get_user_documents(current_user["id"], access_token=access_token)
            results["documents_count"] = len(docs)
            results["documents"] = docs[:5]  # First 5 docs
        except Exception as e:
            results["database_test"] = f"ERROR querying: {str(e)}"
            results["database_traceback"] = traceback.format_exc()
            
    except Exception as e:
        results["database_test"] = f"ERROR: {str(e)}"
        results["database_traceback"] = traceback.format_exc()
    
    # Test storage
    try:
        from auth import get_supabase_client
        client = get_supabase_client()
        
        # Try to list files (this will fail if bucket doesn't exist)
        try:
            files = client.storage.from_("documents").list(current_user["id"], limit=1)
            results["storage_bucket_exists"] = True
            results["storage_test"] = "SUCCESS - Bucket exists"
        except Exception as bucket_error:
            error_str = str(bucket_error)
            if "not found" in error_str.lower() or "does not exist" in error_str.lower():
                results["storage_bucket_exists"] = False
                results["storage_test"] = "ERROR: Bucket 'documents' does not exist! Create it in Supabase Dashboard."
            else:
                results["storage_bucket_exists"] = "UNKNOWN"
                results["storage_test"] = f"ERROR: {error_str}"
    except Exception as e:
        results["storage_test"] = f"ERROR: {str(e)}"
        results["storage_traceback"] = traceback.format_exc()
        results["storage_bucket_exists"] = False
    
    # Add recommendations
    recommendations = []
    if not results.get("database_table_exists"):
        recommendations.append("❌ Database table missing - Run SQL migration from migrations/001_create_documents_table.sql")
    if not results.get("storage_bucket_exists"):
        recommendations.append("❌ Storage bucket missing - Create 'documents' bucket in Supabase Dashboard")
    if results["env_variables"]["SUPABASE_URL"] == "NOT SET" or results["env_variables"]["SUPABASE_ANON_KEY"] == "NOT SET":
        recommendations.append("❌ Environment variables missing - Check .env file")
    
    if not recommendations:
        recommendations.append("✅ Everything looks good! If uploads still fail, check RLS policies.")
    
    results["recommendations"] = recommendations
    results["fix_guide"] = "See FIX_AFTER_DELETE.md for step-by-step instructions"
    
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