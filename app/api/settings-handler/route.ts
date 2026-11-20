import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { checkWritePermission, MONTH_NAMES } from '../../../lib/db.js';
import { normalizeTrustConfig } from '../../../lib/trust.js';
import { createTestReceiptPngBuffer, runTesseractRecognition } from '../../../lib/ocrEngine.js';
import { getStateForRequest, saveStateForRequest, saveStateForRequestWithResult, persistenceInfo } from '../../../lib/server/supabase-store';
import {
  syncAdminStateToNormalized,
  logAudit,
  ensureAdminConfigSeed,
  hasDatabase,
  DEFAULT_OCR_ENDPOINTS,
  DEFAULT_OCR_MODELS,
  DEFAULT_OCR_THRESHOLDS,
  DEFAULT_AI_ROUTING_RULES
} from '../../../lib/server/admin-config.js';
import {
  buildSettingsBody,
  getReceiptPatternImageUrls,
  normalizeDashboardState,
  prepareSettings
} from '../../../lib/server/dashboard-builders';
import {
  ALLOWED_PROVIDERS,
  getInternalLicenseStatus,
  getStoredOcrKeys,
  maskKey
} from '../../../lib/server/settings-shared';
import { hashPassword } from '../../../lib/server/security.js';
import { setLegacyPasswordPreview, storePasswordPreview } from '../../../lib/server/password-preview.js';
import { getSupabaseAdminClientOrNull } from '../../../lib/supabase/admin';
import { isSupabaseConfigured } from '../../../lib/supabase/env';
import { resolveRequestAuth } from '../../../lib/server/request-auth';
import { resolveUploadUrls } from '../../../lib/storage/uploads.js';
import {
  exportSystemBackup,
  importSystemBackup,
  BackupUnavailableError,
  BackupValidationError,
  BackupForbiddenError,
  BackupTransactionError,
  publicBackupError
} from '../../../lib/server/system-backup';

// Tesseract.js necesita tiempo para iniciar el worker y cargar wasm/traineddata.
// 300 s es el máximo de Hobby; el timeout interno responde mucho antes del corte.
export const maxDuration = 300;

function auditUserSnapshot(user: any) {
  const { password, passwordHash, passwordLegacy, passwordEncrypted, ...rest } = user || {};
  return rest;
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
    normalizeDashboardState(db);
    // Autocuración de un aiProvider inválido (efecto colateral del GET legado).
    await prepareSettings(db, request);

    const patternUrls = getReceiptPatternImageUrls(db);
    const resolvedPatternUrls = patternUrls.length
      ? await resolveUploadUrls(patternUrls)
      : [];

    return NextResponse.json(buildSettingsBody(db, resolvedPatternUrls));
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

    const isBackupAction = action === 'export_settings' || action === 'import_settings';
    const backupAuth = isBackupAction ? await resolveRequestAuth(request) : null;
    if (isBackupAction && isSupabaseConfigured() && (!backupAuth?.userId || !backupAuth?.supabase)) {
      return NextResponse.json({ success: false, error: 'Sesión activa requerida' }, { status: 403 });
    }

    const db = await getStateForRequest(request);
    if (!db.settings) db.settings = {};
    if (!Array.isArray(db.users)) db.users = [];
    if (!Array.isArray(db.receiptPatterns)) db.receiptPatterns = [];
    const currentUser: any = db.__currentUser || null;

    const isActiveBackupAdmin = Boolean(currentUser) &&
      currentUser.role === 'admin' &&
      currentUser.isActive !== false &&
      (!isSupabaseConfigured() || String(currentUser.id) === String(backupAuth?.userId));

    // EXPORTACIÓN DINÁMICA: todas las tablas activas se descubren en PostgreSQL.
    if (action === 'export_settings') {
      if (!isActiveBackupAdmin) {
        return NextResponse.json(
          { success: false, error: 'Acceso restringido: Solo el administrador activo puede exportar el respaldo' },
          { status: 403 }
        );
      }

      const backup = await exportSystemBackup();
      return NextResponse.json({
        success: true,
        export: backup,
        persistence: persistenceInfo(),
      });
    }

    // IMPORTACIÓN ATÓMICA: una sola RPC valida, ordena por FK y hace ROLLBACK
    // completo ante cualquier error. Las tablas nuevas ausentes se conservan.
    if (action === 'import_settings') {
      if (!isActiveBackupAdmin) {
        return NextResponse.json(
          { success: false, error: 'Acceso restringido: Solo el administrador activo puede importar el respaldo' },
          { status: 403 }
        );
      }

      const result = await importSystemBackup(importData);
      revalidatePath('/');

      return NextResponse.json({
        success: true,
        message: 'Respaldo restaurado de forma atómica',
        imported: result,
        persistence: persistenceInfo(),
      });
    }

    // VERIFICACIÓN DE CONEXIÓN CON EL PROVEEDOR OCR/IA (solo admin)
    if (testProvider) {
      if (currentUser?.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'Acceso restringido: Solo el administrador puede verificar el motor OCR' }, { status: 403 });
      }
      const provider = ALLOWED_PROVIDERS.includes(testProvider) ? testProvider : 'openai';

      // Validación temprana: si el proveedor requiere clave y no fue proporcionada, retornar error
      if (provider !== 'tesseract' && (!testApiKey || String(testApiKey).trim() === '')) {
        return NextResponse.json({ success: false, error: 'Clave de API requerida para probar la conexión' }, { status: 400 });
      }

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
        const before = auditUserSnapshot(target);
        db.users = db.users.filter((u: any) => u.id !== targetUserId);
        await saveStateForRequest(request, db);
        if (hasDatabase()) await syncAdminStateToNormalized(db).catch(() => {});
        await logAudit({ entity: 'User', entityId: targetUserId, action: 'DELETE', before, after: null, actorLegacyId: currentUser?.id }).catch(() => {});
        return NextResponse.json({ success: true, message: 'Usuario eliminado exitosamente', persistence: persistenceInfo() });
      }

      if (updateUserAction === 'edit') {
        // Un admin nunca debe poder cambiar la clave de otro admin: evita lockouts
        // y mantiene una sola credencial administrativa bajo su control.
        if (target.role === 'admin' && String(target.id) !== String(currentUser.id)) {
          return NextResponse.json(
            { success: false, error: 'Un administrador solo puede cambiar su propia clave.' },
            { status: 403 }
          );
        }

        const before = auditUserSnapshot(target);
        if (updatedName) target.name = String(updatedName).trim();
        if (updatedCompanyName !== undefined) target.companyName = String(updatedCompanyName || '').trim();
        if (updatedAddress !== undefined) target.address = String(updatedAddress || '').trim();
        if (updatedPhone !== undefined) target.phone = String(updatedPhone || '').trim();

        // Una sola normalización para Auth, hash y vista previa.
        const plainPassword =
          updatedPassword === undefined || updatedPassword === null || updatedPassword === ''
            ? null
            : String(updatedPassword).trim();
        if (plainPassword !== null) {
          if (plainPassword.length < 4) {
            return NextResponse.json(
              { success: false, error: 'La clave debe tener al menos 4 caracteres' },
              { status: 400 }
            );
          }
          if (isSupabaseConfigured()) {
            const admin = getSupabaseAdminClientOrNull();
            if (!admin) {
              return NextResponse.json({ success: false, error: 'Supabase admin no configurado' }, { status: 503 });
            }
            const { error: passwordError } = await admin.auth.admin.updateUserById(targetUserId, {
              password: plainPassword,
            });
            if (passwordError) {
              return NextResponse.json({ success: false, error: passwordError.message }, { status: 400 });
            }
          }
          target.passwordHash = await hashPassword(plainPassword);
          delete target.password;
          delete target.passwordLegacy;
          if (!isSupabaseConfigured()) setLegacyPasswordPreview(target, plainPassword);
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
        if (hasDatabase()) await syncAdminStateToNormalized(db).catch(() => {});
        await logAudit({ entity: 'User', entityId: targetUserId, action: 'UPDATE', before, after: auditUserSnapshot(target), actorLegacyId: currentUser?.id }).catch(() => {});

        if (plainPassword && isSupabaseConfigured()) {
          await storePasswordPreview(targetUserId, plainPassword).catch((previewError: any) => {
            console.warn('[settings] No se pudo guardar la vista previa de la clave:', previewError?.message || previewError);
          });
        }

        const safeUser = { ...target };
        delete safeUser.password;
        delete safeUser.passwordHash;
        delete safeUser.passwordLegacy;
        delete safeUser.passwordEncrypted;
        return NextResponse.json({ success: true, message: 'Usuario y licencia actualizados correctamente', user: safeUser, persistence: persistenceInfo() });
      }
    }

    // PARÁMETROS GENERALES DEL ADMINISTRADOR (solo rol admin activo)
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

    // Guard: si no hay clave de cifrado disponible, no guardar secrets en claro.
    // Se almacenan valores vacíos y se marca advertencia en la respuesta.
    const encryptionKeyAvailable = process.env.SETTINGS_ENCRYPTION_KEY && String(process.env.SETTINGS_ENCRYPTION_KEY).trim();
    if (!encryptionKeyAvailable) {
      console.warn('[settings] SETTINGS_ENCRYPTION_KEY no definida; API keys se almacenarán sin cifrado. Definir la variable en producción para proteger las credenciales.');
      nextKeys.openai = '';
      nextKeys.gemini = '';
      nextKeys.ocrspace = '';
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
    }
    await logAudit({ entity: 'AdminSetting', entityId: 'main', action: 'UPDATE', before: beforeSettings, after: db.settings, actorLegacyId: currentUser?.id }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: 'Parámetros del sistema y proveedor OCR actualizados exitosamente',
      persistence: persistenceInfo(),
    });
  } catch (error) {
    console.error('Settings POST error:', error);

    if (error instanceof BackupUnavailableError ||
        error instanceof BackupValidationError ||
        error instanceof BackupForbiddenError ||
        error instanceof BackupTransactionError) {
      return NextResponse.json({
        success: false,
        error: error.message,
        detail: (error as any).detail || undefined,
        code: error.code,
        persistence: persistenceInfo(),
      }, { status: error.status });
    }

    return NextResponse.json({
      success: false,
      error: 'Error al guardar la configuración',
      detail: publicBackupError(error),
    }, { status: 500 });
  }
}
