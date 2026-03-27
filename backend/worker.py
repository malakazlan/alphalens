"""ARQ worker — processes documents through ADE pipeline."""
import asyncio
import json
import logging
import tempfile
import os
import uuid
from pathlib import Path
from typing import Any

# Load .env into os.environ BEFORE anything else — SDKs read os.environ directly
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

from arq import create_pool
from arq.connections import RedisSettings

from config import settings
import db
import storage_client as storage
import qdrant_store
import embeddings

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


def _to_dict(obj: Any) -> Any:
    """Recursively convert Pydantic models / dataclasses to plain dicts for JSON serialization."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {k: _to_dict(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_dict(i) for i in obj]
    if hasattr(obj, "model_dump"):
        return _to_dict(obj.model_dump())
    if hasattr(obj, "__dict__"):
        return _to_dict(obj.__dict__)
    return str(obj)


# ─── Redis settings ───────────────────────────────────────────────────────────

def get_redis_settings() -> RedisSettings:
    url = settings.UPSTASH_REDIS_URL
    # Parse rediss://user:pass@host:port
    from urllib.parse import urlparse
    parsed = urlparse(url)
    return RedisSettings(
        host=parsed.hostname,
        port=parsed.port or 6379,
        password=parsed.password,
        ssl=url.startswith("rediss://"),
        conn_timeout=30,
    )


async def get_arq_pool():
    return await create_pool(get_redis_settings())


# ─── ADE helpers (sync — called via asyncio.to_thread) ───────────────────────

def _run_ade_parse(file_path: Path) -> Any:
    from landingai_ade import LandingAIADE
    client = LandingAIADE(timeout=480.0, max_retries=2)
    # Use parse_jobs for large-file async processing
    job = client.parse_jobs.create(document=file_path, model="dpt-2-latest")
    logger.info(f"ADE parse job created: {job.job_id}")

    import time
    _POLL_INTERVAL = 15       # seconds between polls
    _MAX_POLLS     = 180      # 180 × 15s = 45 minutes hard cap
    for poll in range(_MAX_POLLS):
        status = client.parse_jobs.get(job.job_id)
        logger.info(f"ADE job {job.job_id} status: {status.status} (poll {poll + 1}/{_MAX_POLLS})")
        if status.status == "completed":
            return status.data
        if status.status in ("failed", "error"):
            raise RuntimeError(f"ADE parse failed: {status.status}")
        time.sleep(_POLL_INTERVAL)
    raise RuntimeError("ADE parse timed out after 45 minutes")


def _run_ade_extract(markdown: str) -> Any:
    from landingai_ade import LandingAIADE
    from landingai_ade.lib import pydantic_to_json_schema
    from schemas import FinancialDocument

    os.environ["VISION_AGENT_API_KEY"] = settings.VISION_AGENT_API_KEY
    client = LandingAIADE(timeout=120.0, max_retries=2)
    schema = pydantic_to_json_schema(FinancialDocument)
    return client.extract(schema=schema, markdown=markdown)


# ─── Main job ─────────────────────────────────────────────────────────────────

async def process_document(ctx: dict, doc_id: str, user_id: str, file_path: str) -> None:
    logger.info(f"Starting processing: doc_id={doc_id}")

    def update(status: str, progress: int, message: str):
        db.update_document(doc_id, {
            "status": status, "progress": progress, "status_message": message
        })

    try:
        # ── 1. Download file from Supabase Storage ────────────────────────────
        update("parsing", 5, "Downloading document...")
        file_bytes = await asyncio.to_thread(
            lambda: storage.get_client().storage.from_(storage.BUCKET).download(file_path)
        )

        # Write to temp file
        ext = os.path.splitext(file_path)[-1] or ".pdf"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)

        # ── 2. ADE Parse ──────────────────────────────────────────────────────
        update("parsing", 10, "Parsing document with AI vision model...")
        parse_data = await asyncio.to_thread(_run_ade_parse, tmp_path)

        markdown = parse_data.markdown
        chunks = parse_data.chunks
        grounding = parse_data.grounding  # element_id → {page, box, type}
        page_count = getattr(parse_data, "metadata", None)
        if page_count and hasattr(page_count, "page_count"):
            page_count = page_count.page_count
        else:
            page_count = None

        update("parsing", 40, f"Parsed {len(chunks)} content chunks.")

        # ── 3. ADE Extract ────────────────────────────────────────────────────
        update("extracting", 45, "Extracting financial data...")
        extract_data = await asyncio.to_thread(_run_ade_extract, markdown)
        extract_dict = extract_data.model_dump() if hasattr(extract_data, "model_dump") else {}

        update("extracting", 55, "Financial data extracted.")

        # ── 4. Persist grounding to Supabase ─────────────────────────────────
        update("indexing", 58, "Persisting grounding data...")
        grounding_rows = []
        for element_id, g in grounding.items():
            box = g.get("box", {}) if isinstance(g, dict) else getattr(g, "box", {})
            page = g.get("page", 0) if isinstance(g, dict) else getattr(g, "page", 0)
            gtype = g.get("type", "") if isinstance(g, dict) else getattr(g, "type", "")
            if hasattr(box, "__dict__"):
                box = {"left": box.left, "top": box.top, "right": box.right, "bottom": box.bottom}
            grounding_rows.append({
                "doc_id": doc_id,
                "element_id": element_id,
                "page": page,
                "bbox_left": box.get("left", 0),
                "bbox_top": box.get("top", 0),
                "bbox_right": box.get("right", 1),
                "bbox_bottom": box.get("bottom", 1),
                "type": gtype,
            })

        if grounding_rows:
            await asyncio.to_thread(
                lambda: db.get_client().table("document_grounding").insert(grounding_rows).execute()
            )

        # ── 5. Section-aware chunking ─────────────────────────────────────────
        update("indexing", 62, "Building section-aware chunks...")
        current_section = ""
        enriched_chunks = []
        for chunk in chunks:
            ctype = chunk.type if hasattr(chunk, "type") else chunk.get("type", "text")
            cmarkdown = chunk.markdown if hasattr(chunk, "markdown") else chunk.get("markdown", "")
            chunk_id = chunk.id if hasattr(chunk, "id") else chunk.get("id", str(uuid.uuid4()))
            cgrounding = chunk.grounding if hasattr(chunk, "grounding") else chunk.get("grounding", {})

            if ctype == "title":
                # Strip anchor tag to get clean title text
                import re
                current_section = re.sub(r"<[^>]+>", "", cmarkdown).strip()

            page = 0
            bbox = {}
            if cgrounding:
                if hasattr(cgrounding, "page"):
                    page = cgrounding.page
                    box = cgrounding.box
                    bbox = {"left": box.left, "top": box.top, "right": box.right, "bottom": box.bottom}
                elif isinstance(cgrounding, dict):
                    page = cgrounding.get("page", 0)
                    box = cgrounding.get("box", {})
                    bbox = box if isinstance(box, dict) else {}

            enriched_chunks.append({
                "chunk_id": chunk_id,
                "doc_id": doc_id,
                "user_id": user_id,
                "chunk_type": ctype,
                "section_header": current_section,
                "page": page,
                "markdown": cmarkdown,
                "bbox": bbox,
            })

        # ── 6. Embed & upsert to Qdrant ───────────────────────────────────────
        update("indexing", 68, f"Embedding {len(enriched_chunks)} chunks...")

        texts = [c["markdown"] for c in enriched_chunks]
        vectors = await asyncio.to_thread(embeddings.embed_texts, texts)

        await asyncio.to_thread(qdrant_store.ensure_collection)

        from qdrant_client.models import PointStruct
        points = [
            PointStruct(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, c["chunk_id"])),
                vector=v,
                payload=c,
            )
            for c, v in zip(enriched_chunks, vectors)
        ]
        await asyncio.to_thread(qdrant_store.upsert_chunks, points)

        # ── 7. Cache parse result to Storage ─────────────────────────────────
        update("indexing", 90, "Caching processed data...")
        cache_path = f"{user_id}/{doc_id}/processed.json"
        cache_data = json.dumps({
            "markdown": markdown,
            "grounding": _to_dict(grounding),
        }).encode()
        await asyncio.to_thread(storage.upload_file, user_id, doc_id, cache_data, "processed.json")

        # ── 8. Mark complete ──────────────────────────────────────────────────
        metadata_update = {
            "page_count": page_count,
            "company_name": extract_dict.get("company_name"),
            "fiscal_year": extract_dict.get("fiscal_year"),
            "currency": extract_dict.get("currency"),
            "doc_type": extract_dict.get("doc_type"),
        }
        db.update_document(doc_id, {
            "status": "complete",
            "progress": 100,
            "status_message": "Processing complete",
            "extract_data": extract_dict,
            "metadata": metadata_update,
        })
        logger.info(f"Document {doc_id} processing complete.")

    except Exception as e:
        logger.error(f"Document {doc_id} failed: {e}", exc_info=True)
        db.update_document(doc_id, {
            "status": "error",
            "progress": 0,
            "status_message": str(e)[:500],
        })
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


# ─── ARQ worker config ────────────────────────────────────────────────────────

class WorkerSettings:
    functions = [process_document]
    redis_settings = get_redis_settings()
    max_jobs = 4
    job_timeout = 3000  # 50 min — gives 5 min buffer after 45-min ADE parse cap
    keep_result = 3600
