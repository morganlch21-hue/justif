import { createServiceClient } from '@/lib/supabase';
import { listTransactions, getMonthRange, type QontoTransactionAPI } from '@/lib/qonto';
import { pushDocumentToQonto } from '@/lib/process-document';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

/**
 * Auto-push: match confirmed documents to Qonto transactions and attach them.
 * Can be called for a specific document or for all unmatched docs of a month.
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const documentId = searchParams.get('documentId');

    const supabase = createServiceClient();

    let query = supabase
      .from('accounting_documents')
      .select('id, month_key, category')
      .eq('status', 'confirmed')
      .eq('qonto_attachment_sent', false)
      .neq('category', 'client')
      .is('qonto_error', null);

    if (documentId) {
      query = query.eq('id', documentId);
    } else if (month) {
      query = query.eq('month_key', month);
    } else {
      return NextResponse.json({ error: 'month ou documentId requis' }, { status: 400 });
    }

    const { data: docs } = await query;
    if (!docs || docs.length === 0) {
      return NextResponse.json({ matched: 0, pushed: 0, message: 'Aucun document à traiter' });
    }

    // Fetch transactions once per relevant month (shared across all docs).
    const monthKeys = Array.from(new Set(docs.map(d => d.month_key)));
    const transactions: QontoTransactionAPI[] = [];
    for (const mk of monthKeys) {
      const { from, to } = getMonthRange(mk);
      try {
        const response = await listTransactions({
          bankAccountId: process.env.QONTO_BANK_ACCOUNT_ID,
          settledAtFrom: from,
          settledAtTo: to,
          status: 'completed',
          perPage: 100,
        });
        transactions.push(...(response.transactions || []));
      } catch (err) {
        console.warn(`[auto-push] Failed to fetch txs for ${mk}:`, err);
      }
    }

    let pushed = 0;
    const results: Array<{ docId: string; status: string }> = [];

    for (const doc of docs) {
      try {
        const r = await pushDocumentToQonto(doc.id, { transactions });
        if (r.pushed) {
          pushed++;
          // Remove the consumed tx from the pool so the next doc doesn't match it.
          for (const txId of r.txIds) {
            const idx = transactions.findIndex(t => t.id === txId);
            if (idx !== -1) transactions.splice(idx, 1);
          }
          results.push({ docId: doc.id, status: 'pushed' });
        } else {
          results.push({ docId: doc.id, status: r.reason });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'error';
        results.push({ docId: doc.id, status: `error:${msg}` });
      }
    }

    return NextResponse.json({ matched: pushed, pushed, total: docs.length, results });
  } catch (err) {
    console.error('Auto-push error:', err);
    return NextResponse.json({ error: 'Erreur auto-push' }, { status: 500 });
  }
}
