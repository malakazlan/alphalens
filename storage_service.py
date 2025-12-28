"""
Supabase Storage Service
Handles file uploads, downloads, and management in Supabase Storage
"""
import os
from typing import Optional, BinaryIO
from supabase import Client
from auth import get_supabase_client
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class StorageService:
    """Service for managing files in Supabase Storage"""
    
    def __init__(self, bucket_name: str = "documents"):
        self.bucket_name = bucket_name
        self.client: Optional[Client] = None
    
    def _get_client(self) -> Client:
        """Get Supabase client"""
        if self.client is None:
            self.client = get_supabase_client()
        return self.client
    
    def _get_client_with_token(self, access_token: str) -> Client:
        """Get Supabase client with user access token for RLS"""
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
        
        # Decode JWT to verify user_id (for debugging)
        try:
            import jwt
            decoded = jwt.decode(access_token, options={"verify_signature": False})
            token_user_id = decoded.get("sub")
            print(f"🔍 Storage: JWT user_id from token: {token_user_id}")
        except Exception as jwt_error:
            print(f"⚠️ Could not decode JWT for storage: {str(jwt_error)}")
        
        # Create client with user's access token in headers for RLS
        # For Storage API, we need both apikey and Authorization headers
        # DO NOT call set_session() - it tries to validate and causes "Invalid API key" errors
        options = ClientOptions()
        options.headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {access_token}",
            "Prefer": "return=representation"
        }
        client = create_client(supabase_url, supabase_key, options)
        
        # Headers are sufficient for Storage RLS - no need to call set_session
        print(f"✓ Created storage client with access token for RLS (headers only, no session)")
        return client
    
    def upload_file(
        self, 
        user_id: str, 
        document_id: str, 
        file_content: bytes, 
        filename: str,
        file_type: str = "original",
        access_token: Optional[str] = None
    ) -> str:
        """
        Upload a file to Supabase Storage
        
        Args:
            user_id: User ID
            document_id: Document ID
            file_content: File content as bytes
            filename: Original filename
            file_type: Type of file ('original' or 'processed')
            access_token: User's JWT access token (required for RLS policies)
            
        Returns:
            Storage path of uploaded file
        """
        # Get client with user token for RLS if provided
        if access_token:
            client = self._get_client_with_token(access_token)
        else:
            client = self._get_client()
        
        # Create storage path: {user_id}/{document_id}/{file_type}_{filename}
        # IMPORTANT: The first folder MUST match auth.uid() for RLS policies to work
        file_extension = os.path.splitext(filename)[1]
        storage_filename = f"{file_type}{file_extension}"
        storage_path = f"{user_id}/{document_id}/{storage_filename}"
        
        print(f"🔍 Storage upload: path={storage_path}, user_id={user_id}, bucket={self.bucket_name}")
        if access_token:
            print(f"🔍 Storage: Using access token for RLS")
        else:
            print(f"⚠️ Storage: WARNING - No access token provided! RLS will block upload!")
        
        try:
            # Upload file to Supabase Storage
            # The Storage API will check RLS policies:
            # - bucket_id must be 'documents'
            # - First folder (user_id) must match auth.uid() from JWT token
            response = client.storage.from_(self.bucket_name).upload(
                path=storage_path,
                file=file_content,
                file_options={
                    "content-type": self._get_content_type(file_extension),
                    "upsert": "true"  # Overwrite if exists
                }
            )
            
            # Check if upload was successful
            if response:
                print(f"✓ File uploaded successfully to: {storage_path}")
                return storage_path
            else:
                error_msg = "Upload failed - no response from Supabase"
                print(f"ERROR: {error_msg}")
                raise Exception(error_msg)
                
        except Exception as e:
            error_msg = f"Error uploading file to Supabase Storage: {str(e)}"
            print(f"ERROR: {error_msg}")
            import traceback
            traceback.print_exc()
            raise Exception(f"Failed to upload file: {str(e)}")
    
    def download_file(self, storage_path: str, access_token: Optional[str] = None) -> bytes:
        """
        Download a file from Supabase Storage
        
        Args:
            storage_path: Path to file in storage
            access_token: Optional user JWT token for RLS policies
            
        Returns:
            File content as bytes
        """
        # Get client with user token for RLS if provided
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
            
            # Create client with user's access token in headers for RLS
            options = ClientOptions()
            options.headers["Authorization"] = f"Bearer {access_token}"
            client = create_client(supabase_url, supabase_key, options=options)
        else:
            client = self._get_client()
        
        try:
            print(f"🔍 Downloading file from storage: {storage_path}")
            print(f"🔍 Bucket: {self.bucket_name}")
            if access_token:
                print(f"🔍 Using access token: {access_token[:30]}...")
            
            response = client.storage.from_(self.bucket_name).download(storage_path)
            print(f"✓ File downloaded successfully: {storage_path} ({len(response)} bytes)")
            return response
        except Exception as e:
            error_msg = f"Error downloading file from Supabase Storage: {str(e)}"
            print(f"ERROR: {error_msg}")
            print(f"🔍 Storage path: {storage_path}")
            print(f"🔍 Bucket: {self.bucket_name}")
            import traceback
            print("🔍 Full traceback:")
            traceback.print_exc()
            raise Exception(f"Failed to download file: {str(e)}")
    
    def get_public_url(self, storage_path: str, expires_in: int = 3600) -> str:
        """
        Get a signed URL for temporary file access
        
        Args:
            storage_path: Path to file in storage
            expires_in: URL expiration time in seconds (default 1 hour)
            
        Returns:
            Signed URL
        """
        client = self._get_client()
        
        try:
            response = client.storage.from_(self.bucket_name).create_signed_url(
                path=storage_path,
                expires_in=expires_in
            )
            return response.get("signedURL", "")
        except Exception as e:
            print(f"Error creating signed URL: {str(e)}")
            raise Exception(f"Failed to create signed URL: {str(e)}")
    
    def delete_file(self, storage_path: str) -> bool:
        """
        Delete a file from Supabase Storage
        
        Args:
            storage_path: Path to file in storage
            
        Returns:
            True if successful
        """
        client = self._get_client()
        
        try:
            response = client.storage.from_(self.bucket_name).remove([storage_path])
            return True
        except Exception as e:
            print(f"Error deleting file from Supabase Storage: {str(e)}")
            return False
    
    def delete_folder(self, user_id: str, document_id: str) -> bool:
        """
        Delete entire document folder from storage
        
        Args:
            user_id: User ID
            document_id: Document ID
            
        Returns:
            True if successful
        """
        client = self._get_client()
        
        try:
            folder_path = f"{user_id}/{document_id}/"
            # List all files in folder
            files = client.storage.from_(self.bucket_name).list(folder_path)
            
            if files:
                # Delete all files
                file_paths = [f"{folder_path}{file['name']}" for file in files]
                client.storage.from_(self.bucket_name).remove(file_paths)
            
            return True
        except Exception as e:
            print(f"Error deleting folder from Supabase Storage: {str(e)}")
            return False
    
    def _get_content_type(self, file_extension: str) -> str:
        """Get content type based on file extension"""
        content_types = {
            '.pdf': 'application/pdf',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.tiff': 'image/tiff',
            '.webp': 'image/webp',
            '.json': 'application/json',
        }
        return content_types.get(file_extension.lower(), 'application/octet-stream')


# Create singleton instance
storage_service = StorageService()
