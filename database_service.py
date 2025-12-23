"""
Database Service for Supabase
Handles database operations for documents and processing status
"""
from typing import Optional, Dict, Any, List
from supabase import Client
from auth import get_supabase_client
from datetime import datetime
import uuid


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
            import os
            supabase_url = os.getenv("SUPABASE_URL")
            supabase_key = os.getenv("SUPABASE_ANON_KEY")
            
            if not supabase_url or not supabase_key:
                raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set")
            
            # Create client with user's access token for RLS
            # The Supabase client needs the token in the Authorization header
            client = create_client(supabase_url, supabase_key)
            # Set the access token in the client's auth session
            try:
                # Set the session using the access token
                # Note: set_session typically needs both access_token and refresh_token
                # But for RLS, we can set just the access token in headers
                client.auth.set_session(access_token=access_token, refresh_token="")
            except:
                # If set_session fails, try setting it directly in headers
                try:
                    client.options.headers["Authorization"] = f"Bearer {access_token}"
                except:
                    pass
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
        status: str = "uploaded"
    ) -> Dict[str, Any]:
        """
        Create a new document record in database
        
        Args:
            user_id: User ID
            document_id: Document ID
            filename: Original filename
            file_path: Storage path to file
            status: Initial status
            
        Returns:
            Created document record
        """
        client = self._get_client()
        
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
            response = client.table("documents").insert(document_data).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]
            else:
                error_msg = "Failed to create document record - no data returned"
                print(f"ERROR: {error_msg}")
                print(f"Response: {response}")
                raise Exception(error_msg)
        except Exception as e:
            error_msg = f"Error creating document in database: {str(e)}"
            print(f"ERROR: {error_msg}")
            import traceback
            traceback.print_exc()
            raise Exception(error_msg)
    
    def get_document(self, document_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a document by ID (with user verification)
        
        Args:
            document_id: Document ID
            user_id: User ID for verification
            
        Returns:
            Document record or None
        """
        client = self._get_client()
        
        try:
            response = client.table("documents").select("*").eq("id", document_id).eq("user_id", user_id).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            print(f"Error getting document from database: {str(e)}")
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
        updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Update a document record
        
        Args:
            document_id: Document ID
            user_id: User ID for verification
            updates: Dictionary of fields to update
            
        Returns:
            Updated document record or None
        """
        client = self._get_client()
        
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
        message: str = ""
    ) -> bool:
        """
        Update document processing status
        
        Args:
            document_id: Document ID
            user_id: User ID
            status: New status
            progress: Progress percentage (0-100)
            message: Status message
            
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
        
        result = self.update_document(document_id, user_id, updates)
        return result is not None
    
    def update_processed_data(
        self,
        document_id: str,
        user_id: str,
        processed_data_path: str,
        processed_data: Dict[str, Any]
    ) -> bool:
        """
        Update document with processed data
        
        Args:
            document_id: Document ID
            user_id: User ID
            processed_data_path: Path to processed data file in storage
            processed_data: Processed data dictionary
            
        Returns:
            True if successful
        """
        updates = {
            "processed_data_path": processed_data_path,
            "status": "complete",
            "metadata": processed_data.get("metadata", {}),
            "updated_at": datetime.utcnow().isoformat()
        }
        
        result = self.update_document(document_id, user_id, updates)
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

