'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MonthSelector } from '@/components/MonthSelector';
import { DocumentCard } from '@/components/DocumentCard';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefreshCw, Loader2, Upload, Search, CheckCheck, FolderOpen } from 'lucide-react';
import { getCurrentMonthKey, type AccountingDocument } from '@/lib/types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function DocumentsPage() {
  const [month, setMonth] = useState(getCurrentMonthKey());
  const [type, setType] = useState<string>('all');
  const [allDocuments, setAllDocuments] = useState<AccountingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents?month=${month}`);
      const data = await res.json();
      setAllDocuments(data.documents || []);
    } catch {
      toast.error('Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const filteredByType = useMemo(() => {
    if (type === 'supplier') return allDocuments.filter(d => d.type === 'invoice' && d.category !== 'client');
    if (type === 'client') return allDocuments.filter(d => d.type === 'invoice' && d.category === 'client');
    if (type === 'ticket') return allDocuments.filter(d => d.type === 'ticket');
    return allDocuments;
  }, [allDocuments, type]);

  const documents = useMemo(() => {
    if (!search.trim()) return filteredByType;
    const q = search.toLowerCase();
    return filteredByType.filter(d => d.title.toLowerCase().includes(q));
  }, [filteredByType, search]);

  const counts = useMemo(() => ({
    all: allDocuments.length,
    supplier: allDocuments.filter(d => d.type === 'invoice' && d.category !== 'client').length,
    client: allDocuments.filter(d => d.type === 'invoice' && d.category === 'client').length,
    ticket: allDocuments.filter(d => d.type === 'ticket').length,
  }), [allDocuments]);

  const toVerifyDocs = documents.filter(d => d.status === 'to_verify');

  async function handleRefresh() {
    setRefreshing(true);
    await fetchDocuments();
    setTimeout(() => setRefreshing(false), 600);
  }

  async function handleStatusChange(id: string, status: string) {
    const res = await fetch(`/api/documents`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) {
      toast.success('Statut mis à jour');
      fetchDocuments();
      if (status === 'confirmed') {
        fetch(`/api/qonto/auto-push?documentId=${id}`, { method: 'POST' })
          .then(r => r.json())
          .then(data => {
            if (data.pushed > 0) {
              toast.success('Facture envoyée automatiquement sur Qonto');
              fetchDocuments();
            }
          })
          .catch(() => {});
      }
    }
  }

  async function handleBulkConfirm() {
    setConfirming(true);
    try {
      const ids = toVerifyDocs.map(d => d.id);
      await fetch('/api/documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status: 'confirmed' }),
      });
      toast.success(`${ids.length} document(s) confirmé(s)`);
      fetch(`/api/qonto/auto-push?month=${month}`, { method: 'POST' }).catch(() => {});
      fetchDocuments();
    } catch {
      toast.error('Erreur lors de la confirmation');
    } finally {
      setConfirming(false);
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

  async function handlePreview(id: string) {
    try {
      const res = await fetch(`/api/documents/preview?id=${id}`);
      const data = await res.json();
      if (res.ok && data.url) {
        window.open(data.url, '_blank');
      } else {
        toast.error('Impossible d\'ouvrir le document');
      }
    } catch {
      toast.error('Erreur de chargement');
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    let uploaded = 0;

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'invoice');
      formData.append('category', 'supplier');
      formData.append('month', month);

      try {
        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          uploaded++;
          const data = await res.json();
          if (data.document?.id) {
            fetch(`/api/qonto/auto-push?documentId=${data.document.id}`, { method: 'POST' })
              .then(r => r.json())
              .then(pushData => {
                if (pushData.pushed > 0) {
                  toast.success(`${file.name} envoyée sur Qonto`);
                  fetchDocuments();
                }
              })
              .catch(() => {});
          }
        } else {
          toast.error(`Erreur pour ${file.name}`);
        }
      } catch {
        toast.error(`Erreur pour ${file.name}`);
      }
    }

    if (uploaded > 0) {
      toast.success(`${uploaded} facture(s) importée(s)`);
      fetchDocuments();
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="px-4 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Documents</h1>
            {toVerifyDocs.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-amber-600">
                <span className="flex h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                {toVerifyDocs.length} à vérifier
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-muted-foreground"
            >
              {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
              Importer
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
            <Button variant="ghost" size="icon" onClick={handleRefresh} className="text-muted-foreground">
              <RefreshCw className={cn("h-4 w-4 transition-transform", refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-3 px-4 pb-24 animate-fade-in">
        {/* Month + Tabs */}
        <div className="flex items-center justify-between">
          <MonthSelector value={month} onChange={setMonth} />
          <Tabs value={type} onValueChange={setType}>
            <TabsList>
              <TabsTrigger value="all">Tout{counts.all > 0 && <span className="ml-1 text-[10px] opacity-60">{counts.all}</span>}</TabsTrigger>
              <TabsTrigger value="supplier">Fourn.{counts.supplier > 0 && <span className="ml-1 text-[10px] opacity-60">{counts.supplier}</span>}</TabsTrigger>
              <TabsTrigger value="client">Clients{counts.client > 0 && <span className="ml-1 text-[10px] opacity-60">{counts.client}</span>}</TabsTrigger>
              <TabsTrigger value="ticket">Tickets{counts.ticket > 0 && <span className="ml-1 text-[10px] opacity-60">{counts.ticket}</span>}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher un document..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 bg-gray-50 border-0 text-sm"
          />
        </div>

        {/* Bulk confirm */}
        {toVerifyDocs.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleBulkConfirm}
            disabled={confirming}
          >
            {confirming ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-1.5 h-4 w-4" />}
            Tout confirmer ({toVerifyDocs.length})
          </Button>
        )}

        {/* Document list */}
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardContent className="flex items-start gap-3 p-4">
                  <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4 rounded" />
                    <Skeleton className="h-3 w-1/2 rounded" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="py-16 text-center">
            <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">
              {search ? 'Aucun résultat pour cette recherche' : 'Aucun document pour cette période'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map(doc => (
              <DocumentCard
                key={doc.id}
                document={doc}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
                onPreview={handlePreview}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
