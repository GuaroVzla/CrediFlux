'use strict';

/**
 * Worker de Tesseract.js para entornos serverless (Vercel).
 *
 * Problema: getCore() de tesseract.js carga variantes como
 * `tesseract-core-relaxedsimd-lstm`, que leen el binario sidecar `.wasm`
 * desde node_modules en tiempo de ejecución. En el bundle serverless ese
 * archivo puede no estar disponible y el worker muere sin notificar al padre,
 * dejando la petición colgada hasta el timeout.
 *
 * Solución: interceptar esos require y cargar las variantes `.wasm.js`,
 * que llevan el WASM embebido en base64 y no dependen del filesystem.
 *
 * Además, cualquier fallo de arranque se registra en /tmp (único directorio
 * escribible en Vercel) para poder diagnosticarlo desde el proceso padre.
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join('/tmp', 'crediflux-ocr-worker.log');

function safeLog(message) {
  try {
    fs.appendFileSync(
      LOG_FILE,
      `[${new Date().toISOString()}] [pid ${process.pid}] ${message}\n`,
      'utf8'
    );
  } catch {
    // Sin logging disponible: no interrumpir el arranque del worker.
  }
}

safeLog('worker startup');

process.on('uncaughtException', (err) => {
  safeLog(`uncaughtException: ${err && err.stack ? err.stack : String(err)}`);
  throw err;
});

process.on('unhandledRejection', (err) => {
  safeLog(`unhandledRejection: ${err && err.stack ? err.stack : String(err)}`);
});

const Module = require('module');

const EMBEDDED_CORE_VARIANTS = {
  'tesseract.js-core/tesseract-core-lstm': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract.js-core/tesseract-core-simd-lstm': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract.js-core/tesseract-core-relaxedsimd-lstm': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract.js-core/tesseract-core': 'tesseract.js-core/tesseract-core.wasm.js',
  'tesseract.js-core/tesseract-core-simd': 'tesseract.js-core/tesseract-core-simd.wasm.js',
  'tesseract.js-core/tesseract-core-relaxedsimd': 'tesseract.js-core/tesseract-core-relaxedsimd.wasm.js'
};

const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  const embedded = EMBEDDED_CORE_VARIANTS[request];
  if (embedded) {
    safeLog(`core redirect: ${request} -> ${embedded}`);
    try {
      return originalLoad.call(this, embedded, parent, isMain);
    } catch (err) {
      safeLog(`core redirect failed (${embedded}): ${err && err.stack ? err.stack : String(err)}`);
      throw err;
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  safeLog('loading tesseract worker-script');
  require('tesseract.js/src/worker-script/node/index.js');
  safeLog('tesseract worker-script loaded');
} catch (err) {
  safeLog(`worker-script require failed: ${err && err.stack ? err.stack : String(err)}`);
  throw err;
}
