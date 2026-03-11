import { createServiceClient } from '@/lib/supabase';
import { uploadAttachment, removeAttachment, getTransaction } from '@/lib/qonto';
import { NextResponse } from 'next/server';

/**
 * Fix mismatched attachments: reassign documents to correct Qonto transactions.
 * Body: { fixes: [{ docId, correctTxId }] }
 */
export async function POST(request: Request) {
  try {
    const { fixes } = await request.json() as {
      fixes: Array<{ docId: string; correctTxId: string }>;
    };

    if (!fixes || fixes.length === 0) {
      return NextResponse.json({ error: 'No fixes provided' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const results: Array<{ docId: string; status: string; error?: string }> = [];

    for (const fix of fixes) {
      try {
        // Get document
        const { data: doc } = await supabase
          .from('accounting_documents')
          .select('*')
          .eq('id', fix.docId)
          .single();

        if (!doc) {
          results.push({ docId: fix.docId, status: 'not_found' });
          continue;
        }

        // Remove old attachment from old transaction if exists
        if (doc.qonto_transaction_id) {
          try {
            const txData = await getTransaction(doc.qonto_transaction_id);
            const tx = txData.transaction;
            if (tx?.attachment_ids?.length > 0) {
              for (const attId of tx.attachment_ids) {
                try {
                  await removeAttachment(doc.qonto_transaction_id, attId);
                } catch {
                  // May fail if already removed
                }
              }
            }
          } catch {
            // Old transaction might not exist
          }
        }

        // Download file from storage
        const bucket = doc.type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
        const { data: fileData } = await supabase.storage
          .from(bucket)
          .download(doc.storage_path);

        if (!fileData) {
          results.push({ docId: fix.docId, status: 'file_error' });
          continue;
        }

        // Upload to correct transaction
        const buffer = Buffer.from(await fileData.arrayBuffer());
        await uploadAttachment(fix.correctTxId, buffer, doc.file_name, doc.file_type);

        // Update accounting_documents
        await supabase
          .from('accounting_documents')
          .update({
            qonto_transaction_id: fix.correctTxId,
            qonto_attachment_sent: true,
            qonto_attachment_sent_at: new Date().toISOString(),
            qonto_error: null,
          })
          .eq('id', fix.docId);

        // Update accounting_qonto_transactions for the correct transaction
        await supabase
          .from('accounting_qonto_transactions')
          .update({
            has_attachment: true,
            matched_document_id: fix.docId,
          })
          .eq('qonto_id', fix.correctTxId);

        // Clear old transaction's matched state if it exists
        if (doc.qonto_transaction_id && doc.qonto_transaction_id !== fix.correctTxId) {
          await supabase
            .from('accounting_qonto_transactions')
            .update({
              has_attachment: false,
              matched_document_id: null,
            })
            .eq('qonto_id', doc.qonto_transaction_id);
        }

        results.push({ docId: fix.docId, status: 'fixed' });
      } catch (err) {
        results.push({
          docId: fix.docId,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error('Fix attachments error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
