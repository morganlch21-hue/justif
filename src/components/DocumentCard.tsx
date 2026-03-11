'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Image as ImageIcon, Check, AlertTriangle, Clock, Send, Trash2 } from 'lucide-react';
import type { AccountingDocument } from '@/lib/types';

interface DocumentCardProps {
  document: AccountingDocument;
  onPushToQonto?: (doc: AccountingDocument) => void;
  onDelete?: (id: string) => void;
  onStatusChange?: (id: string, status: string) => void;
}

export function DocumentCard({ document: doc, onPushToQonto, onDelete, onStatusChange }: DocumentCardProps) {
  const isImage = doc.file_type.startsWith('image/');

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-start gap-3 p-4">
        {/* Icon */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          {isImage ? (
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          ) : (
            <FileText className="h-5 w-5 text-muted-foreground" />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-medium text-sm">{doc.title}</p>
            <StatusBadge status={doc.status} />
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-xs">
              {doc.type === 'invoice' ? 'Facture' : 'Ticket'}
            </Badge>
            {doc.type === 'invoice' && (
              <Badge className={`text-xs ${doc.category === 'client' ? 'bg-purple-100 text-purple-700 hover:bg-purple-100' : 'bg-blue-100 text-blue-700 hover:bg-blue-100'}`}>
                {doc.category === 'client' ? 'Client' : 'Fournisseur'}
              </Badge>
            )}
            {doc.source === 'gmail' && (
              <Badge variant="outline" className="text-xs">Email</Badge>
            )}
            <span>{new Date(doc.created_at).toLocaleDateString('fr-FR')}</span>
            {doc.file_size_bytes && (
              <span>{formatFileSize(doc.file_size_bytes)}</span>
            )}
          </div>

          {/* Qonto status */}
          <div className="mt-2 flex items-center gap-2">
            {doc.qonto_attachment_sent ? (
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                <Check className="mr-1 h-3 w-3" />
                Envoyé sur Qonto
              </Badge>
            ) : doc.qonto_error ? (
              <Badge variant="destructive" className="text-xs">
                <AlertTriangle className="mr-1 h-3 w-3" />
                Erreur Qonto
              </Badge>
            ) : null}
          </div>

          {/* Actions */}
          <div className="mt-2 flex items-center gap-1">
            {doc.status === 'to_verify' && onStatusChange && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onStatusChange(doc.id, 'confirmed')}
                >
                  <Check className="mr-1 h-3 w-3" />
                  Confirmer
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onStatusChange(doc.id, 'ignored')}
                >
                  Ignorer
                </Button>
              </>
            )}
            {!doc.qonto_attachment_sent && doc.status === 'confirmed' && onPushToQonto && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onPushToQonto(doc)}
              >
                <Send className="mr-1 h-3 w-3" />
                Envoyer sur Qonto
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={() => onDelete(doc.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'confirmed':
      return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-xs">Confirmé</Badge>;
    case 'to_verify':
      return (
        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 text-xs">
          <Clock className="mr-1 h-3 w-3" />
          À vérifier
        </Badge>
      );
    case 'ignored':
      return <Badge variant="secondary" className="text-xs">Ignoré</Badge>;
    default:
      return null;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
