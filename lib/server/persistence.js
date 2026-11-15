import fs from 'fs';
import path from 'path';
import { getPrisma, hasDatabase } from '../prisma.js';
import { decryptStateSecretsInMemory, encryptStateSecretsAtRest, encryptionAvailable } from './security.js';

const JSON_DB_PATH = path.join(process.cwd(), 'data', 'crediflux-store.json');
const LEGACY_DB_PATHS = [
  path.join(process.cwd(), 'data', 'ricardo-store.json'),
  path.join(process.cwd(), 'data', 'db.json'),
];
const APP_STATE_ID = 'main';

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
        const data = clone(row.data);
        decryptStateSecretsInMemory(data);
        return data;
      }

      // Inicializar desde JSON existente si hay (migración transparente) o vacío
      const seed = readJsonFile() || {};
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
      const fallback = readJsonFile() || {};
      decryptStateSecretsInMemory(fallback);
      return fallback;
    }
  }
  const local = readJsonFile() || {};
  decryptStateSecretsInMemory(local);
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
