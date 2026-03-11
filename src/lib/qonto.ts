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
 * Try to match a document to a Qonto transaction.
 * Uses keyword matching between doc metadata and transaction labels/counterparty,
 * plus amount comparison when available.
 * Returns the best matching transaction or null.
 */
export function findMatchingTransaction(
  doc: { gmail_sender?: string; gmail_subject?: string; title?: string; created_at: string; amount_cents?: number | null },
  transactions: QontoTransactionAPI[]
): QontoTransactionAPI | null {
  // Only match debit transactions without attachments
  const candidates = transactions.filter(
    tx => tx.side === 'debit' && (!tx.attachment_ids || tx.attachment_ids.length === 0)
  );

  if (candidates.length === 0) return null;

  // Extract keywords from document
  const docText = [
    doc.gmail_sender || '',
    doc.gmail_subject || '',
    doc.title || '',
  ].join(' ').toLowerCase();

  // Extract meaningful words (skip common/short words)
  const skipWords = new Set(['facture', 'invoice', 'votre', 'your', 'pour', 'from', 'the', 'les', 'des', 'une', 'fwd', 'com', 'gmail', 'email', 'noreply', 'billing', 'no-reply', 'info', 'contact', 'hello', 'bonjour', 'merci', 'order', 'commande', 'confirmation', 'receipt', 'recu', 'numero', 'number']);
  const docWords = docText
    .replace(/[<>@.,;:!?()[\]{}""''#€$%&*+=/\\|~`^]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !skipWords.has(w));

  let bestMatch: QontoTransactionAPI | null = null;
  let bestScore = 0;

  for (const tx of candidates) {
    // Combine label and counterparty name for matching
    const txText = [tx.label || '', tx.clean_counterparty_name || ''].join(' ').toLowerCase().replace(/[*_\-]/g, ' ');
    const txWords = txText.split(/\s+/).filter(w => w.length >= 3);

    let score = 0;

    // Keyword matching: doc words in tx text
    for (const dw of docWords) {
      if (txText.includes(dw)) score += 2;
    }
    // Keyword matching: tx words in doc text
    for (const tw of txWords) {
      if (docText.includes(tw)) score += 2;
    }

    // Amount matching: strong signal if amounts match exactly
    if (doc.amount_cents && doc.amount_cents > 0 && tx.amount_cents === doc.amount_cents) {
      score += 5;
    }

    // Date proximity bonus
    const docDate = new Date(doc.created_at).getTime();
    const txDate = new Date(tx.settled_at).getTime();
    const daysDiff = Math.abs(docDate - txDate) / (1000 * 60 * 60 * 24);
    if (daysDiff <= 3) score += 1;
    if (daysDiff <= 7) score += 1;

    // Minimum threshold: at least 2 keyword matches (score 4) or amount match + 1 keyword
    if (score > bestScore && score >= 3) {
      bestScore = score;
      bestMatch = tx;
    }
  }

  return bestMatch;
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
