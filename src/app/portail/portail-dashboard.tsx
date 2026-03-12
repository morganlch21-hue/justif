'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileText, LogOut } from 'lucide-react';
import { MonthSelector } from '@/components/MonthSelector';
import { getCurrentMonthKey } from '@/lib/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { createBrowserClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { PortailSummary } from './components/portail-summary';
import { PortailDocuments } from './components/portail-documents';
import { PortailReconciliation } from './components/portail-reconciliation';
import { PortailMissing } from './components/portail-missing';

interface Props {
  token?: string;
}

export function PortailDashboard({ token }: Props) {
  const [month, setMonth] = useState(getCurrentMonthKey());
  const [missingCount, setMissingCount] = useState(0);
  const router = useRouter();
  const isSessionMode = !token;

  // Build query string for API calls
  const authQuery = token ? `token=${token}` : '';

  // Sync Qonto in background on load, then fetch missing count
  useEffect(() => {
    const syncThenFetchMissing = async () => {
      try {
        await fetch(`/api/qonto/sync?month=${month}`, { method: 'POST' });
      } catch { /* ignore sync errors */ }
      try {
        const r = await fetch(`/api/portail/missing?month=${month}&${authQuery}`);
        const data = await r.json();
        setMissingCount((data.transactions || []).length);
      } catch { setMissingCount(0); }
    };
    syncThenFetchMissing();
  }, [month, authQuery]);

  const handleMissingCount = useCallback((count: number) => {
    setMissingCount(count);
  }, []);

  async function handleLogout() {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.push('/portail/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-background animate-fade-in">
      <header className="sticky top-0 z-10 backdrop-blur-xl bg-background/80 px-4 py-4 border-b border-border/50">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight">ML Consulting</h1>
                <p className="text-xs text-muted-foreground">Portail comptable</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <MonthSelector value={month} onChange={setMonth} />
              {isSessionMode && (
                <Button variant="ghost" size="icon" onClick={handleLogout} title="Déconnexion">
                  <LogOut className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-8 space-y-6 mt-4">
        <PortailSummary token={token} month={month} />

        <Tabs defaultValue="documents" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="documents" className="flex-1">Documents</TabsTrigger>
            <TabsTrigger value="reconciliation" className="flex-1">Rapprochement</TabsTrigger>
            <TabsTrigger value="missing" className="flex-1 relative">
              Manquants
              {missingCount > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                  {missingCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="mt-4">
            <PortailDocuments token={token} month={month} />
          </TabsContent>

          <TabsContent value="reconciliation" className="mt-4">
            <PortailReconciliation token={token} month={month} />
          </TabsContent>

          <TabsContent value="missing" className="mt-4">
            <PortailMissing token={token} month={month} onCountChange={handleMissingCount} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
