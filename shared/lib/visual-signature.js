/**
 * Firma visual compacta y comparación de patrones de comprobantes.
 *
 * Se usa un dHash 9x8: se reduce la imagen a 9x8 niveles de gris y se
 * comparan los 8 píxeles horizontales adyacentes de cada fila, produciendo
 * 64 bits (16 hexadecimales). Es estable ante escalado, compresión y cambios
 * leves de color, que es exactamente el caso de capturas de comprobantes.
 *
 * Este módulo es 100% puro: no usa DOM ni Node. El cálculo de la firma desde
 * un archivo vive en `visual-signature-client.js` (navegador) y en el script
 * de backfill (sharp).
 */

export const VISUAL_SIGNATURE_ALGORITHM = 'dhash-9x8';
export const VISUAL_SIGNATURE_VERSION = 1;
export const VISUAL_SIGNATURE_BITS = 64;

/** Distancia máxima de Hamming aceptada como coincidence (<=12/64 bits). */
export const VISUAL_MATCH_MAX_DISTANCE = 12;

/** Margen mínimo sobre el segundo candidato para evitar empates ambiguos. */
export const VISUAL_MATCH_MIN_MARGIN = 2;

/** Normaliza una firma almacenada o recibida; devuelve null si no es válida. */
export function normalizeVisualSignature(value) {
  if (!value || typeof value !== 'object') return null;

  const algorithm = value.algorithm || VISUAL_SIGNATURE_ALGORITHM;
  if (algorithm !== VISUAL_SIGNATURE_ALGORITHM) return null;

  const hash = String(value.hash || '')
    .trim()
    .toLowerCase()
    .replace(/^0x/, '');
  if (!new RegExp(`^[0-9a-f]{${VISUAL_SIGNATURE_BITS / 4}}$`).test(hash)) return null;

  const width = Number(value.width);
  const height = Number(value.height);
  const aspectRatio = Number(value.aspectRatio);

  return {
    algorithm,
    version: Number(value.version) || VISUAL_SIGNATURE_VERSION,
    hash,
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    aspectRatio: Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : null,
  };
}

/** Convierte el valor de un FormData (string JSON) en una firma válida. */
export function parseVisualSignature(value) {
  if (value === null || value === undefined || value === '') return null;
  const isFile = typeof File !== 'undefined' && value instanceof File;
  if (typeof value === 'object' && !isFile) {
    return normalizeVisualSignature(value);
  }
  try {
    return normalizeVisualSignature(JSON.parse(String(value)));
  } catch {
    return null;
  }
}

/** Número de bits diferentes entre dos hashes hexadecimales. */
export function hammingDistance(leftHash, rightHash) {
  const left = String(leftHash || '').toLowerCase();
  const right = String(rightHash || '').toLowerCase();
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;

  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let xor = parseInt(left[index], 16) ^ parseInt(right[index], 16);
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/**
 * Elige el patrón activo cuya imagen se parece más a la del comprobante.
 * Devuelve null cuando no hay coincidencia suficiente o cuando hay empate:
 * en ese caso el OCR debe seguir con su estrategia textual habitual.
 */
export function matchBankByVisualSignature(signature, patterns = []) {
  const receiptSignature = normalizeVisualSignature(signature);
  if (!receiptSignature) return null;

  const activePatterns = (Array.isArray(patterns) ? patterns : [])
    .filter((pattern) => pattern && pattern.isActive !== false);

  const candidates = [];
  for (const pattern of activePatterns) {
    const patternSignature = normalizeVisualSignature(
      pattern.extra?.visualSignature || pattern.visualSignature
    );
    if (!patternSignature) continue;

    const distance = hammingDistance(receiptSignature.hash, patternSignature.hash);
    if (distance > VISUAL_MATCH_MAX_DISTANCE) continue;

    // La proporción sólo desempata; una captura recortada no debe descartar
    // un patrón válido por diferencias de encuadre.
    const aspectDelta =
      receiptSignature.aspectRatio && patternSignature.aspectRatio
        ? Math.min(Math.abs(receiptSignature.aspectRatio - patternSignature.aspectRatio), 0.5)
        : 0;
    const score = distance + aspectDelta * 2;

    candidates.push({
      pattern,
      distance,
      score,
      similarity: Number((1 - distance / VISUAL_SIGNATURE_BITS).toFixed(4)),
    });
  }

  candidates.sort((a, b) => a.score - b.score || a.distance - b.distance);
  const best = candidates[0];
  if (!best) return null;

  const runnerUp = candidates[1];
  if (runnerUp && runnerUp.score - best.score < VISUAL_MATCH_MIN_MARGIN) return null;

  const bankName = String(best.pattern.bankName || best.pattern.bank || '').trim();
  if (!bankName) return null;

  return {
    bankName,
    patternId: best.pattern.id || null,
    distance: best.distance,
    similarity: best.similarity,
    algorithm: VISUAL_SIGNATURE_ALGORITHM,
  };
}
