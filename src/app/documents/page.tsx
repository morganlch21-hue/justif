'use client';

import { useState, useEffect, useCallback } from 'react';
import { MonthSelector } from '@/components/MonthSelector';
import { DocumentCard } from '@/components/DocumentCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
import { getCurrentMonthKey, type AccountingDocument } from '@/lib/types';
import { toast } from 'sonner';
import Link from 'next/link';

export default function DocumentsPage() {
  const [month, setMonth] = useState(getCurrentMonthKey());
  const [type, setType] = useState<string>('all');
  const [documents, setDocuments] = useState<AccountingDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ month });
      if (type === 'ticket') params.set('type', 'ticket');
      else if (type === 'supplier' || type === 'client') {
        params.set('type', 'invoice');
        params.set('category', type);
      }
      const res = await fetch(`/api/documents?${params}`);
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch {
      toast.error('Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  }, [month, type]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  async function handleStatusChange(id: string, status: string) {
    const res = await fetch(`/api/documents`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) {
      toast.success('Statut mis à jour');
      fetchDocuments();
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer ce document ?')) return;
    const res = await fetch(`/api/documents?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Document supprimé');
      fetchDocuments();
    }
  }

  const toVerifyCount = documents.filter(d => d.status === 'to_verify').length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-lg font-semibold">Documents</h1>
            {toVerifyCount > 0 && (
              <Badge className="bg-amber-100 text-amber-700">{toVerifyCount} à vérifier</Badge>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={fetchDocuments} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 p-4">
        {/* Filters */}
        <div className="flex items-center justify-between">
          <MonthSelector value={month} onChange={setMonth} />
          <Tabs value={type} onValueChange={setType}>
            <TabsList>
              <TabsTrigger value="all">Tout</TabsTrigger>
              <TabsTrigger value="supplier">Fournisseurs</TabsTrigger>
              <TabsTrigger value="client">Clients</TabsTrigger>
              <TabsTrigger value="ticket">Tickets</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Document list */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : documents.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            Aucun document pour cette période
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map(doc => (
              <DocumentCard
                key={doc.id}
                document={doc}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
