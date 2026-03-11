'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, Check, AlertTriangle, Copy, HelpCircle } from 'lucide-react';
import type { AccountingDocument } from '@/lib/types';

interface Props {
  token: string;
  document: AccountingDocument;
  existingNote?: { note: string; flag: string | null };
  onClose: () => void;
  onSaved: () => void;
}

const FLAGS = [
  { value: 'ok', label: 'OK', icon: Check, color: 'text-green-600 border-green-200 bg-green-50', active: 'bg-green-500 text-white border-green-500' },
  { value: 'missing_info', label: 'Info manquante', icon: AlertTriangle, color: 'text-amber-600 border-amber-200 bg-amber-50', active: 'bg-amber-500 text-white border-amber-500' },
  { value: 'duplicate', label: 'Doublon', icon: Copy, color: 'text-red-600 border-red-200 bg-red-50', active: 'bg-red-500 text-white border-red-500' },
  { value: 'question', label: 'Question', icon: HelpCircle, color: 'text-blue-600 border-blue-200 bg-blue-50', active: 'bg-blue-500 text-white border-blue-500' },
];

export function PortailNoteDialog({ token, document: doc, existingNote, onClose, onSaved }: Props) {
  const [note, setNote] = useState(existingNote?.note || '');
  const [flag, setFlag] = useState<string | null>(existingNote?.flag || null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`/api/portail/notes?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: doc.id, note, flag }),
      });
      onSaved();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-md mx-4 mb-4 sm:mb-0">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Note · {doc.title}</h3>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {FLAGS.map(f => {
              const isActive = flag === f.value;
              return (
                <button
                  key={f.value}
                  onClick={() => setFlag(isActive ? null : f.value)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${isActive ? f.active : f.color}`}
                >
                  <f.icon className="h-3 w-3" />
                  {f.label}
                </button>
              );
            })}
          </div>

          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Ajouter une note..."
            rows={3}
            className="w-full rounded-xl border bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
          />

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" size="sm" onClick={onClose}>Annuler</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
