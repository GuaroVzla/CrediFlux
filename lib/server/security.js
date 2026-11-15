import crypto from 'crypto';

const SCRYPT_PREFIX = 'scrypt$';
const ENC_PREFIX = 'enc:v1:';
const KEY_LEN = 32;

// ---------- Password hashing (Node crypto.scrypt, sin dependencias nativas) ----------

export function isPasswordHash(value) {
  return typeof value === 'string' && value.startsWith(SCRYPT_PREFIX);
}

export async function hashPassword(password) {
  const plain = String(password ?? '');
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(plain, salt, KEY_LEN, { N, r, p }, (err, buf) => err ? reject(err) : resolve(buf));
  });
  return `${SCRYPT_PREFIX}${N}$${r}$${p}$${salt.toString('base64')}$${Buffer.from(derived).toString('base64')}`;
}

export function verifyPasswordSyncNotSupported() { /* placeholder */ }

export async function verifyPassword(password, stored) {
  const plain = String(password ?? '');
  const s = stored == null ? '' : String(stored);
  if (!s) return { ok: false, legacy: false, needsMigration: false };

  if (isPasswordHash(s)) {
    try {
      const parts = s.slice(SCRYPT_PREFIX.length).split('$');
      if (parts.length !== 5) return { ok: false, legacy: false, needsMigration: false };
      const [Ns, rs, ps, saltB64, hashB64] = parts;
      const N = parseInt(Ns, 10), r = parseInt(rs, 10), p = parseInt(ps, 10);
      const salt = Buffer.from(saltB64, 'base64');
      const expected = Buffer.from(hashB64, 'base64');
      const derived = await new Promise((resolve, reject) => {
        crypto.scrypt(plain, salt, expected.length, { N, r, p }, (err, buf) => err ? reject(err) : resolve(buf));
      });
      const ok = expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
      return { ok, legacy: false, needsMigration: false };
    } catch {
      return { ok: false, legacy: false, needsMigration: false };
    }
  }

  // Compatibilidad legado: contraseña en texto plano
  const ok = plain === s;
  return { ok, legacy: ok, needsMigration: ok };
}

export async function upgradePasswordIfNeeded(user, plainPassword) {
  if (!user) return false;
  const stored = user.passwordHash || user.password;
  const res = await verifyPassword(plainPassword, stored);
  if (!res.ok) return false;
  if (res.needsMigration || res.legacy || (user.password && !user.passwordHash)) {
    user.passwordHash = await hashPassword(plainPassword);
    user.password = undefined; // eliminar plaintext en reposo
    return true;
  }
  return false;
}

export function sanitizeUserForClient(user, { includeSecrets = false } = {}) {
  if (!user) return user;
  const { password, passwordHash, passwordLegacy, ...rest } = user;
  return {
    ...rest,
    hasPassword: Boolean(passwordHash || password || passwordLegacy),
    ...(includeSecrets ? {} : {}),
  };
}

// ---------- Cifrado de secretos en reposo (AES-256-GCM, SETTINGS_ENCRYPTION_KEY) ----------

function getEncryptionKey() {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  // aceptar hex (64), base64 (~44), o derivar de passphrase
  try {
    if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
    const b64 = Buffer.from(s, 'base64');
    if (b64.length === 32) return b64;
  } catch {}
  return crypto.createHash('sha256').update(s).digest();
}

export function encryptionAvailable() {
  return Boolean(getEncryptionKey());
}

export function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

export function encryptSecret(value) {
  if (value == null) return value;
  const str = String(value);
  if (str === '') return '';
  if (isEncryptedSecret(str)) return str;
  const key = getEncryptionKey();
  if (!key) return str; // sin clave: no se puede cifrar (se mantiene para no romper)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptSecret(value) {
  if (value == null) return value;
  const str = String(value);
  if (str === '') return '';
  if (!isEncryptedSecret(str)) return str; // legado/plaintext
  const key = getEncryptionKey();
  if (!key) {
    // No se puede descifrar sin clave; devolver vacío para no filtrar blob cifrado a consumidores
    return '';
  }
  try {
    const payload = str.slice(ENC_PREFIX.length);
    const [ivB64, tagB64, dataB64] = payload.split('.');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return '';
  }
}

export function decryptProviderKeys(keys) {
  const src = (keys && typeof keys === 'object') ? keys : {};
  const out = { ...src };
  for (const k of ['openai', 'gemini', 'ocrspace', 'anthropic']) {
    if (typeof out[k] === 'string') out[k] = decryptSecret(out[k]);
  }
  return out;
}

export function encryptProviderKeys(keys) {
  const src = (keys && typeof keys === 'object') ? keys : {};
  const out = { ...src };
  for (const k of ['openai', 'gemini', 'ocrspace', 'anthropic']) {
    if (typeof out[k] === 'string' && out[k] !== '') out[k] = encryptSecret(out[k]);
  }
  return out;
}

// Determina si un valor entrante es un placeholder/enmascarado (no debe sobrescribir el secreto real)
export function isMaskedSecret(value) {
  const s = String(value || '');
  return /^\*+$/.test(s) || (/^\*+/.test(s) && s.includes('...')) || (s.includes('...') && s.length <= 12);
}

// Convierte un campo de clave potencialmente "vacío por falta de key de cifrado" a estado seguro
export function resolveIncomingSecret(incoming, existingDecrypted) {
  if (incoming == null) return existingDecrypted || '';
  const s = String(incoming);
  if (s === '') return ''; // borrado explícito
  if (isMaskedSecret(s)) return existingDecrypted || '';
  return s;
}

// ---------- Aplicar a estado de app (en reposo cifrado) ----------

export function encryptStateSecretsAtRest(state) {
  if (!state || typeof state !== 'object') return state;
  const keyAvailable = encryptionAvailable();
  if (!keyAvailable) return state; // no podemos garantizar cifrado sin clave

  if (state.settings && typeof state.settings === 'object') {
    const s = state.settings;
    if (s.ocrApiKeys && typeof s.ocrApiKeys === 'object') {
      s.ocrApiKeys = encryptProviderKeys(s.ocrApiKeys);
    }
    if (typeof s.aiApiKey === 'string' && s.aiApiKey) s.aiApiKey = encryptSecret(s.aiApiKey);
    if (typeof s.ocrSpaceApiKey === 'string' && s.ocrSpaceApiKey) s.ocrSpaceApiKey = encryptSecret(s.ocrSpaceApiKey);
    // adminPassword en settings: hashear si es legado/plaintext
    // (hash async no posible aquí de forma síncrona; se maneja en flujos de escritura)
  }
  return state;
}

export function decryptStateSecretsInMemory(state) {
  if (!state || typeof state !== 'object') return state;
  if (state.settings && typeof state.settings === 'object') {
    const s = state.settings;
    if (s.ocrApiKeys && typeof s.ocrApiKeys === 'object') {
      s.ocrApiKeys = decryptProviderKeys(s.ocrApiKeys);
    }
    if (typeof s.aiApiKey === 'string') s.aiApiKey = decryptSecret(s.aiApiKey);
    if (typeof s.ocrSpaceApiKey === 'string') s.ocrSpaceApiKey = decryptSecret(s.ocrSpaceApiKey);
  }
  return state;
}
