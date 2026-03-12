'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Image as ImageIcon, Check, Send, Trash2, Eye } from 'lucide-react';
import type { AccountingDocument } from '@/lib/types';
import { cn } from '@/lib/utils';

interface DocumentCardProps {
  document: AccountingDocument;
  onPushToQonto?: (doc: AccountingDocument) => void;
  onDelete?: (id: string) => void;
  onStatusChange?: (id: string, status: string) => void;
  onPreview?: (id: string) => void;
  selected?: boolean;
  onSelect?: (id: string) => void;
  selectionMode?: boolean;
}

export function DocumentCard({ document: doc, onPushToQonto, onDelete, onStatusChange, onPreview, selected, onSelect, selectionMode }: DocumentCardProps) {
  const isImage = doc.file_type.startsWith('image/');

  return (
    <Card
      className={cn(
        'group transition-all duration-200 hover:apple-shadow-hover',
        selected && 'ring-2 ring-blue-500 bg-blue-50/30',
        selectionMode && 'cursor-pointer'
      )}
      onClick={selectionMode && onSelect ? () => onSelect(doc.id) : undefined}
    >
      <CardContent className="flex items-start gap-3 p-4">
        {/* Selection checkbox or Icon */}
        {selectionMode ? (
          <div className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 transition-all',
            selected ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-200 bg-gray-50'
          )}>
            {selected ? <Check className="h-5 w-5" /> : <span className="h-5 w-5" />}
          </div>
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-50">
            {isImage ? (
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
            ) : (
              <FileText className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        )}

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-medium">{doc.title}</p>
            <StatusDot status={doc.status} />
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            {doc.type === 'invoice' ? 'Facture' : 'Ticket'}
            {doc.type === 'invoice' && (
              <> · {doc.category === 'client' ? 'Client' : 'Fournisseur'}</>
            )}
            {doc.source === 'gmail' && <> · Email</>}
            {' · '}
            {new Date(doc.created_at).toLocaleDateString('fr-FR')}
            {doc.file_size_bytes && <> · {formatFileSize(doc.file_size_bytes)}</>}
          </p>

          {/* Extracted info */}
          {doc.extracted_vendor && (
            <p className="mt-1 text-xs text-blue-600">
              🤖 {doc.extracted_vendor}
              {doc.amount_cents ? ` · ${(doc.amount_cents / 100).toFixed(2)}€` : ''}
            </p>
          )}

          {/* Qonto status */}
          {doc.qonto_attachment_sent ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-green-600">
              <span className="flex h-1.5 w-1.5 rounded-full bg-green-500" />
              Qonto
            </p>
          ) : doc.qonto_error ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-500">
              <span className="flex h-1.5 w-1.5 rounded-full bg-red-500" />
              Erreur Qonto
            </p>
          ) : null}

          {/* Actions (hidden in selection mode) */}
          {!selectionMode && (
            <div className="mt-2.5 flex items-center gap-1">
              {onPreview && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => onPreview(doc.id)}
                >
                  <Eye className="mr-1 h-3 w-3" />
                  Voir
                </Button>
              )}
              {doc.status === 'to_verify' && onStatusChange && (
                <>
                  <Button
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
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => onStatusChange(doc.id, 'ignored')}
                  >
                    Ignorer
                  </Button>
                </>
              )}
              {!doc.qonto_attachment_sent && doc.status === 'confirmed' && onPushToQonto && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => onPushToQonto(doc)}
                >
                  <Send className="mr-1 h-3 w-3" />
                  Envoyer
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 w-7 p-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                  onClick={() => onDelete(doc.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusDot({ status }: { status: string }) {
  switch (status) {
    case 'confirmed':
      return (
        <span className="flex items-center gap-1.5 text-xs text-green-600 shrink-0">
          <span className="flex h-2 w-2 rounded-full bg-green-500" />
          Confirmé
        </span>
      );
    case 'to_verify':
      return (
        <span className="flex items-center gap-1.5 text-xs text-amber-600 shrink-0">
          <span className="flex h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          À vérifier
        </span>
      );
    case 'ignored':
      return (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
          <span className="flex h-2 w-2 rounded-full bg-gray-300" />
          Ignoré
        </span>
      );
    default:
      return null;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
