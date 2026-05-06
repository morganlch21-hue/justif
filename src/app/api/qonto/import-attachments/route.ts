import { createServiceClient } from '@/lib/supabase';
import {
  listTransactions,
  getMonthRange,
  getAttachment,
  downloadAttachmentFile,
  type QontoTransactionAPI,
} from '@/lib/qonto';
import { extractDocument } from '@/lib/process-document';
import { getCurrentMonthKey } from '@/lib/types';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/**
 * POST /api/qonto/import-attachments?month=YYYY-MM
 *
 * Pulls every attachment Morgan has uploaded directly to Qonto for the given
 * month and inserts them as accounting_documents with source='qonto'. This
 * complements the push direction (app → Qonto) so the app's DB stays a true
 * mirror of what's attached on Qonto's side.
 *
 * Idempotent via the unique index on (qonto_attachment_id): re-running just
 * skips already-imported attachments.
 *
 * For each new attachment we also kick off `extractDocument` so the IA fills
 * in vendor/amount/date.
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || getCurrentMonthKey();

    const { from, to } = getMonthRange(month);
    const response = await listTransactions({
      bankAccountId: process.env.QONTO_BANK_ACCOUNT_ID,
      settledAtFrom: from,
      settledAtTo: to,
      status: 'completed',
      perPage: 100,
    });
    const transactions: QontoTransactionAPI[] = response.transactions || [];

    const supabase = createServiceClient();

    // Pre-fetch existing qonto_attachment_id to skip in-memory (faster than per-row UPSERT)
    const { data: existingDocs } = await supabase
      .from('accounting_documents')
      .select('qonto_attachment_id')
      .not('qonto_attachment_id', 'is', null);
    const alreadyImported = new Set(
      (existingDocs || []).map(d => d.qonto_attachment_id).filter(Boolean) as string[]
    );

    let imported = 0;
    let skipped = 0;
    let extracted = 0;
    const errors: Array<{ attachmentId: string; error: string }> = [];

    for (const tx of transactions) {
      const ids = tx.attachment_ids || [];
      if (ids.length === 0) continue;

      for (const attachmentId of ids) {
        if (alreadyImported.has(attachmentId)) {
          skipped++;
          continue;
        }

        try {
          const meta = await getAttachment(attachmentId);
          if (!ALLOWED_TYPES.has(meta.file_content_type)) {
            errors.push({ attachmentId, error: `unsupported type ${meta.file_content_type}` });
            continue;
          }

          const buffer = await downloadAttachmentFile(meta.url);

          const docId = crypto.randomUUID();
          const safeFileName = meta.file_name
            .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics (̀-ͯ)
            .replace(/[^a-zA-Z0-9._-]/g, '_');
          // All Qonto-imported invoices land in the invoice bucket regardless of side.
          // (Credits = client invoices we issued, debits = supplier invoices we paid.)
          const bucket = 'accounting-invoices';
          const storagePath = `${month}/${docId}/${safeFileName}`;

          const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(storagePath, buffer, {
              contentType: meta.file_content_type,
              upsert: false,
            });
          if (uploadError) {
            errors.push({ attachmentId, error: `storage: ${uploadError.message}` });
            continue;
          }

          // Side determines client vs supplier from this app's perspective.
          const category = tx.side === 'credit' ? 'client' : 'supplier';

          const fileSize = typeof meta.file_size === 'string'
            ? parseInt(meta.file_size, 10) || buffer.length
            : meta.file_size || buffer.length;

          const { error: dbError } = await supabase
            .from('accounting_documents')
            .insert({
              id: docId,
              type: 'invoice',
              source: 'qonto',
              title: meta.file_name,
              description: `Importé depuis Qonto (tx ${tx.id})`,
              storage_path: storagePath,
              file_name: safeFileName,
              file_type: meta.file_content_type,
              file_size_bytes: fileSize,
              month_key: month,
              category,
              status: 'confirmed',
              qonto_transaction_id: tx.id,
              qonto_attachment_id: attachmentId,
              qonto_attachment_sent: true, // it IS already attached on Qonto
              qonto_attachment_sent_at: meta.created_at,
            });
          if (dbError) {
            // Cleanup storage if DB insert failed
            await supabase.storage.from(bucket).remove([storagePath]);
            errors.push({ attachmentId, error: `db: ${dbError.message}` });
            continue;
          }

          alreadyImported.add(attachmentId);
          imported++;

          // Best-effort IA extraction (non-blocking on failure)
          try {
            await extractDocument(docId);
            extracted++;
          } catch (extractErr) {
            console.warn(`[import-attachments] extract failed for ${docId}:`, extractErr);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown';
          errors.push({ attachmentId, error: msg });
        }
      }
    }

    return NextResponse.json({
      month,
      imported,
      skipped,
      extracted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Import-attachments error:', err);
    const msg = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
