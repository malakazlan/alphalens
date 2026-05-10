"""Qdrant vector store operations."""
import logging
import time
from typing import Optional
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    Filter, FieldCondition, MatchValue,
    PayloadSchemaType, PayloadSelectorInclude,
)
from config import settings

logger = logging.getLogger(__name__)

COLLECTION = "alphalens_documents"
VECTOR_SIZE = 1536  # text-embedding-3-small

# Long timeout because we batch many points per upsert and the writer
# may be on a residential connection. The default httpx 5s ReadTimeout
# is too short — we already saw it fire in production after a 44-page
# parse, killing a job that had already paid for ADE + embeddings.
_QDRANT_TIMEOUT_SECS = 120
# Don't push more than this many points in a single upsert. A 1500-point
# upsert over a residential link can stall on the write side; smaller
# batches recover fast on retry and cap the blast radius of a single
# transient failure.
_QDRANT_UPSERT_BATCH = 64
# Retry policy for transient Qdrant writes (timeouts, 5xx).
_QDRANT_MAX_RETRIES = 3

_client: Optional[QdrantClient] = None
_collection_ready: bool = False


def get_client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(
            url=settings.QDRANT_URL,
            api_key=settings.QDRANT_API_KEY,
            timeout=_QDRANT_TIMEOUT_SECS,
        )
    return _client


def ensure_collection() -> None:
    """Create collection + payload indexes if missing. Idempotent.

    Memoized via _collection_ready so repeated calls are free after the first
    successful run. Called from the worker before each upsert, and lazily by
    healthcheck — never from web app startup, so a Qdrant outage cannot
    take the FastAPI process down.
    """
    global _collection_ready
    if _collection_ready:
        return
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
    _collection_ready = True


def upsert_chunks(points: list[PointStruct]) -> None:
    """Upsert points with batching + retry.

    Splits the input into `_QDRANT_UPSERT_BATCH`-sized chunks and retries
    each batch up to `_QDRANT_MAX_RETRIES` times on transient errors
    (httpx timeouts, qdrant ResponseHandlingException, 5xx). A timeout on
    a single batch no longer kills a parse that's already paid for ADE +
    embeddings — the retry will succeed on the next pass.
    """
    if not points:
        return
    client = get_client()
    total   = len(points)
    written = 0
    for start in range(0, total, _QDRANT_UPSERT_BATCH):
        batch = points[start:start + _QDRANT_UPSERT_BATCH]
        last_err: Exception | None = None
        for attempt in range(1, _QDRANT_MAX_RETRIES + 1):
            try:
                client.upsert(collection_name=COLLECTION, points=batch, wait=True)
                written += len(batch)
                break
            except Exception as e:
                last_err = e
                # Exponential backoff: 2s, 4s, 8s.
                backoff = 2 ** attempt
                logger.warning(
                    "qdrant upsert batch %d-%d failed (attempt %d/%d): %s — retrying in %ds",
                    start, start + len(batch), attempt, _QDRANT_MAX_RETRIES, e, backoff,
                )
                if attempt < _QDRANT_MAX_RETRIES:
                    time.sleep(backoff)
        else:
            # All retries exhausted — surface the original error so the
            # worker's outer except writes a useful status_message.
            raise RuntimeError(
                f"Qdrant upsert failed after {_QDRANT_MAX_RETRIES} attempts "
                f"(wrote {written}/{total} points): {last_err}"
            ) from last_err
    logger.info("qdrant upsert OK: %d points in %d batches", written,
                (total + _QDRANT_UPSERT_BATCH - 1) // _QDRANT_UPSERT_BATCH)


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


def get_chunk_overlays_by_doc(doc_id: str, user_id: str, limit: int = 500) -> list:
    """Return lightweight overlay data only — no markdown. Used for PDF overlay rendering."""
    must = [
        FieldCondition(key="doc_id", match=MatchValue(value=doc_id)),
        FieldCondition(key="user_id", match=MatchValue(value=user_id)),
    ]
    results, _ = get_client().scroll(
        collection_name=COLLECTION,
        scroll_filter=Filter(must=must),
        limit=limit,
        with_payload=PayloadSelectorInclude(include=["chunk_id", "chunk_type", "page", "bbox"]),
        with_vectors=False,
    )
    chunks = [r.payload for r in results if r.payload]
    chunks.sort(key=lambda c: (c.get("page", 0), c.get("chunk_type", "")))
    return chunks


def delete_doc_chunks(doc_id: str, user_id: str | None = None) -> None:
    must = [FieldCondition(key="doc_id", match=MatchValue(value=doc_id))]
    if user_id:
        must.append(FieldCondition(key="user_id", match=MatchValue(value=user_id)))
    get_client().delete(
        collection_name=COLLECTION,
        points_selector=Filter(must=must),
    )
