import { createServiceClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    if (!month) {
      return NextResponse.json({ error: 'Paramètre month requis' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const monthStart = `${month}-01T00:00:00Z`;
    const [year, m] = month.split('-').map(Number);
    const monthEnd = new Date(year, m, 1).toISOString();

    const { data: transactions, error } = await supabase
      .from('accounting_paypal_transactions')
      .select('*')
      .eq('side', 'debit')
      .eq('has_document', false)
      .is('matched_document_id', null)
      .gte('transaction_date', monthStart)
      .lt('transaction_date', monthEnd)
      .gt('amount_cents', 100)
      .order('transaction_date', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ transactions: transactions || [] });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { transactionId, note } = await request.json();

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId requis' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('accounting_paypal_transactions')
      .update({ note: note || null })
      .eq('id', transactionId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
