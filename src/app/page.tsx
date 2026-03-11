'use client';

import { useState, useEffect, useCallback } from 'react';
import { MonthSelector } from '@/components/MonthSelector';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  FileText, Camera, FolderOpen,
  CheckCircle, Clock, Receipt, RefreshCw, Loader2
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

  const fetchStats = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchStats();
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Link href="/ticket">
            <Card className="cursor-pointer transition-all duration-200 hover:apple-shadow-hover hover:scale-[1.02]">
              <CardContent className="flex flex-col items-center gap-2.5 p-5">
                <Camera className="h-7 w-7 text-primary" />
                <span className="text-sm font-medium">Ticket resto</span>
              </CardContent>
            </Card>
          </Link>
          <Link href="/documents">
            <Card className="cursor-pointer transition-all duration-200 hover:apple-shadow-hover hover:scale-[1.02]">
              <CardContent className="flex flex-col items-center gap-2.5 p-5">
                <FolderOpen className="h-7 w-7 text-primary" />
                <span className="text-sm font-medium">Documents</span>
              </CardContent>
            </Card>
          </Link>
          <Link href="/documents">
            <Card className="cursor-pointer transition-all duration-200 hover:apple-shadow-hover hover:scale-[1.02]">
              <CardContent className="flex flex-col items-center gap-2.5 p-5 relative">
                <Clock className="h-7 w-7 text-amber-500" />
                <span className="text-sm font-medium">À vérifier</span>
                {stats && stats.toVerify > 0 && (
                  <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-semibold text-white">
                    {stats.toVerify}
                  </span>
                )}
              </CardContent>
            </Card>
          </Link>
          <Card className="cursor-pointer transition-all duration-200 hover:apple-shadow-hover hover:scale-[1.02]" onClick={autoPushQonto}>
            <CardContent className="flex flex-col items-center gap-2.5 p-5">
              <Receipt className="h-7 w-7 text-primary" />
              <span className="text-sm font-medium">Sync Qonto</span>
            </CardContent>
          </Card>
        </div>

        {/* Stats */}
        {loading ? (
          <Card>
            <CardContent className="p-0">
              <div className="grid grid-cols-2 sm:grid-cols-5">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className={cn("p-5 text-center", i > 0 && "border-l")}>
                    <Skeleton className="mx-auto h-8 w-12 rounded-lg" />
                    <Skeleton className="mx-auto mt-2 h-3 w-16 rounded" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : stats && (
          <>
            <Card>
              <CardContent className="p-0">
                <div className="grid grid-cols-2 sm:grid-cols-5">
                  <div className="p-5 text-center">
                    <p className="text-3xl font-semibold tracking-tight">{stats.totalDocs}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Documents</p>
                  </div>
                  <div className="border-l p-5 text-center">
                    <p className="text-3xl font-semibold tracking-tight">{stats.supplierInvoices}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Fournisseurs</p>
                  </div>
                  <div className="border-l p-5 text-center">
                    <p className="text-3xl font-semibold tracking-tight">{stats.clientInvoices}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Clients</p>
                  </div>
                  <div className="border-l p-5 text-center">
                    <p className="text-3xl font-semibold tracking-tight">{stats.tickets}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Tickets</p>
                  </div>
                  <div className="border-l p-5 text-center">
                    <p className="text-3xl font-semibold tracking-tight">{stats.sentToQonto}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Envoyés Qonto</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Missing invoices alert */}
            {stats.missingInvoices.length > 0 && (
              <div className="rounded-xl bg-amber-50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex h-2 w-2 rounded-full bg-amber-500" />
                  <p className="text-sm font-medium text-amber-900">
                    {stats.missingInvoices.length} paiement(s) sans facture
                  </p>
                </div>
                <p className="mb-3 text-sm text-amber-700/80">
                  Pensez à télécharger les factures depuis les plateformes concernées.
                </p>
                <div className="space-y-1.5">
                  {stats.missingInvoices.slice(0, 5).map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between rounded-lg bg-white/60 px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium">{tx.counterparty_name || 'Inconnu'}</span>
                        <span className="ml-2 text-muted-foreground">
                          {new Date(tx.settled_at).toLocaleDateString('fr-FR')}
                        </span>
                      </div>
                      <span className="font-medium tabular-nums text-amber-800">
                        {(tx.amount_cents / 100).toFixed(2)} {tx.currency}
                      </span>
                    </div>
                  ))}
                  {stats.missingInvoices.length > 5 && (
                    <p className="text-xs text-amber-600 pl-3">
                      + {stats.missingInvoices.length - 5} autre(s)
                    </p>
                  )}
                </div>
              </div>
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
