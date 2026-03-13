import { createServiceClient } from '@/lib/supabase';
import { listTransactions, getMonthRange, uploadAttachment, findMatchingTransaction, findAllMatchingTransactions, getMultiTxPatterns, isNoMatchVendor, type QontoTransactionAPI } from '@/lib/qonto';
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
        // Auto-ignorer les documents qui ne sont pas des factures
        // (pas de montant ET pas de fournisseur = screenshot, email, notification...)
        const finalAmount = extractedData.amount_cents || doc.amount_cents;
        const finalVendor = extractedData.vendor;
        if (!finalAmount && !finalVendor) {
          updateFields.status = 'ignored';
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
    const vendor = extractedData?.vendor || doc.extracted_vendor;

    if (doc.category !== 'client' && !doc.qonto_attachment_sent && doc.status !== 'ignored') {
      // --- CAS 1: Vendor sans débit Qonto (ex: GoCardless frais déduits des virements) ---
      if (isNoMatchVendor(vendor)) {
        console.log(`[process] No-match vendor detected: ${vendor}, skipping Qonto push`);
        await supabase
          .from('accounting_documents')
          .update({ status: 'no_qonto_match' })
          .eq('id', docId);
      } else {
        try {
          // Déterminer les mois à chercher
          const extractedDateStr = extractedData?.document_date || doc.extracted_date;
          const monthsToSearch: string[] = [doc.month_key];
          if (extractedDateStr) {
            const m = extractedDateStr.match(/^(\d{4}-\d{2})/);
            if (m && !monthsToSearch.includes(m[1])) {
              monthsToSearch.push(m[1]);
              const day = parseInt(extractedDateStr.substring(8, 10));
              if (day >= 20) {
                const [y, mo] = m[1].split('-').map(Number);
                const nextMonth = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
                if (!monthsToSearch.includes(nextMonth)) monthsToSearch.push(nextMonth);
              }
            }
          }

          // Récupérer les transactions de tous les mois pertinents
          let allTransactions: QontoTransactionAPI[] = [];
          for (const mk of monthsToSearch) {
            const { from, to } = getMonthRange(mk);
            const response = await listTransactions({
              bankAccountId: process.env.QONTO_BANK_ACCOUNT_ID,
              settledAtFrom: from,
              settledAtTo: to,
              status: 'completed',
              perPage: 100,
            });
            allTransactions = allTransactions.concat(response.transactions || []);
          }
          // Dédupliquer par ID
          const seen = new Set<string>();
          const transactions = allTransactions.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });

          // --- CAS 2: Vendor multi-transactions (ex: Google Ads mensuel → plusieurs prélèvements) ---
          const multiTxPatterns = getMultiTxPatterns(vendor);
          if (multiTxPatterns) {
            const matchedTxs = findAllMatchingTransactions(multiTxPatterns, transactions);
            console.log(`[process] Multi-tx vendor "${vendor}": found ${matchedTxs.length} transactions`);
            if (matchedTxs.length > 0) {
              const txIds: string[] = [];
              for (const tx of matchedTxs) {
                try {
                  await uploadAttachment(tx.id, buffer, doc.file_name, doc.file_type);
                  txIds.push(tx.id);
                } catch (uploadErr) {
                  console.warn(`[process] Failed to upload to tx ${tx.id}:`, uploadErr);
                }
              }
              if (txIds.length > 0) {
                const updateData: Record<string, unknown> = {
                  qonto_transaction_id: txIds[0],
                  qonto_attachment_sent: true,
                  qonto_attachment_sent_at: new Date().toISOString(),
                };
                // Store all tx IDs if column exists (graceful)
                try {
                  await supabase
                    .from('accounting_documents')
                    .update({ ...updateData, qonto_multi_tx_ids: txIds })
                    .eq('id', docId);
                } catch {
                  await supabase
                    .from('accounting_documents')
                    .update(updateData)
                    .eq('id', docId);
                }
                qontoPushed = true;
              }
            }
          } else {
            // --- CAS 3: Matching normal (1 facture → 1 transaction) ---
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
          }
        } catch (err) {
          console.error('Auto-push to Qonto failed:', err);
        }
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
