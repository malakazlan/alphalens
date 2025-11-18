import os
from dotenv import load_dotenv
from typing import Optional

# Load .env file
load_dotenv()

class Settings:
    """Configuration settings loaded from environment variables"""
    
    # Landing.AI ADE Configuration
    VISION_AGENT_API_KEY: str = os.getenv("VISION_AGENT_API_KEY", "")
    ADE_ENDPOINT: str = os.getenv("ADE_ENDPOINT", "https://api.va.landing.ai/v1/ade")
    
    # LLM API Configuration
    OPENAI_API_KEY: Optional[str] = os.getenv("OPENAI_API_KEY")
    ANTHROPIC_API_KEY: Optional[str] = os.getenv("ANTHROPIC_API_KEY")
    GOOGLE_API_KEY: Optional[str] = os.getenv("GOOGLE_API_KEY")
    
    # Determine which LLM to use based on available API keys
    @property
    def active_llm(self) -> str:
        if self.ANTHROPIC_API_KEY:
            return "claude"
        elif self.OPENAI_API_KEY:
            return "openai"
        elif self.GOOGLE_API_KEY:
            return "gemini"
        else:
            return "none"  # No LLM available
    
    # Use Landing.AI Chat if API key is available
    @property
    def use_landing_ai_chat(self) -> bool:
        return bool(self.VISION_AGENT_API_KEY)
    
    # Vector Database Configuration
    VECTOR_DB_PATH: str = os.getenv("VECTOR_DB_PATH", "./data/vector_stores")
    
    # Storage Configuration
    DOCUMENT_STORAGE_PATH: str = os.getenv("DOCUMENT_STORAGE_PATH", "./data/raw_docs")
    EXTRACTED_DATA_PATH: str = os.getenv("EXTRACTED_DATA_PATH", "./data/extracted")
    FINAL_OUTPUT_PATH: str = os.getenv("FINAL_OUTPUT_PATH", "./data/final_outputs")
    
    # Server Configuration
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "False").lower() in ("true", "1", "t")
    
    # Supabase Configuration
    SUPABASE_URL: Optional[str] = os.getenv("SUPABASE_URL")
    SUPABASE_ANON_KEY: Optional[str] = os.getenv("SUPABASE_ANON_KEY")
    
    # Create required directories
    def create_directories(self):
        """Create necessary directories if they don't exist"""
        os.makedirs(self.DOCUMENT_STORAGE_PATH, exist_ok=True)
        os.makedirs(self.EXTRACTED_DATA_PATH, exist_ok=True)
        os.makedirs(self.FINAL_OUTPUT_PATH, exist_ok=True)
        os.makedirs(self.VECTOR_DB_PATH, exist_ok=True)
        
        return self

# Create settings instance
settings = Settings().create_directories()