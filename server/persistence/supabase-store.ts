import { createHash, randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, ProfileRow, UserSettingRow } from '@/shared/types/database';
import type { PaymentCalculation } from '@/modules/loans/abono';
import { getSupabaseAdminClientOrNull } from '@/server/supabase/admin';
import { isSupabaseConfigured } from '@/server/supabase/env';
import { profileToLegacyUser, resolveRequestAuth, type RequestAuth } from '@/server/auth/request-auth';
import { decryptStateSecretsInMemory, encryptStateSecretsAtRest } from '@/server/security/security.js';
import { normalizeTrustConfig } from '@/modules/trust/service.js';
import { readGlobalOcrConfigDto } from '@/server/ocr/global-config';
import { computeLoanStatus, getRequestUser } from '@/shared/lib/db.js';
import {
  getAppState as legacyGetAppState,
  saveAppState as legacySaveAppState,
  saveAppStateWithResult as legacySaveAppStateWithResult,
  persistenceInfo as legacyPersistenceInfo,
  checkPersistenceConnection as legacyCheckPersistenceConnection,
  hasDatabase as legacyHasDatabase,
} from '@/server/persistence/persistence.js';

type DbClient = SupabaseClient<Database>;
type AnyRecord = Record<string, any>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Estos campos pertenecen a public.admin_ocr_settings. Nunca se escriben en
// user_settings: hacerlo reintroduciría una fuente de verdad por usuario.
const GLOBAL_OCR_SETTING_KEYS = [
  'aiProvider', 'aiAutoAssignEnabled', 'aiRoutingRules', 'ocrConfidenceMin',
  'ocrEndpoints', 'ocrModels', 'ocrThresholds', 'providerConfig',
  'ocrApiKeys', 'aiApiKey', 'ocrSpaceApiKey',
] as const;

/**
 * Convierte cualquier id legado ("cli_123", "usr_admin", etc.) en un UUID v5
 * determinista. Así las claves primarias son UUID sin perder las referencias
 * históricas entre clientes, préstamos y pagos.
 */
export function toUuid(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (UUID_RE.test(raw)) return raw.toLowerCase();
  const hash = createHash('sha1').update(raw || randomUUID()).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isUuid(value: unknown): boolean {
  return UUID_RE.test(String(value ?? ''));
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function int(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out === '' ? null : out;
}

function dateOnly(value: unknown): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : new Date(value as any).toISOString().slice(0, 10);
}

function timestampOrNow(value: unknown): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value as any);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function jsonObject(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Json;
}

function jsonArray(value: unknown): Json {
  return Array.isArray(value) ? (value as Json) : [];
}

function badRequest(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

/**
 * Proyección exacta de columnas consumidas por los mappers de getScopedState.
 * Recortar el payload reduce latencia y memoria sin alterar el shape devuelto.
 * `user_settings.data`, `payments.metadata`, `exchange_rates` y
 * `receipt_patterns` se conservan completos porque el mapper los necesita.
 */
const SCOPED_COLUMNS: Partial<Record<keyof Database['public']['Tables'], string>> = {
  clients: 'id, user_id, name, dni, phone, address, trust_level, credit_limit, notes, is_active, created_at, updated_at',
  products: 'id, user_id, name, category, cost_price, sale_price, profit_margin_percent, manual_sale_price, stock, created_at, updated_at',
  loans: 'id, user_id, client_id, client_name, type, product_id, product_name, principal, down_payment, financed_amount, interest_rate, total_amount, installment_count, installment_amount, frequency, start_date, notes, status, archived, archived_at, archive_reason, final_status, metadata, created_at, updated_at',
  loan_installments: 'id, loan_id, installment_number, due_date, amount, paid, paid_date, receipt_ref',
  payments: 'id, user_id, loan_id, client_id, installment_number, amount, payment_date, metadata, method, reference, notes, created_at, updated_at',
  ecommerce_transactions: 'id, user_id, type, title, amount_bs, amount_usd, bcv_rate, bank_origin, bank_destination, reference, transaction_date, receipt_url, ocr_provider, raw_ocr, created_at, updated_at',
  blacklist_entries: 'id, user_id, client_id, name, dni, phone, address, reason, notes, created_at, updated_at',
  receipt_patterns: 'id, user_id, bank_name, keywords, reference_format, reference_regex, notes, image_key, image_url, image_mime, is_active, version, created_by, extra, created_at, updated_at',
  exchange_rates: 'id, user_id, source, base_currency, quote_currency, rate, buy_rate, sell_rate, is_manual, fetched_at, raw, created_at, updated_at',
  p2p_transactions: 'id, user_id, side, amount_usdt, amount_ves, rate, counterparty, bank, reference, status, occurred_at, notes, created_at, updated_at',
  capital_movements: 'id, user_id, type, amount_usd, currency_origin, exchange_rate, notes, created_at, updated_at',
};

async function readAll<T>(supabase: DbClient, table: keyof Database['public']['Tables'], userId: string, order?: { column: string; ascending?: boolean }) {
  let query = (supabase as any).from(table).select(SCOPED_COLUMNS[table] || '*').eq('user_id', userId);
  if (order) query = query.order(order.column, { ascending: order.ascending ?? false });
  const { data, error } = await query;
  badRequest(error, `No se pudo leer ${String(table)}`);
  return (data || []) as T[];
}

// =============================================================================
// LECTURA
// =============================================================================

function emptyState() {
  return {
    settings: {},
    users: [],
    clients: [],
    products: [],
    loans: [],
    payments: [],
    ecommerce: [],
    receiptPatterns: [],
    blacklist: [],
    exchangeRates: [],
    p2pTransactions: [],
    capitalMovements: [],
    __currentUser: null as AnyRecord | null,
  };
}

/**
 * Actualización atómica de un financiamiento en Supabase.
 *
 * La RPC bloquea la fila del préstamo, valida propiedad y montos, reescribe
 * sólo el cronograma pendiente y actualiza las condiciones de pago en una
 * sola transacción. No recibe products/stock: inventario, cliente y monto base
 * quedan congelados. La tabla `payments` nunca se toca.
 */
export async function updateLoanPlanAtomic(args: {
  request: Request;
  loan: AnyRecord;
  plan: import('@/modules/loans/plan').LoanPlanResult;
}): Promise<void> {
  const { request, loan, plan } = args;
  const auth = await resolveRequestAuth(request);
  if (!auth.userId || !auth.supabase) throw new Error('No autenticado');

  const userId = toUuid(auth.userId);
  const loanId = toUuid(loan.id);
  // Sólo se envían cuotas pendientes; la RPC deja intactas las pagadas.
  const installments = plan.installments
    .filter((inst: AnyRecord) => !inst.paid)
    .map((inst: AnyRecord) => ({
      id: isUuid(inst.id) ? inst.id : toUuid(`installment:${loanId}:${inst.number}`),
      number: inst.number,
      dueDate: dateOnly(inst.dueDate),
      amount: num(inst.amount),
    }));

  const { error } = await (auth.supabase as any).rpc('update_loan_plan', {
    p_loan_id: loanId,
    p_user_id: userId,
    p_interest_rate: plan.interestRate,
    p_interest_mode: plan.interestMode,
    p_interest_amount: plan.interestAmount,
    p_total_amount: plan.totalAmount,
    p_installment_count: plan.installmentCount,
    p_installment_amount: plan.installmentAmount,
    p_frequency: ['diario', 'semanal', 'quincenal', 'mensual'].includes(loan.frequency) ? loan.frequency : 'mensual',
    p_start_date: plan.startDate,
    p_status: computeLoanStatus({ ...loan, installments: plan.installments }),
    p_installments: installments,
  });

  if (error) {
    const message = error.message || String(error);
    if (/could not find the function|schema cache|does not exist/i.test(message)) {
      throw new Error('La función update_loan_plan no está instalada en Supabase. Ejecuta la migración 20261120000200_edit_loan_plan_rpc.sql.');
    }
    throw new Error(message);
  }
}

export interface PaymentRpcResult {
  paymentId: string;
  appliedAmount: number;
  currentBalance: number;
  newBalance: number;
  remainingInstallments: number;
  settledInstallments: number;
  partialInstallment: { number: number; remaining: number } | null;
  installmentAmount: number;
  settled: boolean;
  status: string;
  totalAmount: number;
  totalInstallments: number;
  coveredInstallments: number;
  remainingEquivalent: number;
  collectedAmount: number;
  pendingAmount: number;
  progressPercent: number;
}

/** Alias conservado para consumidores existentes. */
export type AbonoRpcResult = PaymentRpcResult;

/**
 * Registro atómico de un pago o abono en Supabase.
 *
 * La RPC bloquea la fila del financiamiento, recalcula el saldo dentro de la
 * transacción, valida el monto, marca/resta cuotas del cronograma, actualiza
 * el contador de cuotas y el progreso, y crea el movimiento en `payments` en
 * un único CALL.
 */
export async function registerLoanPaymentAtomic(args: {
  request: Request;
  loan: AnyRecord;
  calculation: PaymentCalculation;
  payment: AnyRecord;
}): Promise<PaymentRpcResult> {
  const { loan, calculation, payment } = args;
  const auth = await resolveRequestAuth(args.request);
  if (!auth.userId || !auth.supabase) throw new Error('No autenticado');

  const { data, error } = await (auth.supabase as any).rpc('register_loan_abono', {
    p_loan_id: toUuid(loan.id),
    p_user_id: toUuid(auth.userId),
    p_amount: num(calculation.appliedAmount),
    p_payment_date: dateOnly(payment.date),
    p_method: text(payment.method),
    p_reference: text(payment.reference),
    p_notes: text(payment.notes),
    p_amount_bs: payment.amountBs == null ? null : num(payment.amountBs),
    p_bcv_rate: payment.bcvRate == null ? null : num(payment.bcvRate),
    p_installments: [],
  });

  if (error) {
    const message = error.message || String(error);
    if (/could not find the function|schema cache|does not exist/i.test(message)) {
      throw new Error('La función register_loan_abono no está instalada en Supabase. Ejecuta la migración 20261120000400_loan_payment_progress_rpc.sql.');
    }
    throw new Error(message);
  }
  if (!data) throw new Error('No se pudo registrar el pago en Supabase');
  return data as PaymentRpcResult;
}

export async function getStateForRequest(request: Request): Promise<AnyRecord> {
  if (!isSupabaseConfigured()) {
    const state = await legacyGetAppState();
    // En modo legado la identidad viene del header x-user-id (sólo dev/test).
    // La capa de Supabase ya adjunta __currentUser; sin esto los builders ven
    // un invitado y ocultan la lista de usuarios de Ajustes al administrador.
    state.__currentUser = getRequestUser(request, state);
    return state;
  }

  const auth = await resolveRequestAuth(request);
  if (!auth.userId || !auth.supabase) {
    const state = emptyState();
    state.__currentUser = null;
    return state;
  }

  const state = await getScopedState(auth);
  state.__currentUser = profileToLegacyUser(auth.profile);
  return state;
}

/**
 * Estado completo de otro usuario para acciones administrativas controladas.
 * Usa service_role (OMITE RLS) y nunca el scope del usuario solicitante, de modo
 * que una limpieza por admin no lea ni escriba los datos del administrador.
 */
export async function getStateForTargetUser(targetUserId: string): Promise<AnyRecord> {
  const admin = getSupabaseAdminClientOrNull();
  if (!admin) {
    throw new Error('Supabase admin no configurado: se requiere service_role para purgar otro usuario.');
  }
  const auth: RequestAuth = {
    mode: 'supabase',
    supabase: admin,
    authUser: null,
    profile: null,
    userId: targetUserId,
  };
  const state = await getScopedState(auth);
  state.__currentUser = null;
  return state;
}

async function getScopedState(auth: RequestAuth): Promise<AnyRecord> {
  const supabase = auth.supabase!;
  const userId = auth.userId!;

  const [profileResult, settingsResult, trustResult, clients, products, loans, installments, payments, ecommerce, blacklist, patterns, rates, p2p, capital] =
    await Promise.all([
      supabase.from('profiles')
        .select('id, username, full_name, company_name, email, address, phone, role, is_active, license_key, license_status, license_assigned_at, license_expires_at, license_duration_months, monthly_capitals, created_at, updated_at')
        .order('created_at', { ascending: true }),
      supabase.from('user_settings')
        .select('data, company_name, currency, timezone, ecommerce_capital, ai_provider, ai_auto_assign_enabled, ai_routing_rules, ocr_confidence_min, ocr_api_keys, provider_config, system_license_key')
        .eq('user_id', userId).maybeSingle(),
      supabase.from('trust_level_configs')
        .select('tier, label, description, sort_order')
        .eq('user_id', userId).order('sort_order', { ascending: true }),
      readAll<any>(supabase, 'clients', userId, { column: 'created_at', ascending: false }),
      readAll<any>(supabase, 'products', userId, { column: 'created_at', ascending: false }),
      readAll<any>(supabase, 'loans', userId, { column: 'created_at', ascending: false }),
      readAll<any>(supabase, 'loan_installments', userId, { column: 'installment_number', ascending: true }),
      readAll<any>(supabase, 'payments', userId, { column: 'payment_date', ascending: false }),
      readAll<any>(supabase, 'ecommerce_transactions', userId, { column: 'transaction_date', ascending: true }),
      readAll<any>(supabase, 'blacklist_entries', userId, { column: 'created_at', ascending: false }),
      readAll<any>(supabase, 'receipt_patterns', userId, { column: 'created_at', ascending: false }),
      readAll<any>(supabase, 'exchange_rates', userId, { column: 'fetched_at', ascending: false }),
      readAll<any>(supabase, 'p2p_transactions', userId, { column: 'occurred_at', ascending: false }),
      readAll<any>(supabase, 'capital_movements', userId, { column: 'created_at', ascending: false }),
    ]);

  badRequest(profileResult.error, 'No se pudieron leer los perfiles');
  const profiles = (profileResult.data || []) as ProfileRow[];

  if (!settingsResult.data) {
    // Autocuración: el trigger debería haberlo creado.
    const admin = getSupabaseAdminClientOrNull();
    if (admin) await admin.from('user_settings').upsert({ user_id: userId }, { onConflict: 'user_id' });
  }

  const settingsRow = settingsResult.data as UserSettingRow | null;
  const settings = mapSettings(settingsRow, trustResult.data || []);
  const installmentsByLoan = new Map<string, any[]>();
  for (const row of installments) {
    const list = installmentsByLoan.get(row.loan_id) || [];
    list.push({
      id: row.id,
      number: row.installment_number,
      dueDate: row.due_date,
      amount: num(row.amount),
      paid: Boolean(row.paid),
      paidDate: row.paid_date,
      receiptRef: row.receipt_ref,
    });
    installmentsByLoan.set(row.loan_id, list);
  }

  const state: AnyRecord = {
    settings,
    users: profiles.map(profileToLegacyUser).filter(Boolean),
    clients: clients.map(mapClient),
    products: products.map(mapProduct),
    loans: loans.map((loan) => mapLoan(loan, installmentsByLoan.get(loan.id) || [])),
    payments: payments.map(mapPayment),
    ecommerce: ecommerce.map(mapEcommerce),
    receiptPatterns: patterns.map(mapReceiptPattern),
    blacklist: blacklist.map(mapBlacklist),
    exchangeRates: rates.map(mapExchangeRate),
    p2pTransactions: p2p.map(mapP2P),
    capitalMovements: capital.map(mapCapitalMovement),
  };

  if (isSupabaseConfigured()) {
    // La configuración OCR se sirve siempre desde la tabla global. Se eliminan
    // credenciales del estado por usuario para que ningún builder pueda
    // reenviarlas accidentalmente al cliente.
    const globalOcr = await readGlobalOcrConfigDto().catch(() => null);
    state.settings = {
      ...state.settings,
      aiProvider: globalOcr?.provider ?? null,
      aiAutoAssignEnabled: globalOcr ? globalOcr.autoAssignEnabled : state.settings.aiAutoAssignEnabled,
      aiRoutingRules: globalOcr ? globalOcr.routingRules : state.settings.aiRoutingRules,
      ocrConfidenceMin: globalOcr ? globalOcr.confidenceMin : state.settings.ocrConfidenceMin,
      ocrEndpoints: globalOcr ? globalOcr.endpoints : state.settings.ocrEndpoints,
      ocrModels: globalOcr ? globalOcr.models : state.settings.ocrModels,
      ocrThresholds: globalOcr ? globalOcr.thresholds : state.settings.ocrThresholds,
      providerConfig: globalOcr
        ? { endpoints: globalOcr.endpoints, models: globalOcr.models, thresholds: globalOcr.thresholds }
        : state.settings.providerConfig,
      ocrApiKeys: {},
      aiApiKey: '',
      ocrSpaceApiKey: '',
    };
    state.__globalOcr = globalOcr;
  }

  return state;
}

function mapSettings(row: UserSettingRow | null, trustRows: any[]) {
  if (!row) {
    return { currency: '$', ecommerceCapital: 5000, trustLevelConfig: normalizeTrustConfig(null) };
  }
  const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as AnyRecord) : {};
  const settings: AnyRecord = {
    ...data,
    companyName: row.company_name,
    currency: row.currency,
    timezone: row.timezone,
    ecommerceCapital: num(row.ecommerce_capital),
    aiProvider: row.ai_provider,
    aiAutoAssignEnabled: Boolean(row.ai_auto_assign_enabled),
    aiRoutingRules: row.ai_routing_rules || {},
    ocrConfidenceMin: num(row.ocr_confidence_min, 0.8),
    ocrApiKeys: row.ocr_api_keys || {},
    providerConfig: row.provider_config || {},
    systemLicenseKey: row.system_license_key,
    licenseKey: row.system_license_key || data.licenseKey,
  };

  if (trustRows.length > 0) {
    const levels: AnyRecord = { ...(settings.trustLevelConfig?.levels || {}) };
    for (const t of trustRows) {
      levels[t.tier] = { label: t.label, description: t.description || '' };
    }
    settings.trustLevelConfig = {
      levels,
      thresholds: settings.trustLevelConfig?.thresholds || normalizeTrustConfig(null).thresholds,
    };
  }
  if (!settings.trustLevelConfig) settings.trustLevelConfig = normalizeTrustConfig(null);

  decryptStateSecretsInMemory({ settings });
  return settings;
}

function mapClient(row: AnyRecord) {
  const tier = String(row.trust_level || 'medio').toLowerCase();
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    dni: row.dni,
    phone: row.phone || '',
    address: row.address || '',
    trustLevel: tier === 'alto' ? 'Alto' : tier === 'riesgoso' ? 'Riesgoso' : 'Medio',
    creditLimit: num(row.credit_limit),
    notes: row.notes || '',
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProduct(row: AnyRecord) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    category: row.category || '',
    costPrice: num(row.cost_price),
    salePrice: num(row.sale_price),
    profitMarginPercent: num(row.profit_margin_percent),
    manualSalePrice: Boolean(row.manual_sale_price),
    stock: int(row.stock),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLoan(row: AnyRecord, installments: any[]) {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    clientName: row.client_name || '',
    type: row.type,
    productId: row.product_id,
    productName: row.product_name || '',
    principal: num(row.principal),
    downPayment: num(row.down_payment),
    financedAmount: num(row.financed_amount),
    interestRate: num(row.interest_rate),
    totalAmount: num(row.total_amount),
    installmentCount: int(row.installment_count, installments.length),
    installmentAmount: num(row.installment_amount),
    frequency: row.frequency,
    startDate: row.start_date,
    notes: row.notes || '',
    status: row.status,
    archived: Boolean(row.archived),
    archivedAt: row.archived_at,
    archiveReason: row.archive_reason,
    finalStatus: row.final_status,
    metadata: jsonObject(row.metadata),
    items: Array.isArray(row.metadata?.items) ? row.metadata.items : [],
    interestMode: row.metadata?.interestMode === 'fixed' ? 'fixed' : 'percent',
    interestAmount: num(row.metadata?.interestAmount, num(row.interest_rate ? (num(row.principal) * num(row.interest_rate)) / 100 : 0)),
    installments: installments.sort((a, b) => a.number - b.number),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPayment(row: AnyRecord) {
  return {
    id: row.id,
    userId: row.user_id,
    loanId: row.loan_id,
    clientId: row.client_id,
    clientName: row.metadata?.clientName || '',
    installmentNumber: row.installment_number,
    amount: num(row.amount),
    date: row.payment_date,
    method: row.method || '',
    reference: row.reference || '',
    notes: row.notes || '',
    bcvRate: row.metadata?.bcvRate == null ? null : num(row.metadata.bcvRate),
    amountBs: row.metadata?.amountBs == null ? null : num(row.metadata.amountBs),
    metadata: jsonObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEcommerce(row: AnyRecord) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title || '',
    amountBs: num(row.amount_bs),
    amountUSD: num(row.amount_usd),
    amount: num(row.amount_bs),
    bcvRate: num(row.bcv_rate),
    bankOrigin: row.bank_origin || '',
    bankDestination: row.bank_destination || '',
    bank: row.bank_origin || row.bank_destination || '',
    reference: row.reference || '',
    date: row.transaction_date,
    receiptUrl: row.receipt_url || '',
    ocrProvider: row.ocr_provider || '',
    rawOcr: row.raw_ocr,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBlacklist(row: AnyRecord) {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    name: row.name,
    dni: row.dni,
    phone: row.phone || '',
    address: row.address || '',
    reason: row.reason || '',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReceiptPattern(row: AnyRecord) {
  return {
    id: row.id,
    userId: row.user_id,
    bankName: row.bank_name,
    keywords: row.keywords || [],
    referenceFormat: row.reference_format || '',
    referenceRegex: row.reference_regex || '',
    notes: row.notes || '',
    imageKey: row.image_key || '',
    imageUrl: row.image_url || '',
    imageMime: row.image_mime || '',
    isActive: row.is_active !== false,
    version: int(row.version, 1),
    createdBy: row.created_by,
    extra: row.extra || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExchangeRate(row: AnyRecord) {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: num(row.rate),
    buyRate: row.buy_rate == null ? null : num(row.buy_rate),
    sellRate: row.sell_rate == null ? null : num(row.sell_rate),
    isManual: Boolean(row.is_manual),
    fetchedAt: row.fetched_at,
    raw: row.raw || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapP2P(row: AnyRecord) {
  return {
    id: row.id,
    userId: row.user_id,
    side: row.side,
    amountUsdt: num(row.amount_usdt),
    amountVes: num(row.amount_ves),
    rate: num(row.rate),
    counterparty: row.counterparty || '',
    bank: row.bank || '',
    reference: row.reference || '',
    status: row.status,
    occurredAt: row.occurred_at,
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCapitalMovement(row: AnyRecord) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    amountUsd: num(row.amount_usd),
    currencyOrigin: row.currency_origin,
    exchangeRate: row.exchange_rate == null ? null : num(row.exchange_rate),
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// ESCRITURA// =============================================================================

export async function saveStateForRequest(request: Request, state: AnyRecord): Promise<boolean> {
  const result = await saveStateForRequestWithResult(request, state);
  return result.ok;
}

export async function saveStateForRequestWithResult(request: Request, state: AnyRecord) {
  if (!isSupabaseConfigured()) {
    return legacySaveAppStateWithResult(state);
  }

  const auth = await resolveRequestAuth(request);
  if (!auth.userId || !auth.supabase) {
    return { ok: false, mode: 'supabase', persistent: true, error: 'No autenticado: no se puede persistir sin sesión.' };
  }

  try {
    await persistScopedState(auth, state);
    return { ok: true, mode: 'supabase', persistent: true };
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error('[supabase-store] Error al persistir:', message);
    return { ok: false, mode: 'supabase', persistent: true, error: message };
  }
}

async function persistScopedState(auth: RequestAuth, state: AnyRecord) {
  const supabase = auth.supabase!;
  const userId = auth.userId!;
  const users: AnyRecord[] = Array.isArray(state.users) ? state.users : [];
  const currentUser = users.find((u) => u && String(u.id) === String(userId)) || auth.profile;

  await syncOwnProfile(auth, currentUser, state);
  await syncAdminProfiles(auth, users);
  await syncSettings(supabase, userId, state.settings, auth.profile);
  await syncTrustLevels(supabase, userId, state.settings);

  const clients = Array.isArray(state.clients) ? state.clients : [];
  const products = Array.isArray(state.products) ? state.products : [];
  const loans = Array.isArray(state.loans) ? state.loans : [];
  const payments = Array.isArray(state.payments) ? state.payments : [];
  const ecommerce = Array.isArray(state.ecommerce) ? state.ecommerce : [];
  const blacklist = Array.isArray(state.blacklist) ? state.blacklist : [];
  const patterns = Array.isArray(state.receiptPatterns) ? state.receiptPatterns : [];

  const clientIds = new Set(clients.map((c) => toUuid(c.id)));
  const productIds = new Set(products.map((p) => toUuid(p.id)));

  await syncCollection(supabase, userId, 'clients', clients.map((c) => clientRow(userId, c)));
  await syncCollection(supabase, userId, 'products', products.map((p) => productRow(userId, p)));

  const loanRows = loans.map((loan) => loanRow(userId, loan, clientIds, productIds));
  await syncCollection(supabase, userId, 'loans', loanRows);

  const installmentRows: AnyRecord[] = [];
  for (const loan of loans) {
    const loanId = toUuid(loan.id);
    const installments = Array.isArray(loan.installments) ? loan.installments : [];
    installments.forEach((inst: AnyRecord, index: number) => {
      const number = int(inst.number, index + 1);
      installmentRows.push(installmentRow(userId, loanId, number, inst));
    });
  }
  await syncCollection(supabase, userId, 'loan_installments', installmentRows);

  await syncCollection(supabase, userId, 'payments', payments.map((p) => paymentRow(userId, p)));
  await syncCollection(supabase, userId, 'ecommerce_transactions', ecommerce.map((e) => ecommerceRow(userId, e)));
  await syncCollection(supabase, userId, 'blacklist_entries', blacklist.map((b) => blacklistRow(userId, b)));
  await syncCollection(supabase, userId, 'receipt_patterns', patterns.map((p) => receiptPatternRow(userId, p)));

  const rates = Array.isArray(state.exchangeRates) ? state.exchangeRates : [];
  const p2p = Array.isArray(state.p2pTransactions) ? state.p2pTransactions : [];
  const capitalMovements = Array.isArray(state.capitalMovements) ? state.capitalMovements : [];
  if (rates.length > 0) await syncCollection(supabase, userId, 'exchange_rates', rates.map((r) => exchangeRateRow(userId, r)));
  if (p2p.length > 0) await syncCollection(supabase, userId, 'p2p_transactions', p2p.map((t) => p2pRow(userId, t)));
  if (capitalMovements.length > 0 || state.__syncCapital === true) {
    await syncCollection(supabase, userId, 'capital_movements', capitalMovements.map((m) => capitalMovementRow(userId, m)));
  }
}

async function syncCollection(
  supabase: DbClient,
  userId: string,
  table: keyof Database['public']['Tables'],
  rows: AnyRecord[]
) {
  const { data: existing, error: readError } = await (supabase as any)
    .from(table)
    .select('id')
    .eq('user_id', userId);
  badRequest(readError, `No se pudo leer ${String(table)}`);

  const desired = new Set(rows.map((row) => row.id));
  const toDelete = (existing || [])
    .map((row: AnyRecord) => row.id)
    .filter((id: string) => !desired.has(id));

  if (toDelete.length > 0) {
    const { error } = await (supabase as any).from(table).delete().eq('user_id', userId).in('id', toDelete);
    badRequest(error, `No se pudieron eliminar registros de ${String(table)}`);
  }

  if (rows.length > 0) {
    const { error } = await (supabase as any).from(table).upsert(rows, { onConflict: 'id' });
    badRequest(error, `No se pudieron guardar registros de ${String(table)}`);
  }
}

async function syncOwnProfile(auth: RequestAuth, user: AnyRecord | ProfileRow | null | undefined, state: AnyRecord) {
  if (!user) return;
  const row = profileRow(user, auth.profile);
  const admin = getSupabaseAdminClientOrNull();
  const client = admin || auth.supabase!;
  const { error } = await client.from('profiles').upsert(row, { onConflict: 'id' });
  badRequest(error, 'No se pudo actualizar el perfil');
}

async function syncAdminProfiles(auth: RequestAuth, users: AnyRecord[]) {
  if (auth.profile?.role !== 'admin') return;
  const admin = getSupabaseAdminClientOrNull();
  if (!admin) return;

  const { data: existing, error } = await admin.from('profiles').select('id, role, username, metadata');
  badRequest(error, 'No se pudieron leer los perfiles administrados');

  const desiredIds = new Set(users.map((u) => String(u.id)));
  for (const user of users) {
    if (!user?.id || !isUuid(user.id)) continue;
    // Conservar metadata existente: allí se guarda la copia cifrada de la clave
    // que habilita la vista previa "mantener presionado para ver".
    const fallback = (existing || []).find((p) => String(p.id) === String(user.id)) || null;
    const { error: upsertError } = await admin
      .from('profiles')
      .upsert(profileRow(user, fallback as ProfileRow | null), { onConflict: 'id' });
    if (upsertError) console.error('[supabase-store] Perfil no sincronizado:', user.id, upsertError.message);
  }

  for (const profile of existing || []) {
    if (profile.id === auth.userId) continue;
    if (desiredIds.has(profile.id)) continue;
    if (profile.role === 'admin') continue;
    const { error: deleteError } = await admin.auth.admin.deleteUser(profile.id);
    if (deleteError) console.error('[supabase-store] No se pudo eliminar usuario auth:', profile.id, deleteError.message);
  }
}

function profileRow(user: AnyRecord, fallback: ProfileRow | null) {
  const role = user.role === 'admin' || user.rawRole === 'admin' ? 'admin' : user.rawRole === 'operator' ? 'operator' : 'user';
  const expiresAt = user.licenseExpiresAt || fallback?.license_expires_at || null;
  const status = user.licenseStatus || (expiresAt && new Date(expiresAt).getTime() < Date.now() ? 'expired' : 'active');
  return {
    id: toUuid(user.id),
    username: String(user.username || fallback?.username || `user_${toUuid(user.id).slice(0, 8)}`).trim(),
    full_name: String(user.name || fallback?.full_name || user.username || '').trim(),
    company_name: text(user.companyName ?? fallback?.company_name),
    email: text(user.email ?? fallback?.email),
    address: text(user.address ?? fallback?.address),
    phone: text(user.phone ?? fallback?.phone),
    role,
    is_active: user.isActive !== false,
    license_key: text(user.licenseKey ?? fallback?.license_key),
    license_status: status,
    license_assigned_at: user.licenseAssignedAt || fallback?.license_assigned_at || null,
    license_expires_at: expiresAt,
    license_duration_months: int(user.licenseDurationMonths ?? fallback?.license_duration_months, 1),
    monthly_capitals: jsonObject(user.monthlyCapitals ?? fallback?.monthly_capitals),
    metadata: jsonObject(fallback?.metadata),
  };
}

async function syncSettings(supabase: DbClient, userId: string, settings: AnyRecord | undefined, profile: ProfileRow | null) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const forStorage = JSON.parse(JSON.stringify(source));
  for (const key of GLOBAL_OCR_SETTING_KEYS) delete forStorage[key];
  encryptStateSecretsAtRest({ settings: forStorage });
  const trustConfig = normalizeTrustConfig(source.trustLevelConfig);
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const currentCapital = Number(source.ecommerceCapital ?? profile?.monthly_capitals?.[currentMonthKey]?.capital ?? 5000);

  const row = {
    user_id: userId,
    company_name: String(source.companyName || 'CrediFlux'),
    currency: String(source.currency || '$'),
    timezone: String(source.timezone || 'America/Caracas'),
    ecommerce_capital: Number.isFinite(currentCapital) ? currentCapital : 0,
    // Columnas legadas neutralizadas: la fuente de verdad es admin_ocr_settings.
    ai_provider: 'ocrspace',
    ai_auto_assign_enabled: true,
    ai_routing_rules: jsonObject({}),
    ocr_confidence_min: 0.8,
    ocr_api_keys: jsonObject({}),
    provider_config: jsonObject({}),
    feature_flags: jsonObject(source.featureFlags),
    system_license_key: text(source.systemLicenseKey || source.licenseKey),
    data: forStorage as Json,
  };

  const { error } = await supabase.from('user_settings').upsert(row, { onConflict: 'user_id' });
  badRequest(error, 'No se pudo guardar la configuración');

  // Mantiene la fuente de verdad de niveles de confianza en su tabla.
  const trustRows = Object.entries(trustConfig.levels).map(([tier, level]: [string, any], index) => ({
    user_id: userId,
    tier,
    label: String(level.label || tier),
    description: String(level.description || ''),
    criteria: { thresholds: trustConfig.thresholds } as Json,
    is_active: true,
    sort_order: index + 1,
  }));
  if (trustRows.length > 0) {
    const { error: trustError } = await supabase.from('trust_level_configs').upsert(trustRows, { onConflict: 'user_id,tier' });
    badRequest(trustError, 'No se pudieron guardar los niveles de confianza');
  }
}

async function syncTrustLevels(supabase: DbClient, userId: string, settings: AnyRecord | undefined) {
  // La configuración se sincroniza dentro de syncSettings; se mantiene este
  // punto de extensión para futuras políticas por nivel.
  void supabase;
  void userId;
  void settings;
}

function clientRow(userId: string, client: AnyRecord) {
  const tier = String(client.trustLevel || 'medio').toLowerCase();
  return {
    id: toUuid(client.id),
    user_id: userId,
    name: String(client.name || '').trim(),
    dni: String(client.dni || '').trim(),
    phone: text(client.phone),
    address: text(client.address),
    trust_level: tier === 'alto' ? 'alto' : tier === 'riesgoso' ? 'riesgoso' : 'medio',
    credit_limit: num(client.creditLimit, 500),
    notes: text(client.notes),
    is_active: client.isActive !== false,
  };
}

function productRow(userId: string, product: AnyRecord) {
  return {
    id: toUuid(product.id),
    user_id: userId,
    name: String(product.name || '').trim(),
    category: text(product.category),
    cost_price: num(product.costPrice),
    sale_price: num(product.salePrice),
    profit_margin_percent: num(product.profitMarginPercent),
    manual_sale_price: Boolean(product.manualSalePrice),
    stock: int(product.stock),
  };
}

function loanRow(userId: string, loan: AnyRecord, clientIds: Set<string>, productIds: Set<string>) {
  const type = ['dinero', 'producto', 'cash', 'equipment'].includes(loan.type) ? loan.type : 'dinero';
  const frequency = ['diario', 'semanal', 'quincenal', 'mensual'].includes(loan.frequency) ? loan.frequency : 'mensual';
  const clientId = loan.clientId ? toUuid(loan.clientId) : null;
  const productId = loan.productId ? toUuid(loan.productId) : null;
  return {
    id: toUuid(loan.id),
    user_id: userId,
    client_id: clientId && clientIds.has(clientId) ? clientId : null,
    client_name: String(loan.clientName || ''),
    type,
    product_id: productId && productIds.has(productId) ? productId : null,
    product_name: text(loan.productName),
    principal: num(loan.principal),
    down_payment: Math.min(num(loan.downPayment), num(loan.principal)),
    financed_amount: num(loan.financedAmount),
    interest_rate: num(loan.interestRate),
    total_amount: num(loan.totalAmount),
    installment_count: Math.max(1, int(loan.installmentCount, 1)),
    installment_amount: num(loan.installmentAmount),
    frequency,
    start_date: dateOnly(loan.startDate),
    notes: text(loan.notes),
    status: ['al_dia', 'proximo', 'moroso', 'completado', 'archivado'].includes(loan.status) ? loan.status : 'al_dia',
    archived: Boolean(loan.archived),
    archived_at: loan.archivedAt ? timestampOrNow(loan.archivedAt) : null,
    archive_reason: text(loan.archiveReason),
    final_status: text(loan.finalStatus),
    metadata: {
      ...(jsonObject(loan.metadata) as AnyRecord),
      items: Array.isArray(loan.items) && loan.items.length > 0
        ? loan.items.map((item: AnyRecord) => ({
            productId: toUuid(item?.productId || item?.product_id),
            quantity: Math.max(1, int(item?.quantity, 1)),
          }))
        : type === 'producto' && productId ? [{ productId, quantity: 1 }] : [],
      interestMode: loan.interestMode === 'fixed' ? 'fixed' : 'percent',
      interestAmount: num(loan.interestAmount, 0),
    } as Json,
  };
}

function installmentRow(userId: string, loanId: string, number: number, inst: AnyRecord) {
  return {
    id: isUuid(inst.id) ? inst.id : toUuid(`installment:${loanId}:${number}`),
    user_id: userId,
    loan_id: loanId,
    installment_number: number,
    due_date: dateOnly(inst.dueDate),
    amount: num(inst.amount),
    paid: Boolean(inst.paid),
    paid_date: inst.paidDate ? dateOnly(inst.paidDate) : null,
    receipt_ref: text(inst.receiptRef),
  };
}

function paymentRow(userId: string, payment: AnyRecord) {
  return {
    id: toUuid(payment.id),
    user_id: userId,
    loan_id: payment.loanId ? toUuid(payment.loanId) : null,
    client_id: payment.clientId ? toUuid(payment.clientId) : null,
    installment_number: payment.installmentNumber == null ? null : int(payment.installmentNumber),
    amount: Math.max(0.01, num(payment.amount)),
    payment_date: dateOnly(payment.date),
    method: text(payment.method),
    reference: text(payment.reference),
    notes: text(payment.notes),
    metadata: {
      ...(jsonObject(payment.metadata) as AnyRecord),
      clientName: payment.clientName || '',
    } as Json,
  };
}

function ecommerceRow(userId: string, item: AnyRecord) {
  return {
    id: toUuid(item.id),
    user_id: userId,
    type: item.type === 'compra' ? 'compra' : 'venta',
    title: text(item.title),
    amount_bs: num(item.amountBs ?? item.amount),
    amount_usd: num(item.amountUSD),
    bcv_rate: num(item.bcvRate),
    bank_origin: text(item.bankOrigin || item.bank),
    bank_destination: text(item.bankDestination),
    reference: text(item.reference),
    transaction_date: dateOnly(item.date),
    receipt_url: text(item.receiptUrl),
    ocr_provider: text(item.ocrProvider),
    raw_ocr: (item.rawOcr ?? null) as Json | null,
  };
}

function blacklistRow(userId: string, entry: AnyRecord) {
  return {
    id: toUuid(entry.id),
    user_id: userId,
    // El cliente pudo eliminarse al pasar a la lista negra; se conserva el
    // snapshot de datos y se evita una FK rota.
    client_id: null,
    name: String(entry.name || '').trim(),
    dni: String(entry.dni || '').trim(),
    phone: text(entry.phone),
    address: text(entry.address),
    reason: text(entry.reason || entry.notes),
    notes: text(entry.notes),
  };
}

function receiptPatternRow(userId: string, pattern: AnyRecord) {
  return {
    id: toUuid(pattern.id),
    user_id: userId,
    bank_name: String(pattern.bankName || pattern.bank || 'Desconocido').trim(),
    keywords: jsonArray(pattern.keywords),
    reference_format: text(pattern.referenceFormat),
    reference_regex: text(pattern.referenceRegex),
    notes: text(pattern.notes),
    image_key: text(pattern.imageKey),
    image_url: text(pattern.imageUrl),
    image_mime: text(pattern.imageMime),
    is_active: pattern.isActive !== false,
    version: Math.max(1, int(pattern.version, 1)),
    created_by: pattern.createdBy && isUuid(pattern.createdBy) ? pattern.createdBy : userId,
    extra: jsonObject(pattern.extra),
  };
}

function exchangeRateRow(userId: string, rate: AnyRecord) {
  return {
    id: toUuid(rate.id),
    user_id: userId,
    source: ['bcv', 'binance_p2p', 'manual'].includes(rate.source) ? rate.source : 'manual',
    base_currency: String(rate.baseCurrency || 'VES'),
    quote_currency: String(rate.quoteCurrency || 'USD'),
    rate: Math.max(0.00000001, num(rate.rate)),
    buy_rate: rate.buyRate == null ? null : Math.max(0.00000001, num(rate.buyRate)),
    sell_rate: rate.sellRate == null ? null : Math.max(0.00000001, num(rate.sellRate)),
    is_manual: Boolean(rate.isManual),
    fetched_at: timestampOrNow(rate.fetchedAt),
    raw: jsonObject(rate.raw),
  };
}

function p2pRow(userId: string, tx: AnyRecord) {
  return {
    id: toUuid(tx.id),
    user_id: userId,
    side: tx.side === 'buy' ? 'buy' : 'sell',
    amount_usdt: Math.max(0.000001, num(tx.amountUsdt)),
    amount_ves: Math.max(0.01, num(tx.amountVes)),
    rate: Math.max(0.00000001, num(tx.rate)),
    counterparty: text(tx.counterparty),
    bank: text(tx.bank),
    reference: text(tx.reference),
    status: ['pending', 'completed', 'cancelled'].includes(tx.status) ? tx.status : 'completed',
    occurred_at: timestampOrNow(tx.occurredAt),
    notes: text(tx.notes),
  };
}

function capitalMovementRow(userId: string, movement: AnyRecord) {
  const type = movement.type === 'RETIRO_CAPITAL' ? 'RETIRO_CAPITAL' : 'APORTE_CAPITAL';
  const currency = ['USD', 'USDT', 'VES'].includes(movement.currencyOrigin)
    ? movement.currencyOrigin
    : 'USD';
  const rate = num(movement.exchangeRate);
  return {
    id: toUuid(movement.id),
    user_id: userId,
    type,
    amount_usd: Math.max(0.01, num(movement.amountUsd)),
    currency_origin: currency,
    exchange_rate: Number.isFinite(rate) && rate > 0 ? rate : null,
    notes: text(movement.notes),
    created_at: timestampOrNow(movement.createdAt),
  };
}

// =============================================================================
// DIAGNÓSTICO
// =============================================================================

export function persistenceInfo() {
  if (!isSupabaseConfigured()) return legacyPersistenceInfo();
  return {
    mode: 'supabase',
    persistent: true,
    supabaseConfigured: true,
    databaseConfigured: true,
    blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    storageProvider: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? 'supabase-storage'
      : process.env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : 'local-fs',
    storageConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.BLOB_READ_WRITE_TOKEN),
    serverless: Boolean(process.env.VERCEL),
    localWritable: false,
    encryptionAtRest: Boolean(process.env.SETTINGS_ENCRYPTION_KEY),
    issues: [],
    guidance: 'Datos y comprobantes persistidos en Supabase (Storage privado con URLs firmadas).',
  };
}

export async function checkPersistenceConnection() {
  if (!isSupabaseConfigured()) return legacyCheckPersistenceConnection();
  const admin = getSupabaseAdminClientOrNull();
  if (!admin) {
    return {
      ok: false,
      mode: 'supabase',
      persistent: true,
      databaseConfigured: true,
      message: 'Falta SUPABASE_SERVICE_ROLE_KEY para verificar la conexión.',
      diagnostics: persistenceInfo(),
    };
  }
  const { error } = await admin.from('profiles').select('id', { head: true, count: 'exact' }).limit(1);
  if (error) {
    return {
      ok: false,
      mode: 'supabase',
      persistent: true,
      databaseConfigured: true,
      message: `No se pudo consultar Supabase: ${error.message}`,
      diagnostics: persistenceInfo(),
    };
  }
  return {
    ok: true,
    mode: 'supabase',
    persistent: true,
    databaseConfigured: true,
    message: 'Conexión a Supabase verificada correctamente.',
    diagnostics: persistenceInfo(),
  };
}

export function hasDatabase() {
  return isSupabaseConfigured() || legacyHasDatabase();
}
