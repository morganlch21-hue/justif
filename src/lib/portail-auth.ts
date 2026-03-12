import { createServiceClient } from '@/lib/supabase';
import { createServerComponentClient } from '@/lib/supabase-server';
import { createHash } from 'crypto';

const ALLOWED_DOMAIN = '@cpbm.fr';

export async function validatePortailToken(token: string): Promise<{ valid: boolean; tokenId?: string }> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const supabase = createServiceClient();

  const { data: validToken } = await supabase
    .from('accounting_portail_tokens')
    .select('id, expires_at')
    .eq('token_hash', tokenHash)
    .eq('is_active', true)
    .maybeSingle();

  if (!validToken) return { valid: false };

  if (validToken.expires_at && new Date(validToken.expires_at) < new Date()) {
    return { valid: false };
  }

  await supabase
    .from('accounting_portail_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', validToken.id);

  return { valid: true, tokenId: validToken.id };
}

/**
 * Unified portail auth: tries token first, then Supabase session.
 * Works in API routes and server components.
 */
export async function validatePortailAccess(request: Request): Promise<{ valid: boolean; tokenId?: string; email?: string }> {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  // Try token-based auth first
  if (token) {
    const result = await validatePortailToken(token);
    if (result.valid) return result;
  }

  // Try Supabase session (cookie-based)
  try {
    const supabase = await createServerComponentClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email?.endsWith(ALLOWED_DOMAIN)) {
      return { valid: true, email: user.email };
    }
  } catch {
    // Cookie reading may fail in some contexts
  }

  return { valid: false };
}
