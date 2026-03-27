from pydantic_settings import BaseSettings
from typing import Optional
import os


class Settings(BaseSettings):
    # Landing.AI ADE
    VISION_AGENT_API_KEY: str = ""
    ADE_ENDPOINT: str = "https://api.va.landing.ai/v1/ade"

    # OpenAI
    OPENAI_API_KEY: Optional[str] = None

    # Supabase
    SUPABASE_URL: Optional[str] = None
    SUPABASE_ANON_KEY: Optional[str] = None
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = None

    # Qdrant (Phase 3)
    QDRANT_URL: Optional[str] = None
    QDRANT_API_KEY: Optional[str] = None

    # Upstash Redis / ARQ (Phase 3)
    UPSTASH_REDIS_URL: Optional[str] = None

    # FinBot
    FINNHUB_API_KEY: Optional[str] = None

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8001          # 8001 locally so v1 (8000) keeps running
    DEBUG: bool = True

    # CORS — frontend origin
    FRONTEND_URL: str = "http://localhost:3000"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
