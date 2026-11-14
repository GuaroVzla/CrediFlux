/**
 * OCR and Multimodal AI vision engine for payment receipts and bank transfers
 * Optimized with Venezuelan Banking Rules & Pattern Cross-Validation
 */

/**
 * Parsea y normaliza números con formato venezolano (1.450,50 o 500,00)
 */
export function parseVenezuelanNumber(strNum) {
  if (typeof strNum === 'number' && Number.isFinite(strNum)) {
    return Number(strNum.toFixed(2));
  }
  if (!strNum) return 0;

  let clean = String(strNum).trim();
  // Remover etiquetas o monedas
  clean = clean.replace(/[^\d.,]/g, '').trim();
  if (!clean) return 0;

  const hasDot = clean.includes('.');
  const hasComma = clean.includes(',');

  if (hasDot && hasComma) {
    if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
      // Formato VE: "1.250,50" -> punto miles, coma decimales
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else {
      // Formato US: "1,250.50"
      clean = clean.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Solo coma: "1.250" no aplica; decidir si es decimal o miles
    const parts = clean.split(',');
    const isDecimal = parts.length === 2 && parts[1].length <= 2;
    const isThousands = parts.length > 1 && parts.every((p, i) => i === 0 ? p.length <= 3 : p.length === 3);
    if (isDecimal) {
      clean = clean.replace(/,/g, '.');
    } else if (isThousands) {
      clean = clean.replace(/,/g, ''); // "1,250,000" (miles US)
    } else {
      return 0; // Ambiguo/corrupto: NO inventar valor
    }
  } else if (hasDot) {
    // Solo punto: "1.850" es miles en formato VE (no 1.85)
    const parts = clean.split('.');
    const isThousandsVE = parts.length > 1 && parts.every((p, i) => i === 0 ? p.length <= 3 : p.length === 3);
    const isDecimal = parts.length === 2 && parts[1].length <= 2 && !isThousandsVE;
    if (isThousandsVE && !isDecimal) {
      clean = clean.replace(/\./g, ''); // "1.850" -> 1850
    } else if (isDecimal) {
      // "1850.50" ya está bien para parseFloat
    } else {
      return 0; // Ambiguo/corrupto: NO inventar valor
    }
  }

  const result = parseFloat(clean);
  if (isNaN(result) || !Number.isFinite(result)) return 0;
  // Cota de sanidad: ningún comprobante P2P razonable supera 999.999.999,99 Bs
  if (result <= 0 || result > 999999999.99) return 0;
  return Number(result.toFixed(2));
}

/**
 * Extractor secundario con Regex para filtrar comisiones, teléfonos y cédulas
 */
export function extractVenezuelanAmount(rawText) {
  // Caso 1: la IA ya devolvió un número -> validar y devolver tal cual (NO re-parsear como texto)
  if (typeof rawText === 'number' && Number.isFinite(rawText)) {
    if (rawText > 0 && rawText <= 999999999.99) return Number(rawText.toFixed(2));
    return 0;
  }
  if (!rawText) return 0;

  let text = String(rawText);

  // 1. Descartar números de teléfono móvil comunes (0414, 0424, 0412, 0416, 0426 y formatos con guiones)
  text = text.replace(/(?:0414|0424|0412|0416|0426)[-\s]?\d{3}[-\s]?\d{4}/g, ' [TEL] ');

  // 2. Descartar Cédulas y RIF (V-12.345.678)
  text = text.replace(/[VvJjEeGg][-\s]?\d{1,2}(?:\.\d{3}){2}/g, ' [CEDULA] ');

  // 3. Descartar referencias bancarias, números de operación e identificaciones
  //    (evita concatenar dígitos del monto con la referencia, la cédula o la operación)
  text = text.replace(/\b(?:ref(?:erencia)?|nro|n[uú]m(?:ero)?|operaci[oó]n|identificaci[oó]n|c[eé]dula|rif)\.?\s*(?:n[uú]mero)?\s*[:=]?\s*[\d*][\d*.\-]{3,}/gi, ' [REF] ');

  // 4. ELIMINAR líneas de comisión, IGTF o tasa de cambio (fuente clásica de montos erróneos)
  text = text
    .split(/\n|;|\|| {2,}/)
    .filter(line => !/(comisi[oó]n|igtf|iva|tasa|d[oó]lar|usd|bs\.?\s*\/|convivencia)/i.test(line))
    .join('\n');

  // 5. Número con formato VE/US bien formado (con separadores de miles y/o 2 decimales)
  //    Alt 1: entero con miles opcional + 2 decimales opcionales | Alt 2: termina en decimales
  const numberShape = '(?:[0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)(?:[.,][0-9]{2})?|[0-9]{1,3}(?:[.,][0-9]{3})*[.,][0-9]{2}';

  // 6. Prioridad 1: keywords explícitas de monto principal
  const amountPattern = new RegExp(
    `(?:monto|importe|total|debitado|por\\s*bs\\.?|bs\\.?\\s*por)\\s*(?:de|operaci[oó]n)?[\\s:]*(${numberShape})`,
    'i'
  );
  const match = text.match(amountPattern);
  if (match && match[1]) {
    const parsed = parseVenezuelanNumber(match[1]);
    if (parsed > 0) return parsed;
  }

  // 7. Prioridad 2: cifra precedida por Bs./VES con decimales (ej: "Bs. 1.850,50")
  const bsPattern = new RegExp(`(?:bs\\.?|ves)\\s*(${numberShape})`, 'i');
  const bsMatch = text.match(bsPattern);
  if (bsMatch && bsMatch[1]) {
    const parsed = parseVenezuelanNumber(bsMatch[1]);
    if (parsed > 0) return parsed;
  }

  // 8. Prioridad 3: cifra seguida de Bs/VES (ej: "9.500,00 Bs" en Pagomóvil BDV)
  const postBsPattern = new RegExp(`(${numberShape})\\s*(?:bs\\.?|ves)\\b`, 'i');
  const postBsMatch = text.match(postBsPattern);
  if (postBsMatch && postBsMatch[1]) {
    const parsed = parseVenezuelanNumber(postBsMatch[1]);
    if (parsed > 0) return parsed;
  }

  // 9. Prioridad 4: única cifra con decimales bien formada en todo el texto
  const fallbackPattern = new RegExp(`\\b(${numberShape})\\b`, 'g');
  const candidates = [];
  let m;
  while ((m = fallbackPattern.exec(text)) !== null) {
    const parsed = parseVenezuelanNumber(m[1]);
    if (parsed > 0) candidates.push(parsed);
  }
  // Si hay exactamente una candidata, es el monto con alta confianza
  if (candidates.length === 1) return candidates[0];

  // 10. NUNCA parsear el texto crudo completo: si hay ambigüedad, devolver 0
  //    (mejor forzar revisión manual que registrar un monto inventado)
  return 0;
}

/**
 * Valida o empareja el banco emisor contra los patrones registrados por el Administrador
 */
export function matchBankWithPatterns(detectedText, detectedBank, patterns = []) {
  if (!patterns || patterns.length === 0) {
    return detectedBank || 'Desconocido';
  }

  const searchHaystack = `${detectedText || ''} ${detectedBank || ''}`.toLowerCase();

  for (const pat of patterns) {
    const bankNameLower = (pat.bankName || '').toLowerCase();
    if (bankNameLower && searchHaystack.includes(bankNameLower)) {
      return pat.bankName;
    }
    if (Array.isArray(pat.keywords)) {
      for (const kw of pat.keywords) {
        if (kw && searchHaystack.includes(kw.toLowerCase())) {
          return pat.bankName;
        }
      }
    }
  }

  return detectedBank || 'Desconocido';
}

/**
 * Estructura el texto plano devuelto por OCR.space en los campos financieros
 * esperados por el módulo E-commerce (reglas venezolanas del motor).
 */
export function structurePlainOcrText(rawText, registeredPatterns = []) {
  const text = String(rawText || '');

  // --- MONTO: extractor con descartes de teléfonos, cédulas, referencias y comisiones ---
  const monto = extractVenezuelanAmount(text);

  // --- FECHA: formatos dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd, dd/mm/yy ---
  let fecha = '';
  const dateMatch = text.match(
    /\b(\d{4}-\d{2}-\d{2})|(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/
  );
  if (dateMatch) {
    if (dateMatch[1]) {
      fecha = dateMatch[1]; // ya está en ISO
    } else {
      const [, , d, m, y] = dateMatch;
      let year = parseInt(y, 10);
      if (year < 100) year += 2000;
      const mm = String(parseInt(m, 10)).padStart(2, '0');
      const dd = String(parseInt(d, 10)).padStart(2, '0');
      // Validación básica de rango calendario
      if (mm >= '01' && mm <= '12' && dd >= '01' && dd <= '31' && year >= 2000 && year <= 2100) {
        fecha = `${year}-${mm}-${dd}`;
      }
    }
  }

  // --- REFERENCIA: keyword explícita o número aislado de 6-12 dígitos ---
  let referencia = 'N/A';
  const refKeyword = text.match(
    /(?:ref(?:erencia)?|operaci[oó]n|nro\.?\s*n[uú]m(?:ero)?|n[uú]mero de (?:operaci[oó]n|referencia))\s*[:=]?\s*(\d[\d.\-]{5,})/i
  );
  if (refKeyword && refKeyword[1]) {
    referencia = refKeyword[1].replace(/[.\-\s]/g, '').replace(/^0+(?=\d)/, '');
  } else {
    // Descartar teléfonos y cédulas antes de buscar números sueltos
    const cleaned = text
      .replace(/(?:0414|0424|0412|0416|0426)[-\s]?\d{3}[-\s]?\d{4}/g, ' ')
      .replace(/[VvJjEeGg][-\s]?\d{1,2}(?:\.\d{3}){2}/g, ' ');
    const loose = cleaned.match(/\b(\d{6,12})\b/);
    if (loose) referencia = loose[1];
  }

  // --- BANCO EMISOR: cruzar contra patrones registrados y menciones en el texto ---
  let detectedBank = '';
  const bankLineMatch = text.match(/^(.*\bbanco\b.*)$/im); // línea que menciona un banco
  if (bankLineMatch) {
    let line = bankLineMatch[1].trim();
    // Quitar la etiqueta inicial (Banco Emisor / Banco de Origen / Banco:) conservando el nombre
    const labelStripped = line.replace(/^(?:banco\s*(?:emisor|de\s*origen|receptor)?)\s*[:\-]?\s*/i, '');
    if (labelStripped && labelStripped !== line) {
      line = labelStripped;
      // Si la etiqueta consumió la palabra "Banco" y el nombre empezaba con "de",
      // reconstruir el nombre comercial (ej: "Banco de Venezuela")
      if (!/^\s*banco/i.test(line) && /^\s*de\s/i.test(line)) line = 'Banco ' + line.trim();
    }
    // Formato código-nombre usado por Pagomóvil (ej: "0134 - BANESCO")
    const codeName = line.match(/^\d{3,4}\s*[-–]\s*(.+)$/);
    if (codeName) line = codeName[1].trim();
    detectedBank = line.replace(/\s*[:].*$/, '').trim(); // cortar sobrantes tipo "Banco X: 0102"
  }
  const bancoOrigen = matchBankWithPatterns(text, detectedBank, registeredPatterns);
  const bancoDestino = 'Desconocido'; // OCR.space (texto plano) no distingue emisor/receptor por separado

  return {
    monto,
    fecha: fecha || new Date().toISOString().split('T')[0],
    referencia,
    bancoOrigen,
    bancoDestino,
    textoIdentificado: text.slice(0, 500),
    confianza: monto > 0 ? '85%' : '0%'
  };
}

export async function parseReceiptWithAI({
  imageBuffer,
  mimeType,
  apiKey,
  provider = 'openai',
  registeredPatterns = [],
  ocrSpaceApiKey = null
}) {
  const base64Data = imageBuffer.toString('base64');

  // Nombres de bancos patrones conocidos para inyectar en el prompt
  const patternBankList = registeredPatterns.map(p => p.bankName).filter(Boolean);
  const patternBankContext = patternBankList.length > 0
    ? `Bancos prioritarios reconocidos en el sistema: [${patternBankList.join(', ')}]. Si el membrete, colores o logotipo coinciden con alguno, usa ese nombre exacto.`
    : '';

  const SYSTEM_PROMPT = `Eres un perito bancario auditor y especialista en comprobantes de Pago Móvil (P2P/C2P) y transferencias de bancos venezolanos (Banesco, Banco de Venezuela BDV, Mercantil, BBVA Provincial, Bancaribe, BNC, Banco Bicentenario, etc.).

${patternBankContext}

REGLAS ESTRICTAS DE EXTRACCIÓN FINANCIERA VENEZOLANA:
1. MONTO EXACTO (montoBs):
   - Extrae el Monto Principal de la transacción en Bolívares (Bs / VES).
   - REGLA DE DESCARTE OBLIGATORIA:
     * NO confundas el monto con números de teléfono (ej: 04141234567, 0412...).
     * NO confundas el monto con Cédulas o RIF (ej: V-18.452.910).
     * NO tomes el monto de Comisión bancaria o IGTF (ej: Bs. 4,50 o 0,3%). Toma el Monto de la Operación.
   - En Venezuela el punto (.) separa miles y la coma (,) separa decimales (ej: "Bs. 1.850,50" -> 1850.50). Devuelve un número puro con máximo 2 decimales.

2. BANCO EMISOR (bancoOrigen):
   - El banco que emite o transfiere el dinero. Identifícalo por el logotipo, membrete o color del comprobante.
   - Si coincide con algún banco prioritario, nómbralo idéntico.

3. BANCO RECEPTOR (bancoDestino):
   - El banco que recibe los fondos (banco destino).

4. REFERENCIA:
   - Número de confirmación o referencia bancaria (típicamente entre 6 y 12 dígitos).

Responde ÚNICAMENTE en JSON válido con este formato:
{
  "montoBs": number (ej: 1850.50),
  "fecha": "YYYY-MM-DD",
  "referencia": string,
  "bancoOrigen": string,
  "bancoDestino": string,
  "textoIdentificado": string,
  "confianza": "99%"
}`;

  // 1. Proveedor OpenAI (GPT-4o-mini Vision)
  if (provider === 'openai' && apiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: SYSTEM_PROMPT
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Extrae con máxima precisión los datos financieros de este comprobante bancario venezolano:'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64Data}`
                  }
                }
              ]
            }
          ],
          max_tokens: 600,
          temperature: 0.0
        })
      });

      if (response.ok) {
        const result = await response.json();
        const content = result.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          const rawMonto = parsed.montoBs !== undefined ? parsed.montoBs : parsed.monto;
          const cleanMonto = extractVenezuelanAmount(rawMonto);

          const matchedBankOrigin = matchBankWithPatterns(
            parsed.textoIdentificado || parsed.bancoOrigen,
            parsed.bancoOrigen,
            registeredPatterns
          );

          return {
            success: true,
            provider: 'OpenAI GPT-4o-mini',
            data: {
              monto: cleanMonto,
              fecha: parsed.fecha || new Date().toISOString().split('T')[0],
              referencia: parsed.referencia || 'N/A',
              bancoOrigen: matchedBankOrigin,
              bancoDestino: parsed.bancoDestino || 'Desconocido',
              confianza: parsed.confianza || '98%'
            }
          };
        }
      }
    } catch (err) {
      console.warn('OpenAI Vision OCR error, usando fallback:', err.message);
    }
  }

  // 2. Proveedor Google Gemini (Gemini 1.5 Flash con Structured JSON)
  if (provider === 'gemini' && apiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.0
          },
          contents: [
            {
              parts: [
                {
                  text: `${SYSTEM_PROMPT}\n\nAnaliza la imagen adjunta y devuelve ÚNICAMENTE el objeto JSON estructurado.`
                },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data
                  }
                }
              ]
            }
          ]
        })
      });

      if (response.ok) {
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const parsed = JSON.parse(cleanText);
          const rawMonto = parsed.montoBs !== undefined ? parsed.montoBs : parsed.monto;
          const cleanMonto = extractVenezuelanAmount(rawMonto);

          const matchedBankOrigin = matchBankWithPatterns(
            parsed.textoIdentificado || parsed.bancoOrigen,
            parsed.bancoOrigen,
            registeredPatterns
          );

          return {
            success: true,
            provider: 'Google Gemini 1.5 Flash',
            data: {
              monto: cleanMonto,
              fecha: parsed.fecha || new Date().toISOString().split('T')[0],
              referencia: parsed.referencia || 'N/A',
              bancoOrigen: matchedBankOrigin,
              bancoDestino: parsed.bancoDestino || 'Desconocido',
              confianza: parsed.confianza || '99%'
            }
          };
        }
      }
    } catch (err) {
      console.warn('Gemini Vision OCR error, usando fallback:', err.message);
    }
  }

  // 3. Proveedor OCR.space (API gratuita, endpoint /parse/image)
  //    Devuelve texto plano; se estructura con el motor de reglas venezolanas.
  if (provider === 'ocrspace') {
    const spaceKey = ocrSpaceApiKey || apiKey;

    if (!spaceKey) {
      return {
        success: false,
        provider: 'OCR.space (API gratuita)',
        error: 'Falta la clave del lector OCR. Configúrala en Ajustes → Motor de IA.',
        data: { monto: 0, fecha: new Date().toISOString().split('T')[0], referencia: 'N/A', bancoOrigen: 'Desconocido', bancoDestino: 'Desconocido', confianza: '0%' }
      };
    }

    try {
      const formData = new URLSearchParams();
      formData.append('apikey', spaceKey);
      formData.append('base64Image', `data:${mimeType};base64,${base64Data}`);
      formData.append('language', 'spa');
      formData.append('isOverlayRequired', 'false');
      formData.append('detectOrientation', 'true');
      formData.append('scale', 'true');
      formData.append('isTable', 'true'); // Los comprobantes son tablas con columnas etiqueta/valor
      formData.append('OCREngine', '2');

      const response = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'apikey': spaceKey
        },
        body: formData.toString()
      });

      const rawResult = await response.json().catch(() => null);

      if (!response.ok || !rawResult) {
        console.warn('OCR.space HTTP error:', response.status);
        return {
          success: false,
          provider: 'OCR.space (API gratuita)',
          error: response.status === 429
            ? 'Se alcanzó el límite de la API gratuita. Espera unos minutos e intenta de nuevo.'
            : 'El servicio de lectura no está disponible ahora. Intenta de nuevo en unos momentos.',
          data: { monto: 0, fecha: new Date().toISOString().split('T')[0], referencia: 'N/A', bancoOrigen: 'Desconocido', bancoDestino: 'Desconocido', confianza: '0%' }
        };
      }

      if (rawResult.IsErroredOnProcessing || (rawResult.ErrorMessage && rawResult.ErrorMessage.length > 0)) {
        const errMsg = Array.isArray(rawResult.ErrorMessage) ? rawResult.ErrorMessage.join(' | ') : rawResult.ErrorMessage;
        console.warn('OCR.space processing error:', errMsg);
        return {
          success: false,
          provider: 'OCR.space (API gratuita)',
          error: /invalid|incorrect|api ?key/i.test(String(errMsg))
            ? 'La clave del lector OCR no es válida. Revisa la clave en Ajustes.'
            : 'No se pudo procesar la imagen. Intenta con otra foto más clara.',
          data: { monto: 0, fecha: new Date().toISOString().split('T')[0], referencia: 'N/A', bancoOrigen: 'Desconocido', bancoDestino: 'Desconocido', confianza: '0%' }
        };
      }

      const rawText = rawResult.ParsedResults?.[0]?.ParsedText || '';
      if (!rawText.trim()) {
        return {
          success: false,
          provider: 'OCR.space (API gratuita)',
          error: 'No se detectó texto en la imagen. Sube una foto más nítida y bien iluminada.',
          data: { monto: 0, fecha: new Date().toISOString().split('T')[0], referencia: 'N/A', bancoOrigen: 'Desconocido', bancoDestino: 'Desconocido', confianza: '0%' }
        };
      }

      // Estructuración del texto plano con las reglas financieras venezolanas del motor
      const structured = structurePlainOcrText(rawText, registeredPatterns);

      if (structured.monto <= 0) {
        return {
          success: false,
          provider: 'OCR.space (API gratuita)',
          error: 'No se pudo identificar el monto con certeza. Regístralo manualmente o sube una foto más nítida.',
          data: structured
        };
      }

      return {
        success: true,
        provider: 'OCR.space (API gratuita)',
        data: structured,
        rawOcrText: rawText
      };
    } catch (err) {
      console.warn('OCR.space OCR error:', err.message);
      return {
        success: false,
        provider: 'OCR.space (API gratuita)',
        error: 'No hay conexión con el servicio de lectura. Revisa tu internet e intenta de nuevo.',
        data: { monto: 0, fecha: new Date().toISOString().split('T')[0], referencia: 'N/A', bancoOrigen: 'Desconocido', bancoDestino: 'Desconocido', confianza: '0%' }
      };
    }
  }

  // 4. Fallback Heurístico: SIN datos de visión confiables NO se inventa ningún monto.
  //    (Antes se devolvía un monto fijo de 1450,50 Bs, lo que corrompía la contabilidad)
  return {
    success: false,
    provider: 'Motor Heurístico / Validación Cruzada de Patrones',
    error: 'No se pudo leer el comprobante. Configura el lector OCR en Ajustes o regístra el monto manualmente.',
    data: {
      monto: 0,
      fecha: new Date().toISOString().split('T')[0],
      referencia: 'N/A',
      bancoOrigen: 'Desconocido',
      bancoDestino: 'Desconocido',
      confianza: '0%'
    }
  };
}
