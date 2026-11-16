/**
 * Migra data/crediflux-store.json (o legados) a Supabase.
 *
 * Uso:
 *   node --env-file=.env.local scripts/migrate-json-to-supabase.mjs
 *
 * Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
 * Las contraseñas legadas (hash scrypt) NO son trasladables a Supabase Auth:
 *  - El admin se crea con BOOTSTRAP_ADMIN_PASSWORD (o admin123 + aviso).
 *  - Los operadores se crean con BOOTSTRAP_USER_PASSWORD o una clave aleatoria
 *    temporal que se imprime al final para que el admin la resetee.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();

function loadEnvFile(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function toUuid(value) {
  const raw = String(value ?? '').trim();
  if (UUID_RE.test(raw)) return raw.toLowerCase();
  const hash = crypto.createHash('sha1').update(raw || crypto.randomUUID()).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const num = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
const text = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const dateOnly = (v) => {
  if (!v) return new Date().toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : new Date(v).toISOString().slice(0, 10);
};

function readLegacy() {
  const candidates = [
    path.join(ROOT, 'data', 'crediflux-store.json'),
    path.join(ROOT, 'data', 'ricardo-store.json'),
    path.join(ROOT, 'data', 'db.json'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
  }
  throw new Error('No se encontró data/crediflux-store.json ni legados.');
}

async function findAuthUserByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const found = (data.users || []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (!data.users || data.users.length < 1000) return null;
    page += 1;
  }
}

async function ensureAuthUser({ username, name, password }) {
  const email = `${String(username).toLowerCase()}@crediflux.local`;
  const existing = await findAuthUserByEmail(email);
  if (existing) return { user: existing, created: false, password: null };

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, full_name: name },
  });
  if (error) throw new Error(`No se pudo crear auth user ${username}: ${error.message}`);
  return { user: data.user, created: true, password };
}

async function upsertChunks(table, rows, onConflict = 'id') {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function main() {
  const { file, data } = readLegacy();
  console.log(`Origen: ${file}`);

  const legacyUsers = Array.isArray(data.users) ? data.users : [];
  const adminLegacy = legacyUsers.find((u) => u.role === 'admin') || legacyUsers[0];
  if (!adminLegacy) throw new Error('El JSON no contiene usuarios.');

  const ownerMap = new Map();
  const credentials = [];

  for (const user of legacyUsers) {
    const isAdmin = user.role === 'admin';
    const password =
      process.env[isAdmin ? 'BOOTSTRAP_ADMIN_PASSWORD' : 'BOOTSTRAP_USER_PASSWORD'] ||
      (isAdmin ? 'admin123' : crypto.randomUUID().slice(0, 12));

    const { user: authUser } = await ensureAuthUser({
      username: user.username,
      name: user.name || user.username,
      password,
    });

    ownerMap.set(user.id, authUser.id);

    const licenseExpired = user.licenseExpiresAt && new Date(user.licenseExpiresAt).getTime() < Date.now();
    await upsertChunks('profiles', [{
      id: authUser.id,
      username: user.username,
      full_name: user.name || user.username,
      company_name: text(user.companyName),
      email: `${String(user.username).toLowerCase()}@crediflux.local`,
      address: text(user.address),
      phone: text(user.phone),
      role: isAdmin ? 'admin' : 'user',
      is_active: user.isActive !== false,
      license_key: text(user.licenseKey),
      license_status: licenseExpired ? 'expired' : 'active',
      license_assigned_at: user.licenseAssignedAt || null,
      license_expires_at: user.licenseExpiresAt || null,
      license_duration_months: num(user.licenseDurationMonths, 1),
      monthly_capitals: user.monthlyCapitals || {},
    }]);

    credentials.push({ username: user.username, role: isAdmin ? 'admin' : 'user', password });
  }

  const adminId = ownerMap.get(adminLegacy.id);
  const ownerOf = (record) => ownerMap.get(record?.userId) || adminId;

  // --- Configuración (global legada -> admin) ---
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  const settingsForStorage = JSON.parse(JSON.stringify(settings));
  try {
    const { encryptStateSecretsAtRest } = await import('../lib/server/security.js');
    encryptStateSecretsAtRest({ settings: settingsForStorage });
  } catch (e) {
    console.warn('No se pudieron cifrar secretos al importar:', e?.message || e);
  }

  await upsertChunks('user_settings', [{
    user_id: adminId,
    company_name: String(settings.companyName || 'CrediFlux'),
    currency: String(settings.currency || '$'),
    timezone: String(settings.timezone || 'America/Caracas'),
    ecommerce_capital: num(settings.ecommerceCapital, 5000),
    ai_provider: ['openai', 'gemini', 'ocrspace', 'tesseract'].includes(settings.aiProvider) ? settings.aiProvider : 'ocrspace',
    ai_auto_assign_enabled: settings.aiAutoAssignEnabled !== false,
    ai_routing_rules: settings.aiRoutingRules || {},
    ocr_confidence_min: Math.min(1, Math.max(0, num(settings.ocrConfidenceMin, 0.8))),
    ocr_api_keys: settingsForStorage.ocrApiKeys || {},
    provider_config: settings.providerConfig || {},
    feature_flags: settings.featureFlags || {},
    system_license_key: text(settings.systemLicenseKey || settings.licenseKey),
    data: settingsForStorage,
  }], 'user_id');

  const trust = settings.trustLevelConfig?.levels || {};
  const trustRows = Object.entries(trust).map(([tier, level], index) => ({
    user_id: adminId,
    tier: ['alto', 'medio', 'riesgoso'].includes(tier) ? tier : 'medio',
    label: String(level?.label || tier),
    description: String(level?.description || ''),
    criteria: { thresholds: settings.trustLevelConfig?.thresholds || {} },
    is_active: true,
    sort_order: index + 1,
  }));
  await upsertChunks('trust_level_configs', trustRows, 'user_id,tier');

  // --- Clientes ---
  const clients = Array.isArray(data.clients) ? data.clients : [];
  const clientIds = new Set(clients.map((c) => toUuid(c.id)));
  await upsertChunks('clients', clients.map((c) => ({
    id: toUuid(c.id),
    user_id: ownerOf(c),
    name: String(c.name || '').trim(),
    dni: String(c.dni || '').trim(),
    phone: text(c.phone),
    address: text(c.address),
    trust_level: String(c.trustLevel || 'medio').toLowerCase(),
    credit_limit: num(c.creditLimit, 500),
    notes: text(c.notes),
    is_active: c.isActive !== false,
  })));

  // --- Productos ---
  const products = Array.isArray(data.products) ? data.products : [];
  const productIds = new Set(products.map((p) => toUuid(p.id)));
  await upsertChunks('products', products.map((p) => ({
    id: toUuid(p.id),
    user_id: ownerOf(p),
    name: String(p.name || '').trim(),
    category: text(p.category),
    cost_price: num(p.costPrice),
    sale_price: num(p.salePrice),
    profit_margin_percent: num(p.profitMarginPercent),
    manual_sale_price: Boolean(p.manualSalePrice),
    stock: Math.max(0, num(p.stock)),
  })));

  // --- Préstamos y cuotas ---
  const loans = Array.isArray(data.loans) ? data.loans : [];
  const loanRows = [];
  const installmentRows = [];
  for (const loan of loans) {
    const owner = ownerOf(loan);
    const loanId = toUuid(loan.id);
    const clientId = loan.clientId ? toUuid(loan.clientId) : null;
    const productId = loan.productId ? toUuid(loan.productId) : null;
    loanRows.push({
      id: loanId,
      user_id: owner,
      client_id: clientId && clientIds.has(clientId) ? clientId : null,
      client_name: String(loan.clientName || ''),
      type: ['dinero', 'producto', 'cash', 'equipment'].includes(loan.type) ? loan.type : 'dinero',
      product_id: productId && productIds.has(productId) ? productId : null,
      product_name: text(loan.productName),
      principal: num(loan.principal),
      down_payment: num(loan.downPayment),
      financed_amount: num(loan.financedAmount),
      interest_rate: num(loan.interestRate),
      total_amount: num(loan.totalAmount),
      installment_count: Math.max(1, num(loan.installmentCount, 1)),
      installment_amount: num(loan.installmentAmount),
      frequency: ['diario', 'semanal', 'quincenal', 'mensual'].includes(loan.frequency) ? loan.frequency : 'mensual',
      start_date: dateOnly(loan.startDate),
      notes: text(loan.notes),
      status: ['al_dia', 'proximo', 'moroso', 'completado', 'archivado'].includes(loan.status) ? loan.status : 'al_dia',
      archived: Boolean(loan.archived),
      archived_at: loan.archivedAt || null,
      archive_reason: text(loan.archiveReason),
      final_status: text(loan.finalStatus),
    });
    (loan.installments || []).forEach((inst, index) => {
      const number = num(inst.number, index + 1);
      installmentRows.push({
        id: toUuid(`installment:${loanId}:${number}`),
        user_id: owner,
        loan_id: loanId,
        installment_number: number,
        due_date: dateOnly(inst.dueDate),
        amount: num(inst.amount),
        paid: Boolean(inst.paid),
        paid_date: inst.paidDate ? dateOnly(inst.paidDate) : null,
        receipt_ref: text(inst.receiptRef),
      });
    });
  }
  await upsertChunks('loans', loanRows);
  await upsertChunks('loan_installments', installmentRows);

  // --- Pagos ---
  const payments = Array.isArray(data.payments) ? data.payments : [];
  await upsertChunks('payments', payments.map((p) => ({
    id: toUuid(p.id),
    user_id: ownerOf(p),
    loan_id: p.loanId ? toUuid(p.loanId) : null,
    installment_number: p.installmentNumber == null ? null : num(p.installmentNumber),
    amount: Math.max(0.01, num(p.amount)),
    payment_date: dateOnly(p.date),
    method: text(p.method),
    reference: text(p.reference),
    notes: text(p.notes),
    metadata: { clientName: p.clientName || '' },
  })));

  // --- E-commerce ---
  const ecommerce = Array.isArray(data.ecommerce) ? data.ecommerce : [];
  await upsertChunks('ecommerce_transactions', ecommerce.map((e) => ({
    id: toUuid(e.id),
    user_id: ownerOf(e),
    type: e.type === 'compra' ? 'compra' : 'venta',
    title: text(e.title),
    amount_bs: num(e.amountBs ?? e.amount),
    amount_usd: num(e.amountUSD),
    bcv_rate: num(e.bcvRate),
    bank_origin: text(e.bankOrigin || e.bank),
    bank_destination: text(e.bankDestination),
    reference: text(e.reference),
    transaction_date: dateOnly(e.date),
    receipt_url: text(e.receiptUrl),
    ocr_provider: text(e.ocrProvider),
    raw_ocr: e.rawOcr || null,
  })));

  // --- Lista negra ---
  const blacklist = Array.isArray(data.blacklist) ? data.blacklist : [];
  await upsertChunks('blacklist_entries', blacklist.map((b) => ({
    id: toUuid(b.id),
    user_id: ownerOf(b),
    name: String(b.name || '').trim(),
    dni: String(b.dni || '').trim(),
    phone: text(b.phone),
    address: text(b.address),
    reason: text(b.reason || b.notes),
    notes: text(b.notes),
  })));

  // --- Patrones de comprobantes ---
  const patterns = Array.isArray(data.receiptPatterns) ? data.receiptPatterns : [];
  await upsertChunks('receipt_patterns', patterns.map((p) => ({
    id: toUuid(p.id),
    user_id: ownerOf(p),
    bank_name: String(p.bankName || p.bank || 'Desconocido'),
    keywords: p.keywords || [],
    reference_format: text(p.referenceFormat),
    reference_regex: text(p.referenceRegex),
    notes: text(p.notes),
    image_key: text(p.imageKey),
    image_url: text(p.imageUrl),
    image_mime: text(p.imageMime),
    is_active: p.isActive !== false,
    version: Math.max(1, num(p.version, 1)),
    created_by: ownerOf(p),
    extra: p.extra || {},
  })));

  console.log('\nMigración completada:');
  console.log(`  Usuarios: ${legacyUsers.length}`);
  console.log(`  Clientes: ${clients.length}`);
  console.log(`  Productos: ${products.length}`);
  console.log(`  Préstamos: ${loans.length} (${installmentRows.length} cuotas)`);
  console.log(`  Pagos: ${payments.length}`);
  console.log(`  E-commerce: ${ecommerce.length}`);
  console.log(`  Lista negra: ${blacklist.length}`);
  console.log('\nCredenciales de acceso (CÁMBIALAS tras el primer login):');
  for (const c of credentials) {
    console.log(`  ${c.role === 'admin' ? '[ADMIN]' : '[USER] '} ${c.username}  ->  ${c.password}`);
  }
}

main().catch((error) => {
  console.error('Migración fallida:', error);
  process.exit(1);
});
