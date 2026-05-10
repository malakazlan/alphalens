-- ============================================================================
-- 0003_finbot_conversations.sql
-- Phase 2 / Slice 4 — persistent conversations + messages for FinBot.
--
-- Apply via Supabase Dashboard → SQL Editor → New query → paste UP → Run.
-- ============================================================================


-- ============================================================================
-- UP
-- ============================================================================

-- ─── finbot_conversations ───────────────────────────────────────────────────
-- One row per chat thread. `title` is auto-generated from the first user
-- message (first 5 words) on creation; the user can rename later via PATCH.

CREATE TABLE public.finbot_conversations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    title        text NOT NULL DEFAULT 'New conversation'
                  CHECK (length(title) BETWEEN 1 AND 120),

    pinned       boolean NOT NULL DEFAULT false,
    archived_at  timestamptz,

    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Hot path: user's recent active conversations (sidebar).
CREATE INDEX finbot_conversations_user_active_idx
    ON public.finbot_conversations (user_id, updated_at DESC)
    WHERE archived_at IS NULL;

CREATE TRIGGER finbot_conversations_set_updated_at
    BEFORE UPDATE ON public.finbot_conversations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.finbot_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY finbot_conversations_owner ON public.finbot_conversations
    FOR ALL
    USING      (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());


-- ─── finbot_messages ────────────────────────────────────────────────────────
-- Append-only log of chat messages. `user_id` denormalised so RLS can be
-- evaluated without a JOIN. `tool_calls` keeps the LLM's tool invocations
-- per assistant message so the UI can render badges on history reload.

CREATE TABLE public.finbot_messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES public.finbot_conversations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    role            text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content         text NOT NULL DEFAULT '',
    tool_calls      jsonb,                -- [{name, args, result_summary?}]

    tokens_prompt     integer NOT NULL DEFAULT 0 CHECK (tokens_prompt     >= 0),
    tokens_completion integer NOT NULL DEFAULT 0 CHECK (tokens_completion >= 0),

    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Hot path: page through one conversation in chronological order.
CREATE INDEX finbot_messages_conversation_idx
    ON public.finbot_messages (conversation_id, created_at);

ALTER TABLE public.finbot_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY finbot_messages_owner ON public.finbot_messages
    FOR ALL
    USING      (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());


-- ============================================================================
-- DOWN — copy into a new query if you need to roll back this slice only.
-- ============================================================================
--
-- DROP TABLE IF EXISTS public.finbot_messages;
-- DROP TABLE IF EXISTS public.finbot_conversations;
