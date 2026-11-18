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
  serverExternalPackages: ['tesseract.js', 'tesseract.js-core']
};

export default nextConfig;
