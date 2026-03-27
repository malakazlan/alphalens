"""OpenAI embedding helpers."""
import openai
from config import settings

_client = None


def get_client():
    global _client
    if _client is None:
        _client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
    return _client


def embed_texts(texts: list[str], model: str = "text-embedding-3-small") -> list[list[float]]:
    """Embed a list of texts, returns list of 1536-dim vectors."""
    if not texts:
        return []
    # Batch in groups of 100 (OpenAI limit: 2048 per request, but keep it safe)
    all_vectors = []
    for i in range(0, len(texts), 100):
        batch = texts[i:i + 100]
        response = get_client().embeddings.create(input=batch, model=model)
        all_vectors.extend([item.embedding for item in response.data])
    return all_vectors


def embed_query(text: str) -> list[float]:
    return embed_texts([text])[0]
