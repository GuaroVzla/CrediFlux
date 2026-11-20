import { NextResponse, type NextRequest } from 'next/server';

/**
 * Proxy de Next.js 16 (antes `middleware`): refresca la sesión de Supabase
 * en cada request y bloquea las rutas /api/* sin sesión válida.
 *
 * El módulo de sesión se importa dinámicamente y cualquier fallo se degrada a
 * "continuar la request" para que un problema de Supabase nunca tumbe el sitio.
 */
export async function proxy(request: NextRequest) {
  try {
    const { updateSession } = await import('@/lib/supabase/middleware');
    return await updateSession(request);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[proxy] Error no controlado, se continúa sin refrescar sesión: ${detail}`);
    return NextResponse.next({ request });
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
