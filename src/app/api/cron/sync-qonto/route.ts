import { createServiceClient } from '@/lib/supabase';
import { listTransactions, getMonthRange, type QontoTransactionAPI } from '@/lib/qonto';
import { pushDocumentToQonto } from '@/lib/process-document';
import { getCurrentMonthKey } from '@/lib/types';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

/**
 * Cron job: sync Qonto transactions + auto-push unmatched documents.
 * Runs every 30 minutes via external cron (cron-job.org).
 * Secured via CRON_SECRET (header preferred, query as fallback).
 */
export async function GET(request: Request) {
  // Header-based auth preferred — query params can leak into access logs.
  const headerSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  const querySecret = new URL(request.url).searchParams.get('secret');
  const secret = headerSecret || querySecret;
  if (secret !== process.env.CRON_SECRET) {
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

    // Batch lookup of matched docs to avoid N+1 round-trips.
    const txIds = transactions.map(t => t.id);
    const { data: matchedDocs } = await supabase
      .from('accounting_documents')
      .select('id, qonto_transaction_id')
      .in('qonto_transaction_id', txIds.length > 0 ? txIds : ['__none__']);
    const matchByTx = new Map<string, string>();
    for (const d of matchedDocs || []) {
      if (d.qonto_transaction_id) matchByTx.set(d.qonto_transaction_id, d.id);
    }

    let synced = 0;
    for (const tx of transactions) {
      const hasAttachment = tx.attachment_ids && tx.attachment_ids.length > 0;
      const matchedDocId = matchByTx.get(tx.id) || null;
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
      if (!error) synced++;
    }

    // Phase 2: Auto-push unmatched confirmed docs (current month only).
    const { data: docs } = await supabase
      .from('accounting_documents')
      .select('id')
      .eq('status', 'confirmed')
      .eq('qonto_attachment_sent', false)
      .is('qonto_error', null)
      .eq('month_key', month)
      .neq('category', 'client');

    const txPool = [...transactions];
    let pushed = 0;
    for (const doc of docs || []) {
      try {
        const r = await pushDocumentToQonto(doc.id, { transactions: txPool });
        if (r.pushed) {
          pushed++;
          for (const txId of r.txIds) {
            const idx = txPool.findIndex(t => t.id === txId);
            if (idx !== -1) txPool.splice(idx, 1);
          }
        }
      } catch (err) {
        console.warn(`[cron] Push failed for doc ${doc.id}:`, err);
      }
    }

    return NextResponse.json({ ok: true, month, synced, pushed });
  } catch (err) {
    console.error('Cron sync error:', err);
    return NextResponse.json({ error: 'Cron sync failed' }, { status: 500 });
  }
}
