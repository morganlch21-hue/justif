import { createServiceClient } from '@/lib/supabase';
import {
  listTransactions,
  getMonthRange,
  uploadAttachment,
  findMatchingTransaction,
  findAllMatchingTransactions,
  getMultiTxPatterns,
  isNoMatchVendor,
  type QontoTransactionAPI,
} from '@/lib/qonto';
import { extractDocumentData, type ExtractedDocData } from '@/lib/claude-extract';

const NON_INVOICE_KEYWORDS = [
  'devis', 'proposition', 'reporting', 'optimisation', 'consultation',
  'confirmation de commande', 'commande validée', 'commande est validée',
  'relevé de visite', 'visite technique', 'tracking', 'data &',
  'invitation au call', 'analyse concurrentielle', 'actualisation',
];

type DocRow = {
  id: string;
  type: 'invoice' | 'ticket';
  category: string;
  status: string;
  storage_path: string;
  file_name: string;
  file_type: string;
  title: string | null;
  description: string | null;
  amount_cents: number | null;
  month_key: string;
  qonto_attachment_sent: boolean;
  extracted_vendor: string | null;
  extracted_date: string | null;
  extracted_datetime: string | null;
  extracted_reference: string | null;
  gmail_sender: string | null;
  gmail_subject: string | null;
  created_at: string;
};

/**
 * Run AI extraction on a stored document and persist the structured fields.
 * Also auto-marks status='ignored' if the doc is clearly not an invoice.
 */
export async function extractDocument(docId: string): Promise<{ extracted: ExtractedDocData | null }> {
  const supabase = createServiceClient();
  const { data: doc, error } = await supabase
    .from('accounting_documents')
    .select('*')
    .eq('id', docId)
    .single();
  if (error || !doc) throw new Error('Document not found');

  const bucket = doc.type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
  const { data: fileData } = await supabase.storage.from(bucket).download(doc.storage_path);
  if (!fileData) throw new Error('File not found in storage');
  const buffer = Buffer.from(await fileData.arrayBuffer());

  let extracted: ExtractedDocData | null = null;
  try {
    extracted = await extractDocumentData(buffer, doc.file_type);
  } catch (err) {
    console.error('[process] Extraction error:', err);
  }

  if (!extracted) {
    await supabase.from('accounting_documents').update({ extraction_status: 'failed' }).eq('id', docId);
    return { extracted: null };
  }

  const updateFields: Record<string, unknown> = {
    extraction_status: 'success',
    extracted_vendor: extracted.vendor,
    extracted_date: extracted.document_date,
    extracted_datetime: extracted.document_datetime,
    extracted_reference: extracted.reference,
  };
  if (!doc.amount_cents && extracted.amount_cents) updateFields.amount_cents = extracted.amount_cents;
  if (extracted.currency) updateFields.currency = extracted.currency;
  if (!doc.description && extracted.description) {
    updateFields.description = extracted.description;
    // Only overwrite the title if it's a fallback (file_name) — never the Gmail subject.
    if (!doc.title || doc.title === doc.file_name) {
      updateFields.title = extracted.description;
    }
  }

  const finalAmount = extracted.amount_cents || doc.amount_cents;
  const finalVendor = extracted.vendor;
  const titleLower = (doc.title || '').toLowerCase();
  if (!finalAmount && !finalVendor) {
    updateFields.status = 'ignored';
  } else if (!finalAmount && NON_INVOICE_KEYWORDS.some(kw => titleLower.includes(kw))) {
    updateFields.status = 'ignored';
  }

  await supabase.from('accounting_documents').update(updateFields).eq('id', docId);
  return { extracted };
}

/**
 * Determine which months to query Qonto for, given a doc.
 * Includes the doc's month, the extracted invoice month, and possibly the next month
 * (for late-month invoices that get debited the following month).
 */
function monthsToSearchFor(doc: Pick<DocRow, 'month_key' | 'extracted_date'>): string[] {
  const months: string[] = [doc.month_key];
  if (!doc.extracted_date) return months;
  const m = doc.extracted_date.match(/^(\d{4}-\d{2})/);
  if (!m) return months;
  if (!months.includes(m[1])) months.push(m[1]);
  const day = parseInt(doc.extracted_date.substring(8, 10), 10);
  if (day >= 20) {
    const [y, mo] = m[1].split('-').map(Number);
    const nextMonth = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    if (!months.includes(nextMonth)) months.push(nextMonth);
  }
  return months;
}

async function fetchQontoTransactionsForMonths(months: string[]): Promise<QontoTransactionAPI[]> {
  const all: QontoTransactionAPI[] = [];
  for (const mk of months) {
    const { from, to } = getMonthRange(mk);
    try {
      const response = await listTransactions({
        bankAccountId: process.env.QONTO_BANK_ACCOUNT_ID,
        settledAtFrom: from,
        settledAtTo: to,
        status: 'completed',
        perPage: 100,
      });
      all.push(...(response.transactions || []));
    } catch (err) {
      console.warn(`[process] Failed to fetch Qonto txs for ${mk}:`, err);
    }
  }
  const seen = new Set<string>();
  return all.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
}

export type PushResult =
  | { pushed: true; txIds: string[] }
  | { pushed: false; reason: 'lock_held' | 'already_sent' | 'client_invoice' | 'ignored' | 'no_match_vendor' | 'no_match' | 'file_missing' | 'upload_failed' };

/**
 * Push a single document to Qonto with an advisory lock to prevent double-pushes.
 *
 * - Acquires a 5-min lock via `acquire_qonto_push_lock` RPC. If another worker holds
 *   it (or the doc is already sent), returns early with `pushed: false`.
 * - Fetches Qonto transactions for the relevant months (or uses caller-provided ones).
 * - Handles three cases: no-match vendors (GoCardless), multi-tx vendors (Google Ads),
 *   and 1:1 matching.
 * - Uses deterministic idempotency keys per (doc, tx) so retries are safe.
 * - Always releases the lock at the end (success or error).
 */
export async function pushDocumentToQonto(
  docId: string,
  options: { transactions?: QontoTransactionAPI[] } = {},
): Promise<PushResult> {
  const supabase = createServiceClient();

  const { data: locked, error: lockErr } = await supabase
    .rpc('acquire_qonto_push_lock', { p_doc_id: docId });
  if (lockErr) throw lockErr;
  const doc = (locked as DocRow[] | null)?.[0];
  if (!doc) {
    // Lock not granted: either sent or held by another worker.
    const { data: existing } = await supabase
      .from('accounting_documents')
      .select('qonto_attachment_sent')
      .eq('id', docId)
      .single();
    return { pushed: false, reason: existing?.qonto_attachment_sent ? 'already_sent' : 'lock_held' };
  }

  try {
    if (doc.category === 'client') return { pushed: false, reason: 'client_invoice' };
    if (doc.status === 'ignored') return { pushed: false, reason: 'ignored' };

    const vendor = doc.extracted_vendor;
    if (isNoMatchVendor(vendor)) {
      await supabase.from('accounting_documents').update({ status: 'no_qonto_match' }).eq('id', docId);
      return { pushed: false, reason: 'no_match_vendor' };
    }

    const transactions = options.transactions
      ?? await fetchQontoTransactionsForMonths(monthsToSearchFor(doc));

    const bucket = doc.type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
    const { data: fileData } = await supabase.storage.from(bucket).download(doc.storage_path);
    if (!fileData) return { pushed: false, reason: 'file_missing' };
    const buffer = Buffer.from(await fileData.arrayBuffer());

    const multiTxPatterns = getMultiTxPatterns(vendor);
    if (multiTxPatterns) {
      const matchedTxs = findAllMatchingTransactions(multiTxPatterns, transactions);
      if (matchedTxs.length === 0) return { pushed: false, reason: 'no_match' };
      const txIds: string[] = [];
      for (const tx of matchedTxs) {
        try {
          await uploadAttachment(tx.id, buffer, doc.file_name, doc.file_type, `${doc.id}_${tx.id}`);
          txIds.push(tx.id);
        } catch (err) {
          console.warn(`[process] Multi-tx upload failed for tx ${tx.id}:`, err);
        }
      }
      if (txIds.length === 0) return { pushed: false, reason: 'upload_failed' };
      await supabase.from('accounting_documents').update({
        qonto_transaction_id: txIds[0],
        qonto_multi_tx_ids: txIds,
        qonto_attachment_sent: true,
        qonto_attachment_sent_at: new Date().toISOString(),
        qonto_error: null,
      }).eq('id', docId);
      return { pushed: true, txIds };
    }

    const matchedTx = findMatchingTransaction({
      gmail_sender: doc.gmail_sender ?? undefined,
      gmail_subject: doc.gmail_subject ?? undefined,
      title: doc.title ?? undefined,
      created_at: doc.created_at,
      amount_cents: doc.amount_cents,
      type: doc.type,
      category: doc.category,
      extracted_vendor: doc.extracted_vendor,
      extracted_date: doc.extracted_date,
      extracted_datetime: doc.extracted_datetime,
      extracted_reference: doc.extracted_reference,
    }, transactions);
    if (!matchedTx) return { pushed: false, reason: 'no_match' };

    await uploadAttachment(matchedTx.id, buffer, doc.file_name, doc.file_type, `${doc.id}_${matchedTx.id}`);
    await supabase.from('accounting_documents').update({
      qonto_transaction_id: matchedTx.id,
      qonto_attachment_sent: true,
      qonto_attachment_sent_at: new Date().toISOString(),
      qonto_error: null,
    }).eq('id', docId);
    return { pushed: true, txIds: [matchedTx.id] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await supabase.from('accounting_documents').update({ qonto_error: msg }).eq('id', docId);
    throw err;
  } finally {
    await supabase.rpc('release_qonto_push_lock', { p_doc_id: docId });
  }
}

/** Run extraction then auto-push. Used by /api/documents/process. */
export async function processDocument(docId: string) {
  const { extracted } = await extractDocument(docId);
  let push: PushResult;
  try {
    push = await pushDocumentToQonto(docId);
  } catch (err) {
    push = { pushed: false, reason: 'upload_failed' };
    console.error('[process] Push error (non-blocking):', err);
  }
  return { extracted, qontoPushed: push.pushed };
}
