export interface ExtractedDocData {
  amount_cents: number | null;
  vendor: string | null;
  document_date: string | null;
  document_datetime: string | null; // ISO datetime for precise matching
  reference: string | null; // Invoice/transaction reference number
  description: string | null;
}

const EXTRACTION_PROMPT = `Analyse ce document comptable (facture, ticket de caisse, ou reçu).
Extrais les informations suivantes au format JSON strict :
{
  "amount_cents": <montant total TTC en centimes d'euros, entier, ou null si illisible>,
  "vendor": "<nom du fournisseur/commerçant, ou null si illisible>",
  "document_date": "<date du document au format YYYY-MM-DD, ou null si illisible>",
  "document_datetime": "<date et heure exacte au format YYYY-MM-DDTHH:MM:SS, ou null si pas d'heure>",
  "reference": "<numéro de facture, numéro de référence, ou ID de transaction, ou null si absent>",
  "description": "<description courte du document en 10 mots max>"
}
Règles :
- Pour amount_cents : convertis en centimes (ex: 42.50€ → 4250). Utilise le montant TTC total.
- Pour vendor : utilise le nom commercial, pas l'adresse.
- Pour reference : cherche un numéro de facture, référence de paiement, ou ID de transaction unique.
- Réponds UNIQUEMENT avec le JSON, sans commentaire ni markdown.`;

/**
 * Extract structured data from a document (PDF or image) using Claude Vision.
 * Returns null on any failure (timeout, API error, parse error).
 * Has a 5-second timeout to stay within Vercel's 10s function limit.
 */
export async function extractDocumentData(
  fileBuffer: Buffer,
  fileType: string
): Promise<ExtractedDocData | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set, skipping document extraction');
    return null;
  }
  console.log(`[extract] Starting extraction, fileType=${fileType}, bufferSize=${fileBuffer.length}`);

  try {
    const base64Data = fileBuffer.toString('base64');
    const isPdf = fileType === 'application/pdf';

    // Build the content block based on file type
    const fileContent = isPdf
      ? {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: base64Data,
          },
        }
      : {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: fileType as 'image/jpeg' | 'image/png' | 'image/webp',
            data: base64Data,
          },
        };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25s for large PDFs

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-20250414',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: [
              fileContent,
              { type: 'text', text: EXTRACTION_PROMPT },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[extract] Claude API error:', response.status, errorText.substring(0, 300));
      return null;
    }

    const result = await response.json();
    const text = result.content?.[0]?.text;
    console.log('[extract] Claude response:', text?.substring(0, 200));
    if (!text) return null;

    // Parse JSON response (handle potential markdown wrapping)
    const jsonStr = text.replace(/^```json?\n?/g, '').replace(/\n?```$/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      amount_cents: typeof parsed.amount_cents === 'number' ? Math.round(parsed.amount_cents) : null,
      vendor: typeof parsed.vendor === 'string' ? parsed.vendor : null,
      document_date: typeof parsed.document_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.document_date) ? parsed.document_date : null,
      document_datetime: typeof parsed.document_datetime === 'string' ? parsed.document_datetime : null,
      reference: typeof parsed.reference === 'string' ? parsed.reference : null,
      description: typeof parsed.description === 'string' ? parsed.description.slice(0, 200) : null,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('Claude extraction timed out');
      return null;
    }
    console.error('Document extraction error:', err);
    return null;
  }
}
