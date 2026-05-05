import { validatePortailAccess } from '@/lib/portail-auth';
import { createServiceClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const auth = await validatePortailAccess(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

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
      .gte('transaction_date', monthStart)
      .lt('transaction_date', monthEnd)
      .order('transaction_date', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const txs = transactions || [];
    const credits = txs.filter(t => t.side === 'credit');
    const debits = txs.filter(t => t.side === 'debit');
    const totalFees = txs.reduce((sum, t) => sum + (t.fee_cents || 0), 0);
    const totalCredits = credits.reduce((sum, t) => sum + t.amount_cents, 0);
    const totalDebits = debits.reduce((sum, t) => sum + t.amount_cents, 0);

    return NextResponse.json({
      transactions: txs,
      summary: {
        totalTransactions: txs.length,
        totalCredits,
        totalDebits,
        totalFees,
        creditCount: credits.length,
        debitCount: debits.length,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
