'use client';

import { useState, useEffect, useCallback } from 'react';
import { MonthSelector } from '@/components/MonthSelector';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FileText, Camera, FolderOpen, AlertTriangle,
  CheckCircle, Clock, Receipt, RefreshCw, Loader2, LogOut
} from 'lucide-react';
import { getCurrentMonthKey, type AccountingDocument, type QontoTransaction } from '@/lib/types';
import { createBrowserClient } from '@/lib/supabase';
import { toast } from 'sonner';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents?month=${month}`);
      const { documents } = await res.json() as { documents: AccountingDocument[] };
      const docs = documents || [];

      // Fetch Qonto missing invoices
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

  async function syncQonto() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/qonto/sync?month=${month}`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success(`${data.synced} transactions synchronisées, ${data.missingInvoices} sans facture`);
        fetchStats();
      } else {
        toast.error(data.error || 'Erreur sync');
      }
    } catch {
      toast.error('Erreur de synchronisation');
    } finally {
      setSyncing(false);
    }
  }

  async function handleLogout() {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background px-4 py-3">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-semibold">Justif</h1>
              <p className="text-xs text-muted-foreground">ML Consulting</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="mr-1 h-4 w-4" />
              Déconnexion
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 p-4 py-6">
        {/* Month selector */}
        <div className="flex items-center justify-between">
          <MonthSelector value={month} onChange={setMonth} />
          <Button variant="outline" size="sm" onClick={syncQonto} disabled={syncing}>
            {syncing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
            Sync Qonto
          </Button>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Link href="/ticket">
            <Card className="cursor-pointer transition-colors hover:bg-accent">
              <CardContent className="flex flex-col items-center gap-2 p-4">
                <Camera className="h-8 w-8 text-primary" />
                <span className="text-sm font-medium">Ticket resto</span>
              </CardContent>
            </Card>
          </Link>
          <Link href="/documents">
            <Card className="cursor-pointer transition-colors hover:bg-accent">
              <CardContent className="flex flex-col items-center gap-2 p-4">
                <FolderOpen className="h-8 w-8 text-primary" />
                <span className="text-sm font-medium">Documents</span>
              </CardContent>
            </Card>
          </Link>
          <Link href="/documents">
            <Card className="cursor-pointer transition-colors hover:bg-accent">
              <CardContent className="flex flex-col items-center gap-2 p-4 relative">
                <Clock className="h-8 w-8 text-amber-500" />
                <span className="text-sm font-medium">À vérifier</span>
                {stats && stats.toVerify > 0 && (
                  <Badge className="absolute -right-1 -top-1 bg-amber-500">{stats.toVerify}</Badge>
                )}
              </CardContent>
            </Card>
          </Link>
          <Card className="cursor-pointer transition-colors hover:bg-accent" onClick={syncQonto}>
            <CardContent className="flex flex-col items-center gap-2 p-4">
              <Receipt className="h-8 w-8 text-primary" />
              <span className="text-sm font-medium">Sync Qonto</span>
            </CardContent>
          </Card>
        </div>

        {/* Stats */}
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : stats && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold">{stats.totalDocs}</p>
                  <p className="text-xs text-muted-foreground">Documents</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-blue-600">{stats.supplierInvoices}</p>
                  <p className="text-xs text-muted-foreground">Fournisseurs</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-purple-600">{stats.clientInvoices}</p>
                  <p className="text-xs text-muted-foreground">Clients</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold">{stats.tickets}</p>
                  <p className="text-xs text-muted-foreground">Tickets</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{stats.sentToQonto}</p>
                  <p className="text-xs text-muted-foreground">Envoyés Qonto</p>
                </CardContent>
              </Card>
            </div>

            {/* Missing invoices alert */}
            {stats.missingInvoices.length > 0 && (
              <Card className="border-amber-200 bg-amber-50">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base text-amber-800">
                    <AlertTriangle className="h-5 w-5" />
                    {stats.missingInvoices.length} paiement(s) sans facture
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-3 text-sm text-amber-700">
                    Ces transactions Qonto n&apos;ont pas de justificatif. Pensez à télécharger les factures depuis les plateformes concernées.
                  </p>
                  <div className="space-y-2">
                    {stats.missingInvoices.slice(0, 5).map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between rounded-lg bg-white/80 p-2 text-sm">
                        <div>
                          <span className="font-medium">{tx.counterparty_name || 'Inconnu'}</span>
                          <span className="ml-2 text-muted-foreground">
                            {new Date(tx.settled_at).toLocaleDateString('fr-FR')}
                          </span>
                        </div>
                        <span className="font-medium text-amber-800">
                          {(tx.amount_cents / 100).toFixed(2)} {tx.currency}
                        </span>
                      </div>
                    ))}
                    {stats.missingInvoices.length > 5 && (
                      <p className="text-xs text-amber-600">
                        + {stats.missingInvoices.length - 5} autre(s)...
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {stats.totalDocs === 0 && stats.missingInvoices.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
                  <p className="mt-3 text-muted-foreground">
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
