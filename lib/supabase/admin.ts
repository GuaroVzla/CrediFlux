import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { getSupabaseServiceRoleKey, getSupabaseUrl, isSupabaseAdminConfigured } from './env';

let adminClient: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Cliente con service_role. OMITE RLS: usar solo en el servidor para tareas
 * administrativas controladas (alta de usuarios, migraciones, borrados de auth).
 */
export function createSupabaseAdminClient() {
  if (!isSupabaseAdminConfigured()) {
    throw new Error('Supabase admin no configurado: falta SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (adminClient) return adminClient;
  adminClient = createClient<Database>(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return adminClient;
}

export function getSupabaseAdminClientOrNull() {
  if (!isSupabaseAdminConfigured()) return null;
  return createSupabaseAdminClient();
}
