import type { SupabaseClient, User as SupabaseAuthUser } from '@supabase/supabase-js';
import type { Database, ProfileRow } from '@/lib/supabase/database.types';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClientOrNull } from '@/lib/supabase/admin';
import { emailToUsername, isSupabaseConfigured } from '@/lib/supabase/env';

export interface RequestAuth {
  mode: 'supabase' | 'legacy';
  supabase: SupabaseClient<Database> | null;
  authUser: SupabaseAuthUser | null;
  profile: ProfileRow | null;
  userId: string | null;
}

const authCache = new WeakMap<object, Promise<RequestAuth>>();

export function resolveRequestAuth(request: Request): Promise<RequestAuth> {
  const key = request as unknown as object;
  let cached = authCache.get(key);
  if (!cached) {
    cached = doResolveRequestAuth(request);
    authCache.set(key, cached);
  }
  return cached;
}

async function doResolveRequestAuth(request: Request): Promise<RequestAuth> {
  if (!isSupabaseConfigured()) {
    return {
      mode: 'legacy',
      supabase: null,
      authUser: null,
      profile: null,
      userId: request.headers.get('x-user-id') || null,
    };
  }

  const supabase = await createSupabaseServerClient();

  let authUser: SupabaseAuthUser | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    authUser = data.user;
  } catch {
    authUser = null;
  }

  if (!authUser) {
    return { mode: 'supabase', supabase, authUser: null, profile: null, userId: null };
  }

  let profile: ProfileRow | null = null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();

  if (!error && data) profile = data as ProfileRow;

  if (!profile) {
    profile = await ensureProfileRow(authUser);
  }

  return {
    mode: 'supabase',
    supabase,
    authUser,
    profile,
    userId: profile?.id || authUser.id,
  };
}

/**
 * Crea el perfil si el trigger de auth.users no llegó a ejecutarse.
 * Requiere service_role; si no está disponible se devuelve un perfil mínimo
 * en memoria para no romper la sesión (RLS seguirá aplicando).
 */
async function ensureProfileRow(user: SupabaseAuthUser): Promise<ProfileRow | null> {
  const admin = getSupabaseAdminClientOrNull();
  const username =
    (user.user_metadata?.username as string | undefined) ||
    emailToUsername(user.email) ||
    `user_${user.id.slice(0, 8)}`;

  if (!admin) {
    return {
      id: user.id,
      username,
      full_name: (user.user_metadata?.full_name as string | undefined) || username,
      company_name: null,
      email: user.email ?? null,
      address: null,
      phone: null,
      role: 'user',
      is_active: true,
      license_key: null,
      license_status: 'expired',
      license_assigned_at: null,
      license_expires_at: null,
      license_duration_months: 1,
      monthly_capitals: {},
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const { data, error } = await admin
    .from('profiles')
    .upsert(
      {
        id: user.id,
        username,
        full_name: (user.user_metadata?.full_name as string | undefined) || username,
        email: user.email ?? null,
        role: 'user',
        is_active: true,
      },
      { onConflict: 'id' }
    )
    .select('*')
    .single();

  if (error) {
    console.error('[auth] No se pudo asegurar el perfil:', error.message);
    return null;
  }
  return data as ProfileRow;
}

/** Convierte un perfil Supabase al shape legado que consume el frontend. */
export function profileToLegacyUser(profile: ProfileRow | null) {
  if (!profile) return null;
  return {
    id: profile.id,
    username: profile.username,
    name: profile.full_name || profile.username,
    companyName: profile.company_name || '',
    email: profile.email || '',
    address: profile.address || '',
    phone: profile.phone || '',
    role: profile.role === 'admin' ? 'admin' : 'user',
    rawRole: profile.role,
    isActive: profile.is_active,
    passwordHash: 'supabase-auth',
    licenseKey: profile.license_key || (profile.role === 'admin' ? 'N/A (Admin)' : ''),
    licenseStatus: profile.license_status,
    licenseAssignedAt: profile.license_assigned_at,
    licenseExpiresAt: profile.license_expires_at,
    licenseDurationMonths: profile.license_duration_months,
    monthlyCapitals: profile.monthly_capitals || {},
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}
