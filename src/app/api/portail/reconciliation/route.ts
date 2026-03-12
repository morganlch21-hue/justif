import { createServiceClient } from '@/lib/supabase';
import { validatePortailAccess } from '@/lib/portail-auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    if (!month) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 });
    }

    const { valid } = await validatePortailAccess(request);
    if (!valid) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const supabase = createServiceClient();

    const monthStart = `${month}-01T00:00:00Z`;
    const [year, m] = month.split('-').map(Number);
    const monthEnd = new Date(year, m, 1).toISOString();

    // Get all transactions with their matched documents
    const { data: transactions, error } = await supabase
      .from('accounting_qonto_transactions')
      .select('*, matched_document:accounting_documents(*)')
      .gte('settled_at', monthStart)
      .lt('settled_at', monthEnd)
      .order('settled_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const all = transactions || [];

    const matched = all.filter(t => t.side === 'debit' && t.matched_document);
    const unmatched = all.filter(t => t.side === 'debit' && !t.matched_document);
    const credits = all.filter(t => t.side === 'credit');

    return NextResponse.json({ matched, unmatched, credits });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
