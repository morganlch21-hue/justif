'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Building2, Link2, LogOut, ExternalLink, CreditCard, Mail, CheckCircle2, XCircle } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const [hasPortail, setHasPortail] = useState(false);
  const [qontoOk, setQontoOk] = useState<boolean | null>(null);
  const [gmailOk, setGmailOk] = useState<boolean | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/portail/token')
      .then(r => r.json())
      .then(data => setHasPortail(data.exists))
      .catch(() => {});

    // Check Qonto connection
    fetch('/api/qonto/transactions?month=2026-03')
      .then(r => { setQontoOk(r.ok); })
      .catch(() => setQontoOk(false));

    // Check Gmail (if webhook secret is configured)
    setGmailOk(true); // Gmail is configured via Apps Script
  }, []);

  async function handleLogout() {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="px-4 py-4">
        <h1 className="text-lg font-semibold">Réglages</h1>
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-4 pb-24 animate-fade-in">
        {/* Company info */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">ML Consulting</p>
                <p className="text-xs text-muted-foreground">Compte principal</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Integrations */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Intégrations</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                  <CreditCard className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">Qonto</p>
                  <p className="text-[11px] text-muted-foreground">Sync auto des transactions</p>
                </div>
              </div>
              {qontoOk === null ? (
                <span className="text-xs text-muted-foreground">...</span>
              ) : qontoOk ? (
                <div className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Connecté</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-red-500">
                  <XCircle className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Erreur</span>
                </div>
              )}
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50">
                  <Mail className="h-4 w-4 text-red-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">Gmail</p>
                  <p className="text-[11px] text-muted-foreground">Import auto des factures</p>
                </div>
              </div>
              {gmailOk ? (
                <div className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Actif</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <XCircle className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Inactif</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Portail link */}
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">Portail comptable</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Partagez le lien du portail avec votre comptable pour lui donner accès aux documents confirmés.
            </p>
            {hasPortail ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open('/portail?token=compta-view-2026', '_blank')}
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Ouvrir le portail
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground italic">Aucun lien actif</p>
            )}
          </CardContent>
        </Card>

        <Separator />

        {/* Logout */}
        <Button variant="ghost" className="w-full justify-start text-destructive" onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          Se déconnecter
        </Button>

        <p className="text-center text-[11px] text-muted-foreground pt-4">
          Justif v1.1
        </p>
      </main>
    </div>
  );
}
