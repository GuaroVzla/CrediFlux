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
 */

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
    return originalLoad.call(this, embedded, parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};

// Arranca el worker oficial de tesseract.js con el parche aplicado.
require('tesseract.js/src/worker-script/node/index.js');
