-- ============================================================================
-- 0001_finbot_holdings.sql
-- Phase 2 / Slice 1 — persistent portfolio holdings for FinBot.
--
-- Apply via: Supabase Dashboard → SQL Editor → New query → paste UP section
--             → Run.
-- The DOWN block at the bottom is for emergency rollback only — leave it
-- commented in this file; copy-paste into a new query if you need to roll back.
-- ============================================================================


-- ============================================================================
-- UP
-- ============================================================================

CREATE TABLE public.finbot_holdings (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Symbol normalised to uppercase. CHECK enforces the contract so
    -- repository code can rely on it without re-validating.
    ticker       text NOT NULL
                 CHECK (ticker = upper(ticker) AND length(ticker) BETWEEN 1 AND 10),

    -- Numeric(20,6) keeps fractional shares (e.g. crypto-style 6dp) without
    -- floating-point drift. Max value covers any plausible portfolio.
    quantity     numeric(20, 6) NOT NULL CHECK (quantity > 0),

    -- Total dollars invested for this lot (cost_basis = price_paid * quantity
    -- + commissions). NOT a per-share number.
    cost_basis   numeric(20, 6) NOT NULL CHECK (cost_basis >= 0),

    currency     text NOT NULL DEFAULT 'USD',

    account_type text NOT NULL
                 CHECK (account_type IN ('taxable', 'retirement', 'isa', 'other')),

    opened_at    date NOT NULL,
    closed_at    date,                       -- NULL while position is open
    note         text CHECK (length(note) <= 500),

    -- Soft delete: kept for audit. Repository filters `deleted_at IS NULL`.
    deleted_at   timestamptz,

    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Hot path: list a user's active (open, non-deleted) holdings.
CREATE INDEX finbot_holdings_active_user_idx
    ON public.finbot_holdings (user_id, ticker, account_type)
    WHERE deleted_at IS NULL;

-- Reusable trigger function for keeping `updated_at` fresh.
-- CREATE OR REPLACE → idempotent, safe to re-run later phases reuse this.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER finbot_holdings_set_updated_at
    BEFORE UPDATE ON public.finbot_holdings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Row-Level Security: each user sees only their own rows.
-- Service role (used by the backend) bypasses RLS automatically.
ALTER TABLE public.finbot_holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY finbot_holdings_owner ON public.finbot_holdings
    FOR ALL
    USING      (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());


-- ============================================================================
-- DOWN — copy these statements into a new query if you need to roll back.
-- ============================================================================
--
-- DROP TABLE IF EXISTS public.finbot_holdings;
-- (set_updated_at() is shared with later Phase 2 tables — do NOT drop it
--  unless you're rolling back the entire phase.)
