import { createServiceClient } from '@/lib/supabase';
import { getCurrentMonthKey } from '@/lib/types';
import { listTransactions, getMonthRange, uploadAttachment, findMatchingTransaction } from '@/lib/qonto';
import { extractDocumentData } from '@/lib/claude-extract';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const description = formData.get('description') as string || '';
    const type = (formData.get('type') as string) || 'ticket';
    const category = (formData.get('category') as string) || 'general';
    const amountCentsRaw = formData.get('amount_cents') as string | null;
    const amountCents = amountCentsRaw ? parseInt(amountCentsRaw, 10) : null;

    if (!file) {
      return NextResponse.json({ error: 'Aucun fichier fourni' }, { status: 400 });
    }

    // Validate file size (max 20MB)
    const MAX_FILE_SIZE = 20 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Fichier trop volumineux (max 20 Mo)' }, { status: 400 });
    }

    // Validate file type
    const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Type de fichier non autorisé (PDF, JPG, PNG uniquement)' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const monthKey = (formData.get('month') as string) || getCurrentMonthKey();
    const docId = crypto.randomUUID();
    const bucket = type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
    // Sanitize filename: remove # and other problematic URL characters
    const sanitizedName = file.name.replace(/[#%?&=+]/g, '_');
    const storagePath = `${monthKey}/${docId}/${sanitizedName}`;

    // Upload to Supabase Storage
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return NextResponse.json({ error: 'Erreur lors de l\'upload' }, { status: 500 });
    }

    // Insert document record
    const title = description || file.name;
    const { data, error: dbError } = await supabase
      .from('accounting_documents')
      .insert({
        id: docId,
        type,
        source: 'upload',
        title,
        description: description || null,
        storage_path: storagePath,
        file_name: sanitizedName,
        file_type: file.type,
        file_size_bytes: file.size,
        month_key: monthKey,
        category,
        amount_cents: amountCents,
        status: 'confirmed',
      })
      .select()
      .single();

    if (dbError) {
      console.error('DB insert error:', dbError);
      // Cleanup: remove uploaded file
      await supabase.storage.from(bucket).remove([storagePath]);
      return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 });
    }

    // AI extraction: extract amount, vendor, date from document content
    let extractedData = null;
    try {
      extractedData = await extractDocumentData(buffer, file.type);
      if (extractedData) {
        const updateFields: Record<string, unknown> = {
          extraction_status: 'success',
          extracted_vendor: extractedData.vendor,
          extracted_date: extractedData.document_date,
        };
        // Only fill amount/description if user didn't provide them
        if (!amountCents && extractedData.amount_cents) {
          updateFields.amount_cents = extractedData.amount_cents;
        }
        if (!description && extractedData.description) {
          updateFields.description = extractedData.description;
          updateFields.title = extractedData.description;
        }
        await supabase
          .from('accounting_documents')
          .update(updateFields)
          .eq('id', docId);
        // Update local data object for matching
        Object.assign(data, updateFields);
      } else {
        await supabase
          .from('accounting_documents')
          .update({ extraction_status: 'failed' })
          .eq('id', docId);
      }
    } catch {
      console.error('Extraction error (non-blocking)');
      await supabase
        .from('accounting_documents')
        .update({ extraction_status: 'failed' })
        .eq('id', docId);
    }

    // Auto-push to Qonto: try to match and attach to a transaction
    let qontoPushed = false;
    if (category !== 'client') {
      try {
        const { from, to } = getMonthRange(monthKey);
        const response = await listTransactions({
          bankAccountId: process.env.QONTO_BANK_ACCOUNT_ID,
          settledAtFrom: from,
          settledAtTo: to,
          status: 'completed',
          perPage: 100,
        });
        const transactions = response.transactions || [];
        const matchedTx = findMatchingTransaction(
          { ...data, type, category, extracted_vendor: extractedData?.vendor, extracted_date: extractedData?.document_date },
          transactions
        );

        if (matchedTx) {
          const fileBuffer = Buffer.from(await (await supabase.storage.from(bucket).download(storagePath)).data!.arrayBuffer());
          await uploadAttachment(matchedTx.id, fileBuffer, sanitizedName, file.type);
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
        // Non-blocking: document is still saved successfully
      }
    }

    return NextResponse.json({ document: data, qontoPushed });
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
