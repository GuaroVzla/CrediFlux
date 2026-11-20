export function getSupabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
}

export function getSupabaseAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

export function getSupabaseServiceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseServiceRoleKey());
}

/**
 * El modo legado (identidad desde el header `x-user-id` y persistencia JSON/Prisma
 * local) existe únicamente para desarrollo y pruebas. En producción la identidad
 * DEBE venir de una sesión verificada por Supabase; un header controlado por el
 * cliente nunca puede otorgar privilegios.
 */
export function isLegacyAuthAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function assertSupabaseEnv(): { url: string; anonKey: string } {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    throw new Error('Supabase no está configurado: faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }
  return { url, anonKey };
}

/** Email sintético para conservar el login por nombre de usuario de CrediFlux. */
export function usernameToEmail(username: string): string {
  const clean = String(username || '').trim().toLowerCase();
  return clean.includes('@') ? clean : `${clean}@crediflux.local`;
}

export function emailToUsername(email: string | null | undefined): string {
  return String(email || '').split('@')[0] || '';
}
