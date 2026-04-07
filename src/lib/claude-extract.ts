export interface ExtractedDocData {
  amount_cents: number | null;
  currency: string | null; // ISO 4217 currency code (EUR, USD, GBP...)
  vendor: string | null;
  document_date: string | null;
  document_datetime: string | null; // ISO datetime for precise matching
  reference: string | null; // Invoice/transaction reference number
  description: string | null;
}

const EXTRACTION_PROMPT = `Analyse ce document comptable (facture, ticket de caisse, ou reçu).
Extrais les informations suivantes au format JSON strict :
{
  "amount_cents": <montant total TTC en centimes de la devise originale, entier, ou null si illisible>,
  "currency": "<code devise ISO 4217 : EUR, USD, GBP, etc., ou null si illisible>",
  "vendor": "<nom du fournisseur/commerçant, ou null si illisible>",
  "document_date": "<date du document au format YYYY-MM-DD, ou null si illisible>",
  "document_datetime": "<date et heure exacte au format YYYY-MM-DDTHH:MM:SS, ou null si pas d'heure>",
  "reference": "<numéro de facture, numéro de référence, ou ID de transaction, ou null si absent>",
  "description": "<description courte du document en 10 mots max>"
}
Règles :
- Pour amount_cents : convertis en centimes de la devise du document (ex: $7.50 → 750, 42.50€ → 4250). Utilise le montant TTC total.
- Pour currency : indique la devise telle qu'affichée sur le document ($, USD → "USD", €, EUR → "EUR", £, GBP → "GBP"). Par défaut "EUR" si aucune devise visible.
- Pour vendor : utilise le nom commercial, pas l'adresse.
- Pour reference : cherche un numéro de facture, référence de paiement, ou ID de transaction unique.
- Réponds UNIQUEMENT avec le JSON, sans commentaire ni markdown.`;

function parseJsonResponse(text: string): ExtractedDocData {
  const jsonStr = text.replace(/^```json?\n?/g, '').replace(/\n?```$/g, '').trim();
  const parsed = JSON.parse(jsonStr);

  return {
    amount_cents: typeof parsed.amount_cents === 'number' ? Math.round(parsed.amount_cents) : null,
    currency: typeof parsed.currency === 'string' && /^[A-Z]{3}$/.test(parsed.currency) ? parsed.currency : null,
    vendor: typeof parsed.vendor === 'string' ? parsed.vendor : null,
    document_date: typeof parsed.document_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.document_date) ? parsed.document_date : null,
    document_datetime: typeof parsed.document_datetime === 'string' ? parsed.document_datetime : null,
    reference: typeof parsed.reference === 'string' ? parsed.reference : null,
    description: typeof parsed.description === 'string' ? parsed.description.slice(0, 200) : null,
  };
}

/**
 * Extract structured data from a document using Mistral AI (primary) or Gemini (fallback).
 * - PDFs: Mistral OCR → Mistral Chat for structured extraction
 * - Images: Mistral Chat with vision
 * - Fallback: Gemini if Mistral fails
 * Returns null on any failure (timeout, API error, parse error).
 */
export async function extractDocumentData(
  fileBuffer: Buffer,
  fileType: string
): Promise<ExtractedDocData | null> {
  const mistralKey = process.env.MISTRAL_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!mistralKey && !geminiKey) {
    console.error('[extract] No API key set (MISTRAL_API_KEY or GEMINI_API_KEY), skipping');
    return null;
  }

  const base64Data = fileBuffer.toString('base64');

  // Try Mistral first
  if (mistralKey) {
    try {
      console.log(`[extract] Trying Mistral, fileType=${fileType}, size=${fileBuffer.length}`);
      const result = await extractWithMistral(base64Data, fileType, mistralKey);
      if (result) return result;
    } catch (err) {
      console.warn('[extract] Mistral failed:', err instanceof Error ? err.message : err);
    }
  }

  // Fallback to Gemini
  if (geminiKey) {
    try {
      console.log('[extract] Falling back to Gemini');
      return await extractWithGemini(base64Data, fileType, geminiKey);
    } catch (err) {
      console.warn('[extract] Gemini failed:', err instanceof Error ? err.message : err);
    }
  }

  return null;
}

async function extractWithMistral(
  base64Data: string,
  fileType: string,
  apiKey: string
): Promise<ExtractedDocData | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    if (fileType === 'application/pdf' || fileType === 'application/octet-stream') {
      // Step 1: OCR to extract text
      const ocrResponse = await fetch('https://api.mistral.ai/v1/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'mistral-ocr-latest',
          document: {
            type: 'document_url',
            document_url: `data:application/pdf;base64,${base64Data}`,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!ocrResponse.ok) {
        const errorText = await ocrResponse.text();
        throw new Error(`Mistral OCR ${ocrResponse.status}: ${errorText.substring(0, 200)}`);
      }

      const ocrResult = await ocrResponse.json();
      const markdownText = ocrResult.pages?.map((p: { markdown: string }) => p.markdown).join('\n\n') || '';

      if (!markdownText.trim()) return null;

      // Step 2: Parse extracted text with chat
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 15000);

      const chatResponse = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [{
            role: 'user',
            content: `Voici le texte extrait d'un document comptable :\n\n${markdownText.substring(0, 4000)}\n\n${EXTRACTION_PROMPT}`,
          }],
          temperature: 0,
          max_tokens: 512,
        }),
        signal: controller2.signal,
      });

      clearTimeout(timeout2);

      if (!chatResponse.ok) {
        const errorText = await chatResponse.text();
        throw new Error(`Mistral Chat ${chatResponse.status}: ${errorText.substring(0, 200)}`);
      }

      const chatResult = await chatResponse.json();
      const text = chatResult.choices?.[0]?.message?.content;
      if (!text) return null;

      console.log('[extract] Mistral OCR+Chat response:', text.substring(0, 200));
      return parseJsonResponse(text);

    } else {
      // Images: use chat vision directly
      const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${fileType};base64,${base64Data}` },
              },
              { type: 'text', text: EXTRACTION_PROMPT },
            ],
          }],
          temperature: 0,
          max_tokens: 512,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mistral Chat ${response.status}: ${errorText.substring(0, 200)}`);
      }

      const result = await response.json();
      const text = result.choices?.[0]?.message?.content;
      if (!text) return null;

      console.log('[extract] Mistral Vision response:', text.substring(0, 200));
      return parseJsonResponse(text);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function extractWithGemini(
  base64Data: string,
  fileType: string,
  apiKey: string
): Promise<ExtractedDocData | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: fileType, data: base64Data } },
              { text: EXTRACTION_PROMPT },
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 512 },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    console.log('[extract] Gemini response:', text.substring(0, 200));
    return parseJsonResponse(text);
  } finally {
    clearTimeout(timeout);
  }
}
