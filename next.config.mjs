const OCR_TRACE_GLOBS = [
  './*.traineddata',
  './lib/ocr/**/*',
  './node_modules/tesseract.js/**/*',
  './node_modules/tesseract.js-core/**/*',
  './node_modules/wasm-feature-detect/**/*',
  './node_modules/is-url/**/*',
  './node_modules/regenerator-runtime/**/*'
];

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
  // del worker, los .wasm de tesseract.js-core y los .traineddata locales en las rutas OCR.
  outputFileTracingIncludes: {
    '/api/settings-handler': OCR_TRACE_GLOBS,
    '/api/ecommerce-handler': OCR_TRACE_GLOBS,
    '/api/settings': OCR_TRACE_GLOBS,
    '/api/ecommerce': OCR_TRACE_GLOBS
  }
};

export default nextConfig;
