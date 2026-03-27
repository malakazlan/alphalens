"""Qdrant vector store operations."""
from typing import Optional
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    Filter, FieldCondition, MatchValue,
    PayloadSchemaType,
)
from config import settings

COLLECTION = "alphalens_documents"
VECTOR_SIZE = 1536  # text-embedding-3-small

_client: Optional[QdrantClient] = None


def get_client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY)
    return _client


def ensure_collection() -> None:
    client = get_client()
    existing = [c.name for c in client.get_collections().collections]
    if COLLECTION not in existing:
        client.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )
    # Ensure payload indexes exist for filtered fields
    info = client.get_collection(COLLECTION)
    indexed = set(info.payload_schema.keys()) if info.payload_schema else set()
    for field in ("user_id", "doc_id"):
        if field not in indexed:
            client.create_payload_index(
                collection_name=COLLECTION,
                field_name=field,
                field_schema=PayloadSchemaType.KEYWORD,
            )


def upsert_chunks(points: list[PointStruct]) -> None:
    if not points:
        return
    get_client().upsert(collection_name=COLLECTION, points=points, wait=True)


def search(query_vector: list[float], user_id: str, doc_id: Optional[str] = None, top_k: int = 8) -> list:
    must = [FieldCondition(key="user_id", match=MatchValue(value=user_id))]
    if doc_id:
        must.append(FieldCondition(key="doc_id", match=MatchValue(value=doc_id)))
    response = get_client().query_points(
        collection_name=COLLECTION,
        query=query_vector,
        query_filter=Filter(must=must),
        limit=top_k,
        with_payload=True,
    )
    return response.points


def get_chunks_by_doc(doc_id: str, user_id: str, limit: int = 500) -> list:
    """Return all chunks for a document, ordered by page."""
    must = [
        FieldCondition(key="doc_id", match=MatchValue(value=doc_id)),
        FieldCondition(key="user_id", match=MatchValue(value=user_id)),
    ]
    results, _ = get_client().scroll(
        collection_name=COLLECTION,
        scroll_filter=Filter(must=must),
        limit=limit,
        with_payload=True,
        with_vectors=False,
    )
    chunks = [r.payload for r in results if r.payload]
    chunks.sort(key=lambda c: (c.get("page", 0), c.get("chunk_type", "")))
    return chunks


def delete_doc_chunks(doc_id: str) -> None:
    get_client().delete(
        collection_name=COLLECTION,
        points_selector=Filter(must=[FieldCondition(key="doc_id", match=MatchValue(value=doc_id))]),
    )
