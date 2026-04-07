import { createServiceClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

/**
 * Auto-match: find confirmed documents that match unmatched PayPal transactions
 * by vendor name + approximate amount (±15% for USD/EUR conversion).
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    if (!month) {
      return NextResponse.json({ error: 'Paramètre month requis' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const monthStart = `${month}-01T00:00:00Z`;
    const [year, m] = month.split('-').map(Number);
    const monthEnd = new Date(year, m, 1).toISOString();

    // Get unmatched PayPal transactions (debits without documents)
    const { data: paypalTxs } = await supabase
      .from('accounting_paypal_transactions')
      .select('*')
      .eq('side', 'debit')
      .eq('has_document', false)
      .is('matched_document_id', null)
      .gte('transaction_date', monthStart)
      .lt('transaction_date', monthEnd)
      .gt('amount_cents', 100)
      .order('transaction_date', { ascending: false });

    if (!paypalTxs || paypalTxs.length === 0) {
      return NextResponse.json({ matched: 0, total: 0, message: 'Aucune transaction PayPal à rapprocher' });
    }

    // Get confirmed documents for this month that are not yet linked to a PayPal transaction
    const { data: docs } = await supabase
      .from('accounting_documents')
      .select('*')
      .eq('month_key', month)
      .eq('status', 'confirmed')
      .is('paypal_transaction_id', null);

    if (!docs || docs.length === 0) {
      return NextResponse.json({ matched: 0, total: paypalTxs.length, message: 'Aucun document disponible' });
    }

    let matched = 0;
    const results: Array<{ txId: string; docId: string; vendor: string; amount: number; status: string }> = [];
    const usedDocIds = new Set<string>();
    const usedTxIds = new Set<string>();

    for (const tx of paypalTxs) {
      if (usedTxIds.has(tx.id)) continue;

      const txVendor = (tx.counterparty_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const txEmail = (tx.counterparty_email || '').toLowerCase();

      let bestDoc: (typeof docs)[0] | null = null;
      let bestScore = 0;

      for (const doc of docs) {
        if (usedDocIds.has(doc.id)) continue;

        let score = 0;
        let hasVendorMatch = false;
        let hasAmountMatch = false;

        // --- VENDOR MATCHING ---
        const docVendor = (doc.extracted_vendor || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const docTitle = (doc.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        if (txVendor && docVendor && (txVendor.includes(docVendor) || docVendor.includes(txVendor))) {
          score += 5;
          hasVendorMatch = true;
        } else if (txVendor && docTitle && (txVendor.includes(docTitle) || docTitle.includes(txVendor))) {
          score += 4;
          hasVendorMatch = true;
        }
        // Check email sender for vendor match
        if (!hasVendorMatch && txEmail && doc.gmail_sender) {
          const senderDomain = doc.gmail_sender.toLowerCase().split('@')[1] || '';
          if (txEmail.includes(senderDomain.split('.')[0]) || senderDomain.includes(txVendor)) {
            score += 3;
            hasVendorMatch = true;
          }
        }

        // --- AMOUNT MATCHING ---
        if (doc.amount_cents && doc.amount_cents > 0) {
          const sameCurrency = doc.currency && tx.currency && doc.currency.toUpperCase() === tx.currency.toUpperCase();

          if (tx.amount_cents === doc.amount_cents) {
            // Exact match — higher score if same currency
            score += sameCurrency ? 12 : 10;
            hasAmountMatch = true;
          } else {
            // Approximate match (±15% tolerance for USD/EUR conversion)
            const ratio = tx.amount_cents / doc.amount_cents;
            if (ratio >= 0.85 && ratio <= 1.15) {
              score += sameCurrency ? 8 : 6;
              hasAmountMatch = true;
            }
          }
        }

        // --- DATE PROXIMITY ---
        if (doc.extracted_date) {
          const txDate = new Date(tx.transaction_date).getTime();
          const docDate = new Date(doc.extracted_date).getTime();
          const daysDiff = Math.abs(txDate - docDate) / (1000 * 60 * 60 * 24);
          if (daysDiff <= 2) score += 3;
          else if (daysDiff <= 7) score += 1;
        }

        // Only consider if we have at least vendor OR amount match
        // Require minimum score of 10 for safety (avoid false positives)
        if ((hasVendorMatch || hasAmountMatch) && score >= 10 && score > bestScore) {
          bestScore = score;
          bestDoc = doc;
        }
      }

      if (bestDoc) {
        // Link document to PayPal transaction
        const { error: docError } = await supabase
          .from('accounting_documents')
          .update({ paypal_transaction_id: tx.paypal_id })
          .eq('id', bestDoc.id);

        const { error: txError } = await supabase
          .from('accounting_paypal_transactions')
          .update({
            has_document: true,
            matched_document_id: bestDoc.id,
          })
          .eq('id', tx.id);

        if (!docError && !txError) {
          matched++;
          usedDocIds.add(bestDoc.id);
          usedTxIds.add(tx.id);
          results.push({
            txId: tx.paypal_id,
            docId: bestDoc.id,
            vendor: tx.counterparty_name || 'Inconnu',
            amount: tx.amount_cents / 100,
            status: 'matched',
          });
        } else {
          results.push({
            txId: tx.paypal_id,
            docId: bestDoc.id,
            vendor: tx.counterparty_name || 'Inconnu',
            amount: tx.amount_cents / 100,
            status: 'error',
          });
        }
      } else {
        results.push({
          txId: tx.paypal_id,
          docId: '',
          vendor: tx.counterparty_name || 'Inconnu',
          amount: tx.amount_cents / 100,
          status: 'no_match',
        });
      }
    }

    return NextResponse.json({ matched, total: paypalTxs.length, results });
  } catch (err) {
    console.error('PayPal auto-match error:', err);
    return NextResponse.json({ error: 'Erreur auto-match PayPal' }, { status: 500 });
  }
}
