import { NextResponse, type NextRequest } from 'next/server';
import { isLegacyAuthAllowed, isSupabaseConfigured } from './env';

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

/**
 * Secreto exclusivo del servidor para firmar las cookies de sesión.
 * Nunca se usa la anon key (pública por diseño) ni un literal en producción:
 * si falta la variable, fallamos cerrado en lugar de firmar con un secreto
 * conocido por el cliente.
 */
function getSessionSigningSecret(): string {
  const configured =
    process.env.SESSION_SIGNING_SECRET || process.env.SETTINGS_ENCRYPTION_KEY || '';
  if (configured.trim()) return configured.trim();
  if (isLegacyAuthAllowed()) return 'crediflux-dev-session';
  throw new Error(
    'Falta SESSION_SIGNING_SECRET (o SETTINGS_ENCRYPTION_KEY): no se pueden firmar las cookies de sesión.'
  );
}

/** Comparación de firma en tiempo constante, compatible con Edge Runtime. */
function signaturesEqual(expected: string, received: string): boolean {
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}

/** Firma HMAC-SHA256 incluyendo el nombre de cookie (evita intercambiarlas). */
async function signTimestamp(timestamp: string, cookieName: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Sin Web Crypto no se puede firmar de forma segura: en producción esto
    // provoca un 401 (fail-closed) en las rutas API protegidas.
    if (!isLegacyAuthAllowed()) throw new Error('Web Crypto no disponible para firmar la sesión.');
    return timestamp;
  }
  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(getSessionSigningSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${cookieName}.${timestamp}`)
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function signedCookieValue(timestamp: number, cookieName: string): Promise<string> {
  const raw = String(timestamp);
  return `${raw}.${await signTimestamp(raw, cookieName)}`;
}

/**
 * Devuelve el timestamp firmado o null si la cookie falta, es antigua (firma
 * del esquema anterior) o fue manipulada.
 */
async function readSignedTimestamp(
  raw: string | undefined,
  cookieName: string
): Promise<number | null> {
  if (!raw) return null;
  const separator = raw.lastIndexOf('.');
  // La firma es obligatoria: aceptar valores sin firma permitía inyectar un
  // timestamp arbitrario y eliminar los límites de 24 h / 30 min.
  if (separator <= 0) return null;
  const timestamp = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!/^\d+$/.test(timestamp)) return null;
  const expected = await signTimestamp(timestamp, cookieName);
  if (!signaturesEqual(expected, signature)) return null;
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return null;
  // Un timestamp futuro reiniciaría el reloj de sesión indefinidamente.
  if (value > Date.now() + 60_000) return null;
  return value;
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
 * En producción es "fail-closed": sin Supabase, sin secreto de firma o ante
 * cualquier error del SDK, las rutas /api/* protegidas devuelven 401 en lugar
 * de quedar expuestas. El modo legado sólo existe en desarrollo/pruebas.
 * El SDK se importa de forma dinámica para no cargarlo cuando no se usa.
 */
export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;

  if (!isSupabaseConfigured()) {
    if (!isLegacyAuthAllowed() && isProtectedApi(pathname)) {
      console.error('[proxy] Supabase no configurado en producción: se rechazan rutas API protegidas.');
      return unauthorizedResponse();
    }
    // Modo legado (sólo dev/test): el aislamiento se valida en cada handler.
    return response;
  }
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
    const rawStart = request.cookies.get(SESSION_START_COOKIE)?.value;
    const rawLast = request.cookies.get(LAST_ACTIVITY_COOKIE)?.value;
    const storedStart = await readSignedTimestamp(rawStart, SESSION_START_COOKIE);
    const storedLast = await readSignedTimestamp(rawLast, LAST_ACTIVITY_COOKIE);

    // Rotación de cookies: cualquier valor con el esquema de firma anterior
    // (o sin firma) se descarta y se reemplaza por uno firmado con el nuevo
    // contexto y secreto de servidor.
    const needsRotation =
      (Boolean(rawStart) && storedStart === null) || (Boolean(rawLast) && storedLast === null);
    if (needsRotation) {
      console.warn('[proxy] Cookies de seguimiento de sesión obsoletas; se rotaron.');
      clearTrackingCookies(request, finalResponse);
    }

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
      await signedCookieValue(sessionStart, SESSION_START_COOKIE),
      sessionCookieOptions()
    );
    finalResponse.cookies.set(
      LAST_ACTIVITY_COOKIE,
      await signedCookieValue(now, LAST_ACTIVITY_COOKIE),
      sessionCookieOptions()
    );

    return finalResponse;
  } catch (error) {
    // No derribar las páginas públicas por un fallo del SDK, pero NUNCA dejar
    // pasar una API protegida sin sesión verificada (fail-closed).
    console.error(
      `[proxy] No se pudo refrescar la sesión de Supabase: ${getErrorMessage(error)}`
    );
    return isProtectedApi(pathname) ? unauthorizedResponse() : response;
  }
}
