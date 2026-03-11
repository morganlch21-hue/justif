import { TicketCapture } from '@/components/TicketCapture';
import { FileText, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function TicketPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Ticket restaurant</h1>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-lg py-8">
        <TicketCapture />
      </main>
    </div>
  );
}
