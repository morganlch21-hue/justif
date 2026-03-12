'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { MonthSelector } from '@/components/MonthSelector';
import { DocumentCard } from '@/components/DocumentCard';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { RefreshCw, Search, CheckCheck, FolderOpen, Loader2, X, Check, Ban, ListChecks } from 'lucide-react';
import { getCurrentMonthKey, type AccountingDocument } from '@/lib/types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { BulkUpload } from '@/components/BulkUpload';

export default function DocumentsPage() {
  const [month, setMonth] = useState(getCurrentMonthKey());
  const [type, setType] = useState<string>('all');
  const [allDocuments, setAllDocuments] = useState<AccountingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<AccountingDocument | null>(null);

  // Multi-select
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  // Reset selection when month or filter changes
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, [month, type]);

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

  // Preview: open modal with document
  async function handlePreview(id: string) {
    const doc = allDocuments.find(d => d.id === id);
    if (!doc) return;
    setPreviewDoc(doc);
    setPreviewLoading(true);
    setPreviewUrl(null);

    try {
      const res = await fetch(`/api/documents/preview?id=${id}`);
      const data = await res.json();
      if (res.ok && data.url) {
        setPreviewUrl(data.url);
      } else {
        toast.error('Impossible de charger l\'aperçu');
        setPreviewDoc(null);
      }
    } catch {
      toast.error('Erreur de chargement');
      setPreviewDoc(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  // Multi-select: toggle selection
  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Multi-select: select all visible
  function selectAll() {
    setSelectedIds(new Set(documents.map(d => d.id)));
  }

  // Multi-select: bulk action
  async function handleBulkAction(status: 'confirmed' | 'ignored') {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      await fetch('/api/documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status }),
      });
      toast.success(`${ids.length} document(s) ${status === 'confirmed' ? 'confirmé(s)' : 'ignoré(s)'}`);
      if (status === 'confirmed') {
        fetch(`/api/qonto/auto-push?month=${month}`, { method: 'POST' }).catch(() => {});
      }
      fetchDocuments();
      setSelectedIds(new Set());
      setSelectionMode(false);
    } catch {
      toast.error('Erreur');
    }
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
          <div className="flex items-center gap-1">
            <Button
              variant={selectionMode ? 'default' : 'ghost'}
              size="icon"
              onClick={() => { setSelectionMode(!selectionMode); setSelectedIds(new Set()); }}
              className={cn('text-muted-foreground', selectionMode && 'text-white')}
              title="Mode sélection"
            >
              <ListChecks className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleRefresh} className="text-muted-foreground">
              <RefreshCw className={cn("h-4 w-4 transition-transform", refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-3 px-4 pb-24 animate-fade-in">
        {/* Bulk Upload */}
        {!selectionMode && <BulkUpload month={month} onComplete={fetchDocuments} />}

        {/* Selection toolbar */}
        {selectionMode && (
          <div className="flex items-center gap-2 rounded-xl bg-blue-50 p-3">
            <span className="text-sm font-medium text-blue-700">
              {selectedIds.size} sélectionné(s)
            </span>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-blue-600" onClick={selectAll}>
              Tout sélectionner
            </Button>
            <div className="flex-1" />
            <Button size="sm" className="h-7 text-xs" onClick={() => handleBulkAction('confirmed')} disabled={selectedIds.size === 0}>
              <Check className="mr-1 h-3 w-3" />
              Confirmer
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleBulkAction('ignored')} disabled={selectedIds.size === 0}>
              <Ban className="mr-1 h-3 w-3" />
              Ignorer
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); }}>
              <X className="mr-1 h-3 w-3" />
              Annuler
            </Button>
          </div>
        )}

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

        {/* Bulk confirm (non-selection mode) */}
        {!selectionMode && toVerifyDocs.length > 1 && (
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
                selectionMode={selectionMode}
                selected={selectedIds.has(doc.id)}
                onSelect={toggleSelect}
              />
            ))}
          </div>
        )}
      </main>

      {/* Preview Modal */}
      <Dialog open={!!previewDoc} onOpenChange={(open) => { if (!open) { setPreviewDoc(null); setPreviewUrl(null); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden">
          {previewDoc && (
            <div className="flex flex-col h-full max-h-[90vh]">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b">
                <div className="min-w-0 pr-8">
                  <p className="text-sm font-medium truncate">{previewDoc.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {previewDoc.type === 'invoice' ? 'Facture' : 'Ticket'}
                    {' · '}
                    {new Date(previewDoc.created_at).toLocaleDateString('fr-FR')}
                    {previewDoc.extracted_vendor && ` · ${previewDoc.extracted_vendor}`}
                    {previewDoc.amount_cents && ` · ${(previewDoc.amount_cents / 100).toFixed(2)}€`}
                  </p>
                </div>
              </div>
              {/* Content */}
              <div className="flex-1 overflow-auto bg-gray-100">
                {previewLoading ? (
                  <div className="flex items-center justify-center h-96">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : previewUrl ? (
                  previewDoc.file_type.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt={previewDoc.title}
                      className="mx-auto max-h-[80vh] object-contain"
                    />
                  ) : (
                    <iframe
                      src={previewUrl}
                      className="w-full h-[80vh]"
                      title={previewDoc.title}
                    />
                  )
                ) : (
                  <div className="flex items-center justify-center h-96 text-muted-foreground">
                    Impossible de charger l&apos;aperçu
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
