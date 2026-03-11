'use client';

import { useState, useEffect } from 'react';
import { TicketCapture } from '@/components/TicketCapture';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, ImageIcon, Receipt } from 'lucide-react';
import { getCurrentMonthKey, type AccountingDocument } from '@/lib/types';

export default function TicketPage() {
  const [tickets, setTickets] = useState<AccountingDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const month = getCurrentMonthKey();
    fetch(`/api/documents?month=${month}&type=ticket`)
      .then(r => r.json())
      .then(data => setTickets(data.documents || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="px-4 py-4">
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Ticket restaurant</h1>
        </div>
      </header>
      <main className="mx-auto max-w-lg pb-24 animate-fade-in">
        <TicketCapture />

        {/* Recent tickets */}
        <div className="px-4 mt-8">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Tickets ce mois
          </p>
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map(i => (
                <Card key={i}><CardContent className="p-3"><Skeleton className="h-10 w-full" /></CardContent></Card>
              ))}
            </div>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Aucun ticket ce mois</p>
          ) : (
            <Card>
              <CardContent className="p-0 divide-y">
                {tickets.map(t => (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50">
                      {t.file_type?.startsWith('image') ? (
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(t.created_at).toLocaleDateString('fr-FR')}
                        {t.status === 'confirmed' && ' · ✓ Confirmé'}
                        {t.status === 'to_verify' && ' · En attente'}
                      </p>
                    </div>
                    <span className={`h-2 w-2 rounded-full shrink-0 ${
                      t.status === 'confirmed' ? 'bg-green-500' : t.status === 'to_verify' ? 'bg-amber-500 animate-pulse' : 'bg-gray-300'
                    }`} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
