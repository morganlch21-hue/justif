import { createServiceClient } from '@/lib/supabase';
import { validatePortailToken } from '@/lib/portail-auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const token = searchParams.get('token');

    if (!month || !token) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 });
    }

    const { valid } = await validatePortailToken(token);
    if (!valid) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const supabase = createServiceClient();

    const monthStart = `${month}-01T00:00:00Z`;
    const [year, m] = month.split('-').map(Number);
    const monthEnd = new Date(year, m, 1).toISOString();

    const { data: transactions, error } = await supabase
      .from('accounting_qonto_transactions')
      .select('*')
      .eq('side', 'debit')
      .eq('has_attachment', false)
      .is('matched_document_id', null)
      .gte('settled_at', monthStart)
      .lt('settled_at', monthEnd)
      .order('settled_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ transactions: transactions || [] });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
