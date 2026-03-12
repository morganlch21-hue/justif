import { createServiceClient } from '@/lib/supabase';
import { validatePortailAccess } from '@/lib/portail-auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 });
    }

    const { valid } = await validatePortailAccess(request);
    if (!valid) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const supabase = createServiceClient();

    // Get document
    const { data: doc } = await supabase
      .from('accounting_documents')
      .select('*')
      .eq('id', id)
      .single();

    if (!doc) {
      return NextResponse.json({ error: 'Document introuvable' }, { status: 404 });
    }

    // Download file
    const bucket = doc.type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
    const { data: fileData, error } = await supabase.storage
      .from(bucket)
      .download(doc.storage_path);

    if (error || !fileData) {
      return NextResponse.json({ error: 'Fichier introuvable' }, { status: 404 });
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());

    const inline = searchParams.get('inline') === '1';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': doc.file_type,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${doc.file_name}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
