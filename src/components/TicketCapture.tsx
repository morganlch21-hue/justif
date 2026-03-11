'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Camera, Check, RotateCcw, Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Image from 'next/image';

export function TicketCapture() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setSuccess(false);
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setDescription('');
    setAmount('');
    setSuccess(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('description', description);
      formData.append('type', 'ticket');
      formData.append('category', 'restaurant');
      if (amount) {
        formData.append('amount_cents', String(Math.round(parseFloat(amount) * 100)));
      }

      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur lors de l\'envoi');
      }

      setSuccess(true);
      toast.success('Ticket enregistré !');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de l\'envoi');
    } finally {
      setUploading(false);
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-6 p-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-50">
          <Check className="h-10 w-10 text-green-600" />
        </div>
        <p className="text-lg font-medium text-green-700">Ticket enregistré !</p>
        <Button onClick={reset} variant="outline" size="lg" className="w-full max-w-sm">
          <Camera className="mr-2 h-5 w-5" />
          Prendre un autre ticket
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {!preview ? (
        <Button
          size="lg"
          className="h-36 w-full max-w-sm text-base rounded-2xl"
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera className="mr-3 h-7 w-7" />
          Prendre une photo du ticket
        </Button>
      ) : (
        <Card className="w-full max-w-sm">
          <CardContent className="space-y-4 p-5">
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl">
              <Image
                src={preview}
                alt="Aperçu du ticket"
                fill
                className="object-contain"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount" className="text-xs text-muted-foreground">Montant (€)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="7.90"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-xs text-muted-foreground">Description (optionnel)</Label>
              <Input
                id="description"
                placeholder="Ex: déjeuner client, repas équipe..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={reset}
                disabled={uploading}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reprendre
              </Button>
              <Button
                className="flex-1"
                onClick={handleUpload}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {uploading ? 'Envoi...' : 'Enregistrer'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!preview && (
        <Button
          variant="ghost"
          className="text-sm text-muted-foreground"
          onClick={() => {
            if (fileInputRef.current) {
              fileInputRef.current.removeAttribute('capture');
              fileInputRef.current.click();
              setTimeout(() => {
                fileInputRef.current?.setAttribute('capture', 'environment');
              }, 100);
            }
          }}
        >
          ou choisir depuis la galerie
        </Button>
      )}
    </div>
  );
}
