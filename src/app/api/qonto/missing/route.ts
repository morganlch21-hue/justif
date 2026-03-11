import { createServiceClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// Returns Qonto transactions that have no matching invoice/receipt
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    if (!month) {
      return NextResponse.json({ error: 'Paramètre month requis' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Get debit transactions without attachments for this month
    const monthStart = `${month}-01T00:00:00Z`;
    const [year, m] = month.split('-').map(Number);
    const nextMonth = new Date(year, m, 1);
    const monthEnd = nextMonth.toISOString();

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
