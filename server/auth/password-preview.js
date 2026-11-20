import { getSupabaseAdminClientOrNull } from '../supabase/admin';
import { isSupabaseConfigured } from '../supabase/env';
import { decryptSecret, encryptSecret, encryptionAvailable } from '@/server/security/security.js';

/**
 * Vista previa de claves de acceso.
 *
 * Las claves de autenticación se guardan SIEMPRE con hashing (Supabase Auth / scrypt)
 * porque ese es el mecanismo de verificación. De forma adicional, y solo cuando
 * SETTINGS_ENCRYPTION_KEY está disponible, se conserva una copia cifrada
 * (AES-256-GCM) de las claves creadas o reemplazadas desde la activación de esta
 * función. Esa copia es la única que puede mostrarse bajo demanda a un Admin.
 *
 * Nunca se expone en el payload del listado: solo se desciftra en el endpoint
 * de revelado, válido únicamente mientras el botón está presionado.
 */

const PREVIEW_METADATA_KEY = 'passwordPreview';
const PREVIEW_LEGACY_FIELD = 'passwordEncrypted';

function metadataObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

export function canRevealPasswords() {
  return encryptionAvailable();
}

/** Modo legado (JSON/Postgres): la copia cifrada viaja dentro del usuario. */
export function setLegacyPasswordPreview(user, plainPassword) {
  if (!user) return;
  if (!plainPassword || !canRevealPasswords()) {
    delete user[PREVIEW_LEGACY_FIELD];
    return;
  }
  user[PREVIEW_LEGACY_FIELD] = encryptSecret(String(plainPassword).trim());
}

export function getLegacyPasswordPreview(user) {
  const stored = user?.[PREVIEW_LEGACY_FIELD];
  if (!stored || !canRevealPasswords()) return null;
  return decryptSecret(stored) || null;
}

/**
 * Guarda la copia reversible en el perfil de Supabase (metadata JSONB) usando
 * service_role. Devuelve false cuando no hay clave de cifrado o no hay perfil.
 */
export async function storePasswordPreview(userId, plainPassword) {
  if (!userId || !plainPassword || !canRevealPasswords()) return false;
  if (!isSupabaseConfigured()) return false;

  const admin = getSupabaseAdminClientOrNull();
  if (!admin) return false;

  const secret = encryptSecret(String(plainPassword).trim());
  const { data, error } = await admin
    .from('profiles')
    .select('metadata')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el perfil para la vista previa: ${error.message}`);
  if (!data) return false;

  const metadata = metadataObject(data.metadata);
  const { error: updateError } = await admin
    .from('profiles')
    .update({ metadata: { ...metadata, [PREVIEW_METADATA_KEY]: secret } })
    .eq('id', userId);
  if (updateError) throw new Error(`No se pudo guardar la vista previa de la clave: ${updateError.message}`);
  return true;
}

/** Devuelve la clave en claro solo si existe una copia reversible cifrada. */
export async function readPasswordPreview(userId, legacyUser) {
  if (!canRevealPasswords()) return null;

  if (isSupabaseConfigured()) {
    if (!userId) return null;
    const admin = getSupabaseAdminClientOrNull();
    if (!admin) return null;
    const { data, error } = await admin
      .from('profiles')
      .select('metadata')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return null;
    const stored = metadataObject(data.metadata)[PREVIEW_METADATA_KEY];
    if (!stored) return null;
    return decryptSecret(stored) || null;
  }

  return getLegacyPasswordPreview(legacyUser);
}
