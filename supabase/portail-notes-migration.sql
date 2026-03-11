-- Migration: Create accounting_portail_notes table
CREATE TABLE IF NOT EXISTS accounting_portail_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES accounting_documents(id) ON DELETE CASCADE,
  token_id uuid NOT NULL REFERENCES accounting_portail_tokens(id) ON DELETE CASCADE,
  note text NOT NULL DEFAULT '',
  flag text CHECK (flag IN ('ok', 'missing_info', 'duplicate', 'question')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Unique constraint: one note per document per token
CREATE UNIQUE INDEX IF NOT EXISTS idx_portail_notes_doc_token
  ON accounting_portail_notes(document_id, token_id);

-- Index for quick lookups by document
CREATE INDEX IF NOT EXISTS idx_portail_notes_document
  ON accounting_portail_notes(document_id);

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER update_portail_notes_updated_at
  BEFORE UPDATE ON accounting_portail_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
