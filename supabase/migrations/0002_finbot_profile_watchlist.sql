-- ============================================================================
-- 0002_finbot_profile_watchlist.sql
-- Phase 2 / Slice 2 — user profile (risk + goals) + watchlist.
--
-- Apply via Supabase Dashboard → SQL Editor → New query → paste UP → Run.
-- ============================================================================


-- ============================================================================
-- UP
-- ============================================================================

-- ─── finbot_profile ─────────────────────────────────────────────────────────
-- One row per user. PK is user_id (a profile is the user, not a separate
-- entity). FinBot's agent loads this as system context on every chat.

CREATE TABLE public.finbot_profile (
    user_id                  uuid PRIMARY KEY
                              REFERENCES auth.users(id) ON DELETE CASCADE,

    risk_tolerance           text NOT NULL
                              CHECK (risk_tolerance IN ('conservative','moderate','aggressive')),
    time_horizon             text NOT NULL
                              CHECK (time_horizon IN ('short','medium','long')),

    -- Multi-select array. CHECK keeps values inside the canonical set.
    goals                    text[] NOT NULL DEFAULT '{}'::text[]
                              CHECK (goals <@ ARRAY['retirement','income','growth','preservation']::text[]),

    liquidity_needs          text CHECK (length(liquidity_needs) <= 500),
    tax_country              text CHECK (tax_country IS NULL OR length(tax_country) = 2),
    currency_preference      text NOT NULL DEFAULT 'USD',

    -- NULL until the user finishes the onboarding wizard.
    onboarding_completed_at  timestamptz,

    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER finbot_profile_set_updated_at
    BEFORE UPDATE ON public.finbot_profile
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.finbot_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY finbot_profile_owner ON public.finbot_profile
    FOR ALL
    USING      (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());


-- ─── finbot_watchlist ───────────────────────────────────────────────────────
-- Saved tickers with optional price alerts. UNIQUE (user_id, ticker) enforces
-- one row per (user, ticker) — repository code can rely on this.

CREATE TABLE public.finbot_watchlist (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    ticker       text NOT NULL
                 CHECK (ticker = upper(ticker) AND length(ticker) BETWEEN 1 AND 10),

    alert_above  numeric(20, 6),     -- notify when price crosses above
    alert_below  numeric(20, 6),     -- notify when price crosses below
    note         text CHECK (length(note) <= 500),

    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    UNIQUE (user_id, ticker)
);

CREATE TRIGGER finbot_watchlist_set_updated_at
    BEFORE UPDATE ON public.finbot_watchlist
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.finbot_watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY finbot_watchlist_owner ON public.finbot_watchlist
    FOR ALL
    USING      (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());


-- ============================================================================
-- DOWN — copy into a new query if you need to roll back this slice only.
-- ============================================================================
--
-- DROP TABLE IF EXISTS public.finbot_watchlist;
-- DROP TABLE IF EXISTS public.finbot_profile;
