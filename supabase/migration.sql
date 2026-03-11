-- ============================================================
-- Migration : Compta App - Tables principales
-- Projet Supabase DEDIE (séparé de france-monte-escalier)
-- ============================================================

-- Fonction updated_at (trigger)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. Documents comptables (factures + tickets)
-- ============================================================
CREATE TABLE IF NOT EXISTS accounting_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Type et source
  type text NOT NULL CHECK (type IN ('invoice', 'ticket')),
  source text NOT NULL CHECK (source IN ('gmail', 'upload', 'manual')),

  -- Métadonnées
  title text NOT NULL,
  description text,

  -- Fichier (Supabase Storage)
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size_bytes bigint,

  -- Organisation
  month_key text NOT NULL,           -- '2026-03'
  category text DEFAULT 'general',   -- 'restaurant', 'supplier', 'service'
  amount_cents bigint,
  currency text DEFAULT 'EUR',

  -- Statut de vérification
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'to_verify', 'ignored')),

  -- Gmail (seulement pour source = 'gmail')
  gmail_message_id text UNIQUE,
  gmail_sender text,
  gmail_subject text,
  gmail_received_at timestamptz,

  -- Qonto
  qonto_transaction_id text,
  qonto_attachment_sent boolean DEFAULT false,
  qonto_attachment_sent_at timestamptz,
  qonto_error text,

  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_docs_month ON accounting_documents(month_key);
CREATE INDEX idx_docs_type ON accounting_documents(type);
CREATE INDEX idx_docs_status ON accounting_documents(status);
CREATE INDEX idx_docs_gmail ON accounting_documents(gmail_message_id) WHERE gmail_message_id IS NOT NULL;
CREATE INDEX idx_docs_created ON accounting_documents(created_at DESC);

CREATE TRIGGER update_docs_updated_at
  BEFORE UPDATE ON accounting_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. Tokens portail comptable
-- ============================================================
CREATE TABLE IF NOT EXISTS accounting_portail_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text UNIQUE NOT NULL,
  label text NOT NULL,
  is_active boolean DEFAULT true,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 3. Sync Gmail (multi-comptes)
-- ============================================================
CREATE TABLE IF NOT EXISTS accounting_gmail_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_account text NOT NULL UNIQUE,
  last_history_id text,
  last_synced_at timestamptz DEFAULT now(),
  emails_processed int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 4. Liste blanche/noire expéditeurs
-- ============================================================
CREATE TABLE IF NOT EXISTS accounting_email_senders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_pattern text NOT NULL UNIQUE,
  action text NOT NULL CHECK (action IN ('always_import', 'always_ignore')),
  label text,
  created_at timestamptz DEFAULT now()
);

-- Pré-remplir avec des expéditeurs courants
INSERT INTO accounting_email_senders (email_pattern, action, label) VALUES
  ('noreply@qonto.com', 'always_ignore', 'Notifications Qonto'),
  ('no-reply@google.com', 'always_ignore', 'Notifications Google'),
  ('notification@ovh.com', 'always_ignore', 'Notifications OVH')
ON CONFLICT (email_pattern) DO NOTHING;

-- ============================================================
-- 5. Cache transactions Qonto
-- ============================================================
CREATE TABLE IF NOT EXISTS accounting_qonto_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qonto_id text UNIQUE NOT NULL,
  amount_cents bigint NOT NULL,
  currency text DEFAULT 'EUR',
  label text,
  counterparty_name text,
  settled_at timestamptz NOT NULL,
  side text NOT NULL CHECK (side IN ('debit', 'credit')),
  has_attachment boolean DEFAULT false,
  matched_document_id uuid REFERENCES accounting_documents(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_qonto_tx_settled ON accounting_qonto_transactions(settled_at DESC);
CREATE INDEX idx_qonto_tx_no_attachment ON accounting_qonto_transactions(has_attachment) WHERE has_attachment = false;

-- ============================================================
-- RLS : tout via service_role (API routes server-side)
-- ============================================================
ALTER TABLE accounting_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_portail_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_gmail_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_email_senders ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_qonto_transactions ENABLE ROW LEVEL SECURITY;

-- Policies service_role
CREATE POLICY "service_role_docs" ON accounting_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_tokens" ON accounting_portail_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_gmail" ON accounting_gmail_sync_state FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_senders" ON accounting_email_senders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_qonto" ON accounting_qonto_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Policies pour utilisateurs authentifiés (lecture)
CREATE POLICY "auth_read_docs" ON accounting_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_senders" ON accounting_email_senders FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_qonto" ON accounting_qonto_transactions FOR SELECT TO authenticated USING (true);

-- ============================================================
-- Storage buckets (exécuter dans le SQL Editor Supabase)
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('accounting-invoices', 'accounting-invoices', false) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('accounting-tickets', 'accounting-tickets', false) ON CONFLICT DO NOTHING;

CREATE POLICY "service_invoices" ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'accounting-invoices') WITH CHECK (bucket_id = 'accounting-invoices');
CREATE POLICY "service_tickets" ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'accounting-tickets') WITH CHECK (bucket_id = 'accounting-tickets');
