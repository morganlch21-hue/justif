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

    // Get confirmed documents for this month
    const { data: docs } = await supabase
      .from('accounting_documents')
      .select('type, category, amount_cents')
      .eq('month_key', month)
      .eq('status', 'confirmed');

    const allDocs = docs || [];
    const supplierDocs = allDocs.filter(d => d.type === 'invoice' && d.category === 'supplier');
    const clientDocs = allDocs.filter(d => d.type === 'invoice' && d.category === 'client');
    const ticketDocs = allDocs.filter(d => d.type === 'ticket');

    const sumAmount = (arr: typeof allDocs) =>
      arr.reduce((sum, d) => sum + (d.amount_cents || 0), 0);

    // Get Qonto transactions for this month
    const monthStart = `${month}-01T00:00:00Z`;
    const [year, m] = month.split('-').map(Number);
    const monthEnd = new Date(year, m, 1).toISOString();

    const { data: transactions } = await supabase
      .from('accounting_qonto_transactions')
      .select('side, has_attachment, matched_document_id')
      .gte('settled_at', monthStart)
      .lt('settled_at', monthEnd);

    const allTx = transactions || [];
    const debitTx = allTx.filter(t => t.side === 'debit');
    const missingTx = debitTx.filter(t => !t.has_attachment && !t.matched_document_id);
    const matchedTx = debitTx.filter(t => t.has_attachment || t.matched_document_id);

    const reconciliationRate = debitTx.length > 0
      ? Math.round((matchedTx.length / debitTx.length) * 100)
      : 100;

    return NextResponse.json({
      summary: {
        totalDocs: allDocs.length,
        supplierCount: supplierDocs.length,
        supplierAmount: sumAmount(supplierDocs),
        clientCount: clientDocs.length,
        clientAmount: sumAmount(clientDocs),
        ticketCount: ticketDocs.length,
        totalDebitTransactions: debitTx.length,
        missingCount: missingTx.length,
        reconciliationRate,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
