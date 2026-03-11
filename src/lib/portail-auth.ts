import { createServiceClient } from '@/lib/supabase';
import { createHash } from 'crypto';

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
