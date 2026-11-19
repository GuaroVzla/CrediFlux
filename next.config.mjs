const OCR_TRACE_GLOBS = [
  // Modelos empaquetados: se sirven desde /tessdata y se leen como archivos locales.
  './public/tessdata/*.traineddata',
  // Compatibilidad con instalaciones antiguas que guardaban los modelos en la raíz.
  './*.traineddata',
  './lib/ocr/**/*',
  './node_modules/tesseract.js/**/*',
  './node_modules/tesseract.js-core/**/*',
  // Dependencias transitivas que el worker carga con require() en runtime.
  './node_modules/bmp-js/**/*',
  './node_modules/idb-keyval/**/*',
  './node_modules/node-fetch/**/*',
  './node_modules/wasm-feature-detect/**/*',
  './node_modules/is-url/**/*',
  './node_modules/regenerator-runtime/**/*',
  './node_modules/zlibjs/**/*'
];

// Aplica tanto a las rutas públicas como a los handlers internos detrás de los rewrites.
const OCR_ROUTE_GLOBS = ['/api/settings*', '/api/ecommerce*'];
const OCR_INCLUDES = Object.fromEntries(
  OCR_ROUTE_GLOBS.map((route) => [route, OCR_TRACE_GLOBS])
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // distDir: '.next-run',

  // Redirección de rutas de acceso al dashboard / pantalla de login en la raíz
  async redirects() {
    return [
      {
        source: '/login',
        destination: '/',
        permanent: false,
      },
    ];
  },

  // Los handlers de /api/ecommerce y /api/settings viven en carpetas "-handler"
  // porque el antivirus bloquea permanentemente los archivos
  // app/api/ecommerce/route.js y app/api/settings/route.js.
  // Estas reglas mantienen las URLs públicas originales para el frontend.
  async rewrites() {
    return [
      { source: '/api/ecommerce', destination: '/api/ecommerce-handler' },
      { source: '/api/settings', destination: '/api/settings-handler' },
      { source: '/api/products', destination: '/api/products-api' }
    ];
  },

  // Tesseract.js usa workers/wasm y rutas de archivos en runtime Node; se excluye del bundling
  // para que resuelva correctamente worker/core/lang desde node_modules en server/API routes.
  serverExternalPackages: ['tesseract.js', 'tesseract.js-core'],

  // Vercel elimina archivos no rastreados del bundle serverless. Forzamos la inclusión
  // del worker, el core embebido (.wasm.js) y los .traineddata de public/tessdata.
  outputFileTracingIncludes: OCR_INCLUDES
};

export default nextConfig;
