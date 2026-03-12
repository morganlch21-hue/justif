'use client';

import { useState, useEffect, useCallback } from 'react';
import { MonthSelector } from '@/components/MonthSelector';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  FileText, Camera, FolderOpen,
  CheckCircle, Clock, Receipt, RefreshCw, Loader2,
  TrendingDown, TrendingUp, Send, AlertTriangle
} from 'lucide-react';
import { getCurrentMonthKey, type AccountingDocument, type QontoTransaction } from '@/lib/types';
import { toast } from 'sonner';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface DashboardStats {
  totalDocs: number;
  invoices: number;
  clientInvoices: number;
  supplierInvoices: number;
  tickets: number;
  toVerify: number;
  sentToQonto: number;
  missingInvoices: QontoTransaction[];
}

export default function DashboardPage() {
  const [month, setMonth] = useState(getCurrentMonthKey());
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showAllMissing, setShowAllMissing] = useState(false);

  const fetchStats = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/documents?month=${month}`);
      const { documents } = await res.json() as { documents: AccountingDocument[] };
      const docs = documents || [];

      let missing: QontoTransaction[] = [];
      try {
        const qRes = await fetch(`/api/qonto/missing?month=${month}`);
        if (qRes.ok) {
          const qData = await qRes.json();
          missing = qData.transactions || [];
        }
      } catch { /* Qonto not configured yet */ }

      setStats({
        totalDocs: docs.length,
        invoices: docs.filter(d => d.type === 'invoice').length,
        clientInvoices: docs.filter(d => d.type === 'invoice' && d.category === 'client').length,
        supplierInvoices: docs.filter(d => d.type === 'invoice' && d.category !== 'client').length,
        tickets: docs.filter(d => d.type === 'ticket').length,
        toVerify: docs.filter(d => d.status === 'to_verify').length,
        sentToQonto: docs.filter(d => d.qonto_attachment_sent).length,
        missingInvoices: missing,
      });
    } catch {
      toast.error('Erreur de chargement');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchStats();
    // Background sync: silently sync Qonto on page load without blocking UI
    fetch(`/api/qonto/sync?month=${month}`, { method: 'POST' })
      .then(() => fetchStats(true))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchStats]);

  async function autoPushQonto() {
    setSyncing(true);
    try {
      await fetch(`/api/qonto/sync?month=${month}`, { method: 'POST' });
      const res = await fetch(`/api/qonto/auto-push?month=${month}`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        if (data.pushed > 0) {
          toast.success(`${data.pushed} facture(s) envoyée(s) sur Qonto`);
        } else {
          toast.info('Aucune nouvelle facture à envoyer');
        }
        fetchStats();
      } else {
        toast.error(data.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur Qonto');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="px-4 py-4">
        <div className="mx-auto flex max-w-4xl items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Justif</h1>
              <p className="text-xs text-muted-foreground">ML Consulting</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 pb-24 animate-fade-in">
        {/* Month selector */}
        <div className="flex items-center justify-between">
          <MonthSelector value={month} onChange={setMonth} />
          <Button variant="outline" size="sm" onClick={autoPushQonto} disabled={syncing}>
            {syncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            Sync Qonto
          </Button>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { href: '/ticket', icon: Camera, label: 'Ticket', color: 'text-primary', bg: 'bg-primary/10' },
            { href: '/documents', icon: FolderOpen, label: 'Docs', color: 'text-blue-500', bg: 'bg-blue-50' },
            { href: '/documents', icon: Clock, label: 'Vérifier', color: 'text-amber-500', bg: 'bg-amber-50', badge: stats?.toVerify },
            { href: '#', icon: Receipt, label: 'Qonto', color: 'text-green-600', bg: 'bg-green-50', onClick: autoPushQonto },
          ].map((action) => (
            <Link key={action.label} href={action.href} onClick={action.onClick ? (e) => { e.preventDefault(); action.onClick(); } : undefined}>
              <Card className="cursor-pointer transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]">
                <CardContent className="flex flex-col items-center gap-1.5 p-3 relative">
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", action.bg)}>
                    <action.icon className={cn("h-5 w-5", action.color)} />
                  </div>
                  <span className="text-[11px] font-medium">{action.label}</span>
                  {action.badge && action.badge > 0 && (
                    <span className="absolute right-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
                      {action.badge}
                    </span>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Stats */}
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-4 w-16 mb-2" />
                  <Skeleton className="h-7 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : stats && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                      <FolderOpen className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <span className="text-xs text-muted-foreground">Documents</span>
                  </div>
                  <p className="text-xl font-bold tracking-tight">{stats.totalDocs}</p>
                  <p className="text-[10px] text-muted-foreground">{stats.supplierInvoices} fourn. · {stats.clientInvoices} clients · {stats.tickets} tickets</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-50">
                      <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                    </div>
                    <span className="text-xs text-muted-foreground">Fournisseurs</span>
                  </div>
                  <p className="text-xl font-bold tracking-tight">{stats.supplierInvoices}</p>
                  <p className="text-[10px] text-muted-foreground">factures fournisseur</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-50">
                      <TrendingUp className="h-3.5 w-3.5 text-green-600" />
                    </div>
                    <span className="text-xs text-muted-foreground">Clients</span>
                  </div>
                  <p className="text-xl font-bold tracking-tight">{stats.clientInvoices}</p>
                  <p className="text-[10px] text-muted-foreground">factures client</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50">
                      <Send className="h-3.5 w-3.5 text-blue-500" />
                    </div>
                    <span className="text-xs text-muted-foreground">Qonto</span>
                  </div>
                  <p className="text-xl font-bold tracking-tight">{stats.sentToQonto}</p>
                  <p className="text-[10px] text-muted-foreground">envoyés sur Qonto</p>
                </CardContent>
              </Card>
            </div>

            {/* Missing invoices alert */}
            {stats.missingInvoices.length > 0 && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <p className="text-sm font-medium text-amber-900">
                      {stats.missingInvoices.length} paiement(s) sans facture
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {(showAllMissing ? stats.missingInvoices : stats.missingInvoices.slice(0, 5)).map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between rounded-lg bg-white/60 px-3 py-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <span className="font-medium truncate">{tx.counterparty_name || 'Inconnu'}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {new Date(tx.settled_at).toLocaleDateString('fr-FR')}
                          </span>
                        </div>
                        <span className="font-semibold tabular-nums text-amber-800 text-sm shrink-0">
                          {(Math.abs(tx.amount_cents) / 100).toFixed(2)} €
                        </span>
                      </div>
                    ))}
                    {stats.missingInvoices.length > 5 && !showAllMissing && (
                      <button
                        onClick={() => setShowAllMissing(true)}
                        className="text-xs text-amber-600 pl-3 hover:text-amber-800 hover:underline cursor-pointer"
                      >
                        + {stats.missingInvoices.length - 5} autre(s)
                      </button>
                    )}
                    {showAllMissing && stats.missingInvoices.length > 5 && (
                      <button
                        onClick={() => setShowAllMissing(false)}
                        className="text-xs text-amber-600 pl-3 hover:text-amber-800 hover:underline cursor-pointer"
                      >
                        Voir moins
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {stats.totalDocs === 0 && stats.missingInvoices.length === 0 && (
              <Card>
                <CardContent className="py-16 text-center">
                  <CheckCircle className="mx-auto h-12 w-12 text-green-500/40" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Aucun document ce mois-ci. Les factures reçues par email apparaîtront automatiquement.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
