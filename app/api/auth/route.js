import { NextResponse } from 'next/server';
import { generateRandomLicense, isUserLicenseExpired, getDefaultMonthlyCapital } from '../../../lib/db.js';
import { getAppState, saveAppState, persistenceInfo } from '../../../lib/server/persistence.js';
import { hashPassword, verifyPassword, sanitizeUserForClient } from '../../../lib/server/security.js';

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      action,
      username,
      password,
      licenseKey,
      newPassword,
      name,
      companyName,
      address,
      phone,
      licenseDurationMonths,
      assignedLicenseKey,
      userId
    } = body;
    const db = await getAppState();
    if (!Array.isArray(db.users)) db.users = [];
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};

    // ACTION: LOGIN
    if (action === 'login') {
      const user = db.users.find(u => u.username?.toLowerCase() === String(username || '').trim().toLowerCase());

      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Usuario no encontrado' },
          { status: 401 }
        );
      }

      const stored = user.passwordHash || user.password || user.passwordLegacy || '';
      const ver = await verifyPassword(password, stored);
      if (!ver.ok) {
        return NextResponse.json(
          { success: false, error: 'Contraseña incorrecta' },
          { status: 401 }
        );
      }

      // Migración automática de legado (texto plano) a hash
      let migrated = false;
      if (ver.needsMigration || ver.legacy || (user.password && !user.passwordHash)) {
        user.passwordHash = await hashPassword(String(password || ''));
        delete user.password;
        delete user.passwordLegacy;
        if (user.role === 'admin') {
          db.settings.adminPasswordHash = user.passwordHash;
          delete db.settings.adminPassword;
          delete db.settings.adminPasswordLegacy;
        }
        migrated = true;
        await saveAppState(db);
      }

      const isExpired = user.role !== 'admin' && isUserLicenseExpired(user);

      // Obtener el capital del mes en curso para el usuario
      const currentMonthKey = new Date().toISOString().slice(0, 7);
      const userCurrentCapital = user.monthlyCapitals?.[currentMonthKey]?.capital ?? 5000;

      return NextResponse.json({
        success: true,
        message: 'Acceso autorizado',
        token: 'token_crediflux_' + Buffer.from(Date.now().toString()).toString('base64'),
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          address: user.address || '',
          phone: user.phone || '',
          licenseKey: user.licenseKey || '',
          licenseExpiresAt: user.licenseExpiresAt || null,
          licenseAssignedAt: user.licenseAssignedAt || null,
          monthlyCapitals: user.monthlyCapitals || getDefaultMonthlyCapital(5000),
          isExpired
        },
        settings: {
          currency: db.settings.currency,
          ecommerceCapital: userCurrentCapital
        },
        security: { passwordMigrated: migrated },
        persistence: persistenceInfo(),
      });
    }

    // ACTION: REGISTER USER (ESTRICTAMENTE RESTRINGIDO A ROL DE ADMINISTRADOR)
    if (action === 'register') {
      const requesterId = request.headers.get('x-user-id');
      const requester = db.users.find(u => u.id === requesterId);

      if (!requester || requester.role !== 'admin') {
        return NextResponse.json(
          { success: false, error: 'Acceso denegado: El registro de nuevos usuarios está reservado exclusivamente al Administrador.' },
          { status: 403 }
        );
      }

      if (!username || !password || !name) {
        return NextResponse.json(
          { success: false, error: 'Nombre y Apellido, Usuario y Clave son obligatorios' },
          { status: 400 }
        );
      }

      const existing = db.users.find(u => u.username?.toLowerCase() === String(username).trim().toLowerCase());
      if (existing) {
        return NextResponse.json(
          { success: false, error: 'El nombre de usuario ya está registrado' },
          { status: 400 }
        );
      }

      // Generar licencia automática aleatoria con fecha de caducidad en meses
      const months = parseInt(licenseDurationMonths, 10) || 1;
      const licenseObj = generateRandomLicense(months);
      const passwordHash = await hashPassword(String(password).trim());

      const newUser = {
        id: 'usr_' + Date.now(),
        username: String(username).trim(),
        name: String(name).trim(),
        address: address ? String(address).trim() : '',
        phone: phone ? String(phone).trim() : '',
        role: 'user', // Rol de usuario final
        passwordHash,
        licenseKey: assignedLicenseKey ? String(assignedLicenseKey).trim().toUpperCase() : licenseObj.licenseKey,
        licenseAssignedAt: licenseObj.assignedAt,
        licenseExpiresAt: licenseObj.expiresAt,
        licenseDurationMonths: months,
        monthlyCapitals: getDefaultMonthlyCapital(5000),
        createdAt: new Date().toISOString()
      };

      db.users.push(newUser);
      const saved = await saveAppState(db);
      if (!saved) {
        return NextResponse.json({
          success: false,
          error: 'No se pudo guardar el usuario en la base de datos. Verifica la configuración de persistencia (DATABASE_URL) o permisos de escritura y reintenta.'
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Usuario final ${newUser.name} registrado con éxito en CrediFlux.`,
        user: sanitizeUserForClient(newUser),
        persistence: persistenceInfo(),
      });
    }

    // ACTION: CHANGE PASSWORD (Para el usuario activo o admin)
    if (action === 'change_password') {
      if (!newPassword || String(newPassword).length < 4) {
        return NextResponse.json(
          { success: false, error: 'La nueva contraseña debe tener al menos 4 caracteres' },
          { status: 400 }
        );
      }

      const targetId = userId || 'usr_admin';
      const user = db.users.find(u => u.id === targetId || (targetId === 'usr_admin' && u.role === 'admin'));

      if (!user) {
        return NextResponse.json({ success: false, error: 'Usuario no encontrado' }, { status: 404 });
      }

      const newHash = await hashPassword(String(newPassword).trim());
      user.passwordHash = newHash;
      delete user.password;
      delete user.passwordLegacy;
      if (user.role === 'admin') {
        db.settings.adminPasswordHash = newHash;
        delete db.settings.adminPassword;
        delete db.settings.adminPasswordLegacy;
      }
      await saveAppState(db);

      return NextResponse.json({ success: true, message: 'Contraseña actualizada con éxito', persistence: persistenceInfo() });
    }

    // ACTION: RENEW / ACTIVATE LICENSE (Usuario final introduce nueva licencia o admin la renueva)
    if (action === 'activate_license') {
      if (!licenseKey || !String(licenseKey).trim()) {
        return NextResponse.json({ success: false, error: 'La clave de licencia es requerida' }, { status: 400 });
      }

      const targetId = userId;
      const user = db.users.find(u => u.id === targetId);
      if (!user) {
        return NextResponse.json({ success: false, error: 'Usuario no encontrado' }, { status: 404 });
      }

      const months = parseInt(licenseDurationMonths, 10) || 1;
      const now = new Date();
      const expiresAt = new Date(now);
      expiresAt.setMonth(expiresAt.getMonth() + months);

      user.licenseKey = String(licenseKey).trim().toUpperCase();
      user.licenseAssignedAt = now.toISOString();
      user.licenseExpiresAt = expiresAt.toISOString();
      user.licenseDurationMonths = months;

      await saveAppState(db);

      return NextResponse.json({
        success: true,
        message: 'Licencia actualizada y activada exitosamente',
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          companyName: user.companyName,
          role: user.role,
          licenseKey: user.licenseKey,
          licenseExpiresAt: user.licenseExpiresAt,
          licenseAssignedAt: user.licenseAssignedAt,
          monthlyCapitals: user.monthlyCapitals,
          isExpired: false
        },
        persistence: persistenceInfo(),
      });
    }

    // ACTION: GENERATE NEW LICENSE CODE (Exclusivo para Admin)
    if (action === 'generate_license') {
      const requesterId = request.headers.get('x-user-id');
      const requester = db.users.find(u => u.id === requesterId);
      if (!requester || requester.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'Solo el administrador puede generar licencias' }, { status: 403 });
      }

      const months = parseInt(licenseDurationMonths, 10) || 1;
      const licenseObj = generateRandomLicense(months);
      return NextResponse.json({ success: true, ...licenseObj });
    }

    return NextResponse.json({ success: false, error: 'Acción no válida' }, { status: 400 });
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json({ success: false, error: 'Error interno en el servidor de autenticación' }, { status: 500 });
  }
}
