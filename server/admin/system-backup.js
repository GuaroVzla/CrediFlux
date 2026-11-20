import { getSupabaseAdminClientOrNull } from '../supabase/admin';
import { isSupabaseAdminConfigured } from '../supabase/env';

const BACKUP_FORMAT = 'crediflux.system-backup';

/** No hay forma de leer/escribir el respaldo de forma atómica (503). */
export class BackupUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupUnavailableError';
    this.status = 503;
    this.code = 'BACKUP_UNAVAILABLE';
  }
}

/** El archivo no cumple el contrato de formato (400). */
export class BackupValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupValidationError';
    this.status = 400;
    this.code = 'BACKUP_INVALID_FILE';
  }
}

/** El llamador no tiene permisos en la base de datos (403). */
export class BackupForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupForbiddenError';
    this.status = 403;
    this.code = 'BACKUP_FORBIDDEN';
  }
}

/** La RPC inició la restauración y falló; PostgreSQL hizo ROLLBACK (500). */
export class BackupTransactionError extends Error {
  constructor(message, detail = '') {
    super(message);
    this.name = 'BackupTransactionError';
    this.status = 500;
    this.code = 'BACKUP_TRANSACTION_FAILED';
    this.detail = detail;
  }
}

/** Nunca devolvemos stack traces ni secretos al cliente. */
export function publicBackupError(error) {
  let text = String(error?.message || error || 'Error desconocido de respaldo')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
  for (const secret of [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.DATABASE_URL,
  ]) {
    if (secret) text = text.split(secret).join('[REDACTADO]');
  }
  return text;
}

function isMissingRpc(error) {
  return error?.code === 'PGRST202' || /could not find the function|no function matches/i.test(String(error?.message || ''));
}

function mapRpcError(error, context) {
  if (isMissingRpc(error)) {
    return new BackupUnavailableError(
      `${context}: la RPC de respaldo no está aplicada. ` +
      'Ejecuta las migraciones de supabase/migrations/ con `supabase db push --remote`.'
    );
  }
  if (error?.code === '42501') {
    return new BackupForbiddenError('No autorizado para operar el respaldo del sistema.');
  }
  if (error?.code === '22023') {
    return new BackupValidationError(error.message || 'Archivo de respaldo inválido.');
  }
  return new BackupTransactionError(
    `${context}: la operación no se pudo completar y se hizo ROLLBACK.`,
    publicBackupError(error)
  );
}

function requireAdminClient() {
  if (!isSupabaseAdminConfigured()) {
    throw new BackupUnavailableError(
      'SUPABASE_SERVICE_ROLE_KEY no configurada. Se requiere service_role para el respaldo del sistema.'
    );
  }
  const admin = getSupabaseAdminClientOrNull();
  if (!admin) {
    throw new BackupUnavailableError('No se pudo inicializar el cliente admin de Supabase.');
  }
  return admin;
}

function normalizeExport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BackupTransactionError('La RPC de exportación devolvió una respuesta inválida.');
  }
  if (!payload.tables || typeof payload.tables !== 'object' || Array.isArray(payload.tables)) {
    throw new BackupTransactionError('La RPC de exportación no devolvió el bloque de tablas.');
  }
  return {
    ...payload,
    format: payload.format || BACKUP_FORMAT,
    formatVersion: Number(payload.formatVersion) || 1,
    modules: payload.modules && typeof payload.modules === 'object' ? payload.modules : {},
    summary: payload.summary && typeof payload.summary === 'object' ? payload.summary : {},
  };
}

/**
 * Serializa dinámicamente todas las tablas del schema public. El catálogo y el
 * orden de dependencias se calculan dentro de PostgreSQL, no en este archivo.
 */
export async function exportSystemBackup() {
  const admin = requireAdminClient();
  const { data, error } = await admin.rpc('admin_export_system_backup');
  if (error) throw mapRpcError(error, 'No se pudo generar el respaldo');
  return normalizeExport(data);
}

/**
 * Restaura un snapshot en una sola transacción. `dryRun` valida y calcula el
 * orden sin escribir; se usa para pruebas y diagnóstico sin tocar los datos.
 */
export async function importSystemBackup(importData, { dryRun = false } = {}) {
  const payload = importData?.data && typeof importData.data === 'object' && !Array.isArray(importData.data)
    ? importData.data
    : importData;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BackupValidationError('Estructura de archivo inválida: se esperaba un objeto JSON.');
  }
  if (payload.format && payload.format !== BACKUP_FORMAT) {
    throw new BackupValidationError('Formato de respaldo no soportado. Genera un respaldo nuevo desde Ajustes.');
  }
  if (payload.formatVersion && Number(payload.formatVersion) > 1) {
    throw new BackupValidationError(
      `Versión de respaldo no soportada (${payload.formatVersion}). Actualiza la aplicación.`
    );
  }
  if (!payload.tables || typeof payload.tables !== 'object' || Array.isArray(payload.tables)) {
    throw new BackupValidationError(
      'Archivo de respaldo inválido: falta el bloque "tables". Genera un respaldo nuevo desde Ajustes.'
    );
  }

  const admin = requireAdminClient();
  const { data, error } = await admin.rpc('admin_import_system_backup', {
    p_payload: payload,
    p_dry_run: dryRun === true,
  });
  if (error) throw mapRpcError(error, 'No se pudo restaurar el respaldo');
  if (!data || data.success !== true) {
    throw new BackupTransactionError('La RPC de importación no confirmó la restauración.');
  }
  return data;
}
