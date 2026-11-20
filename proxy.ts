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

/**
 * Proxy de Next.js 16 (antes `middleware`): refresca la sesión de Supabase
 * en cada request y bloquea las rutas /api/* sin sesión válida.
 *
 * El módulo de sesión se importa dinámicamente y cualquier fallo se degrada a
 * "continuar la request" para que un problema de Supabase nunca tumbe el sitio.
 */
export async function proxy(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith('/api/');
  try {
    const { updateSession } = await import('@/lib/supabase/middleware');
    const response = await updateSession(request);
    return isApi ? applyNoStore(response) : response;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[proxy] Error no controlado, se continúa sin refrescar sesión: ${detail}`);
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
