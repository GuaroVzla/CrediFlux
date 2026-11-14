import { NextResponse } from 'next/server';
import { getDb, saveDb, checkWritePermission, getDefaultMonthlyCapital, MONTH_NAMES } from '../../lib/db.js';
import { getTrustLevelConfig, normalizeTrustConfig } from '../../lib/trust.js';
import { INTERNAL_OCR_CONFIG, createTestReceiptPngBuffer, runTesseractRecognition } from '../../lib/ocrEngine.js';

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
  // Migración/compatibilidad: claves legacy compartidas
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
  const cfg: any = INTERNAL_OCR_CONFIG?.[provider as keyof typeof INTERNAL_OCR_CONFIG];
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
      if (!key) {
        return { success: false, error: 'Debes ingresar una API Key para probar la conexión', responseTimeMs: elapsed() };
      }
      const testUrl = 'https://i.imgur.com/8km9tLL.png';
      const response = await fetch('https://api.ocr.space/parse/imageurl?apikey=' + encodeURIComponent(key) + '&url=' + encodeURIComponent(testUrl), {
        signal: controller.signal
      });
      const data: any = await response.json().catch(() => null);
      if (!data) {
        return { success: false, error: 'Respuesta inválida del servidor de OCR.space', responseTimeMs: elapsed() };
      }

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
      if (!key) {
        return { success: false, error: 'Debes ingresar una API Key para probar la conexión', responseTimeMs: elapsed() };
      }
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key), {
        signal: controller.signal
      });
      if (!response.ok) {
        const detail: any = await response.json().catch(() => null);
        return { success: false, error: detail?.error?.message || 'La API Key de Google Gemini no es válida', responseTimeMs: elapsed() };
      }
      return { success: true, message: 'Conexión exitosa con Google Gemini', responseTimeMs: elapsed() };
    }

    if (provider === 'openai') {
      if (!key) {
        return { success: false, error: 'Debes ingresar una API Key para probar la conexión', responseTimeMs: elapsed() };
      }
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: 'Bearer ' + key },
        signal: controller.signal
      });
      if (!response.ok) {
        const detail: any = await response.json().catch(() => null);
        return { success: false, error: detail?.error?.message || 'La API Key de OpenAI no es válida', responseTimeMs: elapsed() };
      }
      return { success: true, message: 'Conexión exitosa con OpenAI', responseTimeMs: elapsed() };
    }

    // Proveedor interno: Tesseract.js (motor local, sin clave ni límites)
    if (provider === 'tesseract') {
      try {
        const testImage = createTestReceiptPngBuffer();
        // Prueba real: inicializa worker (rutas locales configuradas) y procesa imagen mínima en memoria
        const rec = await Promise.race([
          runTesseractRecognition(testImage, 'eng', { logger: () => {} }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado inicializando/procesando con Tesseract.js (carga de worker/core/traineddata)')), 45000))
        ]) as any;

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
          internalLicense: getInternalLicenseStatus(provider)
        };
      }
    }



    return { success: false, error: 'Proveedor OCR no soportado', responseTimeMs: elapsed() };
  } catch (error: any) {
    return {
      success: false,
      error: error?.name === 'AbortError'
        ? 'Tiempo de espera agotado al verificar la conexión'
        : 'No se pudo verificar la conexión: ' + (error?.message || 'error de red'),
      responseTimeMs: elapsed(),
      internalLicense: getInternalLicenseStatus(provider)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const userId = request.headers.get('x-user-id');
    const currentUser = userId ? db.users.find((u: any) => u.id === userId) : null;
    const isAdmin = currentUser?.role === 'admin';

    const currentMonthKey = new Date().toISOString().slice(0, 7);
    const userCurrentCapital = currentUser?.monthlyCapitals?.[currentMonthKey]?.capital
      ?? db.settings?.ecommerceCapital
      ?? 5000;

    const rawProvider = db.settings?.aiProvider;
    const activeProvider = ALLOWED_PROVIDERS.includes(rawProvider) ? rawProvider : 'openai';
    // Si había un proveedor eliminado (p.ej. hf_ocr) seleccionado, normalizar a uno válido
    if (rawProvider && !ALLOWED_PROVIDERS.includes(rawProvider)) {
      db.settings.aiProvider = activeProvider;
      try { saveDb(db); } catch {}
    }
    const ocrKeys = getStoredOcrKeys(db);

    const safeSettings: any = {
      currency: db.settings?.currency || '$',
      ecommerceCapital: userCurrentCapital,
      aiProvider: activeProvider,
      trustLevelConfig: getTrustLevelConfig(db.settings),
      internalOcrLicenses: {
        tesseract: getInternalLicenseStatus('tesseract')
      }
    };

    if (isAdmin) {
      // Compatibilidad legacy
      safeSettings.hasAiKey = Boolean(ocrKeys.openai || ocrKeys.gemini);
      safeSettings.aiApiKeyMasked = maskKey(ocrKeys.openai || ocrKeys.gemini);
      safeSettings.hasOcrSpaceKey = Boolean(ocrKeys.ocrspace);
      safeSettings.ocrSpaceKeyMasked = maskKey(ocrKeys.ocrspace);

      // Claves por proveedor (independientes) para autocompletado en MOTOR OCR
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

      safeSettings.adminPassword = db.settings?.adminPassword;
      safeSettings.licenseKey = db.settings?.licenseKey;
      safeSettings.monthlyCapitals = currentUser?.monthlyCapitals || {};

      const allUsers = db.users.map((u: any) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        companyName: u.companyName || 'Sin empresa asignada',
        role: u.role,
        address: u.address || '',
        phone: u.phone || '',
        password: u.password,
        licenseKey: u.licenseKey || 'N/A (Admin)',
        licenseAssignedAt: u.licenseAssignedAt || null,
        licenseExpiresAt: u.licenseExpiresAt || null,
        licenseDurationMonths: u.licenseDurationMonths || 1,
        monthlyCapitals: u.monthlyCapitals || getDefaultMonthlyCapital(5000),
        createdAt: u.createdAt
      }));

      return NextResponse.json({
        success: true,
        isAdmin: true,
        settings: safeSettings,
        users: allUsers,
        receiptPatterns: db.receiptPatterns || []
      });
    }

    return NextResponse.json({
      success: true,
      isAdmin: false,
      settings: safeSettings,
      receiptPatterns: db.receiptPatterns || [],
      currentUserInfo: currentUser ? {
        id: currentUser.id,
        username: currentUser.username,
        name: currentUser.name,
        companyName: currentUser.companyName || 'Mi Empresa',
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
      currency,
      adminPassword,
      aiProvider,
      aiApiKey,
      ocrSpaceApiKey,
      ocrKeys: incomingOcrKeys,
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
      updatedPhone
    } = body;

    const db = getDb();
    const userId = request.headers.get('x-user-id');
    const currentUser: any = db.users.find((u: any) => u.id === userId);

    // VERIFICACIÓN DE CONEXIÓN CON EL PROVEEDOR OCR/IA (solo admin)
    if (testProvider) {
      if (currentUser?.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'Acceso restringido: Solo el administrador puede verificar el motor OCR' }, { status: 403 });
      }
      const provider = ALLOWED_PROVIDERS.includes(testProvider) ? testProvider : 'openai';
      const storedKeys = getStoredOcrKeys(db);
      // Para la prueba se usa la clave enviada (campo autocompletado) o, si no se envía, la guardada del proveedor
      const resolvedTestKey = (provider === 'tesseract')
        ? ''
        : String(testApiKey ?? storedKeys[provider] ?? '').trim();
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
        if (!target) {
          return NextResponse.json({ success: false, error: 'Usuario no encontrado' }, { status: 404 });
        }
      }

      const baseCapitals: any = { ...(target.monthlyCapitals || {}) };
      const requestedKeys = Array.isArray(resetCapital.monthKeys) ? resetCapital.monthKeys : [];
      const keysToReset = requestedKeys
        .map((k: any) => String(k))
        .filter((k: string) => /^\d{4}-\d{2}$/.test(k));

      if (keysToReset.length > 0) {
        keysToReset.forEach((key: string) => {
          const [year, month] = key.split('-').map(Number);
          baseCapitals[key] = {
            monthIndex: month,
            monthName: baseCapitals[key]?.monthName || MONTH_NAMES[month - 1] || '',
            year,
            capital: 0
          };
        });
      } else {
        Object.keys(baseCapitals).forEach((key: string) => {
          baseCapitals[key] = { ...baseCapitals[key], capital: 0 };
        });
        const startYear = new Date().getFullYear();
        for (let year = startYear; year <= startYear + 5; year++) {
          for (let month = 1; month <= 12; month++) {
            const key = `${year}-${String(month).padStart(2, '0')}`;
            baseCapitals[key] = {
              monthIndex: month,
              monthName: MONTH_NAMES[month - 1] || '',
              year,
              capital: 0
            };
          }
        }
      }

      target.monthlyCapitals = baseCapitals;
      if (target.role === 'admin') {
        db.settings.ecommerceCapital = 0;
      }
      saveDb(db);

      return NextResponse.json({
        success: true,
        message: 'Capital reseteado exitosamente',
        monthlyCapitals: target.monthlyCapitals
      });
    }

    // GESTIÓN DE CAPITAL MENSUAL POR EL USUARIO FINAL (O ADMIN PARA SU PROPIA CUENTA)
    if (userMonthlyCapitals && currentUser) {
      const perm = checkWritePermission(request, db);
      if (!perm.allowed) {
        return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
      }

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

      currentUser.monthlyCapitals = {
        ...(currentUser.monthlyCapitals || {}),
        ...normalizedCapitals
      };
      saveDb(db);
      return NextResponse.json({
        success: true,
        message: 'Capital mensual actualizado exitosamente',
        monthlyCapitals: currentUser.monthlyCapitals
      });
    }

    // ACCIÓN ADMINISTRATIVA: Modificar usuario final por el Administrador
    if (updateUserAction && targetUserId) {
      if (currentUser?.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'No autorizado. Solo el administrador puede modificar usuarios.' }, { status: 403 });
      }

      const target: any = db.users.find((u: any) => u.id === targetUserId);
      if (!target) {
        return NextResponse.json({ success: false, error: 'Usuario a editar no encontrado' }, { status: 404 });
      }

      if (updateUserAction === 'delete') {
        if (target.role === 'admin') {
          return NextResponse.json({ success: false, error: 'No se puede eliminar el usuario administrador maestro' }, { status: 400 });
        }
        db.users = db.users.filter((u: any) => u.id !== targetUserId);
        saveDb(db);
        return NextResponse.json({ success: true, message: 'Usuario eliminado exitosamente' });
      }

      if (updateUserAction === 'edit') {
        if (updatedName) target.name = updatedName.trim();
        if (updatedCompanyName !== undefined) target.companyName = updatedCompanyName.trim();
        if (updatedAddress !== undefined) target.address = updatedAddress.trim();
        if (updatedPhone !== undefined) target.phone = updatedPhone.trim();
        if (updatedPassword) target.password = updatedPassword.trim();
        if (updatedLicenseKey) target.licenseKey = updatedLicenseKey.trim().toUpperCase();

        if (updatedMonths) {
          const months = parseInt(updatedMonths, 10) || 1;
          const now = new Date();
          const expiresAt = new Date(now);
          expiresAt.setMonth(expiresAt.getMonth() + months);
          target.licenseDurationMonths = months;
          target.licenseExpiresAt = expiresAt.toISOString();
        }

        saveDb(db);
        return NextResponse.json({ success: true, message: 'Usuario y licencia actualizados correctamente', user: target });
      }
    }

    // PARÁMETROS GENERALES DEL ADMINISTRADOR (Solo Administrador Maestro)
    if (currentUser?.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Acceso restringido: Solo el administrador puede modificar parámetros del sistema' }, { status: 403 });
    }

    if (currency) db.settings.currency = currency.trim();

    if (aiProvider && ALLOWED_PROVIDERS.includes(aiProvider)) {
      db.settings.aiProvider = aiProvider;
    }

    // Persistencia independiente de credenciales por proveedor
    const storedKeys = getStoredOcrKeys(db);
    const nextKeys = { ...storedKeys };
    const src = (incomingOcrKeys && typeof incomingOcrKeys === 'object') ? incomingOcrKeys : {};

    const setIfProvided = (providerKey: string, value: any) => {
      // Solo se actualiza si el cliente envía explícitamente la propiedad (permite conservar no enviadas)
      if (Object.prototype.hasOwnProperty.call(src, providerKey)) {
        nextKeys[providerKey] = typeof value === 'string' ? value.trim() : '';
      }
    };

    setIfProvided('openai', src.openai);
    setIfProvided('gemini', src.gemini);
    setIfProvided('ocrspace', src.ocrspace);

    // Compatibilidad con payloads legacy (campo único según proveedor seleccionado)
    if (aiApiKey !== undefined && aiApiKey !== '' && (aiProvider === 'openai' || aiProvider === 'gemini')) {
      nextKeys[aiProvider] = String(aiApiKey).trim();
    }
    if (ocrSpaceApiKey !== undefined && ocrSpaceApiKey !== '' && aiProvider === 'ocrspace') {
      nextKeys.ocrspace = String(ocrSpaceApiKey).trim();
    }

    db.settings.ocrApiKeys = {
      openai: nextKeys.openai || '',
      gemini: nextKeys.gemini || '',
      ocrspace: nextKeys.ocrspace || ''
    };
    // Mantener campos legacy sincronizados para compatibilidad con lecturas antiguas
    db.settings.ocrSpaceApiKey = db.settings.ocrApiKeys.ocrspace;
    db.settings.aiApiKey = db.settings.ocrApiKeys.openai || db.settings.ocrApiKeys.gemini || '';

    if (trustLevelConfig !== undefined) {
      db.settings.trustLevelConfig = normalizeTrustConfig(trustLevelConfig);
    }

    if (adminPassword && adminPassword.length >= 4) {
      db.settings.adminPassword = adminPassword;
      const adminUser: any = db.users.find((u: any) => u.role === 'admin');
      if (adminUser) adminUser.password = adminPassword;
    }

    saveDb(db);

    return NextResponse.json({
      success: true,
      message: 'Parámetros del sistema y proveedor OCR actualizados exitosamente'
    });
  } catch (error) {
    console.error('Settings POST error:', error);
    return NextResponse.json({ success: false, error: 'Error al guardar configuración' }, { status: 500 });
  }
}
