import { createServiceClient } from '@/lib/supabase';
import { getCurrentMonthKey } from '@/lib/types';
import { NextResponse } from 'next/server';

/**
 * POST /api/documents/register
 * Registers a document in the database after the client has uploaded it directly to Supabase Storage.
 * This avoids sending the file through Vercel (WAF blocks some PDFs).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      storagePath,
      fileName,
      fileType,
      fileSize,
      type = 'ticket',
      category = 'general',
      monthKey,
      description,
      amountCents,
    } = body;

    if (!storagePath || !fileName || !fileType) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const docId = crypto.randomUUID();
    const title = description || fileName;

    const { data, error: dbError } = await supabase
      .from('accounting_documents')
      .insert({
        id: docId,
        type,
        source: 'upload',
        title,
        description: description || null,
        storage_path: storagePath,
        file_name: fileName,
        file_type: fileType,
        file_size_bytes: fileSize || null,
        month_key: monthKey || getCurrentMonthKey(),
        category,
        amount_cents: amountCents || null,
        status: 'confirmed',
      })
      .select()
      .single();

    if (dbError) {
      console.error('DB insert error:', dbError);
      return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 });
    }

    return NextResponse.json({ document: data });
  } catch (err) {
    console.error('Register error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
