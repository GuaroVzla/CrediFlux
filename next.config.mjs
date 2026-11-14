/** @type {import('next').NextConfig} */
const nextConfig = {
  // distDir: '.next-run',

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
  }
};

export default nextConfig;
