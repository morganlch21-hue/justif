import { createServiceClient } from '@/lib/supabase';
import { createHash } from 'crypto';
import { ShieldX } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { PortailDashboard } from './portail-dashboard';

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

  return <PortailDashboard token={token} />;
}
