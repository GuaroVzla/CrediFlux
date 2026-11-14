import { NextResponse } from 'next/server';
import { getDb, saveDb, checkWritePermission, getDefaultMonthlyCapital } from '../../lib/db.js';
import { getTrustLevelConfig, normalizeTrustConfig } from '../../lib/trust.js';

const ALLOWED_PROVIDERS = ['openai', 'gemini', 'ocrspace'];

function maskKey(key: string | undefined) {
  if (!key) return '';
  const value = String(key);
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function testProviderConnection(provider: string, apiKey: string | undefined) {
  if (!apiKey || !apiKey.trim()) {
    return { success: false, error: 'Debes ingresar una API Key para probar la conexión' };
  }

  const key = apiKey.trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    if (provider === 'ocrspace') {
      const testUrl = 'https://i.imgur.com/8km9tLL.png';
      const response = await fetch('https://api.ocr.space/parse/imageurl?apikey=' + encodeURIComponent(key) + '&url=' + encodeURIComponent(testUrl), {
        signal: controller.signal
      });
      const data: any = await response.json().catch(() => null);
      if (!data) {
        return { success: false, error: 'Respuesta inválida del servidor de OCR.space' };
      }

      if (data.OCRExitCode === 99 || data.IsErroredOnProcessing) {
        const detail = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(' ') : String(data.ErrorMessage || '');
        // Distinguir errores de clave (E5xx / "API key") de errores de la imagen de prueba (E2xx)
        if (/e5\d\d/i.test(detail) || /api\s*key|apikey|unauthorized|invalid user/i.test(detail)) {
          return { success: false, error: detail || 'La API Key de OCR.space no es válida' };
        }
        // La clave fue aceptada; la imagen de prueba no pudo procesarse
        return { success: true, message: 'Conexión exitosa con OCR.space (clave aceptada)' };
      }

      return { success: true, message: 'Conexión exitosa con OCR.space' };
    }

    if (provider === 'gemini') {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key), {
        signal: controller.signal
      });
      if (!response.ok) {
        const detail: any = await response.json().catch(() => null);
        return { success: false, error: detail?.error?.message || 'La API Key de Google Gemini no es válida' };
      }
      return { success: true, message: 'Conexión exitosa con Google Gemini' };
    }

    // openai (default)
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: 'Bearer ' + key },
      signal: controller.signal
    });
    if (!response.ok) {
      const detail: any = await response.json().catch(() => null);
      return { success: false, error: detail?.error?.message || 'La API Key de OpenAI no es válida' };
    }
    return { success: true, message: 'Conexión exitosa con OpenAI' };
  } catch (error: any) {
    return {
      success: false,
      error: error?.name === 'AbortError'
        ? 'Tiempo de espera agotado al verificar la conexión'
        : 'No se pudo verificar la conexión: ' + (error?.message || 'error de red')
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

    // Para cualquier usuario, determinamos su capital mensual actual
    const currentMonthKey = new Date().toISOString().slice(0, 7);
    const userCurrentCapital = currentUser?.monthlyCapitals?.[currentMonthKey]?.capital
      ?? db.settings?.ecommerceCapital
      ?? 5000;

    const safeSettings: any = {
      currency: db.settings?.currency || '$',
      ecommerceCapital: userCurrentCapital,
      aiProvider: db.settings?.aiProvider || 'openai',
      // Configuración global de niveles de confianza (necesaria para todos los usuarios)
      trustLevelConfig: getTrustLevelConfig(db.settings)
    };

    // Si es administrador, tiene acceso completo a configuración de IA y lista completa de usuarios con claves y licencias
    if (isAdmin) {
      safeSettings.hasAiKey = Boolean(db.settings?.aiApiKey);
      safeSettings.aiApiKeyMasked = maskKey(db.settings?.aiApiKey);
      safeSettings.hasOcrSpaceKey = Boolean(db.settings?.ocrSpaceApiKey);
      safeSettings.ocrSpaceKeyMasked = maskKey(db.settings?.ocrSpaceApiKey);
      safeSettings.adminPassword = db.settings?.adminPassword;
      safeSettings.licenseKey = db.settings?.licenseKey;

      // Lista completa de todos los usuarios con empresa, contraseñas, licencias, caducidad, etc.
      const allUsers = db.users.map((u: any) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        companyName: u.companyName || 'Sin empresa asignada',
        role: u.role,
        address: u.address || '',
        phone: u.phone || '',
        password: u.password, // Visible solo para el admin
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

    // Si es usuario final, enviamos su información personal y su tabla mensual de capital
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
      // Configuración global de niveles de confianza (solo Admin)
      trustLevelConfig,
      // Acción de usuario final: Actualizar capitales mensuales
      userMonthlyCapitals,
      // Acción de verificación previa de conectividad
      testProviderConnection: testProvider,
      testApiKey,
      // Acciones de gestión de usuarios por el Admin
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

    // VERIFICACIÓN DE CONEXIÓN CON EL PROVEEDOR DE IA (solo admin)
    if (testProvider) {
      if (currentUser?.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'Acceso restringido: Solo el administrador puede verificar el motor de IA' }, { status: 403 });
      }
      const provider = ALLOWED_PROVIDERS.includes(testProvider) ? testProvider : 'openai';
      const result = await testProviderConnection(provider, testApiKey);
      return NextResponse.json(result);
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
    if (aiProvider && ALLOWED_PROVIDERS.includes(aiProvider)) db.settings.aiProvider = aiProvider;
    if (aiApiKey !== undefined && aiApiKey !== '') db.settings.aiApiKey = aiApiKey.trim();
    if (ocrSpaceApiKey !== undefined && ocrSpaceApiKey !== '') db.settings.ocrSpaceApiKey = ocrSpaceApiKey.trim();

    // Reglas y umbrales globales de confianza de clientes
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
      message: 'Parámetros del sistema y proveedor de IA actualizados exitosamente'
    });
  } catch (error) {
    console.error('Settings POST error:', error);
    return NextResponse.json({ success: false, error: 'Error al guardar configuración' }, { status: 500 });
  }
}
