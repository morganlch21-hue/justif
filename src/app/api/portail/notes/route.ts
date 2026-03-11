import { createServiceClient } from '@/lib/supabase';
import { validatePortailToken } from '@/lib/portail-auth';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Token manquant' }, { status: 400 });
    }

    const { valid, tokenId } = await validatePortailToken(token);
    if (!valid || !tokenId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const { document_id, note, flag } = await request.json();

    if (!document_id) {
      return NextResponse.json({ error: 'document_id requis' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Verify document exists and is confirmed
    const { data: doc } = await supabase
      .from('accounting_documents')
      .select('id')
      .eq('id', document_id)
      .eq('status', 'confirmed')
      .maybeSingle();

    if (!doc) {
      return NextResponse.json({ error: 'Document introuvable' }, { status: 404 });
    }

    // Upsert note
    const { error } = await supabase
      .from('accounting_portail_notes')
      .upsert(
        {
          document_id,
          token_id: tokenId,
          note: note || '',
          flag: flag || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'document_id,token_id' }
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
