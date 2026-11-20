import fs from 'fs';
import os from 'os';
import path from 'path';
import { getPrisma, hasDatabase } from '@/server/persistence/prisma.js';
import { decryptStateSecretsInMemory, encryptStateSecretsAtRest, encryptionAvailable, hashPassword } from '@/server/security/security.js';

const JSON_DB_PATH = path.join(process.cwd(), 'data', 'crediflux-store.json');
const LEGACY_DB_PATHS = [
  path.join(process.cwd(), 'data', 'ricardo-store.json'),
  path.join(process.cwd(), 'data', 'db.json'),
];
const APP_STATE_ID = 'main';

function isServerlessReadonlyEnv() {
  // Vercel y la mayoría de plataformas serverless exponen FS efímero/de solo lectura fuera de /tmp.
  return Boolean(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT ||
    process.env.K_SERVICE // Cloud Run/Knative
  );
}

function canWriteLocalStore() {
  try {
    ensureDir(JSON_DB_PATH);
    fs.accessSync(path.dirname(JSON_DB_PATH), fs.constants.W_OK);
    const probe = path.join(path.dirname(JSON_DB_PATH), `.persist-probe-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(probe, '1');
    fs.unlinkSync(probe);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function getPersistenceDiagnostics() {
  const databaseConfigured = hasDatabase();
  const serverless = isServerlessReadonlyEnv();
  const localWrite = !databaseConfigured ? canWriteLocalStore() : { ok: true };
  const blobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const mode = databaseConfigured ? 'postgres' : 'json-file';
  const persistent = databaseConfigured ? true : Boolean(localWrite.ok && !serverless);
  const issues = [];

  if (!databaseConfigured && serverless) {
    issues.push('DATABASE_URL no está configurado en un entorno serverless (Vercel): el sistema de archivos es efímero/de solo lectura y los cambios no persistirán.');
  }
  if (!databaseConfigured && !localWrite.ok) {
    issues.push(`No es posible escribir el almacén local (${JSON_DB_PATH}): ${localWrite.reason || 'permiso denegado o ruta de solo lectura'}.`);
  }
  if (!databaseConfigured && !serverless && !localWrite.ok) {
    issues.push('Configura DATABASE_URL (PostgreSQL) o habilita permisos de escritura en el directorio de datos.');
  }

  return {
    mode,
    persistent,
    databaseConfigured,
    blobConfigured,
    serverless,
    localWritable: Boolean(localWrite.ok),
    encryptionAtRest: encryptionAvailable(),
    issues,
    guidance: !databaseConfigured
      ? 'Para producción en Vercel configura la variable de entorno DATABASE_URL apuntando a PostgreSQL (Neon/Supabase/Vercel Postgres) y ejecuta las migraciones de Prisma. Como alternativa de emergencia, importa solo después de habilitar un almacén duradero.'
      : null,
  };
}

export async function checkPersistenceConnection() {
  const prisma = getPrisma();
  if (!prisma) {
    const diag = getPersistenceDiagnostics();
    return {
      ok: !isServerlessReadonlyEnv() && diag.localWritable,
      mode: diag.mode,
      persistent: diag.persistent,
      databaseConfigured: false,
      message: diag.databaseConfigured
        ? 'Base de datos configurada.'
        : (diag.issues[0] || 'Persistencia local en uso (no recomendada para Vercel).'),
      diagnostics: diag,
    };
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      ok: true,
      mode: 'postgres',
      persistent: true,
      databaseConfigured: true,
      message: 'Conexión a PostgreSQL verificada correctamente.',
      diagnostics: getPersistenceDiagnostics(),
    };
  } catch (e) {
    const message = e?.message || String(e);
    console.error('[persistence] Error verificando conexión a base de datos:', message);
    return {
      ok: false,
      mode: 'postgres',
      persistent: false,
      databaseConfigured: true,
      message: `No se pudo conectar/escribir en la base de datos configurada (DATABASE_URL): ${message}`,
      diagnostics: getPersistenceDiagnostics(),
    };
  }
}

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

function getDefaultMonthlyCapital(baseValue = 5000) {
  const currentYear = new Date().getFullYear();
  const months = {};
  for (let i = 1; i <= 12; i++) {
    const key = `${currentYear}-${String(i).padStart(2, '0')}`;
    months[key] = { monthIndex: i, monthName: MONTH_NAMES[i - 1], year: currentYear, capital: baseValue };
  }
  return months;
}

async function buildDefaultState() {
  const adminPasswordHash = await hashPassword('admin123');
  return {
    settings: {
      licenseKey: "CREDIFLUX-FINTECH-2026",
      currency: "$",
      aiProvider: "openai",
      aiApiKey: "",
      ocrApiKeys: { openai: "", gemini: "", ocrspace: "" },
      adminPasswordHash,
      ecommerceCapital: 5000
    },
    users: [
      {
        id: "usr_admin",
        username: "admin",
        name: "Administrador del Sistema",
        role: "admin",
        passwordHash: adminPasswordHash,
        monthlyCapitals: getDefaultMonthlyCapital(5000),
        createdAt: new Date().toISOString()
      }
    ],
    clients: [],
    products: [],
    loans: [],
    payments: [],
    ecommerce: [],
    receiptPatterns: [],
    blacklist: [],
    capitalMovements: []
  };
}

function isEmptyState(data) {
  if (!data || typeof data !== 'object') return true;
  const users = Array.isArray(data.users) ? data.users : [];
  const hasAnyData = users.length > 0 || (Array.isArray(data.clients) && data.clients.length) || (Array.isArray(data.loans) && data.loans.length) || (Array.isArray(data.products) && data.products.length) || (Array.isArray(data.payments) && data.payments.length) || (Array.isArray(data.ecommerce) && data.ecommerce.length);
  return !hasAnyData;
}

async function ensureBootstrapState(data) {
  const state = (data && typeof data === 'object') ? data : {};
  if (!Array.isArray(state.users)) state.users = [];
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};

  const hasAdmin = state.users.some(u => u && (u.role === 'admin' || u.username === 'admin' || u.id === 'usr_admin'));
  if (!hasAdmin) {
    const defaults = await buildDefaultState();
    state.settings = { ...defaults.settings, ...state.settings };
    // conservar hash si ya existía en settings
    if (!state.settings.adminPasswordHash && defaults.settings.adminPasswordHash) state.settings.adminPasswordHash = defaults.settings.adminPasswordHash;
    state.users.unshift(defaults.users[0]);
  }
  // asegurar campos base
  if (!state.settings.currency) state.settings.currency = '$';
  if (state.settings.ecommerceCapital == null) state.settings.ecommerceCapital = 5000;
  if (!Array.isArray(state.clients)) state.clients = [];
  if (!Array.isArray(state.products)) state.products = [];
  if (!Array.isArray(state.loans)) state.loans = [];
  if (!Array.isArray(state.payments)) state.payments = [];
  if (!Array.isArray(state.ecommerce)) state.ecommerce = [];
  if (!Array.isArray(state.receiptPatterns)) state.receiptPatterns = [];
  if (!Array.isArray(state.blacklist)) state.blacklist = [];
  return state;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile() {
  try {
    if (fs.existsSync(JSON_DB_PATH)) {
      return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ JSON_DB_PATH, 'utf-8'));
    }
    for (const legacyPath of LEGACY_DB_PATHS) {
      if (fs.existsSync(/*turbopackIgnore: true*/ legacyPath)) {
        return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ legacyPath, 'utf-8'));
      }
    }
  } catch (e) {
    console.error('[persistence] Error leyendo JSON:', e);
  }
  return null;
}

function writeJsonFile(data) {
  try {
    ensureDir(JSON_DB_PATH);
    fs.writeFileSync(JSON_DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[persistence] Error escribiendo JSON:', e);
    return false;
  }
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

/**
 * Capa de persistencia central.
 * - Si DATABASE_URL está configurado: usa Postgres (tabla AppState) => persistente en Vercel.
 * - Si no: usa JSON local (desarrollo) conservando compatibilidad.
 * Hardening: las claves de proveedores se descifran en memoria al leer y se cifran en reposo al guardar
 * cuando SETTINGS_ENCRYPTION_KEY está configurada.
 */

export async function getAppState() {
  const prisma = getPrisma();
  if (prisma) {
    try {
      const row = await prisma.appState.findUnique({ where: { id: APP_STATE_ID } });
      if (row?.data && typeof row.data === 'object') {
        let data = clone(row.data);
        decryptStateSecretsInMemory(data);
        // Bootstrap automático si no hay admin/estado inicial (evita bloqueo en despliegues nuevos)
        if (isEmptyState(data) || !(Array.isArray(data.users) && data.users.some(u => u?.role === 'admin' || u?.username === 'admin'))) {
          data = await ensureBootstrapState(data);
          const toStore = clone(data);
          encryptStateSecretsAtRest(toStore);
          await prisma.appState.upsert({
            where: { id: APP_STATE_ID },
            update: { data: toStore },
            create: { id: APP_STATE_ID, data: toStore },
          });
        }
        return data;
      }

      // Inicializar desde JSON existente si hay (migración transparente) o estado por defecto
      let seed = readJsonFile();
      if (!seed || isEmptyState(seed)) seed = await buildDefaultState();
      seed = await ensureBootstrapState(seed);
      const toStore = clone(seed);
      encryptStateSecretsAtRest(toStore);
      await prisma.appState.upsert({
        where: { id: APP_STATE_ID },
        update: { data: toStore },
        create: { id: APP_STATE_ID, data: toStore },
      });
      decryptStateSecretsInMemory(seed);
      return seed;
    } catch (e) {
      console.error('[persistence] Error leyendo AppState en DB, usando fallback JSON:', e?.message || e);
      let fallback = readJsonFile() || {};
      decryptStateSecretsInMemory(fallback);
      fallback = await ensureBootstrapState(fallback);
      return fallback;
    }
  }
  let local = readJsonFile() || {};
  decryptStateSecretsInMemory(local);
  local = await ensureBootstrapState(local);
  // persistir bootstrap local si se creó admin por defecto
  if (!readJsonFile()) {
    try { writeJsonFile(local); } catch {}
  }
  return local;
}

export async function saveAppState(data) {
  const result = await saveAppStateWithResult(data);
  return result.ok;
}

export async function saveAppStateWithResult(data) {
  const toStore = clone(data || {});
  encryptStateSecretsAtRest(toStore);

  const prisma = getPrisma();
  if (prisma) {
    try {
      await prisma.appState.upsert({
        where: { id: APP_STATE_ID },
        update: { data: toStore },
        create: { id: APP_STATE_ID, data: toStore },
      });
      return { ok: true, mode: 'postgres', persistent: true };
    } catch (e) {
      const message = e?.message || String(e);
      console.error('[persistence] Error guardando AppState en DB:', message);
      if (isServerlessReadonlyEnv()) {
        return {
          ok: false,
          mode: 'postgres',
          persistent: false,
          error: `Falló la escritura en PostgreSQL (DATABASE_URL). Verifica la conexión, credenciales, red y migraciones. Detalle: ${message}`
        };
      }
      const localOk = writeJsonFile(toStore);
      return localOk
        ? { ok: true, mode: 'json-file', persistent: false, warning: `Fallo en DB, guardado en almacén local: ${message}` }
        : { ok: false, mode: 'json-file', persistent: false, error: `Falló la escritura en DB y también en almacén local. Detalle DB: ${message}` };
    }
  }

  const diag = getPersistenceDiagnostics();
  if (isServerlessReadonlyEnv()) {
    const msg = diag.issues[0] || 'No hay un almacén duradero configurado para este entorno serverless.';
    console.error('[persistence] Escritura bloqueada en entorno serverless sin DB:', msg);
    return { ok: false, mode: 'json-file', persistent: false, error: msg, diagnostics: diag };
  }

  const localOk = writeJsonFile(toStore);
  if (!localOk) {
    const localDiag = getPersistenceDiagnostics();
    const msg = localDiag.issues[0] || `No se pudo escribir en el almacén local (${JSON_DB_PATH}).`;
    console.error('[persistence] Error guardando en almacén local:', msg);
    return { ok: false, mode: 'json-file', persistent: false, error: msg, diagnostics: localDiag };
  }
  return { ok: true, mode: 'json-file', persistent: !isServerlessReadonlyEnv(), diagnostics: diag };
}

export function persistenceInfo() {
  return getPersistenceDiagnostics();
}

export { hasDatabase };
