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
 * Extract structured data from a document (PDF or image) using Google Gemini.
 * Uses Gemini 2.5 Flash (free tier: 15 RPM, 1000 req/day).
 * Returns null on any failure (timeout, API error, parse error).
 */
export async function extractDocumentData(
  fileBuffer: Buffer,
  fileType: string
): Promise<ExtractedDocData | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[extract] GEMINI_API_KEY not set, skipping document extraction');
    return null;
  }
  console.log(`[extract] Starting Gemini extraction, fileType=${fileType}, bufferSize=${fileBuffer.length}`);

  try {
    const base64Data = fileBuffer.toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: fileType,
                    data: base64Data,
                  },
                },
                { text: EXTRACTION_PROMPT },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 512,
          },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[extract] Gemini API error:', response.status, errorText.substring(0, 300));
      return null;
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('[extract] Gemini response:', text?.substring(0, 200));
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
      console.warn('[extract] Gemini extraction timed out');
      return null;
    }
    console.error('[extract] Document extraction error:', err);
    return null;
  }
}
