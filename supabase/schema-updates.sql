-- ============================================================
-- Schema updates : aligne la DB avec l'état actuel du code.
-- Idempotent — peut être ré-exécuté sans risque.
-- ============================================================

-- ------------------------------------------------------------
-- 1. accounting_documents : nouveaux champs
-- ------------------------------------------------------------
ALTER TABLE accounting_documents
  ADD COLUMN IF NOT EXISTS extracted_vendor       text,
  ADD COLUMN IF NOT EXISTS extracted_date         date,
  ADD COLUMN IF NOT EXISTS extracted_datetime     timestamptz,
  ADD COLUMN IF NOT EXISTS extracted_reference    text,
  ADD COLUMN IF NOT EXISTS extraction_status      text CHECK (extraction_status IN ('success', 'failed', 'timeout')),
  ADD COLUMN IF NOT EXISTS qonto_multi_tx_ids     text[],
  ADD COLUMN IF NOT EXISTS qonto_processing_at    timestamptz,
  ADD COLUMN IF NOT EXISTS paypal_transaction_id  text;

-- Élargir le CHECK status pour inclure 'no_qonto_match'
ALTER TABLE accounting_documents DROP CONSTRAINT IF EXISTS accounting_documents_status_check;
ALTER TABLE accounting_documents
  ADD CONSTRAINT accounting_documents_status_check
  CHECK (status IN ('confirmed', 'to_verify', 'ignored', 'no_qonto_match'));

-- Index utiles
CREATE INDEX IF NOT EXISTS idx_docs_paypal_tx ON accounting_documents(paypal_transaction_id) WHERE paypal_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docs_processing ON accounting_documents(qonto_processing_at) WHERE qonto_processing_at IS NOT NULL;

-- ------------------------------------------------------------
-- 2. accounting_qonto_transactions : note libre (pour expliquer un débit sans facture)
-- ------------------------------------------------------------
ALTER TABLE accounting_qonto_transactions
  ADD COLUMN IF NOT EXISTS note text;

-- ------------------------------------------------------------
-- 3. accounting_paypal_transactions : nouveau cache PayPal
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounting_paypal_transactions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paypal_id             text UNIQUE NOT NULL,
  amount_cents          bigint NOT NULL,
  currency              text DEFAULT 'EUR',
  description           text,
  counterparty_name     text,
  counterparty_email    text,
  transaction_date      timestamptz NOT NULL,
  side                  text NOT NULL CHECK (side IN ('debit', 'credit')),
  transaction_type      text,
  fee_cents             bigint DEFAULT 0,
  has_document          boolean DEFAULT false,
  matched_document_id   uuid REFERENCES accounting_documents(id) ON DELETE SET NULL,
  note                  text,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paypal_tx_date ON accounting_paypal_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_paypal_tx_no_doc ON accounting_paypal_transactions(has_document) WHERE has_document = false;

ALTER TABLE accounting_paypal_transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_paypal" ON accounting_paypal_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "auth_read_paypal" ON accounting_paypal_transactions FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- 4. accounting_portail_notes : (consolidé depuis portail-notes-migration.sql)
--    Au cas où le fichier séparé n'aurait pas été appliqué.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounting_portail_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES accounting_documents(id) ON DELETE CASCADE,
  token_id     uuid NOT NULL REFERENCES accounting_portail_tokens(id) ON DELETE CASCADE,
  note         text NOT NULL DEFAULT '',
  flag         text CHECK (flag IN ('ok', 'missing_info', 'duplicate', 'question')),
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portail_notes_doc_token ON accounting_portail_notes(document_id, token_id);
CREATE INDEX IF NOT EXISTS idx_portail_notes_document ON accounting_portail_notes(document_id);

DO $$ BEGIN
  CREATE TRIGGER update_portail_notes_updated_at
    BEFORE UPDATE ON accounting_portail_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- 5. RPC pour le lock applicatif (auto-push Qonto)
--    Pose le verrou si libre OU expiré (>5min). Retourne le doc verrouillé, sinon NULL.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION acquire_qonto_push_lock(p_doc_id uuid, p_lock_ttl_minutes int DEFAULT 5)
RETURNS SETOF accounting_documents
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE accounting_documents
  SET qonto_processing_at = now()
  WHERE id = p_doc_id
    AND qonto_attachment_sent = false
    AND (qonto_processing_at IS NULL OR qonto_processing_at < now() - (p_lock_ttl_minutes || ' minutes')::interval)
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION release_qonto_push_lock(p_doc_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE accounting_documents
  SET qonto_processing_at = NULL
  WHERE id = p_doc_id;
$$;
