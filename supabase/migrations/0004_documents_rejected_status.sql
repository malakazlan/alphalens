-- ============================================================================
-- 0004_documents_rejected_status.sql
-- Cost Lever 0 — extend documents.status to include 'rejected'.
--
-- A 'rejected' document was refused by the financial-document classifier
-- before any ADE call was made. No credits were spent on it.
--
-- Apply via Supabase Dashboard → SQL Editor → New query → paste UP → Run.
-- ============================================================================


-- ============================================================================
-- UP
-- ============================================================================
-- Defensive: drop any existing CHECK constraint on documents.status
-- (the original V1 schema may or may not have one, and the constraint
-- name may not be canonical) before adding our own.

BEGIN;

DO $$
DECLARE
    c record;
BEGIN
    FOR c IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.documents'::regclass
          AND contype  = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE public.documents DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE public.documents
    ADD CONSTRAINT documents_status_check
    CHECK (status IN (
        'queued',
        'parsing',
        'extracting',
        'indexing',
        'complete',
        'error',
        'deleting',
        'rejected'
    ));

COMMIT;


-- ============================================================================
-- DOWN — copy into a new query if you need to roll back this slice only.
-- ============================================================================
--
-- BEGIN;
-- ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_status_check;
-- -- (Optional) re-add the original constraint without 'rejected':
-- ALTER TABLE public.documents
--     ADD CONSTRAINT documents_status_check
--     CHECK (status IN ('queued', 'parsing', 'extracting', 'indexing',
--                       'complete', 'error', 'deleting'));
-- COMMIT;
