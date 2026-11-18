import { NextResponse } from 'next/server';
import { checkWritePermission, getDefaultMonthlyCapital, MONTH_NAMES } from '../../../lib/db.js';
import { getTrustLevelConfig, normalizeTrustConfig } from '../../../lib/trust.js';
import { INTERNAL_OCR_CONFIG, createTestReceiptPngBuffer, runTesseractRecognition } from '../../../lib/ocrEngine.js';
import { getStateForRequest, saveStateForRequest, saveStateForRequestWithResult, persistenceInfo, checkPersistenceConnection } from '../../../lib/server/supabase-store';
import {
  syncAdminStateToNormalized,
  logAudit,
  ensureAdminConfigSeed,
  hasDatabase,
  DEFAULT_OCR_ENDPOINTS,
  DEFAULT_OCR_MODELS,
  DEFAULT_OCR_THRESHOLDS,
  DEFAULT_AI_ROUTING_RULES,
  enrichReceiptPattern
} from '../../../lib/server/admin-config.js';
import { hashPassword } from '../../../lib/server/security.js';
import { getSupabaseAdminClientOrNull } from '../../../lib/supabase/admin';
import { isSupabaseConfigured } from '../../../lib/supabase/env';

// Tesseract.js necesita tiempo para iniciar el worker y cargar wasm/traineddata.
// Vercel debe permitir hasta 60 s; el timeout interno responde antes del corte.
export const maxDuration = 60;

const ALLOWED_PROVIDERS = ['openai', 'gemini', 'ocrspace', 'tesseract'];

function maskKey(key: string | undefined | null) {
  if (!key) return '';
  const value = String(key);
  if (!value) return '';
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function getStoredOcrKeys(db: any) {
  const s = db?.settings || {};
  const map = (s.ocrApiKeys && typeof s.ocrApiKeys === 'object') ? s.ocrApiKeys : {};
  const legacyAi = typeof s.aiApiKey === 'string' ? s.aiApiKey : '';
  const legacyOcr = typeof s.ocrSpaceApiKey === 'string' ? s.ocrSpaceApiKey : '';
  return {
    openai: typeof map.openai === 'string' && map.openai ? map.openai : legacyAi,
    gemini: typeof map.gemini === 'string' && map.gemini ? map.gemini : legacyAi,
    ocrspace: typeof map.ocrspace === 'string' && map.ocrspace ? map.ocrspace : legacyOcr,
    tesseract: ''
  } as Record<string, string>;
}

function getInternalLicenseStatus(provider: string) {
  const cfg: any = (INTERNAL_OCR_CONFIG as any)?.[provider];
  if (provider === 'tesseract') {
    return {
      active: true,
      loaded: true,
      label: cfg?.licenseLabel || 'Licencia interna: No requerida (motor local integrado, sin límites de API)',
      providerName: cfg?.name || 'Tesseract.js (Motor Local)'
    };
  }
  return null;
}

async function testProviderConnection(provider: string, apiKey: string | undefined, storedKeys?: Record<string, string>) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const key = (apiKey || '').trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    if (provider === 'ocrspace') {
      if (!key) return { success: false, error: 'Debes ingresar una API Key para probar la conexión', responseTimeMs: elapsed() };
      const testUrl = 'https://i.imgur.com/8km9tLL.png';
      const response = await fetch('https://api.ocr.space/parse/imageurl?apikey=' + encodeURIComponent(key) + '&url=' + encodeURIComponent(testUrl), { signal: controller.signal });
      const data: any = await response.json().catch(() => null);
      if (!data) return { success: false, error: 'Respuesta inválida del servidor de OCR.space', responseTimeMs: elapsed() };
      if (data.OCRExitCode === 99 || data.IsErroredOnProcessing) {
        const detail = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(' ') : String(data.ErrorMessage || '');
        if (/e5\d\d/i.test(detail) || /api\s*key|apikey|unauthorized|invalid user/i.test(detail)) {
          return { success: false, error: detail || 'La API Key de OCR.space no es válida', responseTimeMs: elapsed() };
        }
        return { success: true, message: 'Conexión exitosa con OCR.space (clave aceptada)', responseTimeMs: elapsed() };
      }
      return { success: true, message: 'Conexión exitosa con OCR.space', responseTimeMs: elapsed() };
    }

    if (provider === 'gemini') {
      if (!key) return { success: false, error: 'Debes ingresar una API Key para probar la conexión', responseTimeMs: elapsed() };
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key), { signal: controller.signal });
      if (!response.ok) {
        const detail: any = await response.json().catch(() => null);
        return { success: false, error: detail?.error?.message || 'La API Key de Google Gemini no es válida', responseTimeMs: elapsed() };
      }
      return { success: true, message: 'Conexión exitosa con Google Gemini', responseTimeMs: elapsed() };
    }

    if (provider === 'openai') {
      if (!key) return { success: false, error: 'Debes ingresar una API Key para probar la conexión', responseTimeMs: elapsed() };
      const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + key }, signal: controller.signal });
      if (!response.ok) {
        const detail: any = await response.json().catch(() => null);
        return { success: false, error: detail?.error?.message || 'La API Key de OpenAI no es válida', responseTimeMs: elapsed() };
      }
      return { success: true, message: 'Conexión exitosa con OpenAI', responseTimeMs: elapsed() };
    }

    if (provider === 'tesseract') {
      try {
        const testImage = createTestReceiptPngBuffer();
        // El propio motor aplica timeout + terminación del worker; 40 s deja margen
        // frente al maxDuration de 60 s de la función en Vercel.
        const rec = await runTesseractRecognition(testImage, 'eng', {
          logger: () => {},
          timeoutMs: 40000
        }) as any;
        const textLen = String(rec?.rawText || '').trim().length;
        const conf = Number(rec?.confidence);
        const confTxt = Number.isFinite(conf) ? `, confianza ${Math.round(conf)}%` : '';
        return {
          success: true,
          message: `Motor local Tesseract.js operativo. Worker inicializado y prueba de reconocimiento completada correctamente (texto extraído: ${textLen} caracteres${confTxt}).`,
          responseTimeMs: typeof rec?.responseTimeMs === 'number' ? rec.responseTimeMs : elapsed(),
          internalLicense: getInternalLicenseStatus(provider),
          details: { extractedChars: textLen, confidence: Number.isFinite(conf) ? conf : null, engine: 'tesseract.js' }
        };
      } catch (err: any) {
        return {
          success: false,
          error: `No se pudo completar la prueba del motor local Tesseract.js: ${err?.message || 'error desconocido'}`,
          responseTimeMs: elapsed(),
          internalLicense: getInternalLicenseStatus(provider),
          // Diagnóstico por fases: permite ver en producción si el worker no
          // arrancó, si faltan traineddata o si el reconocimiento se colgó.
          details: err?.diagnostics || null
        };
      }
    }

    return { success: false, error: 'Proveedor OCR no soportado', responseTimeMs: elapsed() };
  } catch (error: any) {
    return {
      success: false,
      error: error?.name === 'AbortError' ? 'Tiempo de espera agotado al verificar la conexión' : 'No se pudo verificar la conexión: ' + (error?.message || 'error de red'),
      responseTimeMs: elapsed(),
      internalLicense: getInternalLicenseStatus(provider)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  try {
    const db = await getStateForRequest(request);
    if (!db.settings) db.settings = {};
    const currentUser: any = db.__currentUser || null;
    const isAdmin = currentUser?.role === 'admin';

    const currentMonthKey = new Date().toISOString().slice(0, 7);
    const userCurrentCapital = currentUser?.monthlyCapitals?.[currentMonthKey]?.capital ?? db.settings?.ecommerceCapital ?? 5000;

    const rawProvider = db.settings?.aiProvider;
    const activeProvider = ALLOWED_PROVIDERS.includes(rawProvider) ? rawProvider : 'openai';
    if (rawProvider && !ALLOWED_PROVIDERS.includes(rawProvider)) {
      db.settings.aiProvider = activeProvider;
      await saveStateForRequest(request, db);
    }
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
      // No exponer secretos en claro: contraseñas se almacenan hasheadas (hashing aplicado)
      safeSettings.adminPassword = '';
      safeSettings.hasAdminPassword = Boolean(db.settings?.adminPasswordHash || db.settings?.adminPassword || db.settings?.adminPasswordLegacy);
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
          hasPassword: Boolean(u.passwordHash || u.password || u.passwordLegacy),
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

      return NextResponse.json({
        success: true,
        isAdmin: true,
        settings: safeSettings,
        users: allUsers,
        receiptPatterns: enrichedPatterns,
        persistence: persistenceInfo(),
      });
    }

    return NextResponse.json({
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
    });
  } catch (error) {
    console.error('Settings GET error:', error);
    return NextResponse.json({ success: false, error: 'Error al obtener configuración' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      action,
      companyName,
      timezone,
      currency,
      adminPassword,
      aiProvider,
      aiApiKey,
      ocrSpaceApiKey,
      ocrKeys: incomingOcrKeys,
      ocrEndpoints,
      ocrModels,
      ocrThresholds,
      ocrConfidenceMin,
      aiRoutingRules,
      aiAutoAssignEnabled,
      systemLicenseKey,
      trustLevelConfig,
      userMonthlyCapitals,
      resetCapital,
      testProviderConnection: testProvider,
      testApiKey,
      targetUserId,
      updateUserAction,
      updatedLicenseKey,
      updatedPassword,
      updatedMonths,
      updatedName,
      updatedCompanyName,
      updatedAddress,
      updatedPhone,
      importData
    } = body;

    const db = await getStateForRequest(request);
    if (!db.settings) db.settings = {};
    if (!Array.isArray(db.users)) db.users = [];
    if (!Array.isArray(db.receiptPatterns)) db.receiptPatterns = [];
    const currentUser: any = db.__currentUser || null;

    // EXPORTAR SNAPSHOT COMPLETO DE AJUSTES ADMIN (solo administrador)
    if (action === 'export_settings') {
      if (currentUser?.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'Acceso restringido: Solo el administrador puede exportar ajustes' }, { status: 403 });
      }

      const ocrKeys = getStoredOcrKeys(db);
      const activeOcrProvider = ALLOWED_PROVIDERS.includes(db.settings?.aiProvider) ? db.settings.aiProvider : 'ocrspace';
      const resolvedEndpoints = db.settings?.ocrEndpoints || db.settings?.providerConfig?.endpoints || { ...DEFAULT_OCR_ENDPOINTS };
      const resolvedModels = db.settings?.ocrModels || db.settings?.providerConfig?.models || { ...DEFAULT_OCR_MODELS };
      const resolvedThresholds = db.settings?.ocrThresholds || db.settings?.providerConfig?.thresholds || { ...DEFAULT_OCR_THRESHOLDS };
      const resolvedConfidenceMin = Number.isFinite(Number(db.settings?.ocrConfidenceMin))
        ? Number(db.settings.ocrConfidenceMin)
        : (Number.isFinite(Number(resolvedThresholds.ocrConfidenceMin)) ? Number(resolvedThresholds.ocrConfidenceMin) : 0.8);
      const resolvedRoutingRules = db.settings?.aiRoutingRules || { ...DEFAULT_AI_ROUTING_RULES };
      const resolvedSystemLicenseKey = db.settings?.systemLicenseKey || db.settings?.licenseKey || 'CREDIFLUX-FINTECH-2026';

      // 1. Perfiles completos de usuarios y operadores con roles, permisos, estados y credenciales
      const exportedUsers = await Promise.all((db.users || []).map(async (u: any, i: number) => {
        let passwordHash = u.passwordHash;
        if (!passwordHash && u.password) {
          passwordHash = await hashPassword(u.password);
          u.passwordHash = passwordHash;
        } else if (!passwordHash && u.passwordLegacy) {
          passwordHash = await hashPassword(u.passwordLegacy);
          u.passwordHash = passwordHash;
        } else if (!passwordHash && u.role === 'admin') {
          passwordHash = db.settings?.adminPasswordHash || await hashPassword('admin123');
          u.passwordHash = passwordHash;
        }

        const role = String(u.role || 'user').toLowerCase() === 'admin'
          ? 'admin'
          : (String(u.role || '').toLowerCase() === 'operator' || String(u.role || '').toLowerCase() === 'operador' ? 'operator' : 'user');
        const defaultPermissions = role === 'admin'
          ? ['all', 'admin', 'manage_users', 'manage_settings', 'manage_loans', 'manage_payments', 'manage_ecommerce', 'manage_receipt_patterns']
          : (role === 'operator'
            ? ['operator', 'manage_loans', 'manage_payments', 'manage_ecommerce', 'read_clients', 'read_reports']
            : ['read_write', 'manage_loans', 'manage_payments', 'manage_ecommerce']);

        return {
          id: u.id || (role === 'admin' ? 'usr_admin' : `usr_${u.username || i}`),
          username: u.username || `user_${i}`,
          name: u.name || u.username || 'Usuario',
          companyName: u.companyName || '',
          email: u.email || '',
          address: u.address || '',
          phone: u.phone || '',
          role,
          isActive: u.isActive !== false,
          permissions: Array.isArray(u.permissions) && u.permissions.length > 0 ? u.permissions : defaultPermissions,
          passwordHash: passwordHash || null,
          passwordLegacy: u.passwordLegacy || u.password || null,
          licenseKey: u.licenseKey || (role === 'admin' ? 'N/A (Admin)' : ''),
          licenseDurationMonths: Number(u.licenseDurationMonths) || 1,
          licenseAssignedAt: u.licenseAssignedAt || null,
          licenseExpiresAt: u.licenseExpiresAt || null,
          monthlyCapitals: u.monthlyCapitals || getDefaultMonthlyCapital(5000),
          createdAt: u.createdAt || new Date().toISOString(),
          updatedAt: u.updatedAt || new Date().toISOString()
        };
      }));

      // 2. Parámetros completos del motor OCR y Licencias
      const motorOcrConfig = {
        activeProvider: activeOcrProvider,
        apiKeys: {
          openai: ocrKeys.openai || '',
          gemini: ocrKeys.gemini || '',
          ocrspace: ocrKeys.ocrspace || '',
          tesseract: ''
        },
        endpoints: resolvedEndpoints,
        selectedModels: resolvedModels,
        validationThresholds: {
          ocrConfidenceMin: resolvedConfidenceMin,
          minAmount: resolvedThresholds.minAmount ?? 0.01,
          maxAmount: resolvedThresholds.maxAmount ?? 999999999.99,
          strictBankMatch: Boolean(resolvedThresholds.strictBankMatch),
          requireReferenceMatch: resolvedThresholds.requireReferenceMatch !== false,
          crossValidateBank: resolvedThresholds.crossValidateBank !== false
        },
        routingRules: resolvedRoutingRules,
        autoAssignEnabled: db.settings?.aiAutoAssignEnabled !== false,
        licenses: {
          systemLicenseKey: resolvedSystemLicenseKey,
          internal: {
            tesseract: getInternalLicenseStatus('tesseract')
          }
        }
      };

      const fullSettings = {
        companyName: db.settings?.companyName || 'CrediFlux',
        currency: db.settings?.currency || '$',
        ecommerceCapital: db.settings?.ecommerceCapital ?? 5000,
        timezone: db.settings?.timezone || 'America/Caracas',
        aiProvider: activeOcrProvider,
        aiAutoAssignEnabled: motorOcrConfig.autoAssignEnabled,
        aiRoutingRules: motorOcrConfig.routingRules,
        ocrConfidenceMin: resolvedConfidenceMin,
        ocrApiKeys: motorOcrConfig.apiKeys,
        aiApiKey: motorOcrConfig.apiKeys.openai || motorOcrConfig.apiKeys.gemini || '',
        ocrSpaceApiKey: motorOcrConfig.apiKeys.ocrspace || '',
        ocrEndpoints: resolvedEndpoints,
        ocrModels: resolvedModels,
        ocrThresholds: motorOcrConfig.validationThresholds,
        providerConfig: {
          endpoints: resolvedEndpoints,
          models: resolvedModels,
          thresholds: motorOcrConfig.validationThresholds
        },
        trustLevelConfig: getTrustLevelConfig(db.settings),
        systemLicenseKey: resolvedSystemLicenseKey,
        licenseKey: resolvedSystemLicenseKey,
        adminPasswordHash: db.settings?.adminPasswordHash || undefined,
        internalOcrLicenses: {
          tesseract: getInternalLicenseStatus('tesseract')
        },
        featureFlags: db.settings?.featureFlags || {},
        metadata: db.settings?.metadata || {}
      };

      // 3. Base completa de patrones de comprobantes bancarios, firmas visuales y reglas de análisis
      const enrichedReceiptPatterns = (db.receiptPatterns || []).map((p: any) => enrichReceiptPattern(p));

      const payload = {
        version: 2,
        module: 'ajustes-admin',
        snapshot: 'full',
        exportedAt: new Date().toISOString(),
        system: {
          appName: 'CrediFlux',
          platform: 'FinTech Core & Multi-Tenant Architecture',
          snapshotScope: 'integral-admin-settings',
          summary: {
            usersCount: exportedUsers.length,
            operatorsCount: exportedUsers.filter((u: any) => u.role !== 'admin').length,
            receiptPatternsCount: enrichedReceiptPatterns.length,
            activeOcrProvider,
            configuredOcrKeys: Object.keys(motorOcrConfig.apiKeys).filter(k => Boolean((motorOcrConfig.apiKeys as any)[k])),
            systemLicenseKey: resolvedSystemLicenseKey
          }
        },
        data: {
          settings: fullSettings,
          motorOcr: motorOcrConfig,
          users: exportedUsers,
          receiptPatterns: enrichedReceiptPatterns
        }
      };

      return NextResponse.json({ success: true, export: payload, persistence: persistenceInfo() });
    }

    // IMPORTAR SNAPSHOT COMPLETO DE AJUSTES ADMIN (solo administrador)
    if (action === 'import_settings') {
      if (currentUser?.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'Acceso restringido: Solo el administrador puede importar ajustes' }, { status: 403 });
      }

      const src = (importData && typeof importData === 'object') ? importData : null;
      // Compatibilidad con envoltorios: { data: { ... } }, { settings, users, ... }, o raíz directa
      const envelope = (src && src.data && typeof src.data === 'object' && !Array.isArray(src.data))
        ? src.data
        : (src && typeof src === 'object' && !Array.isArray(src) ? src : null);

      if (!envelope || typeof envelope !== 'object') {
        return NextResponse.json({ success: false, error: 'Archivo de importación inválido: estructura JSON no reconocida' }, { status: 400 });
      }

      const hasSettings = Object.prototype.hasOwnProperty.call(envelope, 'settings');
      const hasMotorOcr = Object.prototype.hasOwnProperty.call(envelope, 'motorOcr');
      const hasUsers = Object.prototype.hasOwnProperty.call(envelope, 'users');
      const hasPatterns = Object.prototype.hasOwnProperty.call(envelope, 'receiptPatterns');

      if (!hasSettings && !hasMotorOcr && !hasUsers && !hasPatterns) {
        return NextResponse.json({ success: false, error: 'Archivo de importación inválido: no contiene bloques de Ajustes Admin (settings, motorOcr, users o receiptPatterns)' }, { status: 400 });
      }

      if (hasSettings && (typeof envelope.settings !== 'object' || envelope.settings === null || Array.isArray(envelope.settings))) {
        return NextResponse.json({ success: false, error: 'Archivo de importación inválido: el bloque settings debe ser un objeto' }, { status: 400 });
      }
      if (hasUsers && !Array.isArray(envelope.users)) {
        return NextResponse.json({ success: false, error: 'Archivo de importación inválido: el bloque users debe ser un arreglo' }, { status: 400 });
      }
      if (hasPatterns && !Array.isArray(envelope.receiptPatterns)) {
        return NextResponse.json({ success: false, error: 'Archivo de importación inválido: el bloque receiptPatterns debe ser un arreglo' }, { status: 400 });
      }

      const beforeSettings = JSON.parse(JSON.stringify(db.settings || {}));
      const beforePatterns = JSON.parse(JSON.stringify(db.receiptPatterns || []));
      const beforeUsers = JSON.parse(JSON.stringify(db.users || []));

      // 1. RECREACIÓN Y SINCRONIZACIÓN INTEGRAL DE USUARIOS Y OPERADORES
      let sanitizedUsers: any[] | null = null;
      if (hasUsers) {
        const rawUsers = envelope.users as any[];
        sanitizedUsers = await Promise.all(
          rawUsers
            .filter((u: any) => u && typeof u === 'object' && !Array.isArray(u))
            .map(async (u: any, i: number) => {
              const username = String(u.username || '').trim();
              const rawRole = String(u.role || '').toLowerCase();
              const role = rawRole === 'admin' ? 'admin' : (rawRole === 'operator' || rawRole === 'operador' ? 'operator' : 'user');
              const id = typeof u.id === 'string' && u.id.trim()
                ? u.id.trim()
                : (username ? (role === 'admin' ? 'usr_admin' : `usr_${username.toLowerCase().replace(/[^a-z0-9]/g, '_')}`) : `usr_imp_${Date.now()}_${i}`);

              const name = String(u.name || username || `Usuario ${i + 1}`).trim();
              const isActive = u.isActive !== false;

              // Credenciales: preservar passwordHash existente para login transparente en el nuevo entorno
              let passwordHash = u.passwordHash ? String(u.passwordHash).trim() : null;
              if (!passwordHash && u.password) {
                passwordHash = await hashPassword(String(u.password).trim());
              } else if (!passwordHash && u.passwordLegacy) {
                passwordHash = await hashPassword(String(u.passwordLegacy).trim());
              } else if (!passwordHash) {
                const existing = db.users.find((eu: any) => eu.id === id || (username && eu.username?.toLowerCase() === username.toLowerCase()));
                if (existing?.passwordHash) {
                  passwordHash = existing.passwordHash;
                } else if (role === 'admin') {
                  passwordHash = db.settings?.adminPasswordHash || await hashPassword('admin123');
                } else {
                  passwordHash = await hashPassword('User2026!');
                }
              }

              const defaultPermissions = role === 'admin'
                ? ['all', 'admin', 'manage_users', 'manage_settings', 'manage_loans', 'manage_payments', 'manage_ecommerce', 'manage_receipt_patterns']
                : (role === 'operator'
                  ? ['operator', 'manage_loans', 'manage_payments', 'manage_ecommerce', 'read_clients', 'read_reports']
                  : ['read_write', 'manage_loans', 'manage_payments', 'manage_ecommerce']);

              const permissions = Array.isArray(u.permissions) && u.permissions.length > 0 ? u.permissions : defaultPermissions;

              return {
                id,
                username: username || `user_${id}`,
                name,
                companyName: typeof u.companyName === 'string' ? u.companyName.trim() : '',
                email: typeof u.email === 'string' ? u.email.trim() : '',
                address: typeof u.address === 'string' ? u.address.trim() : '',
                phone: typeof u.phone === 'string' ? u.phone.trim() : '',
                role,
                isActive,
                permissions,
                passwordHash,
                passwordLegacy: typeof u.passwordLegacy === 'string' ? u.passwordLegacy : (typeof u.password === 'string' ? u.password : null),
                licenseKey: typeof u.licenseKey === 'string' && u.licenseKey ? u.licenseKey.trim().toUpperCase() : (role === 'admin' ? 'N/A (Admin)' : `LIC-${id.toUpperCase()}`),
                licenseDurationMonths: Number(u.licenseDurationMonths) || 1,
                licenseAssignedAt: u.licenseAssignedAt || new Date().toISOString(),
                licenseExpiresAt: u.licenseExpiresAt || null,
                monthlyCapitals: (u.monthlyCapitals && typeof u.monthlyCapitals === 'object') ? u.monthlyCapitals : getDefaultMonthlyCapital(5000),
                createdAt: u.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString()
              };
            })
        );

        sanitizedUsers = sanitizedUsers.filter((u: any) => u.id && u.username);

        if (sanitizedUsers.length === 0) {
          return NextResponse.json({ success: false, error: 'Archivo de importación inválido: no contiene usuarios válidos' }, { status: 400 });
        }
        if (!sanitizedUsers.some((u: any) => u.role === 'admin')) {
          return NextResponse.json({ success: false, error: 'Archivo de importación inválido: debe incluir al menos un usuario administrador' }, { status: 400 });
        }

        // Inyectar usuarios en el estado del sistema
        db.users = sanitizedUsers;

        // Sincronizar hash de clave maestra con el administrador importado
        const importedAdmin = sanitizedUsers.find((u: any) => u.role === 'admin');
        if (importedAdmin?.passwordHash) {
          db.settings.adminPasswordHash = importedAdmin.passwordHash;
          delete db.settings.adminPassword;
          delete db.settings.adminPasswordLegacy;
        }
      }

      // 2. INYECCIÓN DEL MOTOR OCR, CLAVES, ENDPOINTS, MODELOS, UMBRALES Y AJUSTES GENERALES
      if (hasSettings || hasMotorOcr) {
        const incomingSettings: any = envelope.settings || {};
        const incomingMotorOcr: any = envelope.motorOcr || {};

        const nextSettings: any = { ...(db.settings || {}), ...incomingSettings };

        // Parámetros generales de plataforma
        if (incomingSettings.companyName) nextSettings.companyName = String(incomingSettings.companyName).trim();
        if (incomingSettings.currency) nextSettings.currency = String(incomingSettings.currency).trim();
        if (incomingSettings.timezone) nextSettings.timezone = String(incomingSettings.timezone).trim();
        if (Object.prototype.hasOwnProperty.call(incomingSettings, 'ecommerceCapital')) {
          const n = Number(incomingSettings.ecommerceCapital);
          nextSettings.ecommerceCapital = Number.isFinite(n) && n >= 0 ? n : (db.settings?.ecommerceCapital ?? 5000);
        }

        // Proveedor activo OCR / IA
        const rawProvider = incomingMotorOcr.activeProvider || incomingSettings.aiProvider;
        if (rawProvider && ALLOWED_PROVIDERS.includes(rawProvider)) {
          nextSettings.aiProvider = rawProvider;
        } else if (!ALLOWED_PROVIDERS.includes(nextSettings.aiProvider)) {
          nextSettings.aiProvider = 'ocrspace';
        }

        // Claves API de proveedores OCR (descifradas y listas para uso)
        const incomingKeys = incomingMotorOcr.apiKeys || incomingSettings.ocrApiKeys || {};
        const existingKeys = getStoredOcrKeys(db);
        const resolvedKeys = {
          openai: typeof incomingKeys.openai === 'string' ? incomingKeys.openai.trim() : (typeof incomingSettings.aiApiKey === 'string' && (nextSettings.aiProvider === 'openai') ? incomingSettings.aiApiKey.trim() : (existingKeys.openai || '')),
          gemini: typeof incomingKeys.gemini === 'string' ? incomingKeys.gemini.trim() : (typeof incomingSettings.aiApiKey === 'string' && (nextSettings.aiProvider === 'gemini') ? incomingSettings.aiApiKey.trim() : (existingKeys.gemini || '')),
          ocrspace: typeof incomingKeys.ocrspace === 'string' ? incomingKeys.ocrspace.trim() : (typeof incomingSettings.ocrSpaceApiKey === 'string' ? incomingSettings.ocrSpaceApiKey.trim() : (existingKeys.ocrspace || '')),
          tesseract: ''
        };
        nextSettings.ocrApiKeys = resolvedKeys;
        nextSettings.ocrSpaceApiKey = resolvedKeys.ocrspace;
        nextSettings.aiApiKey = resolvedKeys.openai || resolvedKeys.gemini || '';

        // Endpoints por motor OCR
        const incomingEndpoints = incomingMotorOcr.endpoints || incomingSettings.ocrEndpoints || {};
        nextSettings.ocrEndpoints = {
          ...DEFAULT_OCR_ENDPOINTS,
          ...(db.settings?.ocrEndpoints || {}),
          ...(typeof incomingEndpoints === 'object' && incomingEndpoints ? incomingEndpoints : {})
        };

        // Modelos seleccionados por motor OCR
        const incomingModels = incomingMotorOcr.selectedModels || incomingSettings.ocrModels || {};
        nextSettings.ocrModels = {
          ...DEFAULT_OCR_MODELS,
          ...(db.settings?.ocrModels || {}),
          ...(typeof incomingModels === 'object' && incomingModels ? incomingModels : {})
        };

        // Umbrales de validación financiera
        const incomingThresholds = incomingMotorOcr.validationThresholds || incomingSettings.ocrThresholds || {};
        nextSettings.ocrThresholds = {
          ...DEFAULT_OCR_THRESHOLDS,
          ...(db.settings?.ocrThresholds || {}),
          ...(typeof incomingThresholds === 'object' && incomingThresholds ? incomingThresholds : {})
        };
        const confMin = Number(incomingSettings.ocrConfidenceMin ?? incomingThresholds.ocrConfidenceMin);
        nextSettings.ocrConfidenceMin = Number.isFinite(confMin) && confMin >= 0 && confMin <= 1 ? confMin : (nextSettings.ocrThresholds?.ocrConfidenceMin ?? 0.8);
        nextSettings.ocrThresholds.ocrConfidenceMin = nextSettings.ocrConfidenceMin;

        // Reglas de enrutamiento y asignación automática
        const incomingRouting = incomingMotorOcr.routingRules || incomingSettings.aiRoutingRules;
        nextSettings.aiRoutingRules = (typeof incomingRouting === 'object' && incomingRouting) ? incomingRouting : (db.settings?.aiRoutingRules || { ...DEFAULT_AI_ROUTING_RULES });
        if (incomingMotorOcr.autoAssignEnabled !== undefined) {
          nextSettings.aiAutoAssignEnabled = Boolean(incomingMotorOcr.autoAssignEnabled);
        } else if (incomingSettings.aiAutoAssignEnabled !== undefined) {
          nextSettings.aiAutoAssignEnabled = Boolean(incomingSettings.aiAutoAssignEnabled);
        }

        // Metadatos de proveedores estructurados
        nextSettings.providerConfig = {
          endpoints: nextSettings.ocrEndpoints,
          models: nextSettings.ocrModels,
          thresholds: nextSettings.ocrThresholds
        };

        // Licencias globales del sistema
        const incomingLic = incomingMotorOcr.licenses?.systemLicenseKey || incomingSettings.systemLicenseKey || incomingSettings.licenseKey;
        if (incomingLic && String(incomingLic).trim()) {
          nextSettings.systemLicenseKey = String(incomingLic).trim();
          nextSettings.licenseKey = String(incomingLic).trim();
        }

        // Niveles de confianza de clientes
        if (incomingSettings.trustLevelConfig && typeof incomingSettings.trustLevelConfig === 'object') {
          try {
            nextSettings.trustLevelConfig = normalizeTrustConfig(incomingSettings.trustLevelConfig);
          } catch {}
        }

        db.settings = nextSettings;
      }

      // 3. INYECCIÓN COMPLETA DE BASE DE PATRONES DE COMPROBANTES, FIRMAS VISUALES Y REGLAS
      if (hasPatterns) {
        const rawPatterns = envelope.receiptPatterns as any[];
        db.receiptPatterns = rawPatterns
          .filter((p: any) => p && typeof p === 'object' && !Array.isArray(p))
          .map((p: any, i: number) => {
            const enriched: any = enrichReceiptPattern(p);
            if (typeof enriched.id !== 'string' || !enriched.id) {
              enriched.id = typeof p.id === 'string' && p.id ? p.id : `pat_imp_${Date.now()}_${i}`;
            }
            return enriched;
          });
      }

      // 4. PERSISTENCIA EN EL ALMACÉN Y SINCRONIZACIÓN CON BASE DE DATOS (POSTGRES / PRISMA)
      const preflight = await checkPersistenceConnection();
      if (!preflight.ok && preflight.databaseConfigured) {
        return NextResponse.json({
          success: false,
          error: `No se pudo validar la conexión de persistencia antes de importar: ${preflight.message}`,
          persistence: preflight.diagnostics || persistenceInfo(),
        }, { status: 503 });
      }
      if (!preflight.persistent && !preflight.databaseConfigured) {
        const diag = preflight.diagnostics || persistenceInfo();
        const reason = diag?.issues?.[0] || preflight.message || 'No hay un almacén duradero disponible.';
        return NextResponse.json({
          success: false,
          error: `No se pudo persistir la configuración importada: ${reason} Configura DATABASE_URL (PostgreSQL) para producción en Vercel y vuelve a intentar la importación.`,
          persistence: diag,
        }, { status: 503 });
      }

      const persisted = await saveStateForRequestWithResult(request, db);
      if (!persisted.ok) {
        return NextResponse.json({
          success: false,
          error: `No se pudo persistir la configuración importada: ${persisted.error || 'error de escritura en el almacén de datos.'}`,
          persistence: (persisted as any).diagnostics || persistenceInfo(),
        }, { status: 500 });
      }

      if (hasDatabase()) {
        try {
          await ensureAdminConfigSeed();
          await syncAdminStateToNormalized(db);
          if (hasSettings || hasMotorOcr) await logAudit({ entity: 'AdminSetting', entityId: 'main', action: 'IMPORT', before: beforeSettings, after: db.settings, actorLegacyId: currentUser?.id }).catch(() => {});
          if (hasUsers) await logAudit({ entity: 'User', entityId: 'all', action: 'IMPORT', before: beforeUsers, after: db.users, actorLegacyId: currentUser?.id }).catch(() => {});
          if (hasPatterns) await logAudit({ entity: 'ReceiptPattern', entityId: 'all', action: 'IMPORT', before: beforePatterns, after: db.receiptPatterns, actorLegacyId: currentUser?.id }).catch(() => {});
        } catch (syncError: any) {
          console.error('Settings import sync error:', syncError);
          return NextResponse.json({
            success: false,
            error: 'La configuración se guardó parcialmente pero falló la sincronización con la base de datos: ' + (syncError?.message || 'error desconocido')
          }, { status: 500 });
        }
      }

      // 5. RECONCILIACIÓN DEL USUARIO ACTIVO Y SESIÓN
      const primaryAdmin = (db.users || []).find((u: any) => u.role === 'admin');
      const activeAdminUser = primaryAdmin ? {
        id: primaryAdmin.id,
        username: primaryAdmin.username,
        name: primaryAdmin.name,
        role: primaryAdmin.role,
        address: primaryAdmin.address || '',
        phone: primaryAdmin.phone || '',
        licenseKey: primaryAdmin.licenseKey || 'N/A (Admin)',
        monthlyCapitals: primaryAdmin.monthlyCapitals || getDefaultMonthlyCapital(5000)
      } : null;

      const configuredKeysList = Object.keys(db.settings.ocrApiKeys || {}).filter(k => Boolean(db.settings.ocrApiKeys[k]));

      const safeSettings = {
        companyName: db.settings?.companyName || 'CrediFlux',
        timezone: db.settings?.timezone || 'America/Caracas',
        currency: db.settings?.currency || '$',
        ecommerceCapital: primaryAdmin?.monthlyCapitals?.[new Date().toISOString().slice(0, 7)]?.capital ?? db.settings?.ecommerceCapital ?? 5000,
        aiProvider: db.settings?.aiProvider || 'ocrspace',
        trustLevelConfig: getTrustLevelConfig(db.settings),
        internalOcrLicenses: { tesseract: getInternalLicenseStatus('tesseract') },
        hasAiKey: Boolean(db.settings?.ocrApiKeys?.openai || db.settings?.ocrApiKeys?.gemini),
        hasOcrSpaceKey: Boolean(db.settings?.ocrApiKeys?.ocrspace),
        ocrKeys: db.settings?.ocrApiKeys || {},
        ocrKeysMasked: {
          openai: maskKey(db.settings?.ocrApiKeys?.openai),
          gemini: maskKey(db.settings?.ocrApiKeys?.gemini),
          ocrspace: maskKey(db.settings?.ocrApiKeys?.ocrspace),
          tesseract: ''
        },
        ocrEndpoints: db.settings?.ocrEndpoints || { ...DEFAULT_OCR_ENDPOINTS },
        ocrModels: db.settings?.ocrModels || { ...DEFAULT_OCR_MODELS },
        ocrThresholds: db.settings?.ocrThresholds || { ...DEFAULT_OCR_THRESHOLDS },
        ocrConfidenceMin: db.settings?.ocrConfidenceMin ?? 0.8,
        aiRoutingRules: db.settings?.aiRoutingRules || { ...DEFAULT_AI_ROUTING_RULES },
        aiAutoAssignEnabled: db.settings?.aiAutoAssignEnabled !== false,
        systemLicenseKey: db.settings?.systemLicenseKey || db.settings?.licenseKey || 'CREDIFLUX-FINTECH-2026',
        licenseKey: db.settings?.systemLicenseKey || db.settings?.licenseKey,
        hasAdminPassword: Boolean(db.settings?.adminPasswordHash || db.settings?.adminPassword)
      };

      const allUsers = (db.users || []).map((u: any) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        companyName: u.companyName || '',
        email: u.email || '',
        role: u.role,
        isActive: u.isActive !== false,
        permissions: Array.isArray(u.permissions) ? u.permissions : (u.role === 'admin' ? ['all', 'admin'] : ['read_write']),
        address: u.address || '',
        phone: u.phone || '',
        hasPassword: Boolean(u.passwordHash || u.password || u.passwordLegacy),
        licenseKey: u.licenseKey || (u.role === 'admin' ? 'N/A (Admin)' : ''),
        licenseAssignedAt: u.licenseAssignedAt || null,
        licenseExpiresAt: u.licenseExpiresAt || null,
        licenseDurationMonths: u.licenseDurationMonths || 1,
        monthlyCapitals: u.monthlyCapitals || getDefaultMonthlyCapital(5000),
        createdAt: u.createdAt
      }));

      const enrichedPatterns = (db.receiptPatterns || []).map((p: any) => enrichReceiptPattern(p));

      return NextResponse.json({
        success: true,
        message: 'Snapshot integral importado con éxito: configuraciones generales, motor OCR, perfiles de usuarios y base de patrones de comprobantes 100% operativos.',
        imported: {
          settings: hasSettings || hasMotorOcr,
          users: hasUsers ? (db.users || []).length : 0,
          operators: hasUsers ? (db.users || []).filter((u: any) => u.role !== 'admin').length : 0,
          receiptPatterns: hasPatterns ? (db.receiptPatterns || []).length : 0,
          activeOcrProvider: db.settings.aiProvider,
          configuredOcrKeys: configuredKeysList,
          systemLicenseKey: db.settings.systemLicenseKey || db.settings.licenseKey
        },
        activeAdmin: activeAdminUser,
        settings: safeSettings,
        users: allUsers,
        receiptPatterns: enrichedPatterns,
        persistence: persistenceInfo(),
      });
    }

    // VERIFICACIÓN DE CONEXIÓN CON EL PROVEEDOR OCR/IA (solo admin)
    if (testProvider) {
      if (currentUser?.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'Acceso restringido: Solo el administrador puede verificar el motor OCR' }, { status: 403 });
      }
      const provider = ALLOWED_PROVIDERS.includes(testProvider) ? testProvider : 'openai';
      const storedKeys = getStoredOcrKeys(db);
      const resolvedTestKey = (provider === 'tesseract') ? '' : String(testApiKey ?? storedKeys[provider] ?? '').trim();
      const result = await testProviderConnection(provider, resolvedTestKey, storedKeys);
      return NextResponse.json(result);
    }

    // RESET DIRECTO DE CAPITAL (Admin o propio usuario)
    if (resetCapital && currentUser) {
      const perm = checkWritePermission(request, db);
      if (!perm.allowed) {
        return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
      }

      let target: any = currentUser;
      if (resetCapital.targetUserId && currentUser.role === 'admin' && resetCapital.targetUserId !== currentUser.id) {
        target = db.users.find((u: any) => u.id === resetCapital.targetUserId);
        if (!target) return NextResponse.json({ success: false, error: 'Usuario no encontrado' }, { status: 404 });
      }

      const baseCapitals: any = { ...(target.monthlyCapitals || {}) };
      const requestedKeys = Array.isArray(resetCapital.monthKeys) ? resetCapital.monthKeys : [];
      const keysToReset = requestedKeys.map((k: any) => String(k)).filter((k: string) => /^\d{4}-\d{2}$/.test(k));

      if (keysToReset.length > 0) {
        keysToReset.forEach((key: string) => {
          const [year, month] = key.split('-').map(Number);
          baseCapitals[key] = { monthIndex: month, monthName: baseCapitals[key]?.monthName || MONTH_NAMES[month - 1] || '', year, capital: 0 };
        });
      } else {
        Object.keys(baseCapitals).forEach((key: string) => { baseCapitals[key] = { ...baseCapitals[key], capital: 0 }; });
        const startYear = new Date().getFullYear();
        for (let year = startYear; year <= startYear + 5; year++) {
          for (let month = 1; month <= 12; month++) {
            const key = `${year}-${String(month).padStart(2, '0')}`;
            baseCapitals[key] = { monthIndex: month, monthName: MONTH_NAMES[month - 1] || '', year, capital: 0 };
          }
        }
      }

      target.monthlyCapitals = baseCapitals;
      if (target.role === 'admin') db.settings.ecommerceCapital = 0;
      await saveStateForRequest(request, db);
      if (hasDatabase()) await syncAdminStateToNormalized(db).catch(() => {});
      return NextResponse.json({ success: true, message: 'Capital reseteado exitosamente', monthlyCapitals: target.monthlyCapitals, persistence: persistenceInfo() });
    }

    // GESTIÓN DE CAPITAL MENSUAL POR EL USUARIO FINAL (O ADMIN PARA SU PROPIA CUENTA)
    if (userMonthlyCapitals && currentUser) {
      const perm = checkWritePermission(request, db);
      if (!perm.allowed) return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });

      const normalizedCapitals: any = {};
      Object.entries(userMonthlyCapitals).forEach(([monthKey, value]: [string, any]) => {
        if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
        const capital = Number(value?.capital);
        if (!Number.isFinite(capital) || capital < 0) return;
        normalizedCapitals[monthKey] = {
          monthIndex: Number(value?.monthIndex) || Number(monthKey.slice(5, 7)),
          monthName: value?.monthName || '',
          year: Number(value?.year) || Number(monthKey.slice(0, 4)),
          capital
        };
      });

      currentUser.monthlyCapitals = { ...(currentUser.monthlyCapitals || {}), ...normalizedCapitals };
      await saveStateForRequest(request, db);
      if (hasDatabase()) await syncAdminStateToNormalized(db).catch(() => {});
      return NextResponse.json({ success: true, message: 'Capital mensual actualizado exitosamente', monthlyCapitals: currentUser.monthlyCapitals, persistence: persistenceInfo() });
    }

    // ACCIÓN ADMINISTRATIVA: Modificar usuario final por el Administrador
    if (updateUserAction && targetUserId) {
      if (currentUser?.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'No autorizado. Solo el administrador puede modificar usuarios.' }, { status: 403 });
      }
      const target: any = db.users.find((u: any) => u.id === targetUserId);
      if (!target) return NextResponse.json({ success: false, error: 'Usuario a editar no encontrado' }, { status: 404 });

      if (updateUserAction === 'delete') {
        if (target.role === 'admin') return NextResponse.json({ success: false, error: 'No se puede eliminar el usuario administrador maestro' }, { status: 400 });
        const before = { ...target };
        db.users = db.users.filter((u: any) => u.id !== targetUserId);
        await saveStateForRequest(request, db);
        if (hasDatabase()) { await syncAdminStateToNormalized(db).catch(() => {}); await logAudit({ entity: 'User', entityId: targetUserId, action: 'DELETE', before, after: null, actorLegacyId: currentUser?.id }).catch(() => {}); }
        return NextResponse.json({ success: true, message: 'Usuario eliminado exitosamente', persistence: persistenceInfo() });
      }

      if (updateUserAction === 'edit') {
        const before = { ...target };
        if (updatedName) target.name = String(updatedName).trim();
        if (updatedCompanyName !== undefined) target.companyName = String(updatedCompanyName || '').trim();
        if (updatedAddress !== undefined) target.address = String(updatedAddress || '').trim();
        if (updatedPhone !== undefined) target.phone = String(updatedPhone || '').trim();
        if (updatedPassword) {
          if (isSupabaseConfigured()) {
            const admin = getSupabaseAdminClientOrNull();
            if (!admin) {
              return NextResponse.json({ success: false, error: 'Supabase admin no configurado' }, { status: 503 });
            }
            const { error: passwordError } = await admin.auth.admin.updateUserById(targetUserId, {
              password: String(updatedPassword).trim(),
            });
            if (passwordError) {
              return NextResponse.json({ success: false, error: passwordError.message }, { status: 400 });
            }
          }
          target.passwordHash = await hashPassword(String(updatedPassword).trim());
          delete target.password;
          delete target.passwordLegacy;
        }
        if (updatedLicenseKey) target.licenseKey = String(updatedLicenseKey).trim().toUpperCase();
        if (updatedMonths) {
          const months = parseInt(String(updatedMonths), 10) || 1;
          const now = new Date();
          const expiresAt = new Date(now);
          expiresAt.setMonth(expiresAt.getMonth() + months);
          target.licenseDurationMonths = months;
          target.licenseExpiresAt = expiresAt.toISOString();
          if (!target.licenseAssignedAt) target.licenseAssignedAt = now.toISOString();
        }
        await saveStateForRequest(request, db);
        if (hasDatabase()) { await syncAdminStateToNormalized(db).catch(() => {}); await logAudit({ entity: 'User', entityId: targetUserId, action: 'UPDATE', before, after: { ...target }, actorLegacyId: currentUser?.id }).catch(() => {}); }
        const safeUser = { ...target };
        delete safeUser.password;
        delete safeUser.passwordHash;
        delete safeUser.passwordLegacy;
        return NextResponse.json({ success: true, message: 'Usuario y licencia actualizados correctamente', user: safeUser, persistence: persistenceInfo() });
      }
    }

    // PARÁMETROS GENERALES DEL ADMINISTRADOR (Solo Administrador Maestro)
    if (currentUser?.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Acceso restringido: Solo el administrador puede modificar parámetros del sistema' }, { status: 403 });
    }

    const beforeSettings = JSON.parse(JSON.stringify(db.settings || {}));
    if (companyName) db.settings.companyName = String(companyName).trim();
    if (timezone) db.settings.timezone = String(timezone).trim();
    if (currency) db.settings.currency = String(currency).trim();
    if (aiProvider && ALLOWED_PROVIDERS.includes(aiProvider)) db.settings.aiProvider = aiProvider;

    const storedKeys = getStoredOcrKeys(db);
    const nextKeys = { ...storedKeys };
    const src = (incomingOcrKeys && typeof incomingOcrKeys === 'object') ? incomingOcrKeys : {};
    const setIfProvided = (providerKey: string, value: any) => {
      if (Object.prototype.hasOwnProperty.call(src, providerKey)) {
        nextKeys[providerKey] = typeof value === 'string' ? value.trim() : '';
      }
    };
    setIfProvided('openai', src.openai);
    setIfProvided('gemini', src.gemini);
    setIfProvided('ocrspace', src.ocrspace);

    if (aiApiKey !== undefined && aiApiKey !== '' && (aiProvider === 'openai' || aiProvider === 'gemini')) {
      nextKeys[aiProvider] = String(aiApiKey).trim();
    }
    if (ocrSpaceApiKey !== undefined && ocrSpaceApiKey !== '' && aiProvider === 'ocrspace') {
      nextKeys.ocrspace = String(ocrSpaceApiKey).trim();
    }

    db.settings.ocrApiKeys = { openai: nextKeys.openai || '', gemini: nextKeys.gemini || '', ocrspace: nextKeys.ocrspace || '', tesseract: '' };
    db.settings.ocrSpaceApiKey = db.settings.ocrApiKeys.ocrspace;
    db.settings.aiApiKey = db.settings.ocrApiKeys.openai || db.settings.ocrApiKeys.gemini || '';

    // Parámetros avanzados del motor OCR: endpoints, modelos y umbrales
    if (ocrEndpoints && typeof ocrEndpoints === 'object') {
      db.settings.ocrEndpoints = {
        ...DEFAULT_OCR_ENDPOINTS,
        ...(db.settings.ocrEndpoints || {}),
        ...ocrEndpoints
      };
    }
    if (ocrModels && typeof ocrModels === 'object') {
      db.settings.ocrModels = {
        ...DEFAULT_OCR_MODELS,
        ...(db.settings.ocrModels || {}),
        ...ocrModels
      };
    }
    if (ocrThresholds && typeof ocrThresholds === 'object') {
      db.settings.ocrThresholds = {
        ...DEFAULT_OCR_THRESHOLDS,
        ...(db.settings.ocrThresholds || {}),
        ...ocrThresholds
      };
    }
    if (ocrConfidenceMin !== undefined) {
      const parsedMin = Number(ocrConfidenceMin);
      if (Number.isFinite(parsedMin) && parsedMin >= 0 && parsedMin <= 1) {
        db.settings.ocrConfidenceMin = parsedMin;
        if (!db.settings.ocrThresholds) db.settings.ocrThresholds = { ...DEFAULT_OCR_THRESHOLDS };
        db.settings.ocrThresholds.ocrConfidenceMin = parsedMin;
      }
    }
    if (aiRoutingRules && typeof aiRoutingRules === 'object') {
      db.settings.aiRoutingRules = {
        ...DEFAULT_AI_ROUTING_RULES,
        ...aiRoutingRules
      };
    }
    if (aiAutoAssignEnabled !== undefined) {
      db.settings.aiAutoAssignEnabled = Boolean(aiAutoAssignEnabled);
    }
    if (systemLicenseKey && String(systemLicenseKey).trim()) {
      const cleanLic = String(systemLicenseKey).trim();
      db.settings.systemLicenseKey = cleanLic;
      db.settings.licenseKey = cleanLic;
    }

    db.settings.providerConfig = {
      endpoints: db.settings.ocrEndpoints || { ...DEFAULT_OCR_ENDPOINTS },
      models: db.settings.ocrModels || { ...DEFAULT_OCR_MODELS },
      thresholds: db.settings.ocrThresholds || { ...DEFAULT_OCR_THRESHOLDS }
    };

    if (trustLevelConfig !== undefined) {
      db.settings.trustLevelConfig = normalizeTrustConfig(trustLevelConfig);
    }

    if (adminPassword && String(adminPassword).length >= 4) {
      if (isSupabaseConfigured() && currentUser?.id) {
        const admin = getSupabaseAdminClientOrNull();
        if (!admin) {
          return NextResponse.json({ success: false, error: 'Supabase admin no configurado' }, { status: 503 });
        }
        const { error: adminPasswordError } = await admin.auth.admin.updateUserById(currentUser.id, {
          password: String(adminPassword),
        });
        if (adminPasswordError) {
          return NextResponse.json({ success: false, error: adminPasswordError.message }, { status: 400 });
        }
      }
      const adminHash = await hashPassword(String(adminPassword));
      db.settings.adminPasswordHash = adminHash;
      delete db.settings.adminPassword;
      delete db.settings.adminPasswordLegacy;
      const adminUser: any = db.users.find((u: any) => u.role === 'admin');
      if (adminUser) {
        adminUser.passwordHash = adminHash;
        delete adminUser.password;
        delete adminUser.passwordLegacy;
      }
    }

    const saveResult = await saveStateForRequestWithResult(request, db);
    if (!saveResult.ok) {
      console.error('[settings] Error al persistir configuración general:', saveResult.error || saveResult);
      return NextResponse.json({
        success: false,
        error: `No se pudo guardar la configuración: ${saveResult.error || 'falló la escritura en el almacén de datos.'}`,
        persistence: (saveResult as any).diagnostics || persistenceInfo(),
      }, { status: 500 });
    }
    if (hasDatabase()) {
      await ensureAdminConfigSeed().catch(() => {});
      await syncAdminStateToNormalized(db).catch(() => {});
      await logAudit({ entity: 'AdminSetting', entityId: 'main', action: 'UPDATE', before: beforeSettings, after: db.settings, actorLegacyId: currentUser?.id }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      message: 'Parámetros del sistema y proveedor OCR actualizados exitosamente',
      persistence: persistenceInfo(),
    });
  } catch (error) {
    console.error('Settings POST error:', error);
    return NextResponse.json({ success: false, error: 'Error al guardar configuración' }, { status: 500 });
  }
}
