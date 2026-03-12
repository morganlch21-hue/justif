import { createServiceClient } from '@/lib/supabase';
import { createServerComponentClient } from '@/lib/supabase-server';
import { createHash } from 'crypto';
import { redirect } from 'next/navigation';
import { PortailDashboard } from './portail-dashboard';

const ALLOWED_DOMAIN = '@cpbm.fr';

export default async function PortailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token;

  // Mode 1: Token-based auth (backward compatible)
  if (token) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const supabase = createServiceClient();

    const { data: validToken } = await supabase
      .from('accounting_portail_tokens')
      .select('*')
      .eq('token_hash', tokenHash)
      .eq('is_active', true)
      .maybeSingle();

    if (!validToken) redirect('/portail/login');

    if (validToken.expires_at && new Date(validToken.expires_at) < new Date()) {
      redirect('/portail/login');
    }

    await supabase
      .from('accounting_portail_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', validToken.id);

    return <PortailDashboard token={token} />;
  }

  // Mode 2: Supabase session auth
  try {
    const supabase = await createServerComponentClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user?.email?.endsWith(ALLOWED_DOMAIN)) {
      return <PortailDashboard />;
    }
  } catch {
    // Session reading failed
  }

  // No valid auth → redirect to login
  redirect('/portail/login');
}
