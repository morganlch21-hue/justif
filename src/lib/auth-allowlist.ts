/**
 * Email allowlist for portail + dashboard access.
 * Edge-runtime safe: no Supabase imports here so it can be used from middleware.
 */

const DEFAULT_ALLOWED_DOMAINS = '@cpbm.fr';
const DEFAULT_ALLOWED_EMAILS = 'morgan.lch21@gmail.com';

const ALLOWED_DOMAINS = (process.env.ALLOWED_PORTAIL_DOMAINS || DEFAULT_ALLOWED_DOMAINS)
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
const ALLOWED_EMAILS = (process.env.ALLOWED_PORTAIL_EMAILS || DEFAULT_ALLOWED_EMAILS)
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

export function isAllowedEmail(email: string): boolean {
  const lower = email.toLowerCase();
  if (ALLOWED_EMAILS.includes(lower)) return true;
  return ALLOWED_DOMAINS.some(d => lower.endsWith(d));
}
