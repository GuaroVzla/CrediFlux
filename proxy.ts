import { NextResponse, type NextRequest } from 'next/server';

const NO_STORE = 'private, no-store, max-age=0, must-revalidate';

/**
 * Las rutas /api/* devuelven datos específicos de la sesión (o secretos).
 * Marcarlas como no-cacheables en un único punto evita que un CDN o la caché
 * del navegador sirva la respuesta de un usuario a otro. Las respuestas que
 * ya definen su propio Cache-Control (p. ej. /api/admin/reveal-password)
 * conservan el suyo: no sobrescribimos si el header ya existe.
 */
function applyNoStore(response: NextResponse) {
  if (!response.headers.has('Cache-Control')) {
    response.headers.set('Cache-Control', NO_STORE);
  }
  return response;
}

/** Rutas API públicas: no requieren sesión (debe coincidir con middleware.ts). */
const PUBLIC_API_PATHS = new Set(['/api/auth', '/api/binance-p2p', '/api/health']);

function requiresApiAuth(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') &&
    !PUBLIC_API_PATHS.has(pathname) &&
    !pathname.startsWith('/api/health')
  );
}

function apiUnauthorized() {
  return applyNoStore(
    NextResponse.json(
      { success: false, error: 'No autenticado', code: 'UNAUTHENTICATED' },
      { status: 401 }
    )
  );
}

/**
 * Proxy de Next.js 16 (antes `middleware`): refresca la sesión de Supabase
 * en cada request y bloquea las rutas /api/* sin sesión válida.
 *
 * El módulo de sesión se importa dinámicamente. Un fallo del módulo NO puede
 * dejar pasar una API protegida: en ese caso se devuelve 401 (fail-closed).
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith('/api/');
  try {
    const { updateSession } = await import('@/lib/supabase/middleware');
    const response = await updateSession(request);
    return isApi ? applyNoStore(response) : response;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[proxy] Error no controlado al validar la sesión: ${detail}`);
    if (requiresApiAuth(pathname)) return apiUnauthorized();
    const response = NextResponse.next({ request });
    return isApi ? applyNoStore(response) : response;
  }
}

export const config = {
  matcher: [
    /*
     * Ejecutar en todas las rutas excepto estáticos de Next, imágenes y favicon.
     * Las rutas de API también pasan por aquí para refrescar la sesión.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2|ttf)$).*)',
  ],
};
