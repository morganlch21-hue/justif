import { createServiceClient } from '@/lib/supabase';
import { createHash } from 'crypto';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const token = searchParams.get('token');

    if (!id || !token) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Validate token
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { data: validToken } = await supabase
      .from('accounting_portail_tokens')
      .select('id')
      .eq('token_hash', tokenHash)
      .eq('is_active', true)
      .maybeSingle();

    if (!validToken) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

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
