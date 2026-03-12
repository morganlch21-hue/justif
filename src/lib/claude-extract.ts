export interface ExtractedDocData {
  amount_cents: number | null;
  vendor: string | null;
  document_date: string | null;
  description: string | null;
}

const EXTRACTION_PROMPT = `Analyse ce document comptable (facture, ticket de caisse, ou reçu).
Extrais les informations suivantes au format JSON strict :
{
  "amount_cents": <montant total TTC en centimes d'euros, entier, ou null si illisible>,
  "vendor": "<nom du fournisseur/commerçant, ou null si illisible>",
  "document_date": "<date du document au format YYYY-MM-DD, ou null si illisible>",
  "description": "<description courte du document en 10 mots max>"
}
Règles :
- Pour amount_cents : convertis en centimes (ex: 42.50€ → 4250). Utilise le montant TTC total.
- Pour vendor : utilise le nom commercial, pas l'adresse.
- Réponds UNIQUEMENT avec le JSON, sans commentaire ni markdown.`;

/**
 * Extract structured data from a document (PDF or image) using Claude Vision.
 * Returns null on any failure (timeout, API error, parse error).
 * Has a 6-second timeout to avoid blocking the upload flow.
 */
export async function extractDocumentData(
  fileBuffer: Buffer,
  fileType: string
): Promise<ExtractedDocData | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set, skipping document extraction');
    return null;
  }

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
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
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
      console.error('Claude API error:', response.status, errorText);
      return null;
    }

    const result = await response.json();
    const text = result.content?.[0]?.text;
    if (!text) return null;

    // Parse JSON response (handle potential markdown wrapping)
    const jsonStr = text.replace(/^```json?\n?/g, '').replace(/\n?```$/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      amount_cents: typeof parsed.amount_cents === 'number' ? Math.round(parsed.amount_cents) : null,
      vendor: typeof parsed.vendor === 'string' ? parsed.vendor : null,
      document_date: typeof parsed.document_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.document_date) ? parsed.document_date : null,
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
