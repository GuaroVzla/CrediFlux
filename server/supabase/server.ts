import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/shared/types/database';
import { assertSupabaseEnv, isSupabaseConfigured } from '@/server/supabase/env';

/**
 * Cliente Supabase ligado a las cookies de la petición.
 * Se usa en Server Components, Server Actions y Route Handlers.
 * RLS se aplica con la identidad del usuario autenticado.
 */
export async function createSupabaseServerClient() {
  const { url, anonKey } = assertSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // En Server Components no se pueden escribir cookies; el middleware
          // se encarga de refrescar la sesión.
        }
      },
    },
  });
}

export async function getSupabaseServerClientOrNull() {
  if (!isSupabaseConfigured()) return null;
  return createSupabaseServerClient();
}

function parseCookieHeader(header: string | null) {
  if (!header) return [];
  return header.split(';').map((part) => {
    const index = part.indexOf('=');
    return index === -1
      ? { name: part.trim(), value: '' }
      : { name: part.slice(0, index).trim(), value: decodeURIComponent(part.slice(index + 1).trim()) };
  });
}

/**
 * Cliente para Route Handlers que necesitan establecer la sesión (login/logout).
 * Acumula las cookies y las aplica explícitamente a la respuesta final.
 */
export function createSupabaseRouteClient(request: Request) {
  const { url, anonKey } = assertSupabaseEnv();
  const pending: { name: string; value: string; options?: any }[] = [];
  const cookieHeader = request.headers.get('cookie');

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(cookieHeader);
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach((cookie) => {
          const existingIndex = pending.findIndex((item) => item.name === cookie.name);
          if (existingIndex >= 0) pending[existingIndex] = cookie;
          else pending.push(cookie);
        });
      },
    },
  });

  return {
    supabase,
    applyCookies<T extends { cookies: { set: (name: string, value: string, options?: any) => unknown } }>(response: T): T {
      pending.forEach((cookie) => response.cookies.set(cookie.name, cookie.value, cookie.options));
      return response;
    },
  };
}
