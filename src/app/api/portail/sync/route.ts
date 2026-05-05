import { validatePortailAccess } from '@/lib/portail-auth';
import { createServiceClient } from '@/lib/supabase';
import { listTransactions, getMonthRange, type QontoTransactionAPI } from '@/lib/qonto';
import { fetchAllPayPalTransactions, parsePayPalTransaction } from '@/lib/paypal';
import { getCurrentMonthKey } from '@/lib/types';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

/**
 * Sync Qonto + PayPal for a given month, gated by portail auth (token OR session).
 * Used by the portail dashboard since /api/qonto/sync etc. require a dashboard session.
 */
export async function POST(request: Request) {
  const auth = await validatePortailAccess(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month') || getCurrentMonthKey();
  const supabase = createServiceClient();

  let qontoSynced = 0;
  let paypalSynced = 0;

  // --- Qonto sync ---
  try {
    const { from, to } = getMonthRange(month);
    const response = await listTransactions({
      bankAccountId: process.env.QONTO_BANK_ACCOUNT_ID,
      settledAtFrom: from,
      settledAtTo: to,
      status: 'completed',
    });
    const transactions: QontoTransactionAPI[] = response.transactions || [];

    const txIds = transactions.map(t => t.id);
    const { data: matchedDocs } = await supabase
      .from('accounting_documents')
      .select('id, qonto_transaction_id')
      .in('qonto_transaction_id', txIds.length > 0 ? txIds : ['__none__']);
    const matchByTx = new Map<string, string>();
    for (const d of matchedDocs || []) {
      if (d.qonto_transaction_id) matchByTx.set(d.qonto_transaction_id, d.id);
    }

    for (const tx of transactions) {
      const matchedDocId = matchByTx.get(tx.id) || null;
      const hasAttachment = tx.attachment_ids && tx.attachment_ids.length > 0;
      const { error } = await supabase
        .from('accounting_qonto_transactions')
        .upsert({
          qonto_id: tx.id,
          amount_cents: tx.amount_cents,
          currency: tx.currency,
          label: tx.label,
          counterparty_name: tx.clean_counterparty_name || tx.label || null,
          settled_at: tx.settled_at,
          side: tx.side,
          has_attachment: hasAttachment || !!matchedDocId,
          matched_document_id: matchedDocId,
        }, { onConflict: 'qonto_id' });
      if (!error) qontoSynced++;
    }
  } catch (err) {
    console.warn('[portail/sync] Qonto sync failed:', err);
  }

  // --- PayPal sync ---
  try {
    const rawTransactions = await fetchAllPayPalTransactions(month);
    for (const raw of rawTransactions) {
      const tx = parsePayPalTransaction(raw);
      if (tx.status !== 'S') continue; // 'S' = success in PayPal reporting
      if (tx.amount_cents <= 100) continue;
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
      if (!error) paypalSynced++;
    }
  } catch (err) {
    console.warn('[portail/sync] PayPal sync failed:', err);
  }

  return NextResponse.json({ qontoSynced, paypalSynced, month });
}
