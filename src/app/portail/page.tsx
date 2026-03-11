import { createServiceClient } from '@/lib/supabase';
import { createHash } from 'crypto';
import { formatMonthKey, type AccountingDocument } from '@/lib/types';
import { FileText, Download, ShieldX, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

function AccessDenied() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-background">
      <Card className="max-w-sm text-center">
        <CardContent className="py-10 px-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-50">
            <ShieldX className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold">Accès refusé</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Le lien est invalide ou a expiré. Contactez votre client pour obtenir un nouveau lien.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function PortailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token;
  if (!token) return <AccessDenied />;

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const supabase = createServiceClient();

  const { data: validToken } = await supabase
    .from('accounting_portail_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .eq('is_active', true)
    .maybeSingle();

  if (!validToken) return <AccessDenied />;

  if (validToken.expires_at && new Date(validToken.expires_at) < new Date()) {
    return <AccessDenied />;
  }

  await supabase
    .from('accounting_portail_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', validToken.id);

  const { data: documents } = await supabase
    .from('accounting_documents')
    .select('*')
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false });

  const byMonth = groupByMonth(documents || []);
  const months = Object.keys(byMonth).sort().reverse();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 backdrop-blur-xl bg-background/80 px-4 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">ML Consulting</h1>
              <p className="text-xs text-muted-foreground">
                Portail comptable
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 pb-8">
        {months.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Aucun document disponible
          </div>
        ) : (
          months.map((monthKey) => (
            <Card key={monthKey}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold">{formatMonthKey(monthKey)}</h2>
                    <span className="text-xs text-muted-foreground">· {byMonth[monthKey].length} doc(s)</span>
                  </div>
                  <a href={`/api/portail/download-month?month=${monthKey}&token=${token}`}>
                    <Button variant="ghost" size="sm" className="text-primary text-xs">
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Tout télécharger
                    </Button>
                  </a>
                </div>
                <div className="space-y-0">
                  {byMonth[monthKey].map((doc, i) => (
                    <div key={doc.id}>
                      {i > 0 && <div className="border-b my-0" />}
                      <div className="flex items-center justify-between gap-2 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{doc.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {doc.type === 'invoice' ? 'Facture' : 'Ticket'}
                            {doc.type === 'invoice' && (
                              <> · {doc.category === 'client' ? 'Client' : 'Fournisseur'}</>
                            )}
                            {' · '}
                            {doc.file_name}
                            {' · '}
                            {new Date(doc.created_at).toLocaleDateString('fr-FR')}
                          </p>
                        </div>
                        <a href={`/api/portail/download?id=${doc.id}&token=${token}`}>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                            <Download className="h-4 w-4" />
                          </Button>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </main>
    </div>
  );
}

function groupByMonth(docs: AccountingDocument[]): Record<string, AccountingDocument[]> {
  const grouped: Record<string, AccountingDocument[]> = {};
  for (const doc of docs) {
    if (!grouped[doc.month_key]) grouped[doc.month_key] = [];
    grouped[doc.month_key].push(doc);
  }
  return grouped;
}
