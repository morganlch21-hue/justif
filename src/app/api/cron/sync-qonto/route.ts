import { createServiceClient } from '@/lib/supabase';
import { listTransactions, getMonthRange, uploadAttachment, findMatchingTransaction, type QontoTransactionAPI } from '@/lib/qonto';
import { getCurrentMonthKey } from '@/lib/types';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

/**
 * Cron job: sync Qonto transactions + auto-push unmatched documents.
 * Runs every 30 minutes via Vercel Cron.
 * Secured via CRON_SECRET env var.
 */
export async function GET(request: Request) {
  // Verify cron secret (Vercel sets this header automatically)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const month = getCurrentMonthKey();
  const supabase = createServiceClient();

  try {
    // Phase 1: Sync transactions from Qonto
    const { from, to } = getMonthRange(month);
    const response = await listTransactions({
      bankAccountId: process.env.QONTO_BANK_ACCOUNT_ID,
      settledAtFrom: from,
      settledAtTo: to,
      status: 'completed',
    });

    const transactions: QontoTransactionAPI[] = response.transactions || [];
    let synced = 0;

    for (const tx of transactions) {
      const hasAttachment = tx.attachment_ids && tx.attachment_ids.length > 0;

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
    }

    // Phase 2: Auto-push unmatched documents
    const { data: docs } = await supabase
      .from('accounting_documents')
      .select('*')
      .eq('status', 'confirmed')
      .eq('qonto_attachment_sent', false)
      .is('qonto_error', null)
      .eq('month_key', month)
      .neq('category', 'client');

    let pushed = 0;
    const availableTxs = transactions.filter(t =>
      t.side === 'debit' && (!t.attachment_ids || t.attachment_ids.length === 0)
    );

    if (docs && docs.length > 0) {
      for (const doc of docs) {
        const matchedTx = findMatchingTransaction(
          { ...doc, type: doc.type, category: doc.category },
          availableTxs
        );

        if (!matchedTx) continue;

        try {
          const bucket = doc.type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
          const { data: fileData } = await supabase.storage.from(bucket).download(doc.storage_path);
          if (!fileData) continue;

          const buffer = Buffer.from(await fileData.arrayBuffer());
          await uploadAttachment(matchedTx.id, buffer, doc.file_name, doc.file_type);

          await supabase
            .from('accounting_documents')
            .update({
              qonto_transaction_id: matchedTx.id,
              qonto_attachment_sent: true,
              qonto_attachment_sent_at: new Date().toISOString(),
            })
            .eq('id', doc.id);

          // Remove from candidates
          const idx = availableTxs.findIndex(t => t.id === matchedTx.id);
          if (idx !== -1) availableTxs.splice(idx, 1);

          pushed++;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          await supabase
            .from('accounting_documents')
            .update({ qonto_error: errorMsg })
            .eq('id', doc.id);
        }
      }
    }

    return NextResponse.json({ ok: true, month, synced, pushed });
  } catch (err) {
    console.error('Cron sync error:', err);
    return NextResponse.json({ error: 'Cron sync failed' }, { status: 500 });
  }
}
