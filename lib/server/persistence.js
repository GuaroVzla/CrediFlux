import fs from 'fs';
import path from 'path';
import { getPrisma, hasDatabase } from '../prisma.js';
import { decryptStateSecretsInMemory, encryptStateSecretsAtRest, encryptionAvailable, hashPassword } from './security.js';

const JSON_DB_PATH = path.join(process.cwd(), 'data', 'crediflux-store.json');
const LEGACY_DB_PATHS = [
  path.join(process.cwd(), 'data', 'ricardo-store.json'),
  path.join(process.cwd(), 'data', 'db.json'),
];
const APP_STATE_ID = 'main';

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
    blacklist: []
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
      return JSON.parse(fs.readFileSync(JSON_DB_PATH, 'utf-8'));
    }
    for (const legacyPath of LEGACY_DB_PATHS) {
      if (fs.existsSync(legacyPath)) {
        return JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
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
      return true;
    } catch (e) {
      console.error('[persistence] Error guardando AppState en DB:', e?.message || e);
      // Fallback best-effort local (útil solo fuera de Vercel)
      return writeJsonFile(toStore);
    }
  }
  return writeJsonFile(toStore);
}

export function persistenceInfo() {
  return {
    mode: hasDatabase() ? 'postgres' : 'json-file',
    persistent: hasDatabase(),
    databaseConfigured: hasDatabase(),
    blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    encryptionAtRest: encryptionAvailable(),
  };
}

export { hasDatabase };
