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
  settled_at: string;
  side: 'debit' | 'credit';
  counterparty: string;
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
 * Extracts keywords from sender/subject/title and compares to transaction labels.
 * Returns the best matching transaction ID or null.
 */
export function findMatchingTransaction(
  doc: { gmail_sender?: string; gmail_subject?: string; title?: string; created_at: string },
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
  const skipWords = new Set(['facture', 'invoice', 'votre', 'your', 'pour', 'from', 'the', 'les', 'des', 'une', 'fwd', 'com', 'gmail', 'email', 'noreply', 'billing', 'no-reply', 'info', 'contact', 'hello', 'bonjour']);
  const docWords = docText
    .replace(/[<>@.,;:!?()[\]{}""''#€$%&*+=/\\|~`^]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !skipWords.has(w));

  let bestMatch: QontoTransactionAPI | null = null;
  let bestScore = 0;

  for (const tx of candidates) {
    const txLabel = (tx.label || '').toLowerCase().replace(/[*_\-]/g, ' ');
    const txWords = txLabel.split(/\s+/).filter(w => w.length >= 3);

    // Score: how many doc words appear in the transaction label (or vice versa)
    let score = 0;
    for (const dw of docWords) {
      if (txLabel.includes(dw)) score += 2;
    }
    for (const tw of txWords) {
      if (docText.includes(tw)) score += 2;
    }

    // Date proximity bonus: closer dates score higher
    const docDate = new Date(doc.created_at).getTime();
    const txDate = new Date(tx.settled_at).getTime();
    const daysDiff = Math.abs(docDate - txDate) / (1000 * 60 * 60 * 24);
    if (daysDiff <= 3) score += 1;

    if (score > bestScore && score >= 4) {
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
