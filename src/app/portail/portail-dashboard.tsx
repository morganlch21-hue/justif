'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { MonthSelector } from '@/components/MonthSelector';
import { getCurrentMonthKey } from '@/lib/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PortailSummary } from './components/portail-summary';
import { PortailDocuments } from './components/portail-documents';
import { PortailReconciliation } from './components/portail-reconciliation';
import { PortailMissing } from './components/portail-missing';

interface Props {
  token: string;
}

export function PortailDashboard({ token }: Props) {
  const [month, setMonth] = useState(getCurrentMonthKey());
  const [missingCount, setMissingCount] = useState(0);

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
            <MonthSelector value={month} onChange={setMonth} />
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
            <PortailMissing token={token} month={month} onCountChange={setMissingCount} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
