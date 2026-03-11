import { createServiceClient } from '@/lib/supabase';
import { validatePortailToken } from '@/lib/portail-auth';
import { NextResponse } from 'next/server';
import JSZip from 'jszip';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const token = searchParams.get('token');

    if (!month || !token) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 });
    }

    const { valid } = await validatePortailToken(token);
    if (!valid) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const supabase = createServiceClient();

    // Get all confirmed documents for this month
    const { data: docs } = await supabase
      .from('accounting_documents')
      .select('*')
      .eq('month_key', month)
      .eq('status', 'confirmed')
      .order('created_at');

    if (!docs || docs.length === 0) {
      return NextResponse.json({ error: 'Aucun document ce mois' }, { status: 404 });
    }

    // Build ZIP file
    const zip = new JSZip();
    const usedNames = new Set<string>();

    for (const doc of docs) {
      const bucket = doc.type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
      const { data } = await supabase.storage
        .from(bucket)
        .download(doc.storage_path);

      if (data) {
        // Organize in subfolders: Factures-Fournisseurs/, Factures-Clients/, Tickets/
        let folder = 'Tickets';
        if (doc.type === 'invoice') {
          folder = doc.category === 'client' ? 'Factures-Clients' : 'Factures-Fournisseurs';
        }

        // Ensure unique filenames
        let fileName = doc.file_name;
        if (usedNames.has(`${folder}/${fileName}`)) {
          const ext = fileName.lastIndexOf('.');
          fileName = ext > 0
            ? `${fileName.slice(0, ext)}-${doc.id.slice(0, 6)}${fileName.slice(ext)}`
            : `${fileName}-${doc.id.slice(0, 6)}`;
        }
        usedNames.add(`${folder}/${fileName}`);

        const arrayBuffer = await data.arrayBuffer();
        zip.file(`${folder}/${fileName}`, arrayBuffer);
      }
    }

    // Add CSV summary
    const csvHeader = 'Date,Titre,Type,Catégorie,Montant,Fichier,Qonto\n';
    const csvRows = docs.map(doc => {
      const date = new Date(doc.created_at).toLocaleDateString('fr-FR');
      const type = doc.type === 'invoice' ? 'Facture' : 'Ticket';
      const cat = doc.type === 'invoice' ? (doc.category === 'client' ? 'Client' : 'Fournisseur') : '';
      const amount = doc.amount_cents ? (doc.amount_cents / 100).toFixed(2) : '';
      const qonto = doc.qonto_attachment_sent ? 'Oui' : 'Non';
      const title = doc.title.replace(/"/g, '""');
      return `${date},"${title}",${type},${cat},${amount},"${doc.file_name}",${qonto}`;
    }).join('\n');
    zip.file('_resume.csv', '\uFEFF' + csvHeader + csvRows); // BOM for Excel

    const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });
    const safeName = `ML-Consulting_${month}.zip`;

    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeName}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
