'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import type { QontoTransaction } from '@/lib/types';

interface Props {
  token: string;
  month: string;
  onCountChange: (count: number) => void;
}

function formatEUR(cents: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Math.abs(cents) / 100);
}

export function PortailMissing({ token, month, onCountChange }: Props) {
  const [transactions, setTransactions] = useState<QontoTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/portail/missing?month=${month}&token=${token}`)
      .then(r => r.json())
      .then(data => {
        const txs = data.transactions || [];
        setTransactions(txs);
        onCountChange(txs.length);
      })
      .catch(() => {
        setTransactions([]);
        onCountChange(0);
      })
      .finally(() => setLoading(false));
  }, [month, token, onCountChange]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="py-12 text-center">
        <CheckCircle className="mx-auto h-8 w-8 text-green-500/50" />
        <p className="mt-2 text-sm text-muted-foreground">Tous les justificatifs sont présents</p>
      </div>
    );
  }

  const totalMissing = transactions.reduce((s, t) => s + Math.abs(t.amount_cents), 0);

  return (
    <div className="space-y-3">
      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <p className="text-xs font-medium text-amber-800">
              {transactions.length} justificatif{transactions.length > 1 ? 's' : ''} manquant{transactions.length > 1 ? 's' : ''}
            </p>
          </div>
          <span className="text-xs font-bold text-amber-800">{formatEUR(totalMissing)}</span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 divide-y">
          {transactions.map(tx => {
            const isHigh = Math.abs(tx.amount_cents) >= 50000; // >= 500€
            return (
              <div key={tx.id} className={`px-4 py-3 ${isHigh ? 'bg-red-50/50' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {tx.counterparty_name || '—'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(tx.settled_at).toLocaleDateString('fr-FR')}
                      {tx.label ? ` · ${tx.label}` : ''}
                    </p>
                  </div>
                  <span className={`text-sm font-semibold shrink-0 ${isHigh ? 'text-red-600' : 'text-foreground'}`}>
                    {formatEUR(tx.amount_cents)}
                  </span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
