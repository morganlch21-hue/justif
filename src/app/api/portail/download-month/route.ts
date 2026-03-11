import { createServiceClient } from '@/lib/supabase';
import { createHash } from 'crypto';
import { NextResponse } from 'next/server';

// Note: For a production zip, you'd use archiver or jszip.
// This simplified version creates a multipart download redirect.
// For now, we generate individual signed URLs.

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const token = searchParams.get('token');

    if (!month || !token) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Validate token
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { data: validToken } = await supabase
      .from('accounting_portail_tokens')
      .select('id')
      .eq('token_hash', tokenHash)
      .eq('is_active', true)
      .maybeSingle();

    if (!validToken) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Get all documents for this month
    const { data: docs } = await supabase
      .from('accounting_documents')
      .select('*')
      .eq('month_key', month)
      .neq('status', 'ignored')
      .order('created_at');

    if (!docs || docs.length === 0) {
      return NextResponse.json({ error: 'Aucun document ce mois' }, { status: 404 });
    }

    // Dynamically import archiver
    // For simplicity, we'll return a JSON list of download URLs
    // In production, you'd use archiver to create a real zip
    const files = [];

    for (const doc of docs) {
      const bucket = doc.type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
      const { data } = await supabase.storage
        .from(bucket)
        .createSignedUrl(doc.storage_path, 3600); // 1 hour

      if (data?.signedUrl) {
        files.push({
          name: doc.file_name,
          url: data.signedUrl,
          type: doc.type,
          title: doc.title,
        });
      }
    }

    // Return as HTML page with download links
    const html = `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Téléchargement - ${month}</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; }
          h1 { font-size: 1.5rem; }
          .file { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #eee; }
          .file-info { flex: 1; }
          .file-name { font-weight: 500; }
          .file-type { font-size: 0.85rem; color: #666; }
          a.dl { padding: 6px 16px; background: #1e40af; color: white; border-radius: 6px; text-decoration: none; font-size: 0.9rem; }
          a.dl:hover { background: #1e3a8a; }
        </style>
      </head>
      <body>
        <h1>Documents - ${month}</h1>
        <p>${files.length} fichier(s)</p>
        ${files.map(f => `
          <div class="file">
            <div class="file-info">
              <div class="file-name">${f.title}</div>
              <div class="file-type">${f.type === 'invoice' ? 'Facture' : 'Ticket'} - ${f.name}</div>
            </div>
            <a class="dl" href="${f.url}" download="${f.name}">Télécharger</a>
          </div>
        `).join('')}
      </body>
      </html>
    `;

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
