import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Proxy de Next.js 16 (antes `middleware`): refresca la sesión de Supabase
 * en cada request y bloquea las rutas /api/* sin sesión válida.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
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
