import { createServiceClient } from '@/lib/supabase';
import { listTransactions, getMonthRange, uploadAttachment, findMatchingTransaction } from '@/lib/qonto';
import { extractDocumentData } from '@/lib/claude-extract';
import { NextResponse } from 'next/server';

/**
 * POST /api/documents/process?id=xxx
 * Runs AI extraction + Qonto matching for a document.
 * Called async after upload to avoid Vercel 10s timeout.
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const docId = searchParams.get('id');
    if (!docId) {
      return NextResponse.json({ error: 'Missing document id' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Fetch document
    const { data: doc, error: docError } = await supabase
      .from('accounting_documents')
      .select('*')
      .eq('id', docId)
      .single();

    if (docError || !doc) {
      return NextResponse.json({ error: 'Document non trouvé' }, { status: 404 });
    }

    // Download file from storage
    const bucket = doc.type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
    const { data: fileData, error: dlError } = await supabase.storage
      .from(bucket)
      .download(doc.storage_path);

    if (dlError || !fileData) {
      return NextResponse.json({ error: 'Fichier non trouvé dans le storage' }, { status: 404 });
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());

    // AI extraction
    let extractedData = null;
    try {
      extractedData = await extractDocumentData(buffer, doc.file_type);
      if (extractedData) {
        const updateFields: Record<string, unknown> = {
          extraction_status: 'success',
          extracted_vendor: extractedData.vendor,
          extracted_date: extractedData.document_date,
        };
        if (!doc.amount_cents && extractedData.amount_cents) {
          updateFields.amount_cents = extractedData.amount_cents;
        }
        if (!doc.description && extractedData.description) {
          updateFields.description = extractedData.description;
          updateFields.title = extractedData.description;
        }
        await supabase
          .from('accounting_documents')
          .update(updateFields)
          .eq('id', docId);
        Object.assign(doc, updateFields);
      } else {
        await supabase
          .from('accounting_documents')
          .update({ extraction_status: 'failed' })
          .eq('id', docId);
      }
    } catch (extractErr) {
      console.error('Extraction error (non-blocking):', extractErr);
      await supabase
        .from('accounting_documents')
        .update({ extraction_status: 'failed' })
        .eq('id', docId);
    }

    // Auto-push to Qonto
    let qontoPushed = false;
    if (doc.category !== 'client' && !doc.qonto_attachment_sent) {
      try {
        const { from, to } = getMonthRange(doc.month_key);
        const response = await listTransactions({
          bankAccountId: process.env.QONTO_BANK_ACCOUNT_ID,
          settledAtFrom: from,
          settledAtTo: to,
          status: 'completed',
          perPage: 100,
        });
        const transactions = response.transactions || [];
        const matchedTx = findMatchingTransaction(
          {
            ...doc,
            extracted_vendor: extractedData?.vendor,
            extracted_date: extractedData?.document_date,
            extracted_datetime: extractedData?.document_datetime,
            extracted_reference: extractedData?.reference,
          },
          transactions
        );

        if (matchedTx) {
          await uploadAttachment(matchedTx.id, buffer, doc.file_name, doc.file_type);
          await supabase
            .from('accounting_documents')
            .update({
              qonto_transaction_id: matchedTx.id,
              qonto_attachment_sent: true,
              qonto_attachment_sent_at: new Date().toISOString(),
            })
            .eq('id', docId);
          qontoPushed = true;
        }
      } catch (err) {
        console.error('Auto-push to Qonto failed:', err);
      }
    }

    return NextResponse.json({
      extracted: extractedData,
      qontoPushed,
    });
  } catch (err) {
    console.error('Process error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
