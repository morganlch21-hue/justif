import { createServiceClient } from '@/lib/supabase';
import { createHash } from 'crypto';
import { formatMonthKey, type AccountingDocument } from '@/lib/types';
import { FileText, Download, ShieldX, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

function AccessDenied() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="max-w-md text-center">
        <CardContent className="pt-6">
          <ShieldX className="mx-auto h-12 w-12 text-destructive" />
          <h1 className="mt-4 text-xl font-semibold">Accès refusé</h1>
          <p className="mt-2 text-muted-foreground">
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

  // Validate token
  const { data: validToken } = await supabase
    .from('accounting_portail_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .eq('is_active', true)
    .maybeSingle();

  if (!validToken) return <AccessDenied />;

  // Check expiry
  if (validToken.expires_at && new Date(validToken.expires_at) < new Date()) {
    return <AccessDenied />;
  }

  // Update last_used_at
  await supabase
    .from('accounting_portail_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', validToken.id);

  // Fetch only confirmed documents (not to_verify or ignored)
  const { data: documents } = await supabase
    .from('accounting_documents')
    .select('*')
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false });

  // Group by month
  const byMonth = groupByMonth(documents || []);
  const months = Object.keys(byMonth).sort().reverse();

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background px-4 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-semibold">Portail Comptable</h1>
              <p className="text-sm text-muted-foreground">
                Documents classés par mois
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 p-4 py-8">
        {months.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Aucun document disponible</p>
            </CardContent>
          </Card>
        ) : (
          months.map((monthKey) => (
            <Card key={monthKey}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Calendar className="h-5 w-5" />
                    {formatMonthKey(monthKey)}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{byMonth[monthKey].length} doc(s)</Badge>
                    <a
                      href={`/api/portail/download-month?month=${monthKey}&token=${token}`}
                    >
                      <Button variant="outline" size="sm">
                        <Download className="mr-1 h-4 w-4" />
                        Tout télécharger
                      </Button>
                    </a>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {byMonth[monthKey].map((doc, i) => (
                    <div key={doc.id}>
                      {i > 0 && <Separator className="my-2" />}
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{doc.title}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline" className="text-xs">
                              {doc.type === 'invoice' ? 'Facture' : 'Ticket'}
                            </Badge>
                            <span>{doc.file_name}</span>
                            <span>
                              {new Date(doc.created_at).toLocaleDateString('fr-FR')}
                            </span>
                          </div>
                        </div>
                        <a
                          href={`/api/portail/download?id=${doc.id}&token=${token}`}
                        >
                          <Button variant="ghost" size="sm">
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
