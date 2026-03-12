'use client';

import { useState } from 'react';
import { createBrowserClient } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FileText, Loader2, Mail } from 'lucide-react';

const ALLOWED_DOMAIN = '@cpbm.fr';

function isAllowedEmail(email: string) {
  return email.toLowerCase().endsWith(ALLOWED_DOMAIN);
}

export default function PortailLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const router = useRouter();
  const supabase = createBrowserClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!isAllowedEmail(email)) {
      toast.error('Accès réservé aux comptables CPBM (@cpbm.fr)');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast.error('Identifiants incorrects');
      setLoading(false);
      return;
    }
    toast.success('Connexion réussie');
    router.push('/portail');
    router.refresh();
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!isAllowedEmail(email)) {
      toast.error('Accès réservé aux comptables CPBM (@cpbm.fr)');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Les mots de passe ne correspondent pas');
      return;
    }
    if (password.length < 6) {
      toast.error('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    toast.success('Compte créé ! Vous pouvez maintenant vous connecter.');
    setLoading(false);
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!isAllowedEmail(email)) {
      toast.error('Accès réservé aux comptables CPBM (@cpbm.fr)');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/portail/auth/callback` },
    });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setMagicLinkSent(true);
    setLoading(false);
  }

  if (magicLinkSent) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="py-10 px-8">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-green-50">
              <Mail className="h-6 w-6 text-green-600" />
            </div>
            <h2 className="text-lg font-semibold">Lien envoyé</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Un lien de connexion a été envoyé à <strong>{email}</strong>. Vérifiez votre boîte mail.
            </p>
            <Button variant="ghost" className="mt-4" onClick={() => setMagicLinkSent(false)}>
              Retour
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary">
            <FileText className="h-6 w-6 text-white" />
          </div>
          <div>
            <CardTitle className="text-xl">Portail Comptable</CardTitle>
            <CardDescription className="mt-1">ML Consulting</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="w-full mb-4">
              <TabsTrigger value="login" className="flex-1">Connexion</TabsTrigger>
              <TabsTrigger value="signup" className="flex-1">Inscription</TabsTrigger>
              <TabsTrigger value="magic" className="flex-1">Lien magique</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email" className="text-xs text-muted-foreground">Email</Label>
                  <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@cpbm.fr" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password" className="text-xs text-muted-foreground">Mot de passe</Label>
                  <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Se connecter
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-email" className="text-xs text-muted-foreground">Email</Label>
                  <Input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@cpbm.fr" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password" className="text-xs text-muted-foreground">Mot de passe</Label>
                  <Input id="signup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-confirm" className="text-xs text-muted-foreground">Confirmer le mot de passe</Label>
                  <Input id="signup-confirm" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Créer mon compte
                </Button>
                <p className="text-xs text-center text-muted-foreground">Réservé aux adresses @cpbm.fr</p>
              </form>
            </TabsContent>

            <TabsContent value="magic">
              <form onSubmit={handleMagicLink} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="magic-email" className="text-xs text-muted-foreground">Email</Label>
                  <Input id="magic-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@cpbm.fr" required />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Envoyer le lien
                </Button>
                <p className="text-xs text-center text-muted-foreground">Un lien de connexion sera envoyé à votre email</p>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
