#!/usr/bin/env node
/**
 * Seeding de estrés CONTROLADO sobre el almacén local (data/crediflux-store.json).
 *
 * Reglas de seguridad (no negociables):
 *  - Único destino de escritura: data/crediflux-store.json. Nunca Supabase, nunca Vercel.
 *  - Modo por defecto: --dry-run. Se requiere --run para escribir.
 *  - Todo registro sintético lleva prefijo stress_<runId>_ y se elimina con --cleanup.
 *  - Backup automático del store antes de --run / --cleanup.
 *  - Techo de cuota: el volumen TOTAL (store + uploads) no supera el 70% de --max-mb.
 *  - El reporte no incluye secretos ni contenido de settings (solo conteos y métricas).
 *
 * Uso:
 *   node scripts/seed-stress-controlled.mjs --dry-run --target-records 12000
 *   node scripts/seed-stress-controlled.mjs --run --target-records 12000
 *   node scripts/seed-stress-controlled.mjs --cleanup --run-id <id>
 *   node scripts/seed-stress-controlled.mjs --repair        # corrige referencias huérfanas (E-1)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE_PATH = path.join(ROOT, 'data', 'crediflux-store.json');
const UPLOADS_DIR = path.join(ROOT, 'public', 'uploads');
const REPORTS_DIR = path.join(ROOT, 'reports');
const BACKUPS_DIR = path.join(REPORTS_DIR, 'backups');

const PREFIX_ROOT = 'stress_';
const MODULES = [
  'users', 'clients', 'products', 'loans', 'payments', 'ecommerce',
  'receiptPatterns', 'blacklist', 'capitalMovements', 'exchangeRates', 'p2pTransactions',
];
// Distribución proporcional de registros. Suma 100.
const MIX = {
  users: 2, clients: 18, products: 8, loans: 12, payments: 16,
  ecommerce: 14, receiptPatterns: 4, blacklist: 3, capitalMovements: 8,
  exchangeRates: 7, p2pTransactions: 8,
};
const DEFAULT_BATCH = 500;
const DEFAULT_MAX_MB = 16;
const DEFAULT_IMAGE_QUOTA_MB = 1000;
const QUOTA_RATIO = 0.70;
const SLOW_WRITE_MS = 2000;

// ---------------------------------------------------------------- utilidades

function parseArgs(argv) {
  const args = { mode: 'dry-run', runId: null, targetRecords: null, batchSize: DEFAULT_BATCH, maxMb: DEFAULT_MAX_MB, imageQuotaMb: DEFAULT_IMAGE_QUOTA_MB };
  const modes = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '--run' || a === '--cleanup' || a === '--repair') {
      modes.push(a === '--run' ? 'run' : a === '--cleanup' ? 'cleanup' : a === '--repair' ? 'repair' : 'dry-run');
      continue;
    }
    const eq = a.indexOf('=');
    const keyRaw = eq >= 0 ? a.slice(0, eq) : a;
    const val = eq >= 0 ? a.slice(eq + 1) : argv[++i];
    const key = keyRaw.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in args)) throw new Error(`Argumento desconocido: ${keyRaw}`);
    if (val == null || String(val).startsWith('--')) throw new Error(`Falta valor para ${keyRaw}`);
    args[key] = val;
  }
  if (modes.length > 1) throw new Error('Modos mutuamente excluyentes: usa solo uno de --dry-run, --run, --cleanup, --repair');
  if (modes.length === 1) args.mode = modes[0];
  args.batchSize = Math.max(1, Math.min(10000, Number(args.batchSize) || DEFAULT_BATCH));
  args.maxMb = Math.max(0.1, Number(args.maxMb) || DEFAULT_MAX_MB);
  args.imageQuotaMb = Math.max(1, Number(args.imageQuotaMb) || DEFAULT_IMAGE_QUOTA_MB);
  if (args.targetRecords != null) {
    args.targetRecords = Math.max(1, Math.min(500000, Number(args.targetRecords) || 1));
  }
  args.runId = String(args.runId || `r${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'run';
  return args;
}

function assertSafeTarget() {
  const resolved = path.resolve(STORE_PATH);
  if (path.basename(resolved) !== 'crediflux-store.json' || !resolved.split(path.sep).includes('data')) {
    throw new Error(`Destino de escritura inseguro: ${resolved}`);
  }
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT || process.env.K_SERVICE) {
    throw new Error('Entorno serverless detectado: el seeding local está prohibido aquí');
  }
  // Señal explícita de que no se usará la instancia remota de Supabase.
  if (String(process.env.STRESS_TARGET || '').toLowerCase() === 'supabase') {
    throw new Error('STRESS_TARGET=supabase está bloqueado; este script solo escribe el store local');
  }
  return resolved;
}

function nowIso(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString();
}
function isoDate(offsetDays = 0) { return nowIso(offsetDays).slice(0, 10); }
function round2(n) { return Number((Math.round(n * 100) / 100).toFixed(2)); }

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x5EED1234);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (min, max, decimals = 0) => {
  const v = min + rnd() * (max - min);
  return decimals ? Number(v.toFixed(decimals)) : Math.round(v);
};

function dirStats(dir) {
  let count = 0; let bytes = 0; const sizes = [];
  if (!fs.existsSync(dir)) return { count, bytes, sizes };
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const s = fs.statSync(full).size;
        count++; bytes += s; sizes.push(s);
      }
    }
  };
  walk(dir);
  sizes.sort((a, b) => a - b);
  return { count, bytes, sizes };
}
function byteLengthPretty(value) { return Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8'); }

function fsCapacity() {
  try {
    const s = fs.statfsSync(ROOT);
    return {
      totalBytes: s.blocks * s.bsize,
      freeBytes: s.bavail * s.bsize,
      usedBytes: (s.blocks - s.bfree) * s.bsize,
      blockSize: s.bsize,
      source: 'statfs',
    };
  } catch (e) {
    return { totalBytes: null, freeBytes: null, usedBytes: null, blockSize: null, source: `unavailable: ${e?.message || e}` };
  }
}

function timed(label, fn) {
  const t0 = performance.now();
  try { return { value: fn(), ms: performance.now() - t0, label }; }
  catch (e) { return { error: e, ms: performance.now() - t0, label }; }
}

function atomicWrite(target, content, attempts = 3) {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.writeFileSync(tmp, content, 'utf8');
      try { fs.renameSync(tmp, target); }
      catch (renameErr) {
        if (renameErr.code !== 'EPERM' && renameErr.code !== 'EACCES') throw renameErr;
        fs.unlinkSync(target);
        fs.renameSync(tmp, target);
      }
      return { ok: true, attempts: i + 1 };
    } catch (e) {
      last = e;
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    }
  }
  return { ok: false, error: last };
}

// ---------------------------------------------------------------- generadores

const FIRST_NAMES = ['Ana', 'Carlos', 'María', 'Luis', 'Paula', 'Jorge', 'Sofía', 'Andrés', 'Valeria', 'Rafael', 'Camila', 'Diego', 'Gabriela', 'Oscar', 'Daniela', 'Iván', 'Mariana', 'Héctor', 'Lucía', 'Fernando'];
const LAST_NAMES = ['García', 'Martínez', 'López', 'Hernández', 'Pérez', 'Rodríguez', 'Torres', 'Ramírez', 'Flores', 'Acosta', 'Vargas', 'Rojas', 'Medina', 'Castro', 'Ortiz', 'Palacios'];
const BANKS = ['Mercantil', 'Banesco', 'Banco de Venezuela', 'BBVA Provincial', 'BOD', 'Banorte', 'Banca Nacional', 'FONDO COMÚN'];
const CATEGORIES = ['Electrónica', 'Vestuario', 'Alimentos', 'Hogar', 'Ferretería', 'Deportes', 'Libros', 'Sin categoría'];

function syntheticPasswordHash() {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync('StressTest123!', salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}
const STRESS_HASH = syntheticPasswordHash();

function monthlyCapitals() {
  const out = {};
  const year = new Date().getFullYear();
  const names = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  for (let i = 1; i <= 12; i++) {
    out[`${year}-${String(i).padStart(2, '0')}`] = { monthIndex: i, monthName: names[i - 1], year, capital: between(2000, 8000) };
  }
  return out;
}

function id(runId, mod, i) { return `${PREFIX_ROOT}${runId}_${mod}_${i}`; }

function buildSynthetic(args, counts) {
  const { runId } = args;
  const out = Object.fromEntries(MODULES.map((m) => [m, []]));

  // 1) Usuarios
  for (let i = 1; i <= counts.users; i++) {
    out.users.push({
      id: id(runId, 'usr', i),
      username: `stress_user_${runId}_${i}`,
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      companyName: '', email: `stress${runId}${i}@example.test`, address: '', phone: '',
      role: 'user', isActive: true,
      permissions: ['manage_loans', 'manage_payments', 'manage_ecommerce'],
      passwordHash: STRESS_HASH, passwordLegacy: null,
      licenseKey: `STRESS-LIC-${runId}-${i}`, licenseDurationMonths: 12,
      licenseAssignedAt: nowIso(-30), licenseExpiresAt: nowIso(335),
      monthlyCapitals: monthlyCapitals(),
      createdAt: nowIso(-45), updatedAt: nowIso(-1),
    });
  }
  const owners = out.users.map((u) => u.id);
  if (!owners.length) owners.push('usr_admin');

  // 2) Clientes
  const dniBase = 20000000 + (parseInt(crypto.createHash('md5').update(runId).digest('hex').slice(0, 6), 16) % 15000000);
  for (let i = 1; i <= counts.clients; i++) {
    out.clients.push({
      id: id(runId, 'cli', i),
      userId: owners[i % owners.length],
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      dni: String(dniBase + i),
      phone: `041${pick(['2', '4', '6'])}${String(1000000 + i).slice(-7)}`,
      address: `Sector ${pick(['Centro', 'Norte', 'Sur', 'Este'])}`,
      trustLevel: pick(['Alto', 'Medio', 'Medio', 'Bajo']),
      creditLimit: between(300, 5000),
      notes: `Cliente sintético ${runId}`,
      createdAt: nowIso(-between(1, 400)),
    });
  }

  // 3) Productos
  for (let i = 1; i <= counts.products; i++) {
    const cost = between(50, 3000, 2);
    const margin = between(10, 60);
    out.products.push({
      id: id(runId, 'prod', i), userId: owners[i % owners.length],
      name: `Producto sintético ${pick(CATEGORIES)} ${i}`,
      category: pick(CATEGORIES), costPrice: cost, salePrice: round2(cost * (1 + margin / 100)),
      profitMarginPercent: margin, manualSalePrice: false, stock: between(0, 40),
      createdAt: nowIso(-between(1, 300)),
    });
  }

  // 4) Financiamientos con cuotas
  const frequencies = ['mensual', 'semanal', 'quincenal'];
  for (let i = 1; i <= counts.loans; i++) {
    const client = out.clients.length ? out.clients[i % out.clients.length] : null;
    const product = out.products.length && rnd() < 0.45 ? out.products[i % out.products.length] : null;
    const type = product ? 'producto' : 'efectivo';
    const basePrice = product ? product.costPrice : between(200, 6000, 2);
    const rate = between(5, 35);
    const down = round2(basePrice * between(0, 25, 2) / 100);
    const totalAmount = round2(Math.max(0, basePrice + basePrice * rate / 100 - down));
    const n = between(3, 12);
    const installmentAmount = round2(totalAmount / n);
    const freq = pick(frequencies);
    const startOffset = -between(1, 200);
    const installments = [];
    for (let k = 1; k <= n; k++) {
      const due = new Date(Date.now() + startOffset * 86400000);
      if (freq === 'semanal') due.setDate(due.getDate() + k * 7);
      else if (freq === 'quincenal') due.setDate(due.getDate() + k * 14);
      else due.setMonth(due.getMonth() + k);
      installments.push({ number: k, dueDate: due.toISOString().slice(0, 10), amount: installmentAmount, paid: false, paidDate: null, receiptRef: null });
    }
    out.loans.push({
      id: id(runId, 'ln', i), userId: client ? client.userId : owners[i % owners.length],
      clientId: client ? client.id : null, clientName: client ? client.name : 'Cliente sintético',
      type, productId: product ? product.id : null, productName: product ? product.name : 'Préstamo en Efectivo',
      principal: round2(basePrice), downPayment: down, financedAmount: round2(basePrice - down),
      interestRate: rate, totalAmount, installmentCount: n, installmentAmount, frequency: freq,
      startDate: isoDate(startOffset), notes: `Financiamiento sintético ${runId}`,
      status: 'al_dia', installments, createdAt: nowIso(startOffset),
    });
  }

  // 5) Pagos: se derivan de cuotas reales para garantizar integridad
  const candidates = [];
  for (const loan of out.loans) for (const inst of loan.installments) candidates.push({ loan, inst });
  for (let i = 0; i < Math.min(counts.payments, candidates.length); i++) {
    const { loan, inst } = candidates[i];
    inst.paid = true;
    inst.paidDate = isoDate(-between(0, 30));
    inst.receiptRef = `SPAY-${runId}-${i}`;
    out.payments.push({
      id: id(runId, 'pay', i + 1), userId: loan.userId, loanId: loan.id, clientId: loan.clientId,
      clientName: loan.clientName, installmentNumber: inst.number, installmentNumbers: [inst.number],
      amount: inst.amount, amountBs: null, bcvRate: null, date: inst.paidDate,
      method: pick(['Pago Móvil', 'Transferencia', 'Efectivo']), reference: inst.receiptRef,
      notes: `Pago sintético de cuota #${inst.number}`, createdAt: nowIso(-between(0, 25)),
    });
  }
  for (const loan of out.loans) {
    if (loan.installments.every((x) => x.paid)) {
      loan.status = 'completado';
      loan.completedAt = nowIso(-1);
      loan.finalStatus = 'completado';
    }
  }

  // 6) E-commerce
  for (let i = 1; i <= counts.ecommerce; i++) {
    const bcvRate = between(35, 95, 2);
    const amountBs = between(50, 4000, 2);
    out.ecommerce.push({
      id: id(runId, 'ecom', i), userId: owners[i % owners.length],
      type: pick(['venta', 'venta', 'compra']), date: isoDate(-between(0, 200)),
      bankOrigin: pick(BANKS), bankDestination: pick(BANKS),
      reference: `SECOM-${runId}-${i}`, amountBs, amountUSD: round2(amountBs / bcvRate), bcvRate,
      receiptUrl: null, manual: true, rawOcr: null, ocrProvider: 'Manual', createdAt: nowIso(-between(0, 200)),
    });
  }

  // 7) Patrones de comprobante
  for (let i = 1; i <= counts.receiptPatterns; i++) {
    const bank = `${pick(BANKS)} ${i}`;
    const regex = '^(?:referencia|operaci[oó]n)?\\s*[:=]?\\s*(\\d{6,12})$';
    out.receiptPatterns.push({
      id: id(runId, 'pat', i), bankName: bank, keywords: [bank.toLowerCase()],
      imageUrl: null, imageKey: null, imageMime: null,
      referenceFormat: '6 a 12 dígitos', notes: `Patrón sintético ${runId}`,
      createdAt: nowIso(-between(1, 120)), referenceRegex: regex,
      visualSignatures: { headerColors: ['#004481', '#FFFFFF'], logoMarkers: [bank.toLowerCase()], layoutType: 'mobile_app_screenshot', aspectRatio: '9:16' },
      analysisRules: { amountLocation: 'center', amountKeywords: ['monto', 'total'], dateKeywords: ['fecha'], dateFormat: 'DD/MM/YYYY', referenceKeywords: ['referencia'], customRegex: regex },
      customAdjustments: { stripFeeWords: ['comision', 'igtf'], minConfidence: 0.8, requireCleanMonto: true },
      isActive: true, version: 1, updatedAt: nowIso(-1),
    });
  }

  // 8) Lista negra (referencias reales a clientes + loans sintéticos)
  const withLoans = new Map();
  for (const l of out.loans) if (l.clientId) {
    if (!withLoans.has(l.clientId)) withLoans.set(l.clientId, []);
    withLoans.get(l.clientId).push(l.id);
  }
  let bl = 0;
  for (const [clientId, loanIds] of withLoans) {
    if (bl >= counts.blacklist) break;
    const client = out.clients.find((c) => c.id === clientId);
    out.blacklist.push({
      id: id(runId, 'bl', ++bl), clientId, name: client.name, dni: client.dni, phone: client.phone,
      address: client.address, notes: '', status: 'Eliminado', reason: 'Incumplimiento sintético',
      archivedAt: nowIso(-between(1, 30)), loanIds, userId: client.userId,
    });
  }

  // 9) Movimientos de capital (neto nunca negativo por usuario)
  const balance = Object.fromEntries(owners.map((u) => [u, 0]));
  for (let i = 1; i <= counts.capitalMovements; i++) {
    const userId = owners[i % owners.length];
    let type = i % 3 === 0 ? 'RETIRO_CAPITAL' : 'APORTE_CAPITAL';
    let amount = between(200, 2500, 2);
    if (type === 'RETIRO_CAPITAL') {
      if (balance[userId] < 100) { type = 'APORTE_CAPITAL'; amount = between(500, 2500, 2); }
      else amount = round2(Math.min(amount, balance[userId] * 0.6));
    }
    balance[userId] = round2(balance[userId] + (type === 'APORTE_CAPITAL' ? amount : -amount));
    const rate = between(35, 95, 2);
    out.capitalMovements.push({
      id: id(runId, 'cap', i), userId, type, amountUsd: amount,
      currencyOrigin: type === 'APORTE_CAPITAL' ? pick(['USD', 'VES']) : 'USD',
      exchangeRate: rate, notes: `Movimiento sintético ${runId}`, createdAt: nowIso(-between(1, 180)),
      metadata: { amountOriginal: type === 'APORTE_CAPITAL' && amount > 5000 ? round2(amount * rate) : amount },
    });
  }

  // 10) Tasas de cambio (shape snake_case, espejo de la tabla exchange_rates)
  for (let i = 1; i <= counts.exchangeRates; i++) {
    const rate = between(35, 95, 4);
    out.exchangeRates.push({
      id: id(runId, 'rate', i), user_id: owners[i % owners.length],
      source: pick(['bcv', 'manual', 'binance_p2p']), base_currency: 'VES', quote_currency: 'USD',
      rate, buy_rate: round2(rate * 0.99), sell_rate: round2(rate * 1.01),
      is_manual: rnd() < 0.2, fetched_at: nowIso(-between(0, 90)), raw: { stress: true },
    });
  }

  // 11) Transacciones P2P (shape snake_case, espejo de p2p_transactions)
  for (let i = 1; i <= counts.p2pTransactions; i++) {
    const rate = between(35, 95, 4);
    const usdt = between(20, 1500, 2);
    out.p2pTransactions.push({
      id: id(runId, 'p2p', i), user_id: owners[i % owners.length], side: pick(['buy', 'sell']),
      amount_usdt: usdt, amount_ves: round2(usdt * rate), rate,
      counterparty: `StressCounterparty${i}`, bank: pick(BANKS), reference: `SP2P-${runId}-${i}`,
      status: 'completed', occurred_at: nowIso(-between(0, 120)), notes: `Operación sintética ${runId}`,
    });
  }
  return out;
}

function allocateCounts(total) {
  const raw = {};
  const out = {};
  for (const m of MODULES) raw[m] = Math.max(1, Math.round(total * MIX[m] / 100));
  // Normalizar para que la suma sea exactamente total
  let diff = total - Object.values(raw).reduce((a, b) => a + b, 0);
  const order = MODULES.slice().sort((a, b) => MIX[b] - MIX[a]);
  for (let i = 0; diff !== 0 && i < order.length * 1000; i++) {
    const m = order[i % order.length];
    if (diff > 0) { raw[m]++; diff--; }
    else if (raw[m] > 1) { raw[m]--; diff++; }
  }
  for (const m of MODULES) out[m] = raw[m];
  return out;
}

// ---------------------------------------------------------------- integridad

function validateIntegrity(db, { onlyPrefix = null } = {}) {
  const issues = [];
  const isSynthetic = (v) => typeof v === 'string' && (!onlyPrefix || v.startsWith(onlyPrefix));
  const relevant = (v) => !onlyPrefix || isSynthetic(v);
  const get = (m) => (Array.isArray(db[m]) ? db[m] : []);
  const idx = (m) => new Set(get(m).map((x) => x && x.id));
  const dupCheck = (m) => {
    const seen = new Set();
    for (const rec of get(m)) {
      if (!rec || !rec.id) { issues.push({ module: m, code: 'MISSING_ID' }); continue; }
      if (seen.has(rec.id)) issues.push({ module: m, code: 'DUPLICATE_ID', id: rec.id });
      seen.add(rec.id);
    }
  };
  MODULES.forEach(dupCheck);

  const users = idx('users'), clients = idx('clients'), products = idx('products'), loans = idx('loans');
  for (const c of get('clients')) if (relevant(c.id) && !users.has(c.userId)) issues.push({ module: 'clients', code: 'ORPHAN_USER', id: c.id, ref: c.userId });
  for (const p of get('products')) {
    if (!relevant(p.id)) continue;
    if (!users.has(p.userId)) issues.push({ module: 'products', code: 'ORPHAN_USER', id: p.id, ref: p.userId });
    if (!(Number(p.costPrice) > 0) || !(Number(p.salePrice) > 0)) issues.push({ module: 'products', code: 'INVALID_AMOUNT', id: p.id });
  }
  for (const l of get('loans')) {
    if (!relevant(l.id)) continue;
    if (l.clientId && !clients.has(l.clientId)) issues.push({ module: 'loans', code: 'ORPHAN_CLIENT', id: l.id, ref: l.clientId });
    if (l.productId && !products.has(l.productId)) issues.push({ module: 'loans', code: 'ORPHAN_PRODUCT', id: l.id, ref: l.productId });
    if (!users.has(l.userId)) issues.push({ module: 'loans', code: 'ORPHAN_USER', id: l.id, ref: l.userId });
    if (!(Number(l.totalAmount) > 0)) issues.push({ module: 'loans', code: 'INVALID_AMOUNT', id: l.id });
    const insts = Array.isArray(l.installments) ? l.installments : [];
    if (insts.length !== Number(l.installmentCount)) issues.push({ module: 'loans', code: 'INSTALLMENT_COUNT_MISMATCH', id: l.id });
    const sum = insts.reduce((a, x) => a + Number(x.amount || 0), 0);
    if (Math.abs(sum - Number(l.totalAmount)) > Math.max(1, insts.length * 0.02)) issues.push({ module: 'loans', code: 'INSTALLMENT_SUM_MISMATCH', id: l.id, sum: round2(sum), total: l.totalAmount });
    for (const x of insts) if (!(Number(x.amount) > 0)) issues.push({ module: 'loans', code: 'INVALID_INSTALLMENT', id: l.id, number: x.number });
  }
  for (const p of get('payments')) {
    if (!relevant(p.id)) continue;
    if (!loans.has(p.loanId)) issues.push({ module: 'payments', code: 'ORPHAN_LOAN', id: p.id, ref: p.loanId });
    if (!(Number(p.amount) > 0)) issues.push({ module: 'payments', code: 'INVALID_AMOUNT', id: p.id });
  }
  for (const t of get('ecommerce')) {
    if (!relevant(t.id)) continue;
    if (!(Number(t.amountBs) > 0) || !(Number(t.bcvRate) > 0) || !(Number(t.amountUSD) > 0)) issues.push({ module: 'ecommerce', code: 'INVALID_AMOUNT', id: t.id });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.date || ''))) issues.push({ module: 'ecommerce', code: 'INVALID_DATE', id: t.id });
  }
  for (const b of get('blacklist')) {
    if (!relevant(b.id)) continue;
    if (b.clientId && !clients.has(b.clientId)) issues.push({ module: 'blacklist', code: 'ORPHAN_CLIENT', id: b.id, ref: b.clientId });
    for (const lid of Array.isArray(b.loanIds) ? b.loanIds : []) if (!loans.has(lid)) issues.push({ module: 'blacklist', code: 'ORPHAN_LOAN', id: b.id, ref: lid });
  }
  for (const m of ['capitalMovements', 'exchangeRates', 'p2pTransactions']) {
    for (const r of get(m)) {
      if (!relevant(r.id)) continue;
      const uid = r.userId || r.user_id;
      if (!users.has(uid)) issues.push({ module: m, code: 'ORPHAN_USER', id: r.id, ref: uid });
      const amount = r.amountUsd ?? r.amount_usdt ?? r.rate;
      if (!(Number(amount) > 0)) issues.push({ module: m, code: 'INVALID_AMOUNT', id: r.id });
    }
  }
  return issues;
}

/**
 * Corrección E-1: elimina referencias huérfanas de la lista negra conservando
 * la entrada como registro histórico. Nunca borra registros reales.
 */
function repairOrphans(db) {
  const changes = [];
  const clients = new Set((Array.isArray(db.clients) ? db.clients : []).map((c) => c && c.id));
  const loans = new Set((Array.isArray(db.loans) ? db.loans : []).map((l) => l && l.id));
  for (const entry of Array.isArray(db.blacklist) ? db.blacklist : []) {
    if (!entry || typeof entry !== 'object') continue;
    let touched = false;
    if (Array.isArray(entry.loanIds)) {
      const kept = [];
      for (const lid of entry.loanIds) {
        if (loans.has(lid)) kept.push(lid);
        else { changes.push({ id: entry.id, field: 'loanIds', ref: lid, action: 'removed_missing_reference' }); touched = true; }
      }
      if (touched) entry.loanIds = kept;
    }
    if (entry.clientId && !clients.has(entry.clientId)) {
      changes.push({ id: entry.id, field: 'clientId', ref: entry.clientId, action: 'cleared_missing_reference' });
      entry.clientId = null;
      touched = true;
    }
    if (touched) {
      entry.repair = { at: new Date().toISOString(), reason: 'Referencias inexistentes eliminadas; entrada conservada como registro histórico' };
    }
  }
  return { changes, count: changes.length };
}

// ---------------------------------------------------------------- imágenes

function imageAnalysis(imageQuotaMb) {
  const s = dirStats(UPLOADS_DIR);
  const quotaBytes = Math.round(imageQuotaMb * 1024 * 1024);
  const avg = s.count ? s.bytes / s.count : 0;
  const median = s.sizes.length ? s.sizes[Math.floor(s.sizes.length / 2)] : 0;
  const remaining = Math.max(0, quotaBytes - s.bytes);
  const scenarios = [1, 5, 10, 25, 50, 100, 250].map((perDay) => {
    const days = perDay > 0 && avg > 0 ? Math.floor(remaining / avg / perDay) : 0;
    return {
      imagesPerDay: perDay,
      imagesPerMonth: perDay * 30,
      daysRemaining: days,
      monthsRemaining: round2(days / 30),
    };
  });
  return {
    files: s.count, totalBytes: s.bytes, totalMiB: round2(s.bytes / 1048576),
    avgBytes: Math.round(avg), avgKiB: round2(avg / 1024),
    medianBytes: median, minBytes: s.sizes[0] || 0, maxBytes: s.sizes[s.sizes.length - 1] || 0,
    quotaBytes, quotaMiB: imageQuotaMb, remainingBytes: remaining, remainingMiB: round2(remaining / 1048576),
    usedPercent: round2(s.bytes / quotaBytes * 100),
    capacityImagesAtAvg: avg > 0 ? Math.floor(remaining / avg) : 0,
    scenarios,
  };
}

// ---------------------------------------------------------------- flujo

function main() {
  const args = parseArgs(process.argv.slice(2));
  const storePath = assertSafeTarget();
  const report = {
    meta: { runId: args.runId, mode: args.mode, startedAt: new Date().toISOString(), node: process.version, storePath, target: 'local-json-only', secretsRead: false },
    errors: [], warnings: [], quota: {}, counts: {}, performance: {}, integrity: {}, images: {},
  };
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  const readT = timed('store.read', () => JSON.parse(fs.readFileSync(storePath, 'utf8')));
  if (readT.error) throw readT.error;
  const db = readT.value;
  const before = Object.fromEntries(MODULES.map((m) => [m, (Array.isArray(db[m]) ? db[m] : []).length]));
  report.counts.before = before;
  report.integrity.pre = validateIntegrity(db);
  report.performance.readMs = round2(readT.ms);

  const fsInfo = fsCapacity();
  const uploads = dirStats(UPLOADS_DIR);
  const storeBytes = fs.existsSync(storePath) ? fs.statSync(storePath).size : 0;
  const usedBytes = storeBytes + uploads.bytes;
  const capBytes = Math.round(args.maxMb * 1024 * 1024);
  const targetBytes = Math.floor(capBytes * QUOTA_RATIO);
  let budget = Math.max(0, targetBytes - usedBytes);
  report.quota = {
    ...fsInfo, capBytes, capMiB: args.maxMb, ratio: QUOTA_RATIO, targetBytes,
    storeBytes, uploadsBytes: uploads.bytes, usedBytes, budgetBytes: budget,
    filesystemHeadroomBytes: fsInfo.freeBytes,
  };
  report.images = imageAnalysis(args.imageQuotaMb);

  const syntheticPrefix = `${PREFIX_ROOT}${args.runId}_`;
  const already = MODULES.reduce((n, m) => n + (Array.isArray(db[m]) ? db[m].filter((x) => x && typeof x.id === 'string' && x.id.startsWith(syntheticPrefix)).length : 0), 0);

  if (args.mode === 'repair') {
    const repair = repairOrphans(db);
    report.repair = repair;
    if (repair.count > 0) {
      const backup = path.join(BACKUPS_DIR, `before-repair-${args.runId}-${Date.now()}.json`);
      fs.copyFileSync(storePath, backup);
      report.backup = path.relative(ROOT, backup);
      const content = JSON.stringify(db, null, 2);
      const w = timed('store.repair-write', () => atomicWrite(storePath, content));
      if (w.value?.error) report.errors.push({ code: 'WRITE_FAILED', message: w.value.error.message });
      report.performance.repairWriteMs = round2(w.ms);
    }
    report.counts.after = Object.fromEntries(MODULES.map((m) => [m, (Array.isArray(db[m]) ? db[m] : []).length]));
    report.integrity.post = validateIntegrity(db);
    report.integrity.postSynthetic = validateIntegrity(db, { onlyPrefix: syntheticPrefix });
    finalize(report, args);
    return;
  }

  if (args.mode === 'cleanup') {
    let removed = 0;
    const removedByModule = {};
    for (const m of MODULES) {
      const arr = Array.isArray(db[m]) ? db[m] : [];
      const keep = arr.filter((x) => !(x && typeof x.id === 'string' && x.id.startsWith(syntheticPrefix)));
      removedByModule[m] = arr.length - keep.length;
      removed += arr.length - keep.length;
      db[m] = keep;
    }
    report.counts.removedByModule = removedByModule;
    report.counts.removed = removed;
    if (removed && (args.mode === 'cleanup' || args.mode === 'run')) {
      const backup = path.join(BACKUPS_DIR, `before-cleanup-${args.runId}-${Date.now()}.json`);
      fs.copyFileSync(storePath, backup);
      report.backup = path.relative(ROOT, backup);
      const content = JSON.stringify(db, null, 2);
      const w = timed('store.cleanup-write', () => atomicWrite(storePath, content));
      if (w.value?.error) report.errors.push({ code: 'WRITE_FAILED', message: w.value.error.message });
      report.performance.cleanupWriteMs = round2(w.ms);
    }
    report.integrity.post = validateIntegrity(db);
    report.integrity.postSynthetic = validateIntegrity(db, { onlyPrefix: syntheticPrefix });
    finalize(report, args);
    return;
  }

  if (already > 0) {
    report.errors.push({ code: 'RUN_ID_ALREADY_PRESENT', message: `Ya existen ${already} registros con prefijo ${syntheticPrefix}. Usa otro --run-id o ejecuta --cleanup.` });
    finalize(report, args, 2);
    return;
  }

  const requested = args.targetRecords || Math.max(1000, Math.floor(budget / 700));
  let counts = allocateCounts(requested);
  let synthetic = buildSynthetic(args, counts);
  const sampleBytes = Math.max(1, Math.round(Object.values(synthetic).flat().reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r, null, 2), 'utf8'), 0) / Math.max(1, Object.values(synthetic).flat().length)));
  let projected = byteLengthPretty({ ...db, ...synthetic });
  let projectedDelta = Math.max(0, projected - storeBytes);
  let stopReason = requested > 0 ? 'target_reached' : 'budget_zero';
  let scaleTries = 0;

  // Ajuste dinámico: si el JSON resultante excede el 70% del techo, reescalamos.
  while (projectedDelta > budget && scaleTries < 5) {
    stopReason = 'quota_clamp_70pct';
    const factor = Math.max(0.01, (budget / projectedDelta) * 0.97);
    const nextTotal = Math.max(MODULES.length, Math.floor(requested * factor));
    counts = allocateCounts(nextTotal);
    synthetic = buildSynthetic(args, counts);
    projected = byteLengthPretty({ ...db, ...synthetic });
    projectedDelta = Math.max(0, projected - storeBytes);
    scaleTries++;
  }
  if (projectedDelta > budget) {
    report.errors.push({ code: 'QUOTA_UNSATISFIABLE', message: `Ni siquiera el mínimo cabe en el presupuesto de ${budget} bytes` });
    finalize(report, args, 3);
    return;
  }
  report.quota.estimatedBytesPerRecord = sampleBytes;
  report.quota.requestedRecords = requested;
  report.quota.effectiveRecords = Object.values(counts).reduce((a, b) => a + b, 0);
  report.quota.countsByModule = counts;
  report.quota.projectedStoreBytes = projected;
  report.quota.projectedDeltaBytes = projectedDelta;
  report.quota.projectedTotalBytes = usedBytes + projectedDelta;
  report.quota.projectedUsedPercent = round2((usedBytes + projectedDelta) / capBytes * 100);
  report.quota.stopReason = stopReason;
  report.quota.scaleTries = scaleTries;

  const postIssues = validateIntegrity({ ...db, ...synthetic }, { onlyPrefix: syntheticPrefix });
  report.integrity.syntheticPreflight = postIssues;
  if (postIssues.length) report.errors.push({ code: 'SYNTHETIC_INTEGRITY_FAILED', message: `${postIssues.length} problemas en datos sintéticos`, detail: postIssues.slice(0, 20) });

  report.meta.estimatedDurationMs = null;

  if (args.mode === 'dry-run') {
    report.counts.after = before;
    report.integrity.post = report.integrity.pre;
    finalize(report, args);
    return;
  }

  // Escritura por lotes: cada lote se serializa y se persiste de forma atómica.
  const backup = path.join(BACKUPS_DIR, `before-run-${args.runId}-${Date.now()}.json`);
  fs.copyFileSync(storePath, backup);
  report.backup = path.relative(ROOT, backup);
  const writes = [];
  const started = performance.now();
  const merged = { ...db };
  for (const m of MODULES) if (!Array.isArray(merged[m])) merged[m] = [];
  const flat = MODULES.flatMap((m) => synthetic[m].map((r) => ({ module: m, record: r })));
  // Corrección aplicada tras la primera corrida: el store JSON se reescribe por completo
  // en cada lote, por lo que la latencia crece con el tamaño (O(n²)). Aumentamos el
  // tamaño del lote a medida que el archivo crece para reducir el número de reescrituras.
  let i = 0;
  let batchNumber = 0;
  while (i < flat.length) {
    const currentBytes = fs.existsSync(storePath) ? fs.statSync(storePath).size : 0;
    const dynamicBatch = currentBytes > 6 * 1048576 ? Math.max(args.batchSize, 2500)
      : currentBytes > 2 * 1048576 ? Math.max(args.batchSize, 1500)
        : args.batchSize;
    const batch = flat.slice(i, i + dynamicBatch);
    batchNumber++;
    i += batch.length; // avanzar por el tamaño REAL del lote (evita saltar registros)
    for (const { module, record } of batch) merged[module].unshift(record);
    const ser = timed('serialize', () => JSON.stringify(merged, null, 2));
    if (ser.error) { report.errors.push({ code: 'SERIALIZE_FAILED', message: ser.error.message }); break; }
    const w = timed('write', () => atomicWrite(storePath, ser.value));
    const entry = { batch: batchNumber, records: batch.length, bytes: Buffer.byteLength(ser.value, 'utf8'), ms: round2(w.ms), attempts: w.value?.attempts || 0, ok: Boolean(w.value?.ok) };
    if (w.value?.error) {
      entry.error = w.value.error.message;
      report.errors.push({ code: 'WRITE_FAILED', batch: entry.batch, message: entry.error });
    }
    if (w.ms > SLOW_WRITE_MS) report.warnings.push({ code: 'SLOW_WRITE', batch: entry.batch, ms: entry.ms, thresholdMs: SLOW_WRITE_MS });
    writes.push(entry);
    process.stdout.write(`  lote ${entry.batch}: +${entry.records} registros, ${(entry.bytes / 1048576).toFixed(2)} MiB, ${entry.ms} ms\n`);
  }
  report.performance.writes = writes;
  const writtenRecords = writes.reduce((a, w) => a + w.records, 0);
  report.performance.writtenRecords = writtenRecords;
  report.performance.expectedRecords = flat.length;
  if (writtenRecords !== flat.length) {
    report.errors.push({ code: 'RECORD_COUNT_MISMATCH', message: `Escritos ${writtenRecords} de ${flat.length} registros planeados` });
  }
  report.performance.totalMs = round2(performance.now() - started);
  report.performance.avgBatchMs = writes.length ? round2(writes.reduce((a, w) => a + w.ms, 0) / writes.length) : 0;
  report.performance.maxBatchMs = writes.length ? Math.max(...writes.map((w) => w.ms)) : 0;
  report.performance.batches = writes.length;
  report.counts.after = Object.fromEntries(MODULES.map((m) => [m, (Array.isArray(merged[m]) ? merged[m] : []).length]));
  report.counts.added = Object.fromEntries(MODULES.map((m) => [m, report.counts.after[m] - before[m]]));
  const finalBytes = fs.statSync(storePath).size;
  report.quota.finalStoreBytes = finalBytes;
  report.quota.finalTotalBytes = finalBytes + uploads.bytes;
  report.quota.finalUsedPercent = round2(report.quota.finalTotalBytes / capBytes * 100);
  report.integrity.post = validateIntegrity(merged);
  report.integrity.postSynthetic = validateIntegrity(merged, { onlyPrefix: syntheticPrefix });
  finalize(report, args);
}

function finalize(report, args, exitCode = 0) {
  report.meta.finishedAt = new Date().toISOString();
  report.meta.durationMs = Date.parse(report.meta.finishedAt) - Date.parse(report.meta.startedAt);
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const file = path.join(REPORTS_DIR, `stress-seed-${args.mode}-${args.runId}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  const q = report.quota;
  console.log('\n=== RESUMEN SEEDING CONTROLADO ===');
  console.log(`modo=${args.mode} runId=${args.runId} destino=${path.relative(process.cwd(), args.mode === 'cleanup' ? STORE_PATH : STORE_PATH)}`);
  if (q.capBytes) console.log(`cuota=${(q.capBytes / 1048576).toFixed(1)} MiB | objetivo 70%=${(q.targetBytes / 1048576).toFixed(2)} MiB | usado=${(q.usedBytes / 1048576).toFixed(2)} MiB | presupuesto=${(q.budgetBytes / 1048576).toFixed(2)} MiB`);
  if (q.effectiveRecords != null) console.log(`registros: solicitados=${q.requestedRecords} efectivos=${q.effectiveRecords} (${q.stopReason}) | bytes/registro≈${q.estimatedBytesPerRecord}`);
  if (report.counts.added) console.log(`agregados: ${JSON.stringify(report.counts.added)}`);
  if (report.counts.removed != null) console.log(`eliminados: ${report.counts.removed}`);
  if (report.repair) console.log(`referencias reparadas: ${report.repair.count}`);
  console.log(`integridad pre=${report.integrity.pre?.length ?? 0} post=${report.integrity.post?.length ?? 0} sintética=${report.integrity.postSynthetic?.length ?? report.integrity.syntheticPreflight?.length ?? 0}`);
  console.log(`errores=${report.errors.length} advertencias=${report.warnings.length}`);
  if (report.images?.files != null) console.log(`imágenes: ${report.images.files} archivos, promedio ${report.images.avgKiB} KiB, capacidad restante ${report.images.capacityImagesAtAvg} imgs`);
  console.log(`reporte: ${path.relative(process.cwd(), file)}`);
  console.log('==================================\n');
  if (exitCode) process.exitCode = exitCode;
  else if (report.errors.length) process.exitCode = 1;
}

try { main(); }
catch (e) {
  console.error('[seed-stress] Fallo fatal:', e?.stack || e);
  process.exitCode = 1;
}
