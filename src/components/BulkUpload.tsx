'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, X, Loader2, CheckCircle2, AlertCircle, FileText, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type FileStatus = 'pending' | 'uploading' | 'success' | 'error';

interface FileItem {
  file: File;
  status: FileStatus;
}

interface BulkUploadProps {
  month: string;
  onComplete: () => void;
}

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export function BulkUpload({ month, onComplete }: BulkUploadProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [docType, setDocType] = useState<'invoice' | 'ticket'>('invoice');
  const [category, setCategory] = useState<'supplier' | 'client' | 'restaurant' | 'general'>('supplier');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const valid: FileItem[] = [];
    const rejected: string[] = [];

    for (const file of Array.from(newFiles)) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        rejected.push(`${file.name} (type non supporté)`);
      } else if (file.size > MAX_FILE_SIZE) {
        rejected.push(`${file.name} (> 20 Mo)`);
      } else {
        valid.push({ file, status: 'pending' });
      }
    }

    if (rejected.length > 0) {
      toast.error(`Fichier(s) refusé(s) : ${rejected.join(', ')}`);
    }

    if (valid.length > 0) {
      setFiles(prev => [...prev, ...valid]);
    }
  }, []);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  function reset() {
    setFiles([]);
    setUploadProgress(0);
    setUploading(false);
  }

  async function handleUpload() {
    setUploading(true);
    setUploadProgress(0);
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
      setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'uploading' } : f));

      const formData = new FormData();
      formData.append('file', files[i].file);
      formData.append('type', docType);
      formData.append('category', category);
      formData.append('month', month);

      try {
        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          body: formData,
        });

        if (res.ok) {
          successCount++;
          setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'success' } : f));

          // Auto-push Qonto
          const data = await res.json();
          if (data.document?.id) {
            fetch(`/api/qonto/auto-push?documentId=${data.document.id}`, { method: 'POST' })
              .then(r => r.json())
              .then(pushData => {
                if (pushData.pushed > 0) {
                  toast.success(`${files[i].file.name} → Qonto ✓`);
                }
              })
              .catch(() => {});
          }
        } else {
          errorCount++;
          setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'error' } : f));
        }
      } catch {
        errorCount++;
        setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'error' } : f));
      }

      setUploadProgress(i + 1);
    }

    // Summary toast
    if (errorCount === 0) {
      toast.success(`${successCount} fichier(s) importé(s) avec succès`);
    } else {
      toast.error(`${successCount} importé(s), ${errorCount} erreur(s)`);
    }

    onComplete();

    // Auto-reset after 2s
    setTimeout(() => {
      reset();
    }, 2000);
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const isImage = (type: string) => type.startsWith('image/');

  // --- State: idle (no files) → drop zone ---
  if (files.length === 0) {
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 transition-all duration-200',
            dragOver
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-200 bg-gray-50/50 hover:border-gray-300 hover:bg-gray-50'
          )}
        >
          <Upload className={cn('h-8 w-8', dragOver ? 'text-blue-500' : 'text-muted-foreground/50')} />
          <p className="text-sm text-muted-foreground">
            Glisser des fichiers ici ou <span className="text-foreground font-medium">cliquer pour importer</span>
          </p>
          <p className="text-xs text-muted-foreground/60">PDF, JPG, PNG · Max 20 Mo par fichier</p>
        </div>
      </>
    );
  }

  // --- State: preview / uploading ---
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* File list */}
        <div className="space-y-2">
          <p className="text-sm font-medium">{files.length} fichier(s) sélectionné(s)</p>
          <div className="max-h-48 overflow-y-auto space-y-1.5">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm rounded-lg bg-gray-50 px-3 py-2">
                {isImage(f.file.type) ? (
                  <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate flex-1">{f.file.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">{formatSize(f.file.size)}</span>
                {f.status === 'pending' && !uploading && (
                  <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive ml-1">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                {f.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-blue-500 ml-1" />}
                {f.status === 'success' && <CheckCircle2 className="h-4 w-4 text-green-500 ml-1" />}
                {f.status === 'error' && <AlertCircle className="h-4 w-4 text-red-500 ml-1" />}
              </div>
            ))}
          </div>
        </div>

        {/* Upload progress bar */}
        {uploading && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progression</span>
              <span>{uploadProgress}/{files.length}</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${(uploadProgress / files.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Type & Category selectors (only before upload) */}
        {!uploading && (
          <div className="space-y-3">
            {/* Type */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Type</p>
              <div className="flex gap-2">
                <ToggleButton active={docType === 'invoice'} onClick={() => setDocType('invoice')}>
                  Facture
                </ToggleButton>
                <ToggleButton active={docType === 'ticket'} onClick={() => setDocType('ticket')}>
                  Ticket
                </ToggleButton>
              </div>
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Catégorie</p>
              <div className="flex gap-2 flex-wrap">
                <ToggleButton active={category === 'supplier'} onClick={() => setCategory('supplier')}>
                  Fournisseur
                </ToggleButton>
                <ToggleButton active={category === 'client'} onClick={() => setCategory('client')}>
                  Client
                </ToggleButton>
                <ToggleButton active={category === 'restaurant'} onClick={() => setCategory('restaurant')}>
                  Restaurant
                </ToggleButton>
                <ToggleButton active={category === 'general'} onClick={() => setCategory('general')}>
                  Général
                </ToggleButton>
              </div>
            </div>

            {/* Add more files */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              multiple
              className="hidden"
              onChange={handleFileInput}
            />
          </div>
        )}

        {/* Actions */}
        {!uploading && (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={reset}>
              Annuler
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="text-muted-foreground"
            >
              + Ajouter
            </Button>
            <Button className="flex-1" onClick={handleUpload}>
              <Upload className="mr-1.5 h-4 w-4" />
              Importer {files.length} fichier(s)
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
        active
          ? 'bg-foreground text-background'
          : 'bg-gray-100 text-muted-foreground hover:bg-gray-200'
      )}
    >
      {children}
    </button>
  );
}
