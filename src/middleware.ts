import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAllowedEmail } from '@/lib/auth-allowlist';

// Webhooks/cron handle their own auth (shared secret).
const PUBLIC_API_PREFIXES = ['/api/gmail/', '/api/cron/'];

// Portail routes carry their own auth (token OR session via validatePortailAccess).
// Middleware just refreshes the session cookie so it stays alive.
const PORTAIL_PREFIXES = ['/portail', '/api/portail/'];

// Main app pages that require an authenticated dashboard user.
const PROTECTED_PAGE_PREFIXES = ['/documents', '/ticket', '/settings'];

function createSupabase(request: NextRequest, response: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public webhooks: route handles its own auth.
  if (PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Portail (UI + API): refresh session, no enforcement here.
  if (PORTAIL_PREFIXES.some(p => pathname.startsWith(p))) {
    const response = NextResponse.next();
    const supabase = createSupabase(request, response);
    await supabase.auth.getUser();
    return response;
  }

  // Other /api/*: enforce session + allowlist.
  if (pathname.startsWith('/api/')) {
    const response = NextResponse.next();
    const supabase = createSupabase(request, response);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email || !isAllowedEmail(user.email)) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }
    return response;
  }

  // Main app pages (/, /documents, /ticket, /settings): redirect to /login if unauth.
  const isHome = pathname === '/';
  const isProtectedPage = isHome || PROTECTED_PAGE_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
  if (isProtectedPage) {
    const response = NextResponse.next();
    const supabase = createSupabase(request, response);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email || !isAllowedEmail(user.email)) {
      const loginUrl = new URL('/login', request.url);
      if (pathname !== '/') loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|manifest.json).*)'],
};
