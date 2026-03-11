import { listTransactions, getMonthRange } from '@/lib/qonto';
import { type NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const month = request.nextUrl.searchParams.get('month');

    if (!month) {
      return NextResponse.json({ error: 'Paramètre month requis' }, { status: 400 });
    }

    const { from, to } = getMonthRange(month);

    const data = await listTransactions({
      bankAccountId: process.env.QONTO_BANK_ACCOUNT_ID,
      settledAtFrom: from,
      settledAtTo: to,
      status: 'completed',
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error('Qonto transactions error:', err);
    return NextResponse.json({ error: 'Erreur Qonto API' }, { status: 500 });
  }
}
