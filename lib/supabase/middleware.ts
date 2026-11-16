import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from './env';

const PUBLIC_API_PATHS = new Set(['/api/auth', '/api/binance-p2p', '/api/health']);

/**
 * Refresca la sesión de Supabase en cada request y protege las rutas /api/*.
 * Devuelve la respuesta con las cookies de sesión actualizadas.
 *
 * Es deliberadamente "fail-safe": si Supabase no está configurado o el SDK
 * falla, la request continúa (modo legado) en lugar de romper el sitio.
 * El SDK se importa de forma dinámica para no cargarlo cuando no se usa.
 */
export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  if (!isSupabaseConfigured()) {
    // Modo legado (sin Supabase): el aislamiento se valida en cada handler.
    return response;
  }

  try {
    const { createServerClient } = await import('@supabase/ssr');
    const { getSupabaseAnonKey, getSupabaseUrl } = await import('./env');

    let refreshed = NextResponse.next({ request });
    const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          refreshed = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            refreshed.cookies.set(name, value, options);
          });
        },
      },
    });

    let user = null;
    try {
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch {
      user = null;
    }

    const pathname = request.nextUrl.pathname;
    const isApi = pathname.startsWith('/api/');
    const isPublicApi =
      PUBLIC_API_PATHS.has(pathname) || pathname.startsWith('/api/health');

    if (isApi && !isPublicApi && !user) {
      return NextResponse.json(
        { success: false, error: 'No autenticado', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }

    return refreshed;
  } catch (error) {
    console.error('[proxy] No se pudo refrescar la sesión de Supabase:', error);
    return response;
  }
}
