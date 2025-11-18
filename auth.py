"""
Authentication utilities using Supabase
"""
import os
from typing import Optional, Dict, Any
from supabase import create_client, Client
try:
    from config import settings
except ImportError:
    # Fallback if settings not available
    class Settings:
        DEBUG = False
    settings = Settings()

# Initialize Supabase client
supabase: Optional[Client] = None

def get_supabase_client() -> Client:
    """Get or create Supabase client"""
    global supabase
    if supabase is None:
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_ANON_KEY")
        
        if not supabase_url or not supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env file")
        
        supabase = create_client(supabase_url, supabase_key)
    
    return supabase

def sign_up(email: str, password: str) -> Dict[str, Any]:
    """Sign up a new user"""
    client = get_supabase_client()
    try:
        response = client.auth.sign_up({
            "email": email,
            "password": password
        })
        # Check if response has user and session
        if response.user:
            return {
                "success": True,
                "user": response.user,
                "session": response.session if hasattr(response, 'session') and response.session else None
            }
        else:
            return {
                "success": False,
                "error": "Failed to create user"
            }
    except Exception as e:
        error_msg = str(e)
        # Extract more specific error message if available
        if hasattr(e, 'message'):
            error_msg = e.message
        elif hasattr(e, 'args') and len(e.args) > 0:
            error_msg = str(e.args[0])
        
        return {
            "success": False,
            "error": error_msg
        }

def sign_in(email: str, password: str) -> Dict[str, Any]:
    """Sign in an existing user"""
    client = get_supabase_client()
    try:
        response = client.auth.sign_in_with_password({
            "email": email,
            "password": password
        })
        # Check if response has user and session
        if response.user and response.session:
            return {
                "success": True,
                "user": response.user,
                "session": response.session
            }
        else:
            return {
                "success": False,
                "error": "Invalid email or password"
            }
    except Exception as e:
        error_msg = str(e)
        # Extract more specific error message if available
        if hasattr(e, 'message'):
            error_msg = e.message
        elif hasattr(e, 'args') and len(e.args) > 0:
            error_msg = str(e.args[0])
        
        # Common error messages from Supabase
        if "Invalid login credentials" in error_msg or "Email not confirmed" in error_msg:
            error_msg = "Invalid email or password"
        elif "User not found" in error_msg:
            error_msg = "Invalid email or password"
        
        return {
            "success": False,
            "error": error_msg
        }

def sign_out(access_token: str) -> Dict[str, Any]:
    """Sign out the current user"""
    client = get_supabase_client()
    try:
        # Sign out using the access token
        # Note: Supabase Python client doesn't require setting session for sign_out
        # We just need to call sign_out which will clear the session on the server
        client.auth.sign_out()
        return {
            "success": True
        }
    except Exception as e:
        # Even if sign_out fails, we consider it successful for client-side cleanup
        return {
            "success": True,
            "error": str(e) if settings.DEBUG else None
        }

def get_user(access_token: str) -> Optional[Dict[str, Any]]:
    """Get current user from access token"""
    if not access_token:
        return None
    
    client = get_supabase_client()
    try:
        # Use get_user with JWT token directly
        # The Supabase client's get_user method accepts a JWT token
        user_response = client.auth.get_user(access_token)
        
        if user_response and user_response.user:
            return {
                "id": user_response.user.id,
                "email": user_response.user.email,
                "created_at": str(user_response.user.created_at) if hasattr(user_response.user, 'created_at') else None
            }
        return None
    except Exception as e:
        print(f"Error getting user: {str(e)}")
        # Try alternative method - set session if we have refresh token
        # But for now, just return None if direct JWT doesn't work
        return None

def verify_token(access_token: str) -> bool:
    """Verify if access token is valid"""
    user = get_user(access_token)
    return user is not None

def reset_password(email: str) -> Dict[str, Any]:
    """Send password reset email"""
    client = get_supabase_client()
    try:
        response = client.auth.reset_password_for_email(email)
        return {
            "success": True,
            "message": "Password reset email sent"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

