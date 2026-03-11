import { createServiceClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

interface GmailPayload {
  messageId: string;
  subject: string;
  sender: string;
  receivedAt: string;
  fileName: string;
  fileBase64: string;
  fileType: string;
  emailAccount: string;
  confidence: number;
  isInvoice: boolean;
  matchedKeywords: string[];
  category?: 'client' | 'supplier';
}

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    // Validate webhook secret
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${process.env.GMAIL_WEBHOOK_SECRET}`) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }

    const payload: GmailPayload = await request.json();
    const supabase = createServiceClient();

    // Check for duplicates
    const { data: existing } = await supabase
      .from('accounting_documents')
      .select('id')
      .eq('gmail_message_id', payload.messageId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ message: 'Déjà traité' }, { status: 409 });
    }

    // Check sender against whitelist/blacklist
    const senderAction = await checkSenderRules(supabase, payload.sender);

    // Determine document status based on analysis
    let status: 'confirmed' | 'to_verify' | 'ignored';
    if (senderAction === 'always_ignore') {
      status = 'ignored';
    } else if (senderAction === 'always_import' || payload.confidence >= 0.7) {
      status = 'confirmed';
    } else if (payload.isInvoice) {
      status = payload.confidence >= 0.3 ? 'confirmed' : 'to_verify';
    } else {
      status = 'to_verify';
    }

    // Decode base64 file
    const fileBuffer = Buffer.from(payload.fileBase64, 'base64');

    // Determine month from email date
    const receivedDate = new Date(payload.receivedAt);
    const monthKey = `${receivedDate.getFullYear()}-${String(receivedDate.getMonth() + 1).padStart(2, '0')}`;

    const docId = crypto.randomUUID();
    // Sanitize filename: remove accents, special chars for storage path
    const safeFileName = payload.fileName
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-zA-Z0-9._-]/g, '_'); // Replace special chars
    const storagePath = `${monthKey}/${docId}/${safeFileName}`;

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from('accounting-invoices')
      .upload(storagePath, fileBuffer, {
        contentType: payload.fileType,
        upsert: false,
      });

    if (uploadError) {
      console.error('Storage error:', JSON.stringify(uploadError));
      return NextResponse.json({ error: 'Erreur stockage', details: uploadError.message }, { status: 500 });
    }

    // Extract sender name for title
    const senderName = extractSenderName(payload.sender);
    const title = payload.subject || `Facture ${senderName}`;

    // Insert document
    const { data, error: dbError } = await supabase
      .from('accounting_documents')
      .insert({
        id: docId,
        type: 'invoice',
        source: 'gmail',
        title,
        description: `De: ${payload.sender}\nMots-clés: ${payload.matchedKeywords.join(', ')}`,
        storage_path: storagePath,
        file_name: payload.fileName,
        file_type: payload.fileType,
        file_size_bytes: fileBuffer.length,
        month_key: monthKey,
        category: payload.category || 'supplier',
        status,
        gmail_message_id: payload.messageId,
        gmail_sender: payload.sender,
        gmail_subject: payload.subject,
        gmail_received_at: payload.receivedAt,
      })
      .select()
      .single();

    if (dbError) {
      console.error('DB error:', dbError);
      await supabase.storage.from('accounting-invoices').remove([storagePath]);
      return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 });
    }

    // Update sync state
    await supabase
      .from('accounting_gmail_sync_state')
      .upsert({
        email_account: payload.emailAccount,
        last_synced_at: new Date().toISOString(),
        emails_processed: 1, // Will be incremented
      }, { onConflict: 'email_account' });

    return NextResponse.json({ document: data });
  } catch (err) {
    console.error('Gmail receive error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

async function checkSenderRules(supabase: ReturnType<typeof createServiceClient>, sender: string) {
  const email = sender.match(/<([^>]+)>/)?.[1] || sender;

  const { data: rules } = await supabase
    .from('accounting_email_senders')
    .select('action, email_pattern');

  if (!rules) return null;

  for (const rule of rules) {
    const pattern = rule.email_pattern.replace('*', '.*');
    if (new RegExp(pattern, 'i').test(email)) {
      return rule.action;
    }
  }
  return null;
}

function extractSenderName(sender: string): string {
  const match = sender.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : sender.split('@')[0];
}
