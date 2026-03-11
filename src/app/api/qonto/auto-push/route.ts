import { createServiceClient } from '@/lib/supabase';
import { listTransactions, getMonthRange, uploadAttachment, findMatchingTransaction, type QontoTransactionAPI } from '@/lib/qonto';
import { NextResponse } from 'next/server';

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

    // Get confirmed supplier docs not yet sent to Qonto
    let query = supabase
      .from('accounting_documents')
      .select('*')
      .eq('status', 'confirmed')
      .eq('qonto_attachment_sent', false)
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

    // Collect all months we need transactions for
    const monthKeys = Array.from(new Set(docs.map(d => d.month_key)));
    const allTransactions: QontoTransactionAPI[] = [];

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
        allTransactions.push(...(response.transactions || []));
      } catch {
        // Continue with other months
      }
    }

    let matched = 0;
    let pushed = 0;
    const results: Array<{ docId: string; title: string; txLabel: string | null; status: string }> = [];

    for (const doc of docs) {
      // Skip client invoices (outgoing)
      if (doc.category === 'client') continue;

      const matchedTx = findMatchingTransaction(
        { ...doc, type: doc.type, category: doc.category },
        allTransactions
      );

      if (!matchedTx) {
        results.push({ docId: doc.id, title: doc.title, txLabel: null, status: 'no_match' });
        continue;
      }

      matched++;

      // Download file from storage
      const bucket = doc.type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
      const { data: fileData } = await supabase.storage
        .from(bucket)
        .download(doc.storage_path);

      if (!fileData) {
        results.push({ docId: doc.id, title: doc.title, txLabel: matchedTx.label, status: 'file_error' });
        continue;
      }

      try {
        const buffer = Buffer.from(await fileData.arrayBuffer());
        await uploadAttachment(matchedTx.id, buffer, doc.file_name, doc.file_type);

        // Mark as sent
        await supabase
          .from('accounting_documents')
          .update({
            qonto_transaction_id: matchedTx.id,
            qonto_attachment_sent: true,
            qonto_attachment_sent_at: new Date().toISOString(),
            qonto_error: null,
          })
          .eq('id', doc.id);

        // Remove this transaction from candidates (already matched)
        const idx = allTransactions.findIndex(t => t.id === matchedTx.id);
        if (idx !== -1) allTransactions.splice(idx, 1);

        pushed++;
        results.push({ docId: doc.id, title: doc.title, txLabel: matchedTx.label, status: 'pushed' });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        await supabase
          .from('accounting_documents')
          .update({ qonto_error: errorMsg })
          .eq('id', doc.id);
        results.push({ docId: doc.id, title: doc.title, txLabel: matchedTx.label, status: 'push_error' });
      }
    }

    return NextResponse.json({ matched, pushed, total: docs.length, results });
  } catch (err) {
    console.error('Auto-push error:', err);
    return NextResponse.json({ error: 'Erreur auto-push' }, { status: 500 });
  }
}
