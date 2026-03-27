-- Migration: Create reports table for persistent report storage
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS reports (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  template   TEXT NOT NULL DEFAULT 'full_analysis',
  sections   JSONB NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'generating',
  word_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Row-Level Security
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Users can only access their own reports
CREATE POLICY reports_select ON reports
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY reports_insert ON reports
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY reports_update ON reports
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY reports_delete ON reports
  FOR DELETE USING (user_id = auth.uid());

-- Index for fast doc-scoped queries
CREATE INDEX IF NOT EXISTS idx_reports_doc_user ON reports(doc_id, user_id);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id);
