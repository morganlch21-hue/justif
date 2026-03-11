'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { FileText, TrendingDown, TrendingUp, Link2, AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { PortailSummary as SummaryType } from '@/lib/types';

interface Props {
  token: string;
  month: string;
}

function formatEUR(cents: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

export function PortailSummary({ token, month }: Props) {
  const [summary, setSummary] = useState<SummaryType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/portail/summary?month=${month}&token=${token}`)
      .then(r => r.json())
      .then(data => setSummary(data.summary))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [month, token]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map(i => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-4 w-16 mb-2" />
              <Skeleton className="h-7 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!summary) return null;

  const cards = [
    {
      label: 'Documents',
      value: String(summary.totalDocs),
      sub: `${summary.supplierCount} fourn. · ${summary.clientCount} clients · ${summary.ticketCount} tickets`,
      icon: FileText,
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Charges',
      value: formatEUR(summary.supplierAmount),
      sub: `${summary.supplierCount} factures fournisseur`,
      icon: TrendingDown,
      color: 'text-red-500',
      bg: 'bg-red-50',
    },
    {
      label: 'Revenus',
      value: formatEUR(summary.clientAmount),
      sub: `${summary.clientCount} factures client`,
      icon: TrendingUp,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      label: 'Rapprochement',
      value: `${summary.reconciliationRate}%`,
      sub: `${summary.totalDebitTransactions} transactions`,
      icon: Link2,
      color: summary.reconciliationRate >= 90 ? 'text-green-600' : summary.reconciliationRate >= 70 ? 'text-amber-500' : 'text-red-500',
      bg: summary.reconciliationRate >= 90 ? 'bg-green-50' : summary.reconciliationRate >= 70 ? 'bg-amber-50' : 'bg-red-50',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {cards.map(card => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${card.bg}`}>
                  <card.icon className={`h-3.5 w-3.5 ${card.color}`} />
                </div>
                <span className="text-xs text-muted-foreground">{card.label}</span>
              </div>
              <p className="text-lg font-bold tracking-tight">{card.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{card.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {summary.missingCount > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <p className="text-xs font-medium text-amber-800">
              {summary.missingCount} transaction{summary.missingCount > 1 ? 's' : ''} bancaire{summary.missingCount > 1 ? 's' : ''} sans justificatif
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
