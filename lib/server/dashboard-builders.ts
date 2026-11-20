// -----------------------------------------------------------------------------
// Builders de respuesta para los 7 módulos del dashboard.
//
// Antes cada GET hacía su propia `getStateForRequest()` (7 lecturas completas
// por sincronización). Aquí la transformación es pura y reutilizable: los GET
// originales y `/api/dashboard` producen exactamente el mismo JSON, pero el
// endpoint agregado sólo lee el estado una vez.
//
// Los shapes se copiaron de las rutas existentes y se mantienen por contrato.
// -----------------------------------------------------------------------------

import { computeLoanStatus, getDefaultMonthlyCapital, scopeRecords } from '../db.js';
import { computeClientTrust, getTrustLevelConfig } from '../trust.js';
import {
  DEFAULT_OCR_ENDPOINTS,
  DEFAULT_OCR_MODELS,
  DEFAULT_OCR_THRESHOLDS,
  DEFAULT_AI_ROUTING_RULES,
  enrichReceiptPattern
} from './admin-config.js';
import { persistenceInfo, saveStateForRequest } from './supabase-store';
import {
  ALLOWED_PROVIDERS,
  getInternalLicenseStatus,
  getStoredOcrKeys,
  maskKey
} from './settings-shared';

/** Iguala la normalización que hacían los GET de forma independiente. */
export function normalizeDashboardState(db: any) {
  if (!db || typeof db !== 'object') return;
  if (!Array.isArray(db.clients)) db.clients = [];
  if (!Array.isArray(db.products)) db.products = [];
  if (!Array.isArray(db.loans)) db.loans = [];
  if (!Array.isArray(db.payments)) db.payments = [];
  if (!Array.isArray(db.ecommerce)) db.ecommerce = [];
  if (!Array.isArray(db.blacklist)) db.blacklist = [];
  if (!Array.isArray(db.capitalMovements)) db.capitalMovements = [];
  if (!Array.isArray(db.receiptPatterns)) db.receiptPatterns = [];
  if (!db.settings || typeof db.settings !== 'object' || Array.isArray(db.settings)) db.settings = {};
}

/** Efecto colateral que el GET de /api/settings realizaba al detectar un proveedor inválido. */
export async function prepareSettings(db: any, request: Request) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  const rawProvider = db.settings?.aiProvider;
  const activeProvider = ALLOWED_PROVIDERS.includes(rawProvider) ? rawProvider : 'openai';
  if (rawProvider && !ALLOWED_PROVIDERS.includes(rawProvider)) {
    db.settings.aiProvider = activeProvider;
    await saveStateForRequest(request, db);
  }
}

/**
 * URLs de los patrones en el mismo orden en que buildSettingsBody los enumera.
 * Permite firmar ecommerce + patrones en un único lote (una llamada por bucket)
 * tanto en /api/dashboard como en /api/settings.
 */
export function getReceiptPatternImageUrls(db: any): string[] {
  const currentUser: any = db?.__currentUser || null;
  if (currentUser?.role !== 'admin') return [];
  const patterns = Array.isArray(db?.receiptPatterns) ? db.receiptPatterns : [];
  return patterns.map((p: any) => enrichReceiptPattern(p)?.imageUrl);
}

// -----------------------------------------------------------------------------
// CLIENTS
// -----------------------------------------------------------------------------
export function buildClientsBody(db: any, user: any) {
  const trustConfig = getTrustLevelConfig(db.settings);
  const visibleClients = scopeRecords(db.clients || [], user);
  const visibleLoans = scopeRecords(db.loans || [], user);
  const visibleBlacklist = scopeRecords(db.blacklist || [], user);

  // Agrupación en un solo paso: antes era un filter() por cliente (O(C×L)).
  const loansByClient = new Map<any, any[]>();
  for (const loan of visibleLoans) {
    const list = loansByClient.get(loan.clientId) || [];
    list.push(loan);
    loansByClient.set(loan.clientId, list);
  }

  const enrichedClients = visibleClients.map((client: any) => {
    const allClientLoans = loansByClient.get(client.id) || [];
    // Los financiamientos archivados no participan en la deuda activa,
    // pero se conservan en el récord crediticio del cliente.
    const clientLoans = allClientLoans.filter(l => !l.archived);

    const totalFinanced = allClientLoans.reduce((sum, l) => sum + (l.financedAmount || 0), 0);
    const activeLoans = clientLoans.filter(l => computeLoanStatus(l) !== 'completado');

    let activeDebt = 0;
    let overdueDebt = 0;
    let paidInstallmentsCount = 0;
    let totalInstallmentsCount = 0;

    clientLoans.forEach(loan => {
      (loan.installments || []).forEach((inst: any) => {
        totalInstallmentsCount++;
        if (inst.paid) {
          paidInstallmentsCount++;
        } else {
          activeDebt += inst.amount;
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          const dueDate = new Date(inst.dueDate);
          dueDate.setHours(0, 0, 0, 0);
          if (dueDate < now) {
            overdueDebt += inst.amount;
          }
        }
      });
    });

    return {
      ...client,
      trust: computeClientTrust(clientLoans, trustConfig),
      stats: {
        totalLoansCount: allClientLoans.length,
        activeLoansCount: activeLoans.length,
        totalFinanced,
        activeDebt: Number(activeDebt.toFixed(2)),
        overdueDebt: Number(overdueDebt.toFixed(2)),
        paidRatio: totalInstallmentsCount > 0 ? Math.round((paidInstallmentsCount / totalInstallmentsCount) * 100) : 100
      },
      creditHistory: allClientLoans.map(l => ({
        id: l.id,
        productName: l.productName,
        type: l.type,
        totalAmount: l.totalAmount,
        status: computeLoanStatus(l),
        archived: Boolean(l.archived),
        startDate: l.startDate,
        installmentsCount: (l.installments || []).length,
        paidCount: (l.installments || []).filter((i: any) => i.paid).length
      }))
    };
  });

  return { success: true, clients: enrichedClients, blacklist: visibleBlacklist };
}

// -----------------------------------------------------------------------------
// PRODUCTS
// -----------------------------------------------------------------------------
export function buildProductsBody(db: any, user: any) {
  const scoped = scopeRecords(db.products || [], user);
  const enrichedProducts = scoped.map((prod: any) => {
    const cost = Number(prod.costPrice) || 0;
    const sale = Number(prod.salePrice) || 0;
    const profitMarginAmount = Number((sale - cost).toFixed(2));
    const profitMarginPercent = cost > 0 ? Number(((profitMarginAmount / cost) * 100).toFixed(1)) : 0;

    return {
      ...prod,
      profitMarginAmount,
      profitMarginPercent
    };
  });

  return { success: true, products: enrichedProducts };
}

// -----------------------------------------------------------------------------
// LOANS
// -----------------------------------------------------------------------------
export function buildLoansBody(db: any, user: any) {
  const visibleLoans = scopeRecords(db.loans || [], user);

  // Índice de costes: antes se hacía products.find() dentro del map (O(L×P)).
  const costByProductId = new Map<any, any>();
  for (const product of db.products || []) {
    if (product && product.id != null && !costByProductId.has(product.id)) {
      costByProductId.set(product.id, product.costPrice);
    }
  }

  const enrichedLoans = visibleLoans.map((loan: any) => {
    const status = computeLoanStatus(loan);
    const installments = loan.installments || [];
    const totalInstallments = installments.length;
    const paidInstallments = installments.filter((i: any) => i.paid);
    const paidCount = paidInstallments.length;
    const paidAmount = paidInstallments.reduce((sum: number, i: any) => sum + i.amount, 0);
    const pendingAmount = installments.filter((i: any) => !i.paid).reduce((sum: number, i: any) => sum + i.amount, 0);
    const progressPercent = totalInstallments > 0 ? Math.round((paidCount / totalInstallments) * 100) : 0;

    const productCost = costByProductId.get(loan.productId);
    const baseCost = loan.type === 'producto'
      ? (productCost || loan.principal * 0.75)
      : loan.principal;
    const projectedProfit = Math.max(0, (loan.totalAmount + (loan.downPayment || 0)) - baseCost);

    return {
      ...loan,
      status,
      stats: {
        totalInstallments,
        paidCount,
        pendingCount: totalInstallments - paidCount,
        paidAmount: Number(paidAmount.toFixed(2)),
        pendingAmount: Number(pendingAmount.toFixed(2)),
        progressPercent,
        projectedProfit: Number(projectedProfit.toFixed(2))
      }
    };
  });

  return { success: true, loans: enrichedLoans };
}

// -----------------------------------------------------------------------------
// PAYMENTS
// -----------------------------------------------------------------------------
export function buildPaymentsBody(db: any, user: any) {
  return { success: true, payments: scopeRecords(db.payments || [], user) };
}

// -----------------------------------------------------------------------------
// CAPITAL MOVEMENTS
// -----------------------------------------------------------------------------
function count(value: any) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round2(value: any) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function summarize(movements: any[]) {
  const list = Array.isArray(movements) ? movements : [];
  const aportes = round2(
    list.filter((m) => m.type === 'APORTE_CAPITAL').reduce((sum, m) => sum + count(m.amountUsd), 0)
  );
  const retiros = round2(
    list.filter((m) => m.type === 'RETIRO_CAPITAL').reduce((sum, m) => sum + count(m.amountUsd), 0)
  );
  return {
    aportes,
    retiros,
    netCapital: round2(aportes - retiros),
    count: list.length,
  };
}

export function buildCapitalBody(db: any, user: any) {
  const movements = scopeRecords(db.capitalMovements || [], user)
    .slice()
    .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  return { success: true, movements, summary: summarize(movements) };
}

// -----------------------------------------------------------------------------
// ECOMMERCE
// -----------------------------------------------------------------------------
export function buildEcommerceBody(
  db: any,
  user: any,
  resolvedReceiptUrls: string[] = [],
  searchParams?: URLSearchParams | null
) {
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const configuredCapital = user?.monthlyCapitals?.[currentMonthKey]?.capital;
  const assignedCapital = Number.isFinite(Number(configuredCapital))
    ? Math.max(0, Number(configuredCapital))
    : 0;

  const scopedTransactions = scopeRecords(db.ecommerce || [], user);
  const chronological = scopedTransactions.slice().reverse(); // oldest first
  const allTransactions = chronological.map((t: any, index: number) => ({
    ...t,
    receiptUrl: resolvedReceiptUrls[index] || t.receiptUrl
  }));

  let transactions = allTransactions;
  const period = searchParams?.get('period');
  const dateParam = searchParams?.get('date');
  if (period && dateParam) {
    transactions = allTransactions.filter((t: any) => {
      const txDate = t.date || (t.createdAt ? t.createdAt.slice(0, 10) : '');
      if (period === 'day') return txDate === dateParam;
      if (period === 'month') return txDate.startsWith(dateParam);
      if (period === 'year') return txDate.startsWith(dateParam);
      return true;
    });
  }

  const totalPurchasesBs = transactions
    .filter((t: any) => t.type === 'compra')
    .reduce((sum: number, t: any) => sum + (Number(t.amountBs) || Number(t.amount) || 0), 0);
  const totalSalesBs = transactions
    .filter((t: any) => t.type === 'venta')
    .reduce((sum: number, t: any) => sum + (Number(t.amountBs) || Number(t.amount) || 0), 0);
  const netProfitBs = Number((totalSalesBs - totalPurchasesBs - assignedCapital).toFixed(2));

  const totalPurchasesUSD = transactions
    .filter((t: any) => t.type === 'compra')
    .reduce((sum: number, t: any) => sum + (Number(t.amountUSD) || 0), 0);
  const totalSalesUSD = transactions
    .filter((t: any) => t.type === 'venta')
    .reduce((sum: number, t: any) => sum + (Number(t.amountUSD) || 0), 0);
  const grossNetUSD = totalSalesUSD - totalPurchasesUSD;
  const netProfitUSD = Number((totalSalesUSD - totalPurchasesUSD - assignedCapital).toFixed(2));

  const totalPurchases = Number(totalPurchasesUSD.toFixed(2)) || transactions
    .filter((t: any) => t.type === 'compra')
    .reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
  const totalSales = Number(totalSalesUSD.toFixed(2)) || transactions
    .filter((t: any) => t.type === 'venta')
    .reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
  const netProfit = Number((totalSales - totalPurchases - assignedCapital).toFixed(2));
  const profitMargin = totalPurchases > 0 ? Number(((grossNetUSD / totalPurchases) * 100).toFixed(1)) : 0;
  const capitalRoi = assignedCapital > 0 ? Number(((grossNetUSD / assignedCapital) * 100).toFixed(1)) : 0;
  const remainingCapital = Number((assignedCapital - totalPurchases + totalSales).toFixed(2));

  return {
    success: true,
    summary: {
      assignedCapital: Number(assignedCapital.toFixed(2)),
      currentMonthKey,
      totalPurchasesBs: Number(totalPurchasesBs.toFixed(2)),
      totalSalesBs: Number(totalSalesBs.toFixed(2)),
      netProfitBs,
      totalPurchasesUSD: Number(totalPurchasesUSD.toFixed(2)),
      totalSalesUSD: Number(totalSalesUSD.toFixed(2)),
      netProfitUSD,
      totalPurchases: Number(totalPurchases.toFixed(2)),
      totalSales: Number(totalSales.toFixed(2)),
      netProfit,
      profitMargin,
      capitalRoi,
      remainingCapital,
      totalTransactions: allTransactions.length
    },
    transactions: allTransactions,
    persistence: persistenceInfo(),
  };
}

// -----------------------------------------------------------------------------
// SETTINGS
// -----------------------------------------------------------------------------
export function buildSettingsBody(db: any, resolvedPatternUrls: string[] = []) {
  // El GET original usa __currentUser (no el usuario del header) para decidir
  // el rol; se conserva tal cual para no alterar permisos ni currentUserInfo.
  const currentUser: any = db?.__currentUser || null;
  const isAdmin = currentUser?.role === 'admin';

  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const userCurrentCapital = currentUser?.monthlyCapitals?.[currentMonthKey]?.capital ?? db.settings?.ecommerceCapital ?? 5000;

  const rawProvider = db.settings?.aiProvider;
  const activeProvider = ALLOWED_PROVIDERS.includes(rawProvider) ? rawProvider : 'openai';
  const ocrKeys = getStoredOcrKeys(db);

  const ocrEndpoints = db.settings?.ocrEndpoints || db.settings?.providerConfig?.endpoints || { ...DEFAULT_OCR_ENDPOINTS };
  const ocrModels = db.settings?.ocrModels || db.settings?.providerConfig?.models || { ...DEFAULT_OCR_MODELS };
  const ocrThresholds = db.settings?.ocrThresholds || db.settings?.providerConfig?.thresholds || { ...DEFAULT_OCR_THRESHOLDS };
  const ocrConfidenceMin = Number.isFinite(Number(db.settings?.ocrConfidenceMin))
    ? Number(db.settings.ocrConfidenceMin)
    : (Number.isFinite(Number(ocrThresholds.ocrConfidenceMin)) ? Number(ocrThresholds.ocrConfidenceMin) : 0.8);
  const aiRoutingRules = db.settings?.aiRoutingRules || { ...DEFAULT_AI_ROUTING_RULES };
  const systemLicenseKey = db.settings?.systemLicenseKey || db.settings?.licenseKey || 'CREDIFLUX-FINTECH-2026';

  const safeSettings: any = {
    companyName: db.settings?.companyName || 'CrediFlux',
    timezone: db.settings?.timezone || 'America/Caracas',
    currency: db.settings?.currency || '$',
    ecommerceCapital: userCurrentCapital,
    aiProvider: activeProvider,
    trustLevelConfig: getTrustLevelConfig(db.settings),
    internalOcrLicenses: { tesseract: getInternalLicenseStatus('tesseract') },
    ocrEndpoints,
    ocrModels,
    ocrThresholds,
    ocrConfidenceMin,
    aiRoutingRules,
    aiAutoAssignEnabled: db.settings?.aiAutoAssignEnabled !== false,
    systemLicenseKey,
    licenseKey: systemLicenseKey
  };

  if (isAdmin) {
    safeSettings.hasAiKey = Boolean(ocrKeys.openai || ocrKeys.gemini);
    safeSettings.aiApiKeyMasked = maskKey(ocrKeys.openai || ocrKeys.gemini);
    safeSettings.hasOcrSpaceKey = Boolean(ocrKeys.ocrspace);
    safeSettings.ocrSpaceKeyMasked = maskKey(ocrKeys.ocrspace);
    safeSettings.ocrKeys = {
      openai: ocrKeys.openai || '',
      gemini: ocrKeys.gemini || '',
      ocrspace: ocrKeys.ocrspace || '',
      tesseract: ''
    };
    safeSettings.ocrKeysMasked = {
      openai: maskKey(ocrKeys.openai),
      gemini: maskKey(ocrKeys.gemini),
      ocrspace: maskKey(ocrKeys.ocrspace),
      tesseract: ''
    };
    safeSettings.monthlyCapitals = currentUser?.monthlyCapitals || {};

    const allUsers = (db.users || []).map((u: any, i: number) => {
      const role = String(u.role || 'user').toLowerCase() === 'admin' ? 'admin' : (String(u.role || '').toLowerCase() === 'operator' || String(u.role || '').toLowerCase() === 'operador' ? 'operator' : 'user');
      const defaultPermissions = role === 'admin'
        ? ['all', 'admin', 'manage_users', 'manage_settings', 'manage_loans', 'manage_payments', 'manage_ecommerce', 'manage_receipt_patterns']
        : (role === 'operator' ? ['operator', 'manage_loans', 'manage_payments', 'manage_ecommerce', 'read_clients', 'read_reports'] : ['read_write', 'manage_loans', 'manage_payments', 'manage_ecommerce']);

      return {
        id: u.id,
        username: u.username,
        name: u.name || u.username,
        companyName: u.companyName || '',
        email: u.email || '',
        role,
        isActive: u.isActive !== false,
        permissions: Array.isArray(u.permissions) && u.permissions.length > 0 ? u.permissions : defaultPermissions,
        address: u.address || '',
        phone: u.phone || '',
        hasPassword: Boolean(u.passwordHash || u.password || u.passwordLegacy || u.passwordEncrypted),
        licenseKey: u.licenseKey || (role === 'admin' ? 'N/A (Admin)' : ''),
        licenseAssignedAt: u.licenseAssignedAt || null,
        licenseExpiresAt: u.licenseExpiresAt || null,
        licenseDurationMonths: u.licenseDurationMonths || 1,
        monthlyCapitals: u.monthlyCapitals || getDefaultMonthlyCapital(5000),
        createdAt: u.createdAt,
        updatedAt: u.updatedAt
      };
    });

    const enrichedPatterns = (db.receiptPatterns || []).map((p: any) => enrichReceiptPattern(p));
    const responsePatterns = enrichedPatterns.map((p: any, index: number) => ({
      ...p,
      imageUrl: resolvedPatternUrls[index] || p.imageUrl,
    }));

    return {
      success: true,
      isAdmin: true,
      settings: safeSettings,
      users: allUsers,
      receiptPatterns: responsePatterns,
      persistence: persistenceInfo(),
    };
  }

  return {
    success: true,
    isAdmin: false,
    settings: safeSettings,
    persistence: persistenceInfo(),
    currentUserInfo: currentUser ? {
      id: currentUser.id,
      username: currentUser.username,
      name: currentUser.name,
      role: currentUser.role,
      address: currentUser.address,
      phone: currentUser.phone,
      licenseKey: currentUser.licenseKey,
      licenseExpiresAt: currentUser.licenseExpiresAt,
      licenseAssignedAt: currentUser.licenseAssignedAt,
      licenseDurationMonths: currentUser.licenseDurationMonths,
      monthlyCapitals: currentUser.monthlyCapitals || getDefaultMonthlyCapital(5000)
    } : null
  };
}
