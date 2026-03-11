export type DocumentType = 'invoice' | 'ticket';
export type DocumentSource = 'gmail' | 'upload' | 'manual';
export type SenderAction = 'always_import' | 'always_ignore';

export interface AccountingDocument {
  id: string;
  type: DocumentType;
  source: DocumentSource;
  title: string;
  description: string | null;
  storage_path: string;
  file_name: string;
  file_type: string;
  file_size_bytes: number | null;
  month_key: string;
  category: string;
  amount_cents: number | null;
  currency: string;
  gmail_message_id: string | null;
  gmail_sender: string | null;
  gmail_subject: string | null;
  gmail_received_at: string | null;
  qonto_transaction_id: string | null;
  qonto_attachment_sent: boolean;
  qonto_attachment_sent_at: string | null;
  qonto_error: string | null;
  status: 'confirmed' | 'to_verify' | 'ignored';
  created_at: string;
  updated_at: string;
}

export interface PortailToken {
  id: string;
  token_hash: string;
  label: string;
  is_active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface GmailSyncState {
  id: string;
  email_account: string;
  last_history_id: string | null;
  last_synced_at: string;
  emails_processed: number;
  created_at: string;
}

export interface EmailSender {
  id: string;
  email_pattern: string;
  action: SenderAction;
  label: string | null;
  created_at: string;
}

export interface QontoTransaction {
  id: string;
  qonto_id: string;
  amount_cents: number;
  currency: string;
  label: string | null;
  counterparty_name: string | null;
  settled_at: string;
  side: 'debit' | 'credit';
  has_attachment: boolean;
  matched_document_id: string | null;
  created_at: string;
}

export interface GmailReceivePayload {
  messageId: string;
  subject: string;
  sender: string;
  receivedAt: string;
  fileName: string;
  fileBase64: string;
  fileType: string;
  emailAccount: string;
}

// Helpers
export function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthKey(key: string): string {
  const [year, month] = key.split('-');
  const months = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ];
  return `${months[parseInt(month) - 1]} ${year}`;
}
