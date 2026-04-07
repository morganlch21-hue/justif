const PAYPAL_BASE_URL = 'https://api-m.paypal.com';

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error('PayPal credentials not configured');

  const res = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal auth error: ${res.status} - ${err}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh 1min before expiry
  };
  return cachedToken.token;
}

export interface PayPalTransactionAPI {
  transaction_info: {
    transaction_id: string;
    transaction_event_code: string;
    transaction_initiation_date: string;
    transaction_updated_date: string;
    transaction_amount: { currency_code: string; value: string };
    fee_amount?: { currency_code: string; value: string };
    transaction_status: string;
    transaction_subject?: string;
    invoice_id?: string;
  };
  payer_info?: {
    email_address?: string;
    payer_name?: { given_name?: string; surname?: string; alternate_full_name?: string };
  };
  cart_info?: {
    item_details?: Array<{ item_name?: string; item_description?: string }>;
  };
}

export async function listPayPalTransactions(params: {
  startDate: string;
  endDate: string;
  page?: number;
  pageSize?: number;
}): Promise<{ transactions: PayPalTransactionAPI[]; totalPages: number }> {
  const token = await getAccessToken();
  const searchParams = new URLSearchParams({
    start_date: params.startDate,
    end_date: params.endDate,
    fields: 'all',
    page_size: String(params.pageSize || 100),
    page: String(params.page || 1),
  });

  const res = await fetch(
    `${PAYPAL_BASE_URL}/v1/reporting/transactions?${searchParams.toString()}`,
    {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal API error: ${res.status} - ${err}`);
  }

  const data = await res.json();
  return {
    transactions: data.transaction_details || [],
    totalPages: data.total_pages || 1,
  };
}

/** Fetch all transactions for a month, handling pagination */
export async function fetchAllPayPalTransactions(monthKey: string): Promise<PayPalTransactionAPI[]> {
  const { from, to } = getPayPalMonthRange(monthKey);
  const allTx: PayPalTransactionAPI[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await listPayPalTransactions({ startDate: from, endDate: to, page });
    allTx.push(...result.transactions);
    totalPages = result.totalPages;
    page++;
  } while (page <= totalPages);

  return allTx;
}

/** PayPal API expects ISO8601 dates */
export function getPayPalMonthRange(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const from = new Date(year, month - 1, 1).toISOString();
  const lastDay = new Date(year, month, 0);
  lastDay.setHours(23, 59, 59, 999);
  const to = lastDay.toISOString();
  return { from, to };
}

/** Parse a PayPal API transaction into a flat DB-friendly shape */
export function parsePayPalTransaction(tx: PayPalTransactionAPI) {
  const info = tx.transaction_info;
  const amountValue = parseFloat(info.transaction_amount.value);
  const amountCents = Math.round(Math.abs(amountValue) * 100);
  const feeCents = info.fee_amount ? Math.round(Math.abs(parseFloat(info.fee_amount.value)) * 100) : 0;
  const side: 'debit' | 'credit' = amountValue < 0 ? 'debit' : 'credit';

  const payerName = tx.payer_info?.payer_name;
  const counterpartyName = payerName?.alternate_full_name
    || [payerName?.given_name, payerName?.surname].filter(Boolean).join(' ')
    || null;

  const description = info.transaction_subject
    || tx.cart_info?.item_details?.[0]?.item_name
    || tx.cart_info?.item_details?.[0]?.item_description
    || null;

  return {
    paypal_id: info.transaction_id,
    amount_cents: amountCents,
    currency: info.transaction_amount.currency_code,
    description,
    counterparty_name: counterpartyName,
    counterparty_email: tx.payer_info?.email_address || null,
    transaction_date: info.transaction_initiation_date,
    side,
    transaction_type: info.transaction_event_code,
    fee_cents: feeCents,
    status: info.transaction_status,
  };
}
