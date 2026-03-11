'use client';

import { usePathname } from 'next/navigation';

const HIDDEN_PATHS = ['/login', '/portail'];

export function NavWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hidden = HIDDEN_PATHS.some(p => pathname.startsWith(p));
  if (hidden) return null;
  return <>{children}</>;
}
