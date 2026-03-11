import { createServiceClient } from '@/lib/supabase';
import { getCurrentMonthKey } from '@/lib/types';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const description = formData.get('description') as string || '';
    const type = (formData.get('type') as string) || 'ticket';
    const category = (formData.get('category') as string) || 'general';

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
    const storagePath = `${monthKey}/${docId}/${file.name}`;

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
        file_name: file.name,
        file_type: file.type,
        file_size_bytes: file.size,
        month_key: monthKey,
        category,
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

    return NextResponse.json({ document: data });
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
