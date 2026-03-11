'use client';

import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, Search, FileText, ImageIcon, MessageSquare, FolderOpen, Eye } from 'lucide-react';
import type { AccountingDocument } from '@/lib/types';
import { PortailNoteDialog } from './portail-note-dialog';

interface Props {
  token: string;
  month: string;
}

const FLAG_COLORS: Record<string, string> = {
  ok: 'bg-green-500',
  missing_info: 'bg-amber-500',
  duplicate: 'bg-red-500',
  question: 'bg-blue-500',
};

export function PortailDocuments({ token, month }: Props) {
  const [documents, setDocuments] = useState<AccountingDocument[]>([]);
  const [notes, setNotes] = useState<Record<string, { note: string; flag: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');
  const [noteDoc, setNoteDoc] = useState<AccountingDocument | null>(null);

  const fetchDocs = () => {
    setLoading(true);
    fetch(`/api/portail/documents?month=${month}&token=${token}`)
      .then(r => r.json())
      .then(data => {
        setDocuments(data.documents || []);
        setNotes(data.notes || {});
      })
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchDocs(); }, [month, token]);

  const filtered = useMemo(() => {
    let docs = documents;
    if (tab === 'supplier') docs = docs.filter(d => d.type === 'invoice' && d.category === 'supplier');
    else if (tab === 'client') docs = docs.filter(d => d.type === 'invoice' && d.category === 'client');
    else if (tab === 'ticket') docs = docs.filter(d => d.type === 'ticket');

    if (search) {
      const q = search.toLowerCase();
      docs = docs.filter(d => d.title.toLowerCase().includes(q) || d.file_name.toLowerCase().includes(q));
    }
    return docs;
  }, [documents, tab, search]);

  const counts = useMemo(() => ({
    all: documents.length,
    supplier: documents.filter(d => d.type === 'invoice' && d.category === 'supplier').length,
    client: documents.filter(d => d.type === 'invoice' && d.category === 'client').length,
    ticket: documents.filter(d => d.type === 'ticket').length,
  }), [documents]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <a href={`/api/portail/download-month?month=${month}&token=${token}`}>
          <Button variant="outline" size="sm">
            <Download className="mr-1.5 h-3.5 w-3.5" />
            ZIP
          </Button>
        </a>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1">Tout {counts.all}</TabsTrigger>
          <TabsTrigger value="supplier" className="flex-1">Fourn. {counts.supplier}</TabsTrigger>
          <TabsTrigger value="client" className="flex-1">Clients {counts.client}</TabsTrigger>
          <TabsTrigger value="ticket" className="flex-1">Tickets {counts.ticket}</TabsTrigger>
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <div className="py-12 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            {search ? 'Aucun résultat' : 'Aucun document ce mois'}
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y">
            {filtered.map(doc => {
              const note = notes[doc.id];
              return (
                <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                    {doc.file_type?.startsWith('image') ? (
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-medium">{doc.title}</p>
                      {note?.flag && (
                        <span className={`inline-block h-2 w-2 rounded-full ${FLAG_COLORS[note.flag] || 'bg-gray-400'}`} />
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {doc.type === 'invoice' ? 'Facture' : 'Ticket'}
                      {doc.type === 'invoice' && ` · ${doc.category === 'client' ? 'Client' : 'Fourn.'}`}
                      {' · '}
                      {new Date(doc.gmail_received_at || doc.created_at).toLocaleDateString('fr-FR')}
                      {doc.qonto_attachment_sent && ' · ✓ Qonto'}
                    </p>
                  </div>
                  {doc.amount_cents ? (
                    <span className="text-sm font-medium tabular-nums shrink-0">
                      {(doc.amount_cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
                    </span>
                  ) : null}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                      onClick={() => setNoteDoc(doc)}
                    >
                      <MessageSquare className={`h-4 w-4 ${note ? 'fill-current' : ''}`} />
                    </Button>
                    <a href={`/api/portail/download?id=${doc.id}&token=${token}&inline=1`} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </a>
                    <a href={`/api/portail/download?id=${doc.id}&token=${token}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                        <Download className="h-4 w-4" />
                      </Button>
                    </a>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {noteDoc && (
        <PortailNoteDialog
          token={token}
          document={noteDoc}
          existingNote={notes[noteDoc.id]}
          onClose={() => setNoteDoc(null)}
          onSaved={() => {
            setNoteDoc(null);
            fetchDocs();
          }}
        />
      )}
    </div>
  );
}
