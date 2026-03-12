'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, CheckCircle2, AlertCircle, ArrowUpRight, ChevronDown, ChevronUp } from 'lucide-react';

interface Transaction {
  id: string;
  counterparty_name: string | null;
  label: string | null;
  amount_cents: number;
  currency: string;
  settled_at: string;
  side: string;
  matched_document: {
    id: string;
    title: string;
    file_name: string;
  } | null;
}

interface Props {
  token?: string;
  month: string;
}

function formatEUR(cents: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Math.abs(cents) / 100);
}

function Section({
  title,
  icon: Icon,
  color,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ElementType;
  color: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card>
      <CardContent className="p-0">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${color}`} />
            <span className="text-sm font-semibold">{title}</span>
            <span className="text-xs text-muted-foreground">({count})</span>
          </div>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {open && count > 0 && <div className="border-t divide-y">{children}</div>}
      </CardContent>
    </Card>
  );
}

export function PortailReconciliation({ token, month }: Props) {
  const [matched, setMatched] = useState<Transaction[]>([]);
  const [unmatched, setUnmatched] = useState<Transaction[]>([]);
  const [credits, setCredits] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/portail/reconciliation?month=${month}${token ? `&token=${token}` : ''}`)
      .then(r => r.json())
      .then(data => {
        setMatched(data.matched || []);
        setUnmatched(data.unmatched || []);
        setCredits(data.credits || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month, token]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Section title="Rapproché" icon={CheckCircle2} color="text-green-600" count={matched.length}>
        {matched.map(tx => (
          <div key={tx.id} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{tx.counterparty_name || tx.label || '—'}</p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(tx.settled_at).toLocaleDateString('fr-FR')}
                  {' · '}{formatEUR(tx.amount_cents)}
                </p>
              </div>
              {tx.matched_document && (
                <a href={`/api/portail/download?id=${tx.matched_document.id}${token ? `&token=${token}` : ''}`}>
                  <Button variant="ghost" size="sm" className="text-xs text-primary shrink-0">
                    <Download className="mr-1 h-3 w-3" />
                    {tx.matched_document.title.slice(0, 20)}
                  </Button>
                </a>
              )}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Non rapproché — Débits" icon={AlertCircle} color="text-amber-500" count={unmatched.length}>
        {unmatched.map(tx => (
          <div key={tx.id} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{tx.counterparty_name || tx.label || '—'}</p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(tx.settled_at).toLocaleDateString('fr-FR')}
                  {tx.label && tx.counterparty_name ? ` · ${tx.label}` : ''}
                </p>
              </div>
              <span className="text-sm font-semibold text-red-500 shrink-0">
                -{formatEUR(tx.amount_cents)}
              </span>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Crédits" icon={ArrowUpRight} color="text-blue-500" count={credits.length} defaultOpen={false}>
        {credits.map(tx => (
          <div key={tx.id} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{tx.counterparty_name || tx.label || '—'}</p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(tx.settled_at).toLocaleDateString('fr-FR')}
                </p>
              </div>
              <span className="text-sm font-semibold text-green-600 shrink-0">
                +{formatEUR(tx.amount_cents)}
              </span>
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}
