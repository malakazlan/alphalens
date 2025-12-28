"""
Database Service for Supabase
Handles database operations for documents and processing status
"""
from typing import Optional, Dict, Any, List
from supabase import Client
from auth import get_supabase_client
from datetime import datetime
from dotenv import load_dotenv
import uuid
import os

# Load environment variables from .env file
load_dotenv()


class DatabaseService:
    """Service for managing documents in Supabase Database"""
    
    def __init__(self):
        self.client: Optional[Client] = None
    
    def _get_client(self, access_token: Optional[str] = None) -> Client:
        """
        Get Supabase client with optional user token for RLS
        
        Args:
            access_token: User's JWT access token (required for RLS policies)
        """
        # If we have a user token, create a client with that token for RLS
        if access_token:
            from supabase import create_client
            from supabase.lib.client_options import ClientOptions
            
            # Try to get from config first, then fallback to os.getenv
            try:
                from config import settings
                supabase_url = settings.SUPABASE_URL or os.getenv("SUPABASE_URL")
                supabase_key = settings.SUPABASE_ANON_KEY or os.getenv("SUPABASE_ANON_KEY")
            except:
                supabase_url = os.getenv("SUPABASE_URL")
                supabase_key = os.getenv("SUPABASE_ANON_KEY")
            
            if not supabase_url or not supabase_key:
                error_msg = (
                    "SUPABASE_URL and SUPABASE_ANON_KEY must be set.\n"
                    "Please check your .env file or environment variables."
                )
                print(f"ERROR: {error_msg}")
                raise ValueError(error_msg)
            
            # Create client with user's access token for RLS
            # The Supabase Python client needs the Authorization header set correctly
            # ClientOptions is a dataclass - we need to update headers, not replace them
            try:
                options = ClientOptions()
                # Update headers dict (it's already initialized with default headers)
                options.headers.update({
                    "Authorization": f"Bearer {access_token}",
                    "Prefer": "return=representation"
                })
                # Create client - it will use supabase_key for apiKey header automatically
                client = create_client(supabase_url, supabase_key, options=options)
            except Exception as e:
                # Fallback: Create client normally and manually set headers
                print(f"⚠️ Could not create client with ClientOptions: {str(e)}")
                print(f"⚠️ Falling back to standard client creation")
                client = create_client(supabase_url, supabase_key)
                # Manually update the client's headers
                if hasattr(client, 'options') and hasattr(client.options, 'headers'):
                    client.options.headers["Authorization"] = f"Bearer {access_token}"
                    client.options.headers["Prefer"] = "return=representation"
            
            # Verify the key format (for debugging)
            if len(supabase_key) < 50:
                print(f"⚠️ WARNING: SUPABASE_ANON_KEY seems too short ({len(supabase_key)} chars)")
            else:
                print(f"✓ SUPABASE_ANON_KEY length: {len(supabase_key)} chars")
            
            print(f"✓ Created Supabase client with access token for RLS")
            return client
        
        # Otherwise use the default client (for service operations)
        if self.client is None:
            self.client = get_supabase_client()
        return self.client
    
    def create_document(
        self,
        user_id: str,
        document_id: str,
        filename: str,
        file_path: str,
        status: str = "uploaded",
        access_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a new document record in database
        
        Args:
            user_id: User ID
            document_id: Document ID
            filename: Original filename
            file_path: Storage path to file
            status: Initial status
            access_token: User's JWT access token (required for RLS policies)
            
        Returns:
            Created document record
        """
        # Use user token for RLS
        client = self._get_client(access_token=access_token)
        
        document_data = {
            "id": document_id,
            "user_id": user_id,
            "filename": filename,
            "file_path": file_path,
            "status": status,
            "upload_time": datetime.utcnow().isoformat(),
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }
        
        try:
            print(f"🔍 Inserting document with user_id: {user_id}, document_id: {document_id}")
            if access_token:
                print(f"🔍 Using access token for RLS: {access_token[:30]}...")
                # Verify the user_id in the token matches the user_id we're inserting
                try:
                    import jwt
                    decoded = jwt.decode(access_token, options={"verify_signature": False})
                    token_user_id = decoded.get("sub")
                    print(f"🔍 User ID from JWT token: {token_user_id}")
                    print(f"🔍 User ID being inserted: {user_id}")
                    if str(token_user_id) != str(user_id):
                        print(f"⚠️ WARNING: JWT user_id ({token_user_id}) doesn't match insert user_id ({user_id})!")
                        print(f"⚠️ This will cause RLS policy to fail!")
                except Exception as jwt_error:
                    print(f"⚠️ Could not decode JWT: {str(jwt_error)}")
            else:
                print(f"⚠️ WARNING: No access token provided - RLS may block insert!")
            
            print(f"🔍 Document data: {document_data}")
            response = client.table("documents").insert(document_data).execute()
            
            print(f"🔍 Insert response: {response}")
            print(f"🔍 Response data: {response.data}")
            
            if response.data and len(response.data) > 0:
                print(f"✓ Document created successfully in database")
                return response.data[0]
            else:
                error_msg = "Failed to create document record - no data returned"
                print(f"ERROR: {error_msg}")
                print(f"Response: {response}")
                print(f"Response data: {response.data}")
                raise Exception(error_msg)
        except Exception as e:
            error_msg = f"Error creating document in database: {str(e)}"
            print(f"ERROR: {error_msg}")
            print(f"Document data being inserted: {document_data}")
            import traceback
            traceback.print_exc()
            raise Exception(error_msg)
    
    def get_document_by_filename(self, user_id: str, filename: str, access_token: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Get a document by filename for a user (check for duplicates)
        
        Args:
            user_id: User ID
            filename: Document filename
            access_token: User's JWT access token (required for RLS policies)
            
        Returns:
            Document record if found, None otherwise
        """
        client = self._get_client(access_token=access_token)
        
        try:
            user_id_str = str(user_id)
            response = client.table("documents").select("*").eq("user_id", user_id_str).eq("filename", filename).limit(1).execute()
            
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            print(f"Error checking for duplicate document: {str(e)}")
            return None
    
    def get_document(self, document_id: str, user_id: str, access_token: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Get a document by ID (with user verification)
        
        Args:
            document_id: Document ID
            user_id: User ID for verification
            access_token: User's JWT access token (required for RLS policies)
            
        Returns:
            Document record or None
        """
        # Get client with user token for RLS
        client = self._get_client(access_token=access_token)
        
        try:
            response = client.table("documents").select("*").eq("id", document_id).eq("user_id", user_id).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            print(f"Error getting document from database: {str(e)}")
            import traceback
            traceback.print_exc()
            return None
    
    def get_user_documents(self, user_id: str, access_token: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get all documents for a user
        
        Args:
            user_id: User ID
            access_token: User's JWT access token (required for RLS policies)
            
        Returns:
            List of document records
        """
        # Get client with user token for RLS
        client = self._get_client(access_token=access_token)
        
        try:
            # Convert user_id to string if it's not already (Supabase expects string for UUID comparison)
            user_id_str = str(user_id)
            
            # Debug: Log the query we're about to execute
            print(f"🔍 Querying documents table for user_id: {user_id_str}")
            if access_token:
                print(f"🔍 Using user token for RLS: {access_token[:20]}...")
            else:
                print(f"⚠ WARNING: No access token provided - RLS may block query!")
            
            response = client.table("documents").select("*").eq("user_id", user_id_str).order("upload_time", desc=True).execute()
            
            # Debug: Log raw response
            print(f"🔍 Raw response: {response}")
            print(f"🔍 Response data type: {type(response.data)}")
            print(f"🔍 Response data: {response.data}")
            
            if response.data and len(response.data) > 0:
                print(f"✓ Found {len(response.data)} documents for user {user_id_str}")
                return response.data
            else:
                print(f"⚠ No documents found for user {user_id_str}")
                # Try to see if there are ANY documents in the table
                try:
                    all_docs = client.table("documents").select("id, user_id, filename").limit(5).execute()
                    if all_docs.data:
                        print(f"🔍 Sample documents in table: {all_docs.data}")
                        print(f"🔍 Sample user_ids: {[doc.get('user_id') for doc in all_docs.data]}")
                except:
                    pass
                return []
        except Exception as e:
            error_msg = f"Error getting user documents from database: {str(e)}"
            print(f"ERROR: {error_msg}")
            import traceback
            traceback.print_exc()
            return []
    
    def update_document(
        self,
        document_id: str,
        user_id: str,
        updates: Dict[str, Any],
        access_token: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Update a document record
        
        Args:
            document_id: Document ID
            user_id: User ID for verification
            updates: Dictionary of fields to update
            access_token: User's JWT access token (required for RLS policies)
            
        Returns:
            Updated document record or None
        """
        # Use user token for RLS
        client = self._get_client(access_token=access_token)
        
        # Add updated_at timestamp
        updates["updated_at"] = datetime.utcnow().isoformat()
        
        try:
            response = client.table("documents").update(updates).eq("id", document_id).eq("user_id", user_id).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            print(f"Error updating document in database: {str(e)}")
            return None
    
    def update_processing_status(
        self,
        document_id: str,
        user_id: str,
        status: str,
        progress: int = 0,
        message: str = "",
        access_token: Optional[str] = None
    ) -> bool:
        """
        Update document processing status
        
        Args:
            document_id: Document ID
            user_id: User ID
            status: New status
            progress: Progress percentage (0-100)
            message: Status message
            access_token: User's JWT access token (required for RLS policies)
            
        Returns:
            True if successful
        """
        updates = {
            "status": status,
            "updated_at": datetime.utcnow().isoformat()
        }
        
        # Add progress and message if provided
        if progress is not None:
            updates["progress"] = progress
        if message:
            updates["status_message"] = message
        
        result = self.update_document(document_id, user_id, updates, access_token=access_token)
        return result is not None
    
    def update_processed_data(
        self,
        document_id: str,
        user_id: str,
        processed_data_path: str,
        processed_data: Dict[str, Any],
        access_token: Optional[str] = None
    ) -> bool:
        """
        Update document with processed data
        
        Args:
            document_id: Document ID
            user_id: User ID
            processed_data_path: Path to processed data file in storage
            processed_data: Processed data dictionary
            access_token: User's JWT access token (required for RLS policies)
            
        Returns:
            True if successful
        """
        updates = {
            "processed_data_path": processed_data_path,
            "status": "complete",
            "metadata": processed_data.get("metadata", {}),
            "updated_at": datetime.utcnow().isoformat()
        }
        
        result = self.update_document(document_id, user_id, updates, access_token=access_token)
        return result is not None
    
    def delete_document(self, document_id: str, user_id: str) -> bool:
        """
        Delete a document record
        
        Args:
            document_id: Document ID
            user_id: User ID for verification
            
        Returns:
            True if successful
        """
        client = self._get_client()
        
        try:
            response = client.table("documents").delete().eq("id", document_id).eq("user_id", user_id).execute()
            return True
        except Exception as e:
            print(f"Error deleting document from database: {str(e)}")
            return False


# Create singleton instance
database_service = DatabaseService()

