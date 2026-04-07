import { createServiceClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// Link a document to a PayPal transaction (database-only, no file upload to PayPal)
export async function POST(request: Request) {
  try {
    const { documentId, paypalTransactionId } = await request.json();

    if (!documentId || !paypalTransactionId) {
      return NextResponse.json({ error: 'documentId et paypalTransactionId requis' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Update document
    const { error: docError } = await supabase
      .from('accounting_documents')
      .update({ paypal_transaction_id: paypalTransactionId })
      .eq('id', documentId);

    if (docError) {
      return NextResponse.json({ error: docError.message }, { status: 500 });
    }

    // Update PayPal transaction
    const { error: txError } = await supabase
      .from('accounting_paypal_transactions')
      .update({
        has_document: true,
        matched_document_id: documentId,
      })
      .eq('paypal_id', paypalTransactionId);

    if (txError) {
      return NextResponse.json({ error: txError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
