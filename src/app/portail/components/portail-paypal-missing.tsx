'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle, ArrowDownRight, ArrowUpRight, Receipt, ChevronDown, ChevronUp } from 'lucide-react';
import type { PayPalTransaction } from '@/lib/types';

interface Props {
  token?: string;
  month: string;
  onCountChange: (count: number) => void;
}

interface FeesSummary {
  totalTransactions: number;
  totalCredits: number;
  totalDebits: number;
  totalFees: number;
  creditCount: number;
  debitCount: number;
}

function formatAmount(cents: number, currency: string) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(Math.abs(cents) / 100);
}

export function PortailPaypalMissing({ token, month, onCountChange }: Props) {
  const [missingTxs, setMissingTxs] = useState<PayPalTransaction[]>([]);
  const [allTxs, setAllTxs] = useState<PayPalTransaction[]>([]);
  const [summary, setSummary] = useState<FeesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCredits, setShowCredits] = useState(false);
  const [showDebits, setShowDebits] = useState(false);

  useEffect(() => {
    setLoading(true);
    const authParam = token ? `&token=${token}` : '';

    Promise.all([
      fetch(`/api/portail/paypal-missing?month=${month}${authParam}`).then(r => r.json()),
      fetch(`/api/portail/paypal-fees?month=${month}${authParam}`).then(r => r.json()),
    ])
      .then(([missingData, feesData]) => {
        const missing = missingData.transactions || [];
        setMissingTxs(missing);
        onCountChange(missing.length);
        setAllTxs(feesData.transactions || []);
        setSummary(feesData.summary || null);
      })
      .catch(() => {
        setMissingTxs([]);
        setAllTxs([]);
        setSummary(null);
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

  const credits = allTxs.filter(t => t.side === 'credit');
  const debits = allTxs.filter(t => t.side === 'debit');

  return (
    <div className="space-y-3">
      {/* Summary cards */}
      {summary && summary.totalTransactions > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <Card>
            <CardContent className="p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <ArrowDownRight className="h-3.5 w-3.5 text-green-500" />
                <span className="text-[10px] text-muted-foreground">Encaissements</span>
              </div>
              <p className="text-sm font-bold text-green-600">
                {formatAmount(summary.totalCredits, 'EUR')}
              </p>
              <p className="text-[10px] text-muted-foreground">{summary.creditCount} opération{summary.creditCount > 1 ? 's' : ''}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <ArrowUpRight className="h-3.5 w-3.5 text-red-500" />
                <span className="text-[10px] text-muted-foreground">Décaissements</span>
              </div>
              <p className="text-sm font-bold text-red-500">
                {formatAmount(summary.totalDebits, 'EUR')}
              </p>
              <p className="text-[10px] text-muted-foreground">{summary.debitCount} opération{summary.debitCount > 1 ? 's' : ''}</p>
            </CardContent>
          </Card>
          <Card className="border-purple-200 bg-purple-50/30">
            <CardContent className="p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Receipt className="h-3.5 w-3.5 text-purple-500" />
                <span className="text-[10px] text-muted-foreground">Frais PayPal</span>
              </div>
              <p className="text-sm font-bold text-purple-600">
                {formatAmount(summary.totalFees, 'EUR')}
              </p>
              <p className="text-[10px] text-muted-foreground">{summary.totalTransactions} transaction{summary.totalTransactions > 1 ? 's' : ''}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Missing documents alert */}
      {missingTxs.length > 0 && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-blue-500" />
              <p className="text-xs font-medium text-blue-800">
                {missingTxs.length} justificatif{missingTxs.length > 1 ? 's' : ''} PayPal manquant{missingTxs.length > 1 ? 's' : ''}
              </p>
            </div>
            <div className="space-y-1">
              {missingTxs.map(tx => (
                <div key={tx.id} className="flex items-center justify-between rounded bg-white/60 px-2 py-1.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{tx.counterparty_name || tx.counterparty_email || '—'}</span>
                    <span className="ml-2 text-muted-foreground">
                      {new Date(tx.transaction_date).toLocaleDateString('fr-FR')}
                    </span>
                  </div>
                  <span className="font-semibold text-blue-800 shrink-0">{formatAmount(tx.amount_cents, tx.currency)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {missingTxs.length === 0 && summary && summary.totalTransactions === 0 && (
        <div className="py-12 text-center">
          <CheckCircle className="mx-auto h-8 w-8 text-green-500/50" />
          <p className="mt-2 text-sm text-muted-foreground">Aucune opération PayPal ce mois</p>
        </div>
      )}

      {/* Credits (incoming payments) */}
      {credits.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <button
              onClick={() => setShowCredits(!showCredits)}
              className="w-full flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <ArrowDownRight className="h-4 w-4 text-green-500" />
                <span className="text-sm font-semibold">Encaissements</span>
                <span className="text-xs text-muted-foreground">({credits.length})</span>
              </div>
              {showCredits ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showCredits && (
              <div className="border-t divide-y">
                {credits.map(tx => (
                  <div key={tx.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{tx.counterparty_name || tx.counterparty_email || '—'}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(tx.transaction_date).toLocaleDateString('fr-FR')}
                          {tx.fee_cents > 0 && (
                            <span className="text-purple-500"> · frais: {formatAmount(tx.fee_cents, tx.currency)}</span>
                          )}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-green-600 shrink-0">
                        +{formatAmount(tx.amount_cents, tx.currency)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Debits (outgoing payments) */}
      {debits.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <button
              onClick={() => setShowDebits(!showDebits)}
              className="w-full flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-red-500" />
                <span className="text-sm font-semibold">Décaissements</span>
                <span className="text-xs text-muted-foreground">({debits.length})</span>
              </div>
              {showDebits ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showDebits && (
              <div className="border-t divide-y">
                {debits.map(tx => (
                  <div key={tx.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{tx.counterparty_name || tx.counterparty_email || '—'}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(tx.transaction_date).toLocaleDateString('fr-FR')}
                          {tx.description ? ` · ${tx.description}` : ''}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-red-500 shrink-0">
                        -{formatAmount(tx.amount_cents, tx.currency)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
