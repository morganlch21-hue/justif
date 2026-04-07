import { createServiceClient } from '@/lib/supabase';
import { fetchAllPayPalTransactions, parsePayPalTransaction } from '@/lib/paypal';
import { getCurrentMonthKey } from '@/lib/types';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || getCurrentMonthKey();

    const rawTransactions = await fetchAllPayPalTransactions(month);
    const supabase = createServiceClient();

    let synced = 0;
    let missingDocuments = 0;

    for (const raw of rawTransactions) {
      const tx = parsePayPalTransaction(raw);

      // Skip pending/denied transactions
      if (tx.status !== 'S') continue;
      // Skip very small amounts (< 1€)
      if (tx.amount_cents <= 100) continue;

      // Check if we have a matching document
      const { data: matchedDoc } = await supabase
        .from('accounting_documents')
        .select('id')
        .eq('paypal_transaction_id', tx.paypal_id)
        .maybeSingle();

      const { error } = await supabase
        .from('accounting_paypal_transactions')
        .upsert({
          paypal_id: tx.paypal_id,
          amount_cents: tx.amount_cents,
          currency: tx.currency,
          description: tx.description,
          counterparty_name: tx.counterparty_name,
          counterparty_email: tx.counterparty_email,
          transaction_date: tx.transaction_date,
          side: tx.side,
          transaction_type: tx.transaction_type,
          fee_cents: tx.fee_cents,
          has_document: !!matchedDoc,
          matched_document_id: matchedDoc?.id || null,
        }, { onConflict: 'paypal_id' });

      if (!error) synced++;
      if (!matchedDoc && tx.side === 'debit') {
        missingDocuments++;
      }
    }

    return NextResponse.json({ synced, total: rawTransactions.length, missingDocuments, month });
  } catch (err) {
    console.error('PayPal sync error:', err);
    return NextResponse.json({ error: 'Erreur sync PayPal' }, { status: 500 });
  }
}
