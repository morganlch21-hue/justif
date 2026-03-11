import { NextResponse } from 'next/server';

export async function middleware() {
  // Auth temporarily disabled for testing
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|manifest.json).*)'],
};
