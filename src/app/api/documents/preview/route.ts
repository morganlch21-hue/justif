import { createServiceClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// Generate a signed URL for document preview
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID manquant' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: doc } = await supabase
      .from('accounting_documents')
      .select('storage_path, type, file_name, file_type')
      .eq('id', id)
      .single();

    if (!doc) {
      return NextResponse.json({ error: 'Document introuvable' }, { status: 404 });
    }

    const bucket = doc.type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
    const { data: signedUrl, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(doc.storage_path, 3600); // 1 hour

    if (error || !signedUrl) {
      return NextResponse.json({ error: 'Erreur de génération du lien' }, { status: 500 });
    }

    return NextResponse.json({
      url: signedUrl.signedUrl,
      fileName: doc.file_name,
      fileType: doc.file_type,
    });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
