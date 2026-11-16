import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from './database.types';
import { getSupabaseAnonKey, getSupabaseUrl, isSupabaseConfigured } from './env';

const PUBLIC_API_PATHS = new Set(['/api/auth', '/api/binance-p2p']);

/**
 * Refresca la sesión de Supabase en cada request y protege las rutas /api/*.
 * Devuelve la respuesta con las cookies de sesión actualizadas.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured()) {
    // Modo legado (sin Supabase): el aislamiento se valida en cada handler.
    return response;
  }

  const supabase = createServerClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
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
  const isPublicApi = PUBLIC_API_PATHS.has(pathname) || pathname.startsWith('/api/health');

  if (isApi && !isPublicApi && !user) {
    return NextResponse.json(
      { success: false, error: 'No autenticado', code: 'UNAUTHENTICATED' },
      { status: 401 }
    );
  }

  return response;
}
