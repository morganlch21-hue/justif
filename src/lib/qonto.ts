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
