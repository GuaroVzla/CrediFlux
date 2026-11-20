import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from './env';

const PUBLIC_API_PATHS = new Set(['/api/auth', '/api/binance-p2p', '/api/health']);

/**
 * Timeouts de sesión aplicados en servidor.
 *
 * Supabase sólo permite `sessions_timebox` / `sessions_inactivity_timeout` en
 * planes Pro+, así que se refuerza en el proxy con dos cookies propias:
 *  - `cf_session_start`: cuándo empezó la sesión (límite absoluto de 24 h).
 *  - `cf_last_activity`: última request autenticada (inactividad de 30 min).
 *
 * Ambas van firmadas con HMAC-SHA256 para que el cliente no pueda extender la
 * sesión manipulando el timestamp. Es complementario a los timers del frontend.
 */
const SESSION_START_COOKIE = 'cf_session_start';
const LAST_ACTIVITY_COOKIE = 'cf_last_activity';
const ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_COOKIE_MAX_AGE = Math.ceil(ABSOLUTE_TIMEOUT_MS / 1000);

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

function hasSessionTrackingCookie(request: NextRequest): boolean {
  return Boolean(
    request.cookies.get(SESSION_START_COOKIE)?.value ||
    request.cookies.get(LAST_ACTIVITY_COOKIE)?.value
  );
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

/** Firma HMAC-SHA256 de un timestamp; degrada a texto plano sin Web Crypto. */
async function signTimestamp(timestamp: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return timestamp;
  const secret =
    process.env.SETTINGS_ENCRYPTION_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'crediflux-session';
  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await subtle.sign('HMAC', key, new TextEncoder().encode(timestamp));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function signedCookieValue(timestamp: number): Promise<string> {
  const raw = String(timestamp);
  return `${raw}.${await signTimestamp(raw)}`;
}

/** Devuelve el timestamp firmado o null si la cookie falta o fue manipulada. */
async function readSignedTimestamp(raw: string | undefined): Promise<number | null> {
  if (!raw) return null;
  const separator = raw.lastIndexOf('.');
  const timestamp = separator > 0 ? raw.slice(0, separator) : raw;
  const signature = separator > 0 ? raw.slice(separator + 1) : '';
  if (signature && signature !== await signTimestamp(timestamp)) return null;
  const value = Number(timestamp);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function sessionCookieOptions() {
  return {
    httpOnly: false, // el frontend lee cf_session_start para ajustar su timer
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE,
  };
}

/** Borra las cookies propias de seguimiento de sesión. */
function clearTrackingCookies(request: NextRequest, response: NextResponse) {
  [SESSION_START_COOKIE, LAST_ACTIVITY_COOKIE].forEach((name) => {
    request.cookies.delete(name);
    response.cookies.set(name, '', { path: '/', maxAge: 0, expires: new Date(0) });
  });
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
  clearTrackingCookies(request, response);
  return response;
}

/** Respuesta ante una sesión expirada por los timeouts de la aplicación. */
function expiredSessionResponse(request: NextRequest, isApi: boolean): NextResponse {
  const authCookieNames = request.cookies
    .getAll()
    .filter(({ name }) => AUTH_COOKIE_NAME.test(name))
    .map(({ name }) => name);
  authCookieNames.forEach((name) => request.cookies.delete(name));

  const response = isApi
    ? NextResponse.json(
        { success: false, error: 'Sesión expirada', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
    : NextResponse.next({ request });

  if (!isApi) response.headers.set('x-session-expired', '1');
  authCookieNames.forEach((name) => {
    response.cookies.set(name, '', { path: '/', maxAge: 0, expires: new Date(0) });
  });
  clearTrackingCookies(request, response);
  return response;
}

/**
 * Refresca la sesión de Supabase en cada request, protege las rutas /api/* y
 * aplica los timeouts de sesión (24 h absoluto / 30 min de inactividad).
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
    const result = isProtectedApi(pathname) ? unauthorizedResponse() : response;
    if (hasSessionTrackingCookie(request)) clearTrackingCookies(request, result);
    return result;
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

    if (!user) {
      const hadTrackingCookies = hasSessionTrackingCookie(request);
      const result = isProtectedApi(pathname) ? unauthorizedResponse() : finalResponse;
      if (hadTrackingCookies) clearTrackingCookies(request, result);
      return result;
    }

    // --- Timeouts de sesión (alternativa al plan Pro de Supabase) ----------
    const now = Date.now();
    const storedStart = await readSignedTimestamp(request.cookies.get(SESSION_START_COOKIE)?.value);
    const storedLast = await readSignedTimestamp(request.cookies.get(LAST_ACTIVITY_COOKIE)?.value);

    const absoluteExpired = storedStart !== null && now - storedStart >= ABSOLUTE_TIMEOUT_MS;
    const idleExpired = storedLast !== null && now - storedLast >= IDLE_TIMEOUT_MS;
    if (absoluteExpired || idleExpired) {
      console.warn(
        `[proxy] Sesión expirada (${absoluteExpired ? '24h' : 'inactividad 30m'}); se cerró la sesión.`
      );
      return expiredSessionResponse(request, isProtectedApi(pathname));
    }

    const sessionStart = storedStart ?? now;
    finalResponse.cookies.set(
      SESSION_START_COOKIE,
      await signedCookieValue(sessionStart),
      sessionCookieOptions()
    );
    finalResponse.cookies.set(
      LAST_ACTIVITY_COOKIE,
      await signedCookieValue(now),
      sessionCookieOptions()
    );

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
