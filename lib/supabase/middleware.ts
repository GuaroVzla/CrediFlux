import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from './env';

const PUBLIC_API_PATHS = new Set(['/api/auth', '/api/binance-p2p', '/api/health']);

/**
 * Errores que significan que la sesión guardada en cookies ya no es válida.
 * Supabase los devuelve cuando el refresh token fue revocado, reutilizado o
 * pertenece a otro proyecto. Reintentarlo en cada request sólo llena los logs.
 */
const STALE_SESSION_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_expired',
]);

/** Coincide con la cookie de sesión de @supabase/ssr y con sus chunks. */
const AUTH_COOKIE_NAME = /^sb-.+-auth-token(?:\.\d+)?$/;

type ErrorWithCode = { code?: unknown; message?: unknown };

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as ErrorWithCode).code;
  return typeof code === 'string' ? code : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof (error as ErrorWithCode).message === 'string') {
    return (error as ErrorWithCode).message as string;
  }
  return String(error);
}

function isStaleSessionError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code !== null && STALE_SESSION_CODES.has(code);
}

/** Sin cookie de sesión no hay nada que refrescar: es una request anónima normal. */
function isMissingSessionError(error: unknown): boolean {
  return getErrorMessage(error) === 'Auth session missing!';
}

function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some(({ name }) => AUTH_COOKIE_NAME.test(name));
}

function isProtectedApi(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') &&
    !PUBLIC_API_PATHS.has(pathname) &&
    !pathname.startsWith('/api/health')
  );
}

function unauthorizedResponse() {
  return NextResponse.json(
    { success: false, error: 'No autenticado', code: 'UNAUTHENTICATED' },
    { status: 401 }
  );
}

/**
 * Elimina de la request y de la respuesta las cookies de una sesión muerta,
 * de modo que el navegador deje de enviar el refresh token inválido.
 */
function clearStaleSession(request: NextRequest): NextResponse {
  const staleCookieNames = request.cookies
    .getAll()
    .filter(({ name }) => AUTH_COOKIE_NAME.test(name))
    .map(({ name }) => name);

  staleCookieNames.forEach((name) => request.cookies.delete(name));

  const response = NextResponse.next({ request });
  staleCookieNames.forEach((name) => {
    response.cookies.set(name, '', { path: '/', maxAge: 0, expires: new Date(0) });
  });
  return response;
}

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

  const pathname = request.nextUrl.pathname;
  if (!hasAuthCookie(request)) {
    // Request anónima: no hay sesión que refrescar ni errores que loguear.
    return isProtectedApi(pathname) ? unauthorizedResponse() : response;
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
    let authError: unknown = null;
    try {
      const { data, error } = await supabase.auth.getUser();
      user = data.user;
      authError = error;
    } catch (error) {
      authError = error;
    }

    let finalResponse = refreshed;
    if (authError && isStaleSessionError(authError)) {
      // Refresh token muerto: limpiar cookies y tratar la request como anónima.
      finalResponse = clearStaleSession(request);
      user = null;
      console.warn('[proxy] Sesión de Supabase inválida; se limpiaron las cookies de sesión.');
    } else if (authError && !isMissingSessionError(authError)) {
      // Mensaje breve: el SDK ya registra el detalle y no queremos repetir el stack.
      console.warn(
        `[proxy] No se pudo validar la sesión de Supabase (${getErrorCode(authError) ?? getErrorMessage(authError)}).`
      );
    }

    if (!user && isProtectedApi(pathname)) {
      return unauthorizedResponse();
    }

    return finalResponse;
  } catch (error) {
    // No derribar el sitio por un fallo del SDK: el mensaje evita volcar el stack
    // completo de auth-js, que ya se encarga de loguear sus propios errores.
    console.error(
      `[proxy] No se pudo refrescar la sesión de Supabase: ${getErrorMessage(error)}`
    );
    return response;
  }
}
