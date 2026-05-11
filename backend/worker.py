"""ARQ worker — processes documents through ADE pipeline."""
import asyncio
import json
import logging
import tempfile
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

# Load .env into os.environ BEFORE anything else — SDKs read os.environ directly
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

# Init Sentry as early as possible after env is loaded so unhandled
# exceptions during imports / startup are captured. No-op when DSN unset.
from observability import init_sentry
init_sentry()

from arq import create_pool
from arq.connections import RedisSettings

from config import settings
import db
import storage_client as storage
import qdrant_store
import embeddings
from financial_classifier import classify_pdf
from page_filter import select_pages, build_filtered_pdf
from extract_filter import build_extract_markdown

# ─── Section-title relaxation ────────────────────────────────────────────────
# ADE inconsistently classifies financial section headings — sometimes as
# `title`, sometimes as `text`, sometimes as `page_header`. The downstream
# chunk pipeline only inherits `current_section` from `title` chunks, so a
# heading that ADE tags as `text` silently disappears from every table chunk
# below it. Result: a question like "summary of cash flow" finds no chunks
# tagged with that section and the model says "not available."
#
# Fix: any chunk whose plain text starts with one of these well-known section
# names AND is short enough to plausibly BE a heading (not a paragraph
# mentioning the phrase) is treated as a section title equivalent. The
# subsequent table chunks then inherit the correct section_header.
import re as _re_section
_FINANCIAL_SECTION_TITLE_RE = _re_section.compile(
    r"^\s*("
    r"cash\s+flows?(?:\s+statement)?"
    r"|statement\s+of\s+cash\s+flows?"
    r"|balance\s+sheet"
    r"|statement\s+of\s+financial\s+position"
    r"|income\s+statement"
    r"|(?:consolidated\s+)?statements?\s+of\s+operations"
    r"|profit\s+(?:and|&)\s+loss(?:\s+account)?"
    r"|statement\s+of\s+changes\s+in\s+equity"
    r"|statement\s+of\s+comprehensive\s+income"
    r"|notes\s+to\s+(?:and\s+forming\s+part\s+of\s+)?(?:the\s+)?(?:consolidated\s+)?financial\s+statements"
    r")\b",
    _re_section.IGNORECASE,
)
# Heading-vs-paragraph gate. A paragraph that mentions "cash flow" buried in
# narrative text would also match the regex above — the length gate prevents
# that. Empirically, ADE-emitted financial headings are <100 chars; the row
# label "Cash generated from operations" and similar table content are also
# short, but they don't start with a canonical section name so the regex
# anchor `^\s*(...)` filters them out.
_MAX_SECTION_HEADING_LEN = 120

# ─── Cost Lever 2: Global ADE response cache ─────────────────────────────────
# Cache is keyed by file SHA-256, persisted in the same Supabase Storage
# bucket as documents (under a non-user prefix). RLS doesn't matter since
# only the worker (service role) reads/writes it. TTL is enforced by a
# `cached_at` timestamp inside the JSON; expired entries are silently
# treated as misses and overwritten on next parse.
ADE_CACHE_PREFIX  = "ade_cache"
ADE_CACHE_TTL_DAYS = 30


def _ade_cache_key(sha256: str) -> str:
    return f"{ADE_CACHE_PREFIX}/{sha256}.json"


def _remap_pages(chunks: list, grounding: dict, kept_indices: list[int]) -> None:
    """Remap page numbers from filtered-PDF coords back to original-PDF coords.

    ADE only saw the trimmed PDF, so its `page` fields run 0..len(kept_indices)-1.
    `kept_indices[ade_page]` returns the corresponding page in the original PDF.
    Mutates `chunks` and `grounding` in place. Both expected to be plain dicts
    (run `_to_dict` first)."""
    if not kept_indices:
        return

    def _remap(p):
        if isinstance(p, int) and 0 <= p < len(kept_indices):
            return kept_indices[p]
        return p

    # Chunks: each may have a top-level `page` and/or nested `grounding.page`.
    if isinstance(chunks, list):
        for c in chunks:
            if not isinstance(c, dict):
                continue
            if "page" in c:
                c["page"] = _remap(c.get("page"))
            cg = c.get("grounding")
            if isinstance(cg, dict) and "page" in cg:
                cg["page"] = _remap(cg.get("page"))
            elif isinstance(cg, list):
                # Some ADE versions return a list of grounding entries.
                for g in cg:
                    if isinstance(g, dict) and "page" in g:
                        g["page"] = _remap(g.get("page"))

    # Grounding: { element_id → {page, box, type} }
    if isinstance(grounding, dict):
        for elem_id, g in grounding.items():
            if isinstance(g, dict) and "page" in g:
                g["page"] = _remap(g.get("page"))


def _read_ade_cache(sha256: str, requested_scope: str) -> dict | None:
    """Look up a cached ADE response, returning None on miss / scope mismatch.

    A Core parse trims pages (Lever 1) and Extract-input (Lever 3) before
    sending to ADE. A Full parse does neither. The cached payload therefore
    differs structurally between the two scopes — the markdown emitted under
    Core does not contain the trimmed sections.

    We MUST NOT serve a Core cache hit to a Full request (it would silently
    hand the user a trimmed parse labelled 'Full'), and vice versa. The cache
    payload records the scope it was written under; mismatched scope = miss.

    Backward compat: cache entries written before the scope field existed
    have `scope=None`, which never equals the requested 'core'/'full' value,
    so they're treated as miss and rebuilt on first re-upload. Old entries
    are orphaned in storage but harmless — they expire by TTL.
    """
    try:
        bucket = storage.get_client().storage.from_(storage.BUCKET)
        cached_bytes = bucket.download(_ade_cache_key(sha256))
    except Exception as e:
        # Cache miss surfaces here as a 404 / "object not found" error from
        # Supabase Storage. Anything else is worth logging.
        msg = str(e).lower()
        if "404" not in msg and "not found" not in msg and "object" not in msg:
            logger.warning(f"ade cache lookup error for {sha256[:12]}: {e}")
        return None

    if not cached_bytes:
        return None

    try:
        data = json.loads(cached_bytes.decode("utf-8"))
    except Exception as e:
        logger.warning(f"ade cache parse error for {sha256[:12]}: {e}")
        return None

    # Scope guard — the integrity fix described above.
    cached_scope = data.get("scope")
    if cached_scope != requested_scope:
        logger.info(
            "ade cache scope-miss sha=%s cached=%s requested=%s",
            sha256[:12], cached_scope, requested_scope,
        )
        return None

    # TTL check — purely a hygiene gate, not a correctness one. ADE output
    # for a fixed PDF doesn't change.
    cached_at_str = data.get("cached_at") or ""
    try:
        cached_at = datetime.fromisoformat(cached_at_str.replace("Z", ""))
        if datetime.utcnow() - cached_at > timedelta(days=ADE_CACHE_TTL_DAYS):
            logger.info(f"ade cache expired for {sha256[:12]}")
            return None
    except Exception:
        return None  # malformed timestamp = treat as miss

    return data


def _write_ade_cache(sha256: str, payload: dict) -> None:
    """Best-effort cache write. Failures don't break the parse pipeline."""
    try:
        bucket = storage.get_client().storage.from_(storage.BUCKET)
        bucket.upload(
            _ade_cache_key(sha256),
            json.dumps(payload, default=str).encode("utf-8"),
            file_options={"content-type": "application/json", "upsert": "true"},
        )
    except Exception as e:
        logger.warning(f"ade cache write failed for {sha256[:12]}: {e}")

logger = logging.getLogger(__name__)
# ARQ's CLI installs its own root handler before our module-level
# basicConfig runs, so a plain basicConfig() becomes a no-op and our
# logger.info() lines never reach the terminal. Force=True (3.8+)
# clears any prior handlers so our INFO format is the one in effect.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    force=True,
)
# Make sure our module logger itself is at INFO regardless of root config.
logger.setLevel(logging.INFO)


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

# ADE key is read once at module import. Rotating keys requires a worker
# restart — same constraint as every other secret in this codebase, and
# Render env-var rotation triggers a redeploy anyway.
_ADE_API_KEY = os.environ.get("VISION_AGENT_API_KEY") or settings.VISION_AGENT_API_KEY


def _fetch_ade_output_url(url: str) -> Any:
    """Download an ADE result JSON from the presigned S3 URL and reshape it
    into a SimpleNamespace that mirrors the SDK's inline `status.data` model.

    ADE's get-job response carries either inline `data` (results <1MB) or a
    presigned S3 URL in `output_url` (results ≥1MB). Both paths feed the same
    downstream pipeline — the rest of the worker only needs `.markdown`,
    `.chunks`, `.grounding`, `.metadata`. We expose those attributes directly
    on a namespace so the existing access patterns work unchanged.
    """
    import httpx
    from types import SimpleNamespace

    # Use a generous timeout — large parse outputs (>1MB JSON) over the
    # presigned link can take a while on a residential connection. Retry
    # once on transient network failure before giving up.
    last_err: Exception | None = None
    for attempt in (1, 2):
        try:
            with httpx.Client(timeout=120.0) as http:
                r = http.get(url)
                r.raise_for_status()
                payload = r.json()
                break
        except Exception as e:
            last_err = e
            logger.warning("ADE output_url fetch attempt %d failed: %s", attempt, e)
    else:
        raise RuntimeError(
            f"ADE marked job completed but result download failed: {last_err}"
        )

    # The S3 payload is the parsed `Data` model serialised as JSON. The
    # downstream worker code reads `.markdown`, `.chunks`, `.grounding`,
    # `.metadata.page_count`. Build a namespace that exposes those fields
    # — _to_dict() will then flatten everything for storage.
    chunks    = payload.get("chunks") or []
    markdown  = payload.get("markdown") or ""
    grounding = payload.get("grounding") or {}
    metadata  = payload.get("metadata") or {}

    if not isinstance(metadata, dict):
        metadata_ns: Any = metadata
    else:
        metadata_ns = SimpleNamespace(**metadata)

    return SimpleNamespace(
        markdown=markdown,
        chunks=chunks,
        grounding=grounding,
        metadata=metadata_ns,
    )


def _run_ade_parse(file_path: Path) -> Any:
    from landingai_ade import LandingAIADE
    client = LandingAIADE(apikey=_ADE_API_KEY, timeout=480.0, max_retries=2)
    # Use parse_jobs for large-file async processing
    try:
        job = client.parse_jobs.create(document=file_path, model="dpt-2-latest")
    except Exception as e:
        # parse_jobs.create itself failed (network, auth, file too large).
        # Surface the underlying class so the user can act on it.
        raise RuntimeError(
            f"ADE could not accept the document: {type(e).__name__}: {e}"
        ) from e
    logger.info(f"ADE parse job created: {job.job_id}")

    import time
    _POLL_INTERVAL = 15       # seconds between polls
    _MAX_POLLS     = 180      # 180 × 15s = 45 minutes hard cap
    last_status = None
    for poll in range(_MAX_POLLS):
        try:
            status = client.parse_jobs.get(job.job_id)
        except Exception as e:
            # Transient poll failures (httpx ReadTimeout, 5xx) are common on
            # the long parse path. Log and keep polling — only abort if
            # several consecutive polls fail, which we approximate by
            # letting the SDK's max_retries=2 handle the retry then
            # surfacing the original error.
            logger.warning(
                "ADE poll %d/%d failed: %s — retrying in %ds",
                poll + 1, _MAX_POLLS, e, _POLL_INTERVAL,
            )
            time.sleep(_POLL_INTERVAL)
            continue
        last_status = status
        logger.info(f"ADE job {job.job_id} status: {status.status} (poll {poll + 1}/{_MAX_POLLS})")
        if status.status == "completed":
            # ADE returns parsed output two ways depending on size:
            #   - inline `status.data` when result is < 1 MB
            #   - presigned S3 URL in `status.output_url` when result is ≥ 1 MB
            # Reading only `status.data` (as the original code did) silently
            # discarded results from any non-trivial document AFTER ADE had
            # already billed for the parse. Always check the URL fallback.
            if status.data is not None:
                return status.data
            output_url = getattr(status, "output_url", None)
            if not output_url:
                raise RuntimeError(
                    "ADE marked the job completed but returned neither inline "
                    "data nor an output_url — possible SDK / API contract drift"
                )
            logger.info(
                "ADE result >1MB — fetching from output_url for job %s",
                job.job_id,
            )
            return _fetch_ade_output_url(output_url)
        if status.status in ("failed", "error"):
            # Pull every diagnostic the SDK exposes so the user sees the
            # real cause in the UI, not just "failed".
            err_msg = (
                getattr(status, "error", None)
                or getattr(status, "error_message", None)
                or getattr(status, "message", None)
                or getattr(status, "detail", None)
                or "(no detail returned by ADE)"
            )
            raise RuntimeError(f"ADE parse failed ({status.status}): {err_msg}")
        time.sleep(_POLL_INTERVAL)
    last_state = getattr(last_status, "status", "unknown") if last_status else "no-poll"
    raise RuntimeError(
        f"ADE parse timed out after 45 minutes (last status: {last_state})"
    )


def _run_ade_extract(markdown: str) -> Any:
    from landingai_ade import LandingAIADE
    from landingai_ade.lib import pydantic_to_json_schema
    from schemas import FinancialDocument

    client = LandingAIADE(apikey=_ADE_API_KEY, timeout=120.0, max_retries=2)
    schema = pydantic_to_json_schema(FinancialDocument)
    return client.extract(schema=schema, markdown=markdown)


# ─── Main job ─────────────────────────────────────────────────────────────────

async def process_document(ctx: dict, doc_id: str, user_id: str, file_path: str) -> None:
    logger.info(f"Starting processing: doc_id={doc_id}")

    # Idempotency guard — ARQ retries (timeout, transient error) re-deliver
    # this job. ADE parse is the most expensive call in the system, so
    # short-circuit if the document already finished. The /retry endpoint
    # explicitly resets status to "queued" before re-enqueueing, so user
    # retries are not blocked.
    existing = await asyncio.to_thread(db.get_document, doc_id, user_id)
    if existing and existing.get("status") == "complete":
        logger.info(f"Document {doc_id} already complete — skipping re-parse.")
        return

    def update(status: str, progress: int, message: str):
        db.update_document(doc_id, {
            "status": status, "progress": progress, "status_message": message
        })

    tmp_path = None  # original PDF on disk
    ade_input_path = None  # may be a trimmed copy when page filter fires

    # Cost Lever 4: parse_scope flag from upload — 'core' (default) runs
    # Lever 1 (page filter) + Lever 3 (extract filter); 'full' skips both.
    # Lever 0 (classifier) and Lever 2 (cache) always run.
    upload_meta = (existing or {}).get("metadata") or {}
    parse_scope = (upload_meta.get("parse_scope") or "core").lower()
    if parse_scope not in ("core", "full"):
        parse_scope = "core"
    is_core_scope = parse_scope == "core"

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

        # ── 1.5. Financial-document gate (Cost Lever 0) ──────────────────────
        # Only PDFs run through the classifier. Other formats (.docx, .html,
        # images) are passed through — they're rare and the classifier doesn't
        # support them; we'd waste credits second-guessing.
        if ext.lower() == ".pdf":
            update("parsing", 7, "Checking document type...")
            classification = await asyncio.to_thread(classify_pdf, file_bytes)
            logger.info(
                "classifier: doc=%s action=%s score=%d text_len=%d",
                doc_id, classification.action, classification.score, classification.text_length,
            )

            if classification.action == "reject":
                # Hard gate: no ADE call. Persist a friendly status_message
                # plus full classifier output in metadata for ops review.
                meta_doc = await asyncio.to_thread(db.get_document, doc_id, user_id)
                prior_meta = (meta_doc or {}).get("metadata") or {}
                db.update_document(doc_id, {
                    "status": "rejected",
                    "progress": 0,
                    "status_message": classification.reason,
                    "metadata": {
                        **prior_meta,
                        "classifier": {
                            "action":           "reject",
                            "score":            classification.score,
                            "text_length":      classification.text_length,
                            "matched_keywords": classification.matched_keywords,
                        },
                    },
                })
                # Reclaim storage — we'll never parse this file, so the bytes
                # are dead weight. Keep the DB row so the user sees the
                # rejection (with reason) in their document list and can
                # dismiss it. Storage delete is best-effort: a failure here
                # doesn't change the rejection outcome.
                try:
                    await asyncio.to_thread(storage.delete_folder, user_id, doc_id)
                    logger.info("classifier reject — purged storage for doc=%s", doc_id)
                except Exception as e:
                    logger.warning("classifier reject — storage purge failed doc=%s: %s", doc_id, e)
                logger.info("classifier rejected doc=%s — no ADE call made", doc_id)
                return  # ← short-circuit; finally block still cleans up tmp file

            # Uncertain (likely scanned) and allow both proceed to ADE. We
            # record the classifier verdict in metadata so we can later
            # audit which uploads slipped through.
            meta_doc = await asyncio.to_thread(db.get_document, doc_id, user_id)
            prior_meta = (meta_doc or {}).get("metadata") or {}
            db.update_document(doc_id, {
                "metadata": {
                    **prior_meta,
                    "classifier": {
                        "action":           classification.action,
                        "score":            classification.score,
                        "text_length":      classification.text_length,
                        "matched_keywords": classification.matched_keywords,
                    },
                },
            })

        # ── 1.6. Global ADE cache lookup (Cost Lever 2) ──────────────────────
        # ADE parse + extract output is purely a function of the input PDF
        # bytes, so it's safe to share across users keyed by SHA-256.
        # Cache hit = zero ADE credits spent on this upload.
        sha256 = (existing or {}).get("sha256_hash")
        cache_hit = False
        cached: dict | None = None
        if sha256:
            update("parsing", 8, "Checking parse cache...")
            cached = await asyncio.to_thread(_read_ade_cache, sha256, parse_scope)
            if cached:
                cache_hit = True
                logger.info(
                    "ADE cache HIT sha256=%s scope=%s doc=%s",
                    sha256[:12], parse_scope, doc_id,
                )

        if cache_hit and cached:
            # Cache hit — bypass ADE Parse + ADE Extract entirely.
            markdown     = cached["markdown"]
            chunks       = cached["chunks"]      # list[dict] — section-aware
                                                  # chunking handles this shape
            grounding    = cached["grounding"]
            extract_dict = cached.get("extract_data") or {}
            page_count   = cached.get("page_count")
            update("indexing", 50, f"Loaded {len(chunks)} chunks from cache.")
            # Tag the document so we can audit hit rates over time.
            meta_doc = await asyncio.to_thread(db.get_document, doc_id, user_id)
            prior_meta = (meta_doc or {}).get("metadata") or {}
            db.update_document(doc_id, {
                "metadata": {**prior_meta, "ade_cache_hit": True},
            })
        else:
            # ── 1.7. Pre-flight page filter (Cost Lever 1) ────────────────────
            # Trim TOC, exhibit indexes, blanks, signature blocks before ADE
            # bills us. `kept_indices` maps filtered_page_idx → original_page_idx
            # and is used post-Parse to remap chunk/grounding pages so that
            # citations refer to the user's original PDF, not the trimmed one.
            kept_indices: list[int] = []
            page_filter_meta: dict | None = None
            ade_input_path = tmp_path

            if ext.lower() == ".pdf" and is_core_scope:
                update("parsing", 9, "Trimming non-essential pages...")
                raw_kept, skip_reasons = await asyncio.to_thread(
                    select_pages, file_bytes,
                )
                # `select_pages` always returns a complete reasons dict that
                # sums to the total page count (counts every page even when
                # it's kept as "content" or returned via a safety path).
                pages_total   = sum(skip_reasons.values())
                pages_skipped = max(0, pages_total - len(raw_kept))

                # Only build a trimmed PDF when we'd actually save pages —
                # otherwise we waste IO and the page-remap is a no-op anyway.
                if pages_skipped > 0 and raw_kept:
                    trimmed_bytes = await asyncio.to_thread(
                        build_filtered_pdf, file_bytes, raw_kept,
                    )
                    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                        tmp.write(trimmed_bytes)
                        ade_input_path = Path(tmp.name)
                    kept_indices = raw_kept   # remap will fire post-Parse
                    logger.info(
                        "page_filter: doc=%s kept=%d/%d reasons=%s",
                        doc_id, len(raw_kept), pages_total, skip_reasons,
                    )
                else:
                    # No trim happened — empty list signals "no remap."
                    kept_indices = []

                page_filter_meta = {
                    "pages_total":   pages_total,
                    "pages_kept":    len(raw_kept),
                    "pages_skipped": pages_skipped,
                    "skip_reasons":  skip_reasons,
                    "applied":       pages_skipped > 0,
                }
                meta_doc = await asyncio.to_thread(db.get_document, doc_id, user_id)
                prior_meta = (meta_doc or {}).get("metadata") or {}
                db.update_document(doc_id, {
                    "metadata": {**prior_meta, "page_filter": page_filter_meta},
                })

            # ── 2. ADE Parse ──────────────────────────────────────────────────
            update("parsing", 10, "Parsing document with AI vision model...")
            parse_data = await asyncio.to_thread(_run_ade_parse, ade_input_path)

            if parse_data is None:
                raise RuntimeError("ADE returned no data — document may be unsupported, empty, or corrupt")

            markdown = parse_data.markdown
            if markdown is None:
                raise RuntimeError("ADE returned a result with no markdown content")

            # Convert to plain dicts so we can safely mutate page numbers
            # below. The downstream chunking code already supports both
            # attribute and dict access — no further changes needed.
            chunks    = _to_dict(parse_data.chunks)
            grounding = _to_dict(parse_data.grounding)

            # Remap filtered → original page numbers so citations and
            # overlay bboxes line up with the user's PDF, not the trimmed one.
            if kept_indices:
                _remap_pages(chunks, grounding, kept_indices)

            page_count_obj = getattr(parse_data, "metadata", None)
            if page_count_obj and hasattr(page_count_obj, "page_count"):
                # Report the ORIGINAL document's page count, not the trimmed one.
                page_count = (
                    page_filter_meta["pages_total"]
                    if page_filter_meta and kept_indices
                    else page_count_obj.page_count
                )
            else:
                page_count = (
                    page_filter_meta["pages_total"]
                    if page_filter_meta else None
                )

            update("parsing", 40, f"Parsed {len(chunks)} content chunks.")

            # ── 3. ADE Extract (Cost Lever 3 — targeted input, gated by scope) ──
            update("extracting", 45, "Extracting financial data...")

            if is_core_scope:
                # Build a financial-section-only subset of the markdown.
                # ADE bills Extract by character count; narrative MD&A
                # doesn't help populate the FinancialDocument schema.
                # Falls back to full on safety conditions.
                extract_input_md, extract_filter_stats = await asyncio.to_thread(
                    build_extract_markdown, markdown, chunks,
                )
            else:
                extract_input_md = markdown
                extract_filter_stats = {"applied": False, "reason": "parse_scope=full"}

            logger.info(
                "extract_filter: doc=%s scope=%s applied=%s full=%s filtered=%s reduction=%s%%",
                doc_id, parse_scope,
                extract_filter_stats.get("applied"),
                extract_filter_stats.get("full_chars", "?"),
                extract_filter_stats.get("filtered_chars", "?"),
                extract_filter_stats.get("reduction_pct", "n/a"),
            )

            extract_data = await asyncio.to_thread(_run_ade_extract, extract_input_md)
            extract_dict = extract_data.model_dump() if hasattr(extract_data, "model_dump") else {}

            # Persist filter stats so we can later audit "Extract returned
            # mostly nulls — was the filter too aggressive on this doc?"
            meta_doc = await asyncio.to_thread(db.get_document, doc_id, user_id)
            prior_meta = (meta_doc or {}).get("metadata") or {}
            db.update_document(doc_id, {
                "metadata": {**prior_meta, "extract_filter": extract_filter_stats},
            })

            update("extracting", 55, "Financial data extracted.")

            # Cache write — best-effort, never fail the parse if storage hiccups.
            # The `scope` field is what `_read_ade_cache` checks on lookup:
            # a Core-cached payload is structurally different from a Full one
            # (Core trimmed pages + Extract input), so serving one in place
            # of the other would silently corrupt the result.
            if sha256:
                cache_payload = {
                    "markdown":     markdown,
                    "chunks":       _to_dict(chunks),
                    "grounding":    _to_dict(grounding),
                    "extract_data": extract_dict,
                    "page_count":   page_count,
                    "scope":        parse_scope,
                    "cached_at":    datetime.utcnow().isoformat(),
                }
                await asyncio.to_thread(_write_ade_cache, sha256, cache_payload)
                logger.info(
                    "ADE cache WRITE sha256=%s scope=%s doc=%s",
                    sha256[:12], parse_scope, doc_id,
                )
                meta_doc = await asyncio.to_thread(db.get_document, doc_id, user_id)
                prior_meta = (meta_doc or {}).get("metadata") or {}
                db.update_document(doc_id, {
                    "metadata": {**prior_meta, "ade_cache_hit": False},
                })

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

            # Track the running section header. Two sources, in this order:
            #   1. ADE-classified `title` chunks (canonical path)
            #   2. Short chunks whose text matches a financial-section name
            #      even when ADE tagged them as text/page_header/etc.
            # Without (2), headings like a bare "CASH FLOW STATEMENT" that
            # ADE classifies as text get dropped, and every table below them
            # loses its section_header.
            import re
            plain = re.sub(r"<[^>]+>", "", cmarkdown).strip()
            if ctype == "title":
                current_section = plain
            elif (
                plain
                and len(plain) <= _MAX_SECTION_HEADING_LEN
                and _FINANCIAL_SECTION_TITLE_RE.match(plain)
            ):
                current_section = plain

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
        # Abort if document was deleted while we were processing
        current = db.get_document(doc_id, user_id)
        if not current or current.get("status") == "deleting":
            logger.info(f"Document {doc_id} was deleted during processing — aborting.")
            return

        await asyncio.to_thread(qdrant_store.upsert_chunks, points)

        # ── 7. Cache parse result to Storage ─────────────────────────────────
        update("indexing", 90, "Caching processed data...")
        cache_path = f"{user_id}/{doc_id}/processed.json"
        cache_data = json.dumps({
            "markdown": markdown,
            "grounding": _to_dict(grounding),
        }).encode()
        await asyncio.to_thread(storage.upload_bytes, cache_path, cache_data, "application/json")

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
        # Clean up both the original tmp file and the (optional) trimmed copy.
        # `ade_input_path` may be the same Path as `tmp_path` (no trim fired)
        # or a separate trimmed file. Either way: try both, swallow errors.
        for path in {tmp_path, ade_input_path}:
            if not path:
                continue
            try:
                os.unlink(path)
            except Exception:
                pass


# ─── ARQ worker config ────────────────────────────────────────────────────────

async def _on_startup(ctx: dict) -> None:
    """Print a banner so the user can see the worker booted with the
    latest code and the cost levers it's about to apply."""
    logger.info("=" * 60)
    logger.info("AlphaLens worker started")
    logger.info("Cost Lever 0 (classifier): ON")
    logger.info("Cost Lever 1 (page filter): ON for parse_scope=core")
    logger.info("Cost Lever 2 (ADE cache):   ON")
    logger.info("Cost Lever 3 (extract trim): ON for parse_scope=core")
    logger.info("Cost Lever 4 (scope toggle): core | full")
    logger.info("=" * 60)


class WorkerSettings:
    functions = [process_document]
    redis_settings = get_redis_settings()
    max_jobs = 4
    job_timeout = 3000  # 50 min — gives 5 min buffer after 45-min ADE parse cap
    keep_result = 3600
    on_startup = _on_startup
