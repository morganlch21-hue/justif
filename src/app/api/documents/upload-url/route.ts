import { createServiceClient } from '@/lib/supabase';
import { getCurrentMonthKey } from '@/lib/types';
import { NextResponse } from 'next/server';

/**
 * POST /api/documents/upload-url
 * Generates a signed upload URL for direct browser → Supabase Storage upload.
 * This bypasses the Vercel WAF which blocks some PDF files.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      fileName,
      fileType,
      fileSize,
      type = 'ticket',
      category = 'general',
      monthKey,
      description,
    } = body;

    if (!fileName || !fileType) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }

    // Validate file type
    const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED_TYPES.includes(fileType)) {
      return NextResponse.json({ error: 'Type de fichier non autorisé' }, { status: 400 });
    }

    // Validate file size (max 20MB)
    if (fileSize && fileSize > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'Fichier trop volumineux (max 20 Mo)' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const month = monthKey || getCurrentMonthKey();
    const docId = crypto.randomUUID();
    const bucket = type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
    const sanitizedName = fileName.replace(/[#%?&=+]/g, '_');
    const storagePath = `${month}/${docId}/${sanitizedName}`;

    // Create signed upload URL (valid for 2 hours)
    const { data: signedData, error: signError } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (signError || !signedData) {
      console.error('Signed URL error:', signError);
      return NextResponse.json({ error: 'Erreur création URL upload' }, { status: 500 });
    }

    // Pre-create the document record in the database
    const title = description || fileName;
    const { data: doc, error: dbError } = await supabase
      .from('accounting_documents')
      .insert({
        id: docId,
        type,
        source: 'upload',
        title,
        description: description || null,
        storage_path: storagePath,
        file_name: sanitizedName,
        file_type: fileType,
        file_size_bytes: fileSize || null,
        month_key: month,
        category,
        status: 'confirmed',
      })
      .select()
      .single();

    if (dbError) {
      console.error('DB insert error:', dbError);
      return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 });
    }

    return NextResponse.json({
      uploadUrl: signedData.signedUrl,
      token: signedData.token,
      document: doc,
    });
  } catch (err) {
    console.error('Upload URL error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
