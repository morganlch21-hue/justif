import { createServiceClient } from '@/lib/supabase';
import { validatePortailAccess } from '@/lib/portail-auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const type = searchParams.get('type');
    const category = searchParams.get('category');

    if (!month) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 });
    }

    const { valid } = await validatePortailAccess(request);
    if (!valid) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const supabase = createServiceClient();

    let query = supabase
      .from('accounting_documents')
      .select('*')
      .eq('month_key', month)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false });

    if (type) query = query.eq('type', type);
    if (category) query = query.eq('category', category);

    const { data: documents, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Try to fetch notes (table may not exist yet)
    const notes: Record<string, { note: string; flag: string | null }> = {};
    try {
      const { data: notesData } = await supabase
        .from('accounting_portail_notes')
        .select('document_id, note, flag')
        .in('document_id', (documents || []).map(d => d.id));

      if (notesData) {
        for (const n of notesData) {
          notes[n.document_id] = { note: n.note, flag: n.flag };
        }
      }
    } catch {
      // Table doesn't exist yet, ignore
    }

    return NextResponse.json({ documents: documents || [], notes });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
