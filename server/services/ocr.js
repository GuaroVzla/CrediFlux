/**
 * OCR and Multimodal AI vision engine for payment receipts and bank transfers
 * Optimized with Venezuelan Banking Rules & Pattern Cross-Validation
 * Proveedores: OpenAI, Gemini, OCR.space, Tesseract.js (local)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { matchBankByVisualSignature as matchVisualPattern } from '@/shared/lib/visual-signature.js';
import { OCR_ADMIN_CONFIG_MESSAGE, OCR_ADMIN_KEY_MESSAGE } from '@/shared/lib/ocr-messages.js';

export { matchBankByVisualSignature } from '@/shared/lib/visual-signature.js';

const nodeRequire = createRequire(import.meta.url);

let _tesseractModule = null;
async function getTesseract() {
  if (_tesseractModule) return _tesseractModule;
  patchTesseractWorkerErrors();
  const mod = await import('tesseract.js');
  _tesseractModule = mod.default || mod;
  return _tesseractModule;
}

/**
 * tesseract.js asigna `worker.onerror = fn`, pero el Worker de Node es un
 * EventEmitter y no invoca esa propiedad. Si el worker muere al cargar una dependencia
 * (por ejemplo bmp-js en Vercel), createWorker() nunca rechaza y la petición
 * termina en timeout. Registramos `error`/`exit` y reenviamos el error al
 * handler que tesseract.js sí intenta usar.
 */
let _workerErrorPatched = false;
function patchTesseractWorkerErrors() {
  if (_workerErrorPatched) return;
  try {
    const workerThreads = nodeRequire('worker_threads');
    const NativeWorker = workerThreads.Worker;
    if (!NativeWorker || NativeWorker.__credifluxErrorPatched) return;

    class CrediFluxWorker extends NativeWorker {
      constructor(...args) {
        super(...args);
        const record = (err, source) => {
          const message = String(err?.message || err || 'worker error');
          globalThis.__credifluxOcrWorkerError = {
            message,
            stack: err?.stack || null,
            source,
            at: Date.now()
          };
          try {
            if (typeof this.onerror === 'function') {
              this.onerror({ message, error: err, type: source });
            }
          } catch {
            // El handler de tesseract.js puede no estar asignado todavía.
          }
        };
        this.on('error', (err) => record(err, 'error'));
        this.on('exit', (code) => {
          if (code === 0) return;
          const last = globalThis.__credifluxOcrWorkerError;
          if (!last || Date.now() - last.at > 2000) {
            record(new Error(`worker terminó con código ${code}`), 'exit');
          }
        });
      }
    }

    CrediFluxWorker.__credifluxErrorPatched = true;
    workerThreads.Worker = CrediFluxWorker;
    _workerErrorPatched = true;
  } catch {
    // Si no se puede parchear, se mantiene el comportamiento original.
  }
}

function readWorkerLogTail(maxChars = 4000) {
  try {
    const logPath = process.env.OCR_WORKER_LOG_PATH || path.join('/tmp', 'crediflux-ocr-worker.log');
    if (!fs.existsSync(/*turbopackIgnore: true*/ logPath)) return null;
    return fs.readFileSync(/*turbopackIgnore: true*/ logPath, 'utf8').slice(-maxChars);
  } catch {
    return null;
  }
}

const DEFAULT_TESSERACT_TIMEOUT_MS = 45000;

function isRemotePath(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function resolveFromModule(relativePath) {
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), relativePath);
  } catch {
    return null;
  }
}

function firstExisting(candidates, predicate = (candidate) => fs.existsSync(candidate)) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (predicate(candidate)) return candidate;
    } catch {
      // Ignorar rutas inaccesibles y probar la siguiente.
    }
  }
  return null;
}

/**
 * Localiza un directorio con los traineddata empaquetados en el proyecto.
 * `public/tessdata` es la ubicación canónica: se sirve como /tessdata/* y
 * outputFileTracingIncludes la copia dentro de la función serverless de Vercel.
 */
function resolveLocalTrainedDataPath(preferredDir) {
  const moduleDir = resolveFromModule('.');
  const candidates = [
    preferredDir,
    process.env.TESSERACT_LANG_PATH,
    path.join(process.cwd(), 'public', 'tessdata'),
    path.join(process.cwd(), 'tessdata'),
    process.cwd(),
    path.join(process.cwd(), 'app', 'lib', 'traineddata'),
    moduleDir && path.join(moduleDir, 'tessdata'),
  ].filter((dir) => dir && !isRemotePath(dir));

  return firstExisting(candidates, (dir) => (
    fs.existsSync(path.join(dir, 'eng.traineddata')) ||
    fs.existsSync(path.join(dir, 'spa.traineddata'))
  ));
}

/**
 * El worker propio sustituye el core con variantes .wasm.js (WASM embebido),
 * evitando los sidecars .wasm que Vercel puede omitir al tracear la función.
 */
function resolveTesseractWorkerPath() {
  return firstExisting([
    process.env.TESSERACT_WORKER_PATH,
    resolveFromModule('ocr/tesseract-worker.cjs'),
    path.join(process.cwd(), 'lib', 'ocr', 'tesseract-worker.cjs'),
  ]);
}

function resolveTesseractCorePath() {
  return firstExisting([
    process.env.TESSERACT_CORE_PATH,
    path.join(process.cwd(), 'node_modules', 'tesseract.js-core'),
    resolveFromModule('../node_modules/tesseract.js-core'),
  ], (dir) => fs.existsSync(path.join(dir, 'tesseract-core-simd-lstm.wasm.js')));
}

/**
 * Ejecuta OCR local con Tesseract.js (server-safe para Next.js con serverExternalPackages)
 * y devuelve resultado detallado.
 *
 * Producción (Vercel): usa los .traineddata locales (evita depender de CDNs externos),
 * desactiva la caché de escritura (FS de solo lectura) y aplica un timeout con
 * terminación garantizada del worker para no dejar peticiones colgadas.
 */
export async function runTesseractRecognition(imageBuffer, langs = 'spa+eng', options = {}) {
  const Tesseract = await getTesseract();
  const startedAt = Date.now();
  if (globalThis.__credifluxOcrWorkerError) delete globalThis.__credifluxOcrWorkerError;
  const timeoutMs = Number(
    options.timeoutMs || process.env.OCR_TESSERACT_TIMEOUT_MS || DEFAULT_TESSERACT_TIMEOUT_MS
  );

  const diagnostics = {
    phase: 'init',
    cwd: process.cwd(),
    langs,
    requestedLangPath: null,
    langPath: null,
    langSource: null,
    gzip: null,
    corePath: null,
    coreStrategy: 'embedded-wasm-js',
    workerPath: null,
    workerExists: null,
    workerError: null,
    workerLogTail: null,
    localLangPath: null,
    progress: []
  };

  const captureWorkerDiagnostics = () => {
    const lastError = globalThis.__credifluxOcrWorkerError;
    if (lastError && Date.now() - lastError.at < 5 * 60 * 1000) {
      diagnostics.workerError = lastError;
    }
    diagnostics.workerLogTail = readWorkerLogTail();
  };

  const baseLogger = options.logger || (() => {});
  const workerOptions = {
    cacheMethod: 'none',
    ...(options.workerOptions || {})
  };

  if (!workerOptions.corePath) {
    workerOptions.corePath = resolveTesseractCorePath() || undefined;
  }
  diagnostics.corePath = workerOptions.corePath || '(default de tesseract.js-core)';

  // Worker propio: fuerza las variantes .wasm.js autocontenidas de tesseract.js-core
  // para no depender de sidecars .wasm en el filesystem serverless.
  const customWorkerPath = resolveTesseractWorkerPath();
  if (!workerOptions.workerPath && customWorkerPath) {
    workerOptions.workerPath = customWorkerPath;
  }
  diagnostics.workerPath = workerOptions.workerPath || '(default de tesseract.js)';
  diagnostics.workerExists = workerOptions.workerPath === '(default de tesseract.js)'
    ? null
    : fs.existsSync(workerOptions.workerPath);

  workerOptions.logger = (event) => {
    try {
      const status = String(event?.status || 'progress');
      const pct = Number.isFinite(Number(event?.progress)) ? Math.round(Number(event.progress) * 100) : null;
      diagnostics.progress.push(pct === null ? status : `${status} ${pct}%`);
      if (diagnostics.progress.length > 20) diagnostics.progress.shift();
    } catch {}
    try { baseLogger(event); } catch {}
  };

  const requestedLangPath = workerOptions.langPath || options.langPath || process.env.TESSERACT_LANG_PATH || null;
  diagnostics.requestedLangPath = requestedLangPath;

  if (options.gzip !== undefined && workerOptions.gzip === undefined) {
    workerOptions.gzip = options.gzip;
  }

  const requestedIsRemote = isRemotePath(requestedLangPath);
  const localLangPath = requestedIsRemote ? null : resolveLocalTrainedDataPath(requestedLangPath);
  diagnostics.localLangPath = localLangPath;

  if (localLangPath) {
    workerOptions.langPath = localLangPath;
    // Los modelos empaquetados en public/tessdata no están comprimidos.
    workerOptions.gzip = false;
    diagnostics.langSource = requestedLangPath && !requestedIsRemote ? 'configured-local' : 'bundled';
  } else if (requestedIsRemote) {
    workerOptions.langPath = requestedLangPath;
    if (workerOptions.gzip === undefined) workerOptions.gzip = true;
    diagnostics.langSource = 'remote';
  } else if (!options.disableDefaultLangPath) {
    workerOptions.langPath = 'https://tessdata.projectnaptha.com/4.0.0';
    if (workerOptions.gzip === undefined) workerOptions.gzip = true;
    diagnostics.langSource = 'default-cdn';
  }

  diagnostics.langPath = workerOptions.langPath || null;
  diagnostics.gzip = Boolean(workerOptions.gzip);

  const buildError = (message) => {
    const error = new Error(message);
    error.diagnostics = diagnostics;
    return error;
  };

  let worker = null;
  let timedOut = false;
  let timer = null;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      captureWorkerDiagnostics();
      const workerDetail = diagnostics.workerError ? ` (worker: ${diagnostics.workerError.message})` : '';
      reject(buildError(`Tesseract.js no respondió en ${Math.round(timeoutMs / 1000)} s${workerDetail}`));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });

  diagnostics.phase = 'createWorker';
  const createWorkerPromise = Tesseract.createWorker(langs, 1, workerOptions).then((createdWorker) => {
    worker = createdWorker;
    diagnostics.phase = 'workerReady';
    if (timedOut) {
      // Si el timeout ganó la carrera, liberar el worker en cuanto exista.
      createdWorker.terminate().catch(() => {});
    }
    return createdWorker;
  }).catch((err) => {
    diagnostics.phase = 'createWorkerFailed';
    diagnostics.lastError = String(err?.message || err || 'error desconocido');
    throw err;
  });

  const run = (async () => {
    const activeWorker = await createWorkerPromise;
    if (timedOut) throw buildError('Tesseract.js cancelado por timeout antes de reconocer');
    diagnostics.phase = 'recognize';
    const { data } = await activeWorker.recognize(
      imageBuffer,
      options.recognizeOptions || undefined,
      options.output || undefined
    );
    diagnostics.phase = 'done';
    const rawText = String(data?.text || '');
    return {
      success: true,
      rawText,
      confidence: Number(data?.confidence),
      data,
      responseTimeMs: Date.now() - startedAt,
      engine: 'Tesseract.js',
      langs,
      diagnostics
    };
  })();

  try {
    return await Promise.race([run, timeoutPromise]);
  } catch (err) {
    captureWorkerDiagnostics();
    const lastProgress = diagnostics.progress.slice(-3).join(' → ') || 'sin eventos de progreso';
    const workerDetail = diagnostics.workerError ? ` Worker: ${diagnostics.workerError.message}.` : '';
    if (timedOut) {
      throw buildError(
        `Tesseract.js excedió el tiempo límite de ${Math.round(timeoutMs / 1000)} s ` +
        `(fase: ${diagnostics.phase}; último estado: ${lastProgress}).${workerDetail} ` +
        `Verifica worker=${diagnostics.workerPath}, core=${diagnostics.corePath}, ` +
        `langPath=${diagnostics.langPath} (origen: ${diagnostics.langSource}) en el bundle del API route.`
      );
    }
    if (typeof err === 'string') {
      throw buildError(`${err}${workerDetail ? ` (${workerDetail.trim()})` : ''}`);
    }
    if (err && typeof err === 'object') {
      err.message = `${err.message || 'error de Tesseract'}${workerDetail ? ` (${workerDetail.trim()})` : ''}`;
      if (!err.diagnostics) err.diagnostics = diagnostics;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (worker) {
      try {
        await Promise.race([
          worker.terminate(),
          new Promise((resolve) => setTimeout(resolve, 3000))
        ]);
      } catch {
        // La terminación es best-effort.
      }
    }
  }
}

/**
 * Configuración interna de proveedores OCR que no requieren clave manual del usuario.
 */
export const INTERNAL_OCR_CONFIG = {
  tesseract: {
    id: 'tesseract',
    name: 'Tesseract.js (Motor Local)',
    internalLicense: true,
    licenseLabel: 'Licencia interna: No requerida (motor local integrado, sin límites de API)',
    requiresUserKey: false,
  },
};

export function getInternalOcrConfig(provider) {
  return INTERNAL_OCR_CONFIG[provider] || null;
}


/**
 * Parsea y normaliza números con formato venezolano (1.450,50 o 500,00)
 */
export function parseVenezuelanNumber(strNum) {
  if (typeof strNum === 'number' && Number.isFinite(strNum)) {
    // Misma validación que la ruta de string: los montos deben ser positivos
    // y estar en rango, de lo contrario se normalizan a 0.
    if (strNum <= 0 || strNum > 999999999.99) return 0;
    return Number(strNum.toFixed(2));
  }
  if (!strNum) return 0;

  let clean = String(strNum).trim();
  clean = clean.replace(/[^\d.,]/g, '').trim();
  if (!clean) return 0;

  const hasDot = clean.includes('.');
  const hasComma = clean.includes(',');

  if (hasDot && hasComma) {
    if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else {
      clean = clean.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = clean.split(',');
    const isDecimal = parts.length === 2 && parts[1].length <= 2;
    const isThousands = parts.length > 1 && parts.every((p, i) => i === 0 ? p.length <= 3 : p.length === 3);
    if (isDecimal) {
      clean = clean.replace(/,/g, '.');
    } else if (isThousands) {
      clean = clean.replace(/,/g, '');
    } else {
      return 0;
    }
  } else if (hasDot) {
    const parts = clean.split('.');
    const isThousandsVE = parts.length > 1 && parts.every((p, i) => i === 0 ? p.length <= 3 : p.length === 3);
    const isDecimal = parts.length === 2 && parts[1].length <= 2 && !isThousandsVE;
    if (isThousandsVE && !isDecimal) {
      clean = clean.replace(/\./g, '');
    } else if (isDecimal) {
      // ok
    } else {
      return 0;
    }
  }

  const result = parseFloat(clean);
  if (isNaN(result) || !Number.isFinite(result)) return 0;
  if (result <= 0 || result > 999999999.99) return 0;
  return Number(result.toFixed(2));
}

/**
 * Extractor secundario con Regex para filtrar comisiones, teléfonos y cédulas
 */
export function extractVenezuelanAmount(rawText) {
  if (typeof rawText === 'number' && Number.isFinite(rawText)) {
    if (rawText > 0 && rawText <= 999999999.99) return Number(rawText.toFixed(2));
    return 0;
  }
  if (!rawText) return 0;

  let text = String(rawText);
  text = text.replace(/(?:0414|0424|0412|0416|0426)[-\s]?\d{3}[-\s]?\d{4}/g, ' [TEL] ');
  text = text.replace(/[VvJjEeGg][-\s]?\d{1,2}(?:\.\d{3}){2}/g, ' [CEDULA] ');
  text = text.replace(/\b(?:ref(?:erencia)?|nro|n[uú]m(?:ero)?|operaci[oó]n|identificaci[oó]n|c[eé]dula|rif)\.?\s*(?:n[uú]mero)?\s*[:=]?\s*[\d*][\d*.\-]{3,}/gi, ' [REF] ');
  text = text
    .split(/\n|;|\|| {2,}/)
    .filter(line => !/(comisi[oó]n|igtf|iva|tasa|d[oó]lar|usd|bs\.?\s*\/|convivencia)/i.test(line))
    .join('\n');

  const numberShape = '(?:[0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)(?:[.,][0-9]{2})?|[0-9]{1,3}(?:[.,][0-9]{3})*[.,][0-9]{2}';

  const amountPattern = new RegExp(
    `(?:monto|importe|total|debitado|por\\s*bs\\.?|bs\\.?\\s*por)\\s*(?:\\(\\s*bs\\.?\\s*\\))?(?:\\s*(?:de|operaci[oó]n))?\\s*[:=]?\\s*(${numberShape})`,
    'i'
  );
  const match = text.match(amountPattern);
  if (match && match[1]) {
    const parsed = parseVenezuelanNumber(match[1]);
    if (parsed > 0) return parsed;
  }

  const bsPattern = new RegExp(`(?:bs\\.?\\s*\\)?|ves)\\s*[:=]?\\s*(${numberShape})`, 'i');
  const bsMatch = text.match(bsPattern);
  if (bsMatch && bsMatch[1]) {
    const parsed = parseVenezuelanNumber(bsMatch[1]);
    if (parsed > 0) return parsed;
  }

  const postBsPattern = new RegExp(`(${numberShape})\\s*(?:bs\\.?|ves)\\b`, 'i');
  const postBsMatch = text.match(postBsPattern);
  if (postBsMatch && postBsMatch[1]) {
    const parsed = parseVenezuelanNumber(postBsMatch[1]);
    if (parsed > 0) return parsed;
  }

  const fallbackPattern = new RegExp(`\\b(${numberShape})\\b`, 'g');
  const candidates = [];
  let m;
  while ((m = fallbackPattern.exec(text)) !== null) {
    const parsed = parseVenezuelanNumber(m[1]);
    if (parsed > 0) candidates.push(parsed);
  }
  if (candidates.length === 1) return candidates[0];

  return 0;
}

/** Los patrones inactivos nunca deben influir en el reconocimiento. */
function getActiveRecognitionPatterns(patterns) {
  return (Array.isArray(patterns) ? patterns : []).filter((pat) => pat && pat.isActive !== false);
}

/**
 * Valida o empareja el banco emisor contra los patrones registrados por el Administrador
 */
export function matchBankWithPatterns(detectedText, detectedBank, patterns = []) {
  const activePatterns = getActiveRecognitionPatterns(patterns);
  if (activePatterns.length === 0) {
    return detectedBank || 'Desconocido';
  }

  const searchHaystack = `${detectedText || ''} ${detectedBank || ''}`.toLowerCase();

  for (const pat of activePatterns) {
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
 * Estructura el texto plano devuelto por OCR en los campos financieros esperados.
 */
export function structurePlainOcrText(rawText, registeredPatterns = [], visualBankName = null) {
  const text = String(rawText || '');
  const activePatterns = getActiveRecognitionPatterns(registeredPatterns);

  const monto = extractVenezuelanAmount(text);

  let fecha = '';
  const dateMatch = text.match(
    /\b(\d{4}-\d{2}-\d{2})|(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/
  );
  if (dateMatch) {
    if (dateMatch[1]) {
      fecha = dateMatch[1];
    } else {
      const [, , d, m, y] = dateMatch;
      let year = parseInt(y, 10);
      if (year < 100) year += 2000;
      const mm = String(parseInt(m, 10)).padStart(2, '0');
      const dd = String(parseInt(d, 10)).padStart(2, '0');
      if (mm >= '01' && mm <= '12' && dd >= '01' && dd <= '31' && year >= 2000 && year <= 2100) {
        fecha = `${year}-${mm}-${dd}`;
      }
    }
  }

  let referencia = 'N/A';
  const refKeyword = text.match(
    /(?:ref(?:erencia)?|operaci[oó]n|nro\.?\s*n[uú]m(?:ero)?|n[uú]mero de (?:operaci[oó]n|referencia))\s*[:=]?\s*(\d[\d.\-]{5,})/i
  );
  if (refKeyword && refKeyword[1]) {
    referencia = refKeyword[1].replace(/[.\-\s]/g, '').replace(/^0+(?=\d)/, '');
  } else {
    const cleaned = text
      .replace(/(?:0414|0424|0412|0416|0426)[-\s]?\d{3}[-\s]?\d{4}/g, ' ')
      .replace(/[VvJjEeGg][-\s]?\d{1,2}(?:\.\d{3}){2}/g, ' ');
    const loose = cleaned.match(/\b(\d{6,12})\b/);
    if (loose) referencia = loose[1];
  }

  let detectedBank = '';
  const bankLineMatch = text.match(/^(.*\bbanco\b.*)$/im);
  if (bankLineMatch) {
    let line = bankLineMatch[1].trim();
    const labelStripped = line.replace(/^(?:banco\s*(?:emisor|de\s*origen|receptor)?)\s*[:\-]?\s*/i, '');
    if (labelStripped && labelStripped !== line) {
      line = labelStripped;
      if (!/^\s*banco/i.test(line) && /^\s*de\s/i.test(line)) line = 'Banco ' + line.trim();
    }
    const codeName = line.match(/^\d{3,4}\s*[-–]\s*(.+)$/);
    if (codeName) line = codeName[1].trim();
    detectedBank = line.replace(/\s*[:].*$/, '').trim();
  }
  const bancoOrigen = visualBankName || matchBankWithPatterns(text, detectedBank, activePatterns);
  const bancoDestino = 'Desconocido';

  // Regla específica del banco detectado: el patrón activo puede afinar la
  // referencia cuando el regex genérico no alcanza a extraerla.
  const matchedPattern = activePatterns.find(
    (pat) => String(pat.bankName || '').toLowerCase() === String(bancoOrigen || '').toLowerCase()
  );
  const customRegexSource = matchedPattern?.referenceRegex || matchedPattern?.analysisRules?.customRegex;
  if (customRegexSource) {
    try {
      const customRegex = new RegExp(customRegexSource, 'i');
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(customRegex);
        if (match) {
          referencia = String(match[1] || match[0])
            .replace(/[.\-\s]/g, '')
            .replace(/^0+(?=\d)/, '');
          break;
        }
      }
    } catch {
      // Regex inválido en un patrón: se ignora sin romper el OCR.
    }
  }

  return {
    monto,
    fecha: fecha || new Date().toISOString().split('T')[0],
    referencia,
    bancoOrigen,
    bancoDestino,
    bankMatchSource: visualBankName ? 'visual-pattern' : (activePatterns.length > 0 ? 'text-pattern' : 'model'),
    textoIdentificado: text.slice(0, 500),
    confianza: monto > 0 ? '85%' : '0%'
  };
}

function emptyOcrData() {
  return {
    monto: 0,
    fecha: new Date().toISOString().split('T')[0],
    referencia: 'N/A',
    bancoOrigen: 'Desconocido',
    bancoDestino: 'Desconocido',
    confianza: '0%'
  };
}

/**
 * Imagen PNG mínima de prueba (para "Probar Conexión"). Válida para procesamiento por motores OCR/VLM.
 */
export function createTestReceiptPngBuffer() {
  const width = 320;
  const height = 120;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const inBox = x >= 30 && x <= 290 && y >= 35 && y <= 85;
      const idx = rowStart + 1 + x * 3;
      raw[idx] = inBox ? 30 : 255;
      raw[idx + 1] = inBox ? 30 : 255;
      raw[idx + 2] = inBox ? 30 : 255;
    }
  }

  const zlibChunks = [Buffer.from([0x78, 0x01])];
  let offset = 0;
  while (offset < raw.length) {
    const remaining = raw.length - offset;
    const blockLen = Math.min(65535, remaining);
    const isFinal = offset + blockLen >= raw.length ? 1 : 0;
    const header = Buffer.alloc(5);
    header[0] = isFinal;
    header.writeUInt16LE(blockLen, 1);
    header.writeUInt16LE(0xffff ^ blockLen, 3);
    zlibChunks.push(header);
    zlibChunks.push(raw.subarray(offset, offset + blockLen));
    offset += blockLen;
  }
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0, 0);
  zlibChunks.push(adler);

  const idat = Buffer.concat(zlibChunks);
  const iend = Buffer.alloc(0);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', iend)]);
}

export const DEFAULT_OCR_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  ocrspace: 'https://api.ocr.space/parse/image',
  tesseract: 'local'
};

export const DEFAULT_OCR_MODELS = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
  ocrspace: 'Engine2',
  tesseract: 'spa+eng'
};

export const DEFAULT_OCR_THRESHOLDS = {
  ocrConfidenceMin: 0.8,
  minAmount: 0.01,
  maxAmount: 999999999.99,
  strictBankMatch: false,
  requireReferenceMatch: true,
  crossValidateBank: true
};

export const DEFAULT_AI_ROUTING_RULES = {
  receipt: 'ocrspace',
  document: 'openai',
  fallback: 'tesseract'
};

export async function parseReceiptWithAI({
  imageBuffer,
  mimeType,
  apiKey,
  provider = 'openai',
  registeredPatterns = [],
  ocrSpaceApiKey = null,
  endpoint = null,
  model = null,
  confidenceThreshold = null,
  visualSignature = null
}) {
  const base64Data = imageBuffer.toString('base64');

  const activePatterns = getActiveRecognitionPatterns(registeredPatterns);

  // Comparación visual FIRST: la imagen del comprobante se coteja con las
  // firmas de los patrones antes de cualquier interpretación del texto.
  const visualMatch = visualSignature ? matchVisualPattern(visualSignature, registeredPatterns) : null;
  const visualBankName = visualMatch?.bankName || null;
  const fallbackBankSource = activePatterns.length > 0 ? 'text-pattern' : 'model';
  const patternBankList = activePatterns.map(p => p.bankName).filter(Boolean);
  const patternFormatList = activePatterns
    .filter(p => p.bankName && p.referenceFormat)
    .map(p => `${p.bankName}: ${p.referenceFormat}`);
  const patternBankContext = patternBankList.length > 0
    ? `Bancos prioritarios reconocidos en el sistema: [${patternBankList.join(', ')}]. Formatos de referencia esperados: [${patternFormatList.join('; ')}]. Si el membrete, colores o logotipo coinciden con alguno, usa ese nombre exacto.`
    : '';
  const visualContext = visualMatch
    ? `COMPARACIÓN VISUAL CON PATRÓN REGISTRADO: la imagen coincide con el patrón de ${visualMatch.bankName} (similitud ${(visualMatch.similarity * 100).toFixed(1)}%). El banco emisor (bancoOrigen) DEBE ser "${visualMatch.bankName}" exactamente, aunque el texto mencione otros bancos.`
    : '';

  const SYSTEM_PROMPT = `Eres un perito bancario auditor y especialista en comprobantes de Pago Móvil (P2P/C2P) y transferencias de bancos venezolanos (Banesco, Banco de Venezuela BDV, Mercantil, BBVA Provincial, Bancaribe, BNC, Banco Bicentenario, etc.).

${patternBankContext}
${visualContext}

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

  // 1. Proveedor OpenAI (GPT-4o-mini Vision u otro modelo/endpoint configurado)
  if (provider === 'openai' && apiKey) {
    try {
      const openAiEndpoint = endpoint || DEFAULT_OCR_ENDPOINTS.openai;
      const openAiModel = model || DEFAULT_OCR_MODELS.openai;
      const response = await fetch(openAiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          model: openAiModel,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: [
              { type: 'text', text: 'Extrae con máxima precisión los datos financieros de este comprobante bancario venezolano:' },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
            ]}
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
          const matchedBankOrigin = visualBankName || matchBankWithPatterns(parsed.textoIdentificado || parsed.bancoOrigen, parsed.bancoOrigen, registeredPatterns);
          return {
            success: true,
            provider: `OpenAI (${openAiModel})`,
            data: {
              monto: cleanMonto,
              fecha: parsed.fecha || new Date().toISOString().split('T')[0],
              referencia: parsed.referencia || 'N/A',
              bancoOrigen: matchedBankOrigin,
              bancoDestino: parsed.bancoDestino || 'Desconocido',
              bankMatchSource: visualBankName ? 'visual-pattern' : fallbackBankSource,
              visualSimilarity: visualMatch?.similarity ?? null,
              confianza: parsed.confianza || '98%'
            }
          };
        }
      }
    } catch (err) {
      console.warn('OpenAI Vision OCR error:', err.message);
    }
  }

  // 2. Proveedor Google Gemini (Gemini 1.5 Flash con Structured JSON)
  if (provider === 'gemini' && apiKey) {
    try {
      const geminiModel = model || DEFAULT_OCR_MODELS.gemini;
      const baseEndpoint = (endpoint || DEFAULT_OCR_ENDPOINTS.gemini).replace(/\/+$/, '');
      const geminiUrl = `${baseEndpoint}/${geminiModel}:generateContent?key=${apiKey}`;
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          generationConfig: { responseMimeType: 'application/json', temperature: 0.0 },
          contents: [{ parts: [
            { text: `${SYSTEM_PROMPT}\n\nAnaliza la imagen adjunta y devuelve ÚNICAMENTE el objeto JSON estructurado.` },
            { inline_data: { mime_type: mimeType, data: base64Data } }
          ]}]
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
          const matchedBankOrigin = visualBankName || matchBankWithPatterns(parsed.textoIdentificado || parsed.bancoOrigen, parsed.bancoOrigen, registeredPatterns);
          return {
            success: true,
            provider: `Google Gemini (${geminiModel})`,
            data: {
              monto: cleanMonto,
              fecha: parsed.fecha || new Date().toISOString().split('T')[0],
              referencia: parsed.referencia || 'N/A',
              bancoOrigen: matchedBankOrigin,
              bancoDestino: parsed.bancoDestino || 'Desconocido',
              bankMatchSource: visualBankName ? 'visual-pattern' : fallbackBankSource,
              visualSimilarity: visualMatch?.similarity ?? null,
              confianza: parsed.confianza || '99%'
            }
          };
        }
      }
    } catch (err) {
      console.warn('Gemini Vision OCR error:', err.message);
    }
  }

  // 3. Proveedor OCR.space (API)
  if (provider === 'ocrspace') {
    const spaceKey = ocrSpaceApiKey || apiKey;
    if (!spaceKey) {
      return { success: false, provider: 'OCR.space (API)', error: OCR_ADMIN_KEY_MESSAGE, data: emptyOcrData() };
    }
    try {
      const ocrSpaceEndpoint = endpoint || DEFAULT_OCR_ENDPOINTS.ocrspace;
      const engineMode = model ? (String(model).includes('1') ? '1' : '2') : '2';
      const formData = new URLSearchParams();
      formData.append('apikey', spaceKey);
      formData.append('base64Image', `data:${mimeType};base64,${base64Data}`);
      formData.append('language', 'spa');
      formData.append('isOverlayRequired', 'false');
      formData.append('detectOrientation', 'true');
      formData.append('scale', 'true');
      formData.append('isTable', 'true');
      formData.append('OCREngine', engineMode);

      const response = await fetch(ocrSpaceEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'apikey': spaceKey },
        signal: AbortSignal.timeout(25000),
        body: formData.toString()
      });
      const rawResult = await response.json().catch(() => null);
      if (!response.ok || !rawResult) {
        return {
          success: false, provider: 'OCR.space (API)',
          error: response.status === 429 ? 'Se alcanzó el límite de la API. Espera unos minutos o cambia de proveedor.' : 'El servicio OCR.space no está disponible ahora. Intenta de nuevo o cambia de proveedor.',
          data: emptyOcrData()
        };
      }
      if (rawResult.IsErroredOnProcessing || (rawResult.ErrorMessage && rawResult.ErrorMessage.length > 0)) {
        const errMsg = Array.isArray(rawResult.ErrorMessage) ? rawResult.ErrorMessage.join(' | ') : rawResult.ErrorMessage;
        return {
          success: false, provider: 'OCR.space (API)',
          error: /invalid|incorrect|api ?key/i.test(String(errMsg)) ? 'La clave de OCR.space no es válida o caducó. Cámbiala o selecciona otro proveedor.' : 'No se pudo procesar la imagen con OCR.space. Intenta con otra foto más clara o cambia de proveedor.',
          data: emptyOcrData()
        };
      }
      const rawText = rawResult.ParsedResults?.[0]?.ParsedText || '';
      if (!rawText.trim()) return { success: false, provider: 'OCR.space (API)', error: 'No se detectó texto en la imagen. Sube una foto más nítida.', data: emptyOcrData() };
      const structured = structurePlainOcrText(rawText, registeredPatterns, visualBankName);
      if (visualMatch) {
        structured.visualSimilarity = visualMatch.similarity;
      }
      if (structured.monto <= 0) return { success: false, provider: 'OCR.space (API)', error: 'No se pudo identificar el monto con certeza. Regístralo manualmente o sube una foto más nítida.', data: structured, rawOcrText: rawText };
      return { success: true, provider: 'OCR.space (API)', data: structured, rawOcrText: rawText };
    } catch (err) {
      return { success: false, provider: 'OCR.space (API)', error: 'No hay conexión con OCR.space. Revisa tu internet o cambia de proveedor.', data: emptyOcrData() };
    }
  }

  // 4. Proveedor Tesseract.js (motor local, sin API key ni límites)
  if (provider === 'tesseract') {
    try {
      const langs = model || 'spa+eng';
      const rec = await runTesseractRecognition(imageBuffer, langs, { logger: () => {} });
      const rawText = String(rec.rawText || '');
      if (!rawText.trim()) {
        return { success: false, provider: 'Tesseract.js (Motor Local)', error: 'No se detectó texto en la imagen con el motor local. Sube una foto más nítida y bien iluminada.', data: emptyOcrData() };
      }
      const structured = structurePlainOcrText(rawText, registeredPatterns, visualBankName);
      if (visualMatch) {
        structured.visualSimilarity = visualMatch.similarity;
      }
      if (Number.isFinite(rec.confidence) && rec.confidence > 0) structured.confianza = `${Math.round(rec.confidence)}%`;
      if (structured.monto <= 0) {
        return { success: false, provider: 'Tesseract.js (Motor Local)', error: 'El motor local leyó la imagen pero no pudo identificar el monto con certeza. Regístralo manualmente o sube una foto más clara.', data: structured, rawOcrText: rawText };
      }
      return { success: true, provider: 'Tesseract.js (Motor Local)', data: structured, rawOcrText: rawText };
    } catch (err) {
      return { success: false, provider: 'Tesseract.js (Motor Local)', error: `No se pudo ejecutar el motor OCR local: ${err?.message || 'error desconocido'}`, data: emptyOcrData() };
    }
  }

  // 5. Fallback
  return { success: false, provider: 'Motor Heurístico / Validación Cruzada de Patrones', error: OCR_ADMIN_CONFIG_MESSAGE, data: emptyOcrData() };
}
