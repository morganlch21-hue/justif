import { TicketCapture } from '@/components/TicketCapture';
import { FileText } from 'lucide-react';

export default function TicketPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="px-4 py-4">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Ticket restaurant</h1>
        </div>
      </header>
      <main className="mx-auto max-w-lg pb-24 animate-fade-in">
        <TicketCapture />
      </main>
    </div>
  );
}
