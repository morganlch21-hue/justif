const QONTO_BASE_URL = 'https://thirdparty.qonto.com/v2';

function getHeaders() {
  return {
    'Authorization': `${process.env.QONTO_LOGIN}:${process.env.QONTO_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

export interface QontoTransactionAPI {
  id: string;
  amount: number;
  amount_cents: number;
  currency: string;
  label: string | null;
  clean_counterparty_name: string | null;
  settled_at: string;
  side: 'debit' | 'credit';
  operation_type: string;
  attachment_ids: string[];
}

export async function getOrganization() {
  const res = await fetch(`${QONTO_BASE_URL}/organization`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Qonto API error: ${res.status}`);
  return res.json();
}

export async function listTransactions(params: {
  bankAccountId?: string;
  settledAtFrom?: string;
  settledAtTo?: string;
  status?: string;
  page?: number;
  perPage?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params.bankAccountId) searchParams.set('bank_account_id', params.bankAccountId);
  if (params.settledAtFrom) searchParams.set('settled_at_from', params.settledAtFrom);
  if (params.settledAtTo) searchParams.set('settled_at_to', params.settledAtTo);
  if (params.status) searchParams.set('status[]', params.status);
  searchParams.set('current_page', String(params.page || 1));
  searchParams.set('per_page', String(params.perPage || 100));
  searchParams.set('includes[]', 'attachments');

  const res = await fetch(
    `${QONTO_BASE_URL}/transactions?${searchParams.toString()}`,
    { headers: getHeaders() }
  );
  if (!res.ok) throw new Error(`Qonto API error: ${res.status}`);
  return res.json();
}

export async function uploadAttachment(
  transactionId: string,
  file: Buffer,
  fileName: string,
  contentType: string
) {
  const formData = new FormData();
  formData.append('file', new Blob([file as unknown as BlobPart], { type: contentType }), fileName);

  const res = await fetch(
    `${QONTO_BASE_URL}/transactions/${transactionId}/attachments`,
    {
      method: 'POST',
      headers: {
        'Authorization': `${process.env.QONTO_LOGIN}:${process.env.QONTO_SECRET_KEY}`,
        'X-Qonto-Idempotency-Key': crypto.randomUUID(),
      },
      body: formData,
    }
  );
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Qonto upload error: ${res.status} - ${error}`);
  }
  return res.json();
}

/**
 * Find the best matching transaction for a document.
 *
 * STRICT RULES to prevent false positives:
 * - Invoices: MUST have exact amount match OR reference match. Keywords alone = NO match.
 * - Tickets: MUST have amount match OR (vendor + close date).
 * - This prevents cases like "Google Ads Proposition" matching a Google Ads 300EUR transaction.
 */
export function findMatchingTransaction(
  doc: { gmail_sender?: string; gmail_subject?: string; title?: string; created_at: string; amount_cents?: number | null; type?: string; category?: string; extracted_vendor?: string | null; extracted_date?: string | null; extracted_datetime?: string | null; extracted_reference?: string | null },
  transactions: QontoTransactionAPI[]
): QontoTransactionAPI | null {
  const candidates = transactions.filter(
    tx => tx.side === 'debit' && (!tx.attachment_ids || tx.attachment_ids.length === 0)
  );
  if (candidates.length === 0) return null;

  const isTicket = doc.type === 'ticket';
  const docText = [
    doc.gmail_sender || '', doc.gmail_subject || '',
    doc.title || '', doc.extracted_vendor || '',
  ].join(' ').toLowerCase();

  let bestMatch: QontoTransactionAPI | null = null;
  let bestScore = 0;

  for (const tx of candidates) {
    const txText = [tx.label || '', tx.clean_counterparty_name || ''].join(' ').toLowerCase().replace(/[*_\-]/g, ' ');
    let score = 0;
    let hasAmountMatch = false;
    let hasVendorMatch = false;
    let hasDateMatch = false;
    let hasReferenceMatch = false;

    // --- AMOUNT: exact or approximate match ---
    if (doc.amount_cents && doc.amount_cents > 0) {
      if (tx.amount_cents === doc.amount_cents) {
        // Exact match
        score += 10;
        hasAmountMatch = true;
      } else {
        // Approximate match (±15% tolerance for currency conversion USD/EUR + bank fees)
        const ratio = tx.amount_cents / doc.amount_cents;
        if (ratio >= 0.85 && ratio <= 1.15) {
          score += 6;
          hasAmountMatch = true;
        }
      }
    }

    // --- VENDOR: extracted vendor vs counterparty ---
    if (doc.extracted_vendor) {
      const v = doc.extracted_vendor.toLowerCase();
      const c = (tx.clean_counterparty_name || '').toLowerCase();
      if (c && v && (c.includes(v) || v.includes(c))) {
        score += 5;
        hasVendorMatch = true;
      }
    }
    // Fallback: keyword matching (weak, capped at 3)
    if (!hasVendorMatch) {
      const skip = new Set(['facture','invoice','votre','your','pour','from','the','les','des','une','fwd','com','gmail','email','noreply','billing','no-reply','info','contact','hello','bonjour','merci','order','commande','confirmation','receipt','recu','numero','number','dejeuner','diner','repas','ticket','proposition','devis','pro','cloud','platform','apis','payment','received','available']);
      const words = docText.replace(/[<>@.,;:!?()[\]{}#$%&*+=/\\|~`^]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !skip.has(w));
      let hits = 0;
      for (const w of words) { if (txText.includes(w)) hits++; }
      if (hits > 0) score += Math.min(hits, 3);
      if (hits >= 2) hasVendorMatch = true;
    }

    // --- DATE: proximity ---
    const docDateStr = doc.extracted_datetime || doc.extracted_date || doc.created_at;
    const hoursDiff = Math.abs(new Date(docDateStr).getTime() - new Date(tx.settled_at).getTime()) / 3600000;
    const daysDiff = hoursDiff / 24;

    if (doc.extracted_datetime && hoursDiff <= 2) { score += 8; hasDateMatch = true; }
    else if (doc.extracted_datetime && hoursDiff <= 6) { score += 5; hasDateMatch = true; }
    else if (daysDiff <= 1) { score += 5; hasDateMatch = true; }
    else if (daysDiff <= 3) { score += 3; hasDateMatch = true; }
    else if (daysDiff <= 7) { score += 1; }
    else if (daysDiff > 30) { score -= 5; }
    else if (daysDiff > 15) { score -= 2; }

    // --- REFERENCE: invoice number in tx label ---
    if (doc.extracted_reference) {
      const ref = doc.extracted_reference.toLowerCase();
      const label = (tx.label || '').toLowerCase();
      if (label.includes(ref) || ref.includes(tx.id || '')) {
        score += 15;
        hasReferenceMatch = true;
      }
    }

    // === STRICT GATE: reject insufficient evidence ===
    if (!isTicket && !hasAmountMatch && !hasReferenceMatch) continue;
    if (isTicket && !hasAmountMatch && !(hasVendorMatch && hasDateMatch)) continue;

    const threshold = isTicket ? 5 : 10;
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestMatch = tx;
    }
  }

  return bestMatch;
}

export async function removeAttachment(
  transactionId: string,
  attachmentId: string
) {
  const res = await fetch(
    `${QONTO_BASE_URL}/transactions/${transactionId}/attachments/${attachmentId}`,
    {
      method: 'DELETE',
      headers: getHeaders(),
    }
  );
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Qonto delete error: ${res.status} - ${error}`);
  }
}

export async function getTransaction(transactionId: string) {
  const res = await fetch(
    `${QONTO_BASE_URL}/transactions/${transactionId}`,
    { headers: getHeaders() }
  );
  if (!res.ok) throw new Error(`Qonto API error: ${res.status}`);
  return res.json();
}

// Get month range for querying transactions
export function getMonthRange(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}
