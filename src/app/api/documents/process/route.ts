import { processDocument } from '@/lib/process-document';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

/**
 * POST /api/documents/process?id=xxx
 * Runs AI extraction + Qonto matching for a document.
 * Called async after upload to avoid Vercel 10s timeout.
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const docId = searchParams.get('id');
    if (!docId) {
      return NextResponse.json({ error: 'Missing document id' }, { status: 400 });
    }

    const result = await processDocument(docId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Process error:', err);
    const msg = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
