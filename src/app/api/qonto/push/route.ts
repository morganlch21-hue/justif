import { createServiceClient } from '@/lib/supabase';
import { uploadAttachment } from '@/lib/qonto';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { documentId, qontoTransactionId } = await request.json();

    if (!documentId || !qontoTransactionId) {
      return NextResponse.json(
        { error: 'documentId et qontoTransactionId requis' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Get document
    const { data: doc, error: docError } = await supabase
      .from('accounting_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !doc) {
      return NextResponse.json({ error: 'Document introuvable' }, { status: 404 });
    }

    // Download file from storage
    const bucket = doc.type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(doc.storage_path);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: 'Fichier introuvable' }, { status: 404 });
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());

    // Push to Qonto
    await uploadAttachment(
      qontoTransactionId,
      buffer,
      doc.file_name,
      doc.file_type
    );

    // Update document record
    await supabase
      .from('accounting_documents')
      .update({
        qonto_transaction_id: qontoTransactionId,
        qonto_attachment_sent: true,
        qonto_attachment_sent_at: new Date().toISOString(),
        qonto_error: null,
      })
      .eq('id', documentId);

    return NextResponse.json({ success: true });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue';

    // Save error to document if we have the ID
    try {
      const { documentId } = await request.clone().json();
      if (documentId) {
        const supabase = createServiceClient();
        await supabase
          .from('accounting_documents')
          .update({ qonto_error: errorMessage })
          .eq('id', documentId);
      }
    } catch { /* ignore */ }

    console.error('Qonto push error:', err);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
