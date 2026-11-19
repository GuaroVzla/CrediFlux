# Tesseract.js en Vercel: diagnóstico y corrección

## Diagnóstico

El proveedor `Tesseract.js (Motor Local Gratuito, sin API)` se ejecutaba **dentro de Route Handlers Node** (`/api/settings` y `/api/ecommerce`, que hacen rewrite a `*-handler`). No existía ejecución en navegador.

Causas probables del fallo solo en Vercel:

1. **Modelos de idioma fuera del bundle.** `eng.traineddata` y `spa.traineddata` estaban ignorados por `.gitignore` (`*.traineddata`). En un build de Vercel desde Git no existían, por lo que `outputFileTracingIncludes` no podía copiarlos y el motor caía al CDN remoto.
2. **WASM sidecar no traceado.** `tesseract.js-core` resuelve variantes como `tesseract-core-simd-lstm` que leen `tesseract-core-simd-lstm.wasm` desde el filesystem. Vercel puede omitir ese sidecar al tracear la función y el worker muere antes de responder (`Aborted`, `ENOENT` o timeout).
3. **Rutas implícitas.** `workerPath` se resolvía solo desde `process.cwd()/lib/ocr/...` y no había una ruta canónica para `langPath`/`corePath`.
4. **Timeout insuficiente.** Los handlers tenían `maxDuration = 60`, insuficiente si había que descargar traineddata desde CDN en frío.

## Viabilidad

**Sí es viable mantener Tesseract en serverless.** Los Functions de Vercel usan Node.js completo (incluye `worker_threads`), hasta 2 GB de memoria en Hobby y permiten `maxDuration` de 300 s. No hay una limitación estructural que obligue a migrar el OCR al navegador.

La corrección conserva la arquitectura actual: el navegador sigue enviando la imagen a `/api/ecommerce` y el servidor devuelve el OCR estructurado. No se añade un proveedor externo ni se expone una clave adicional.

## Corrección aplicada

- `public/tessdata/eng.traineddata` y `public/tessdata/spa.traineddata` pasan a ser archivos versionados. Se sirven como `/tessdata/*` y se tracean dentro de cada función OCR.
- `.gitignore` permite explícitamente `public/tessdata/*.traineddata`.
- `next.config.mjs` incluye los modelos, el worker propio, `tesseract.js`, `tesseract.js-core` y sus dependencias en `/api/settings*` y `/api/ecommerce*` (rutas públicas y handlers).
- `lib/ocrEngine.js`:
  - resuelve `langPath` desde `public/tessdata` antes de usar cualquier CDN;
  - distingue rutas locales de URLs y aplica `gzip=false` solo a modelos locales;
  - resuelve `workerPath` desde varias ubicaciones y usa `lib/ocr/tesseract-worker.cjs`;
  - fuerza el core embebido `.wasm.js` para evitar sidecars `.wasm`;
  - expone `workerPath`, `corePath`, `langPath`, `langSource` y `gzip` en `diagnostics`.
- `maxDuration` sube a 300 s en `/api/settings`, `/api/settings-handler`, `/api/ecommerce` y `/api/ecommerce-handler`. El timeout interno del motor sigue respondiendo antes (40 s en la prueba de conexión y 45 s por defecto).

## Verificación local

1. `npm run build`.
2. Probar conexión en Ajustes → MOTOR OCR con `Tesseract.js` seleccionado.
3. Subir un comprobante en E-Commerce & OCR IA y revisar que `ocr.engine` sea `Tesseract.js`.
4. Si falla, la respuesta de prueba incluye `details.diagnostics` con la fase, el worker, el core y el `langPath` usados.
