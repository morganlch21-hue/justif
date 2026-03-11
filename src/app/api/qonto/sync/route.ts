import { createServiceClient } from '@/lib/supabase';
import { listTransactions, getMonthRange, type QontoTransactionAPI } from '@/lib/qonto';
import { getCurrentMonthKey } from '@/lib/types';
import { NextResponse } from 'next/server';

// Sync Qonto transactions to detect payments without invoices
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || getCurrentMonthKey();

    const { from, to } = getMonthRange(month);

    // Fetch transactions from Qonto
    const response = await listTransactions({
      bankAccountId: process.env.QONTO_BANK_ACCOUNT_ID,
      settledAtFrom: from,
      settledAtTo: to,
      status: 'completed',
    });

    const transactions: QontoTransactionAPI[] = response.transactions || [];
    const supabase = createServiceClient();

    let synced = 0;
    let missingInvoices = 0;

    for (const tx of transactions) {
      const hasAttachment = tx.attachment_ids && tx.attachment_ids.length > 0;

      // Check if we have a matching document
      const { data: matchedDoc } = await supabase
        .from('accounting_documents')
        .select('id')
        .eq('qonto_transaction_id', tx.id)
        .maybeSingle();

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
          has_attachment: hasAttachment || !!matchedDoc,
          matched_document_id: matchedDoc?.id || null,
        }, { onConflict: 'qonto_id' });

      if (!error) synced++;
      if (!hasAttachment && !matchedDoc && tx.side === 'debit') {
        missingInvoices++;
      }
    }

    return NextResponse.json({
      synced,
      total: transactions.length,
      missingInvoices,
      month,
    });
  } catch (err) {
    console.error('Qonto sync error:', err);
    return NextResponse.json({ error: 'Erreur sync Qonto' }, { status: 500 });
  }
}
