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
from auth import sign_up, sign_in, sign_out, get_user, verify_token

app = FastAPI(title="ALPHA LENS - Financial Document Analyzer MVP")

# Add CORS middleware to allow requests from a frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for MVP (replace with MongoDB in production)
documents = {}
processing_status = {}
# Store user sessions (in production, use Redis or database)
user_sessions = {}  # {access_token: user_id}

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
    
    # Save file to temporary location
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    temp_file_path = temp_file.name
    
    try:
        # Write file content to temp file
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Store document info with user association
        documents[document_id] = {
            "filename": file.filename,
            "file_path": temp_file_path,
            "upload_time": "now",  # Use proper timestamp in production
            "user_id": current_user["id"]  # Associate with user
        }
        
        # Set initial processing status
        processing_status[document_id] = {
            "status": "uploaded",
            "progress": 0,
            "message": "Document uploaded, starting processing"
        }
        
        # Start processing in the background
        background_tasks.add_task(
            process_document_background, 
            document_id, 
            temp_file_path
        )
        
        return {"document_id": document_id, "status": "processing"}
    
    except Exception as e:
        if os.path.exists(temp_file_path):
            os.unlink(temp_file_path)
        raise HTTPException(status_code=500, detail=str(e))

def process_document_background(document_id: str, file_path: str):
    """Process document in the background and update status"""
    try:
        # Update status to processing
        processing_status[document_id] = {
            "status": "processing",
            "progress": 10,
            "message": "Started document processing"
        }
        
        # Update progress during processing
        processing_status[document_id] = {
            "status": "processing",
            "progress": 30,
            "message": "Calling Landing.AI ADE API..."
        }
        
        # Process the document
        result = process_document(file_path)
        
        # Update progress
        processing_status[document_id] = {
            "status": "processing",
            "progress": 90,
            "message": "Finalizing document data..."
        }
        
        # Store the processing results
        documents[document_id].update({
            "processed_data": result,
            "vector_store_path": f"./data/vector_stores/{document_id}"
        })
        
        # Update status to complete
        processing_status[document_id] = {
            "status": "complete",
            "progress": 100,
            "message": "Document processing complete"
        }
        
        print(f"✓ Document {document_id} processing completed successfully")
    
    except Exception as e:
        # Update status to error
        processing_status[document_id] = {
            "status": "error",
            "progress": 0,
            "message": f"Error processing document: {str(e)}"
        }
        
        # Log the error
        print(f"✗ Error processing document {document_id}: {str(e)}")
        import traceback
        traceback.print_exc()

@app.get("/documents/{document_id}/status")
async def get_document_status(document_id: str, current_user: dict = Depends(get_current_user)):
    """Get the processing status of a document"""
    if document_id not in processing_status:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Verify document belongs to user
    if document_id in documents and documents[document_id].get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    return processing_status[document_id]

@app.get("/documents/{document_id}")
async def get_document(document_id: str, current_user: dict = Depends(get_current_user)):
    """Get document details and processed results"""
    if document_id not in documents:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Return document info excluding large data like vector stores
    doc_info = {
        "document_id": document_id,
        "filename": documents[document_id]["filename"],
        "status": processing_status[document_id]["status"],
    }
    
    # Include summary if available
    if "processed_data" in documents[document_id]:
        doc_info["summary"] = documents[document_id]["processed_data"].get("summary", "")
        
        # Include key metrics if available
        if "key_metrics" in documents[document_id]["processed_data"]:
            doc_info["key_metrics"] = documents[document_id]["processed_data"]["key_metrics"]
        
        # Include extracted metadata for richer UI context
        processed_data = documents[document_id]["processed_data"]
        if "metadata" in processed_data:
            doc_info["metadata"] = processed_data["metadata"]
        if processed_data.get("markdown"):
            doc_info["document_markdown"] = processed_data["markdown"]
        if processed_data.get("detected_chunks"):
            doc_info["detected_chunks"] = processed_data["detected_chunks"]
        if processed_data.get("tables"):
            doc_info["tables"] = processed_data["tables"]
    
    return doc_info

@app.get("/documents/{document_id}/file")
async def download_document(document_id: str, current_user: dict = Depends(get_current_user)):
    """Download the original PDF for preview overlays"""
    if document_id not in documents:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Verify document belongs to user
    if documents[document_id].get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    file_path = documents[document_id].get("file_path")
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Document file not found")
    
    filename = documents[document_id].get("filename") or f"{document_id}.pdf"
    return FileResponse(path=file_path, media_type="application/pdf", filename=filename)

@app.post("/documents/chat", response_model=ChatResponse)
async def chat_with_document(query: ChatQuery, current_user: dict = Depends(get_current_user)):
    """Chat with a processed document"""
    document_id = query.document_id
    
    # Check if document exists
    if document_id not in documents:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Verify document belongs to user
    if documents[document_id].get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Check if document processing is complete
    if processing_status[document_id]["status"] != "complete":
        raise HTTPException(
            status_code=400, 
            detail=f"Document processing not complete. Current status: {processing_status[document_id]['status']}"
        )
    
    # Get answer from document
    vector_store_path = documents[document_id].get("vector_store_path")
    if not vector_store_path:
        raise HTTPException(status_code=400, detail="Vector store not found for document")
    
    # Query the document
    answer_data = get_answer_from_document(
        query.query,
        vector_store_path,
        documents[document_id]["processed_data"]
    )
    
    return {
        "document_id": document_id,
        "query": query.query,
        "answer": answer_data["answer"],
        "sources": answer_data.get("sources", []),
        "source": answer_data.get("source", "local_llm")
    }

@app.get("/documents")
async def list_documents(current_user: dict = Depends(get_current_user)):
    """List all uploaded documents for the current user"""
    results = []
    for doc_id, doc_info in documents.items():
        # Only return documents belonging to the current user
        if doc_info.get("user_id") == current_user["id"]:
            # Get status from processing_status, default to "processing" if not found
            status_info = processing_status.get(doc_id, {"status": "processing", "progress": 0, "message": "Processing..."})
            
            result = {
                "document_id": doc_id,
                "filename": doc_info["filename"],
                "status": status_info["status"],
                "upload_time": doc_info.get("upload_time", "unknown")
            }
            
            # Include processed data if available
            if "processed_data" in doc_info:
                processed_data = doc_info["processed_data"]
                if processed_data.get("markdown"):
                    result["document_markdown"] = processed_data["markdown"]
                if processed_data.get("detected_chunks"):
                    result["detected_chunks"] = processed_data["detected_chunks"]
                if processed_data.get("metadata"):
                    result["metadata"] = processed_data["metadata"]
                if processed_data.get("tables"):
                    result["tables"] = processed_data["tables"]
            
            results.append(result)
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
        return FileResponse("index.html")
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