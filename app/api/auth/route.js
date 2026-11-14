import { NextResponse } from 'next/server';
import { getDb, saveDb, generateRandomLicense, LICENSE_EXPIRED_MESSAGE, isUserLicenseExpired, getDefaultMonthlyCapital } from '../../lib/db.js';

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
    const db = getDb();

    // ACTION: LOGIN
    if (action === 'login') {
      const user = db.users.find(u => u.username?.toLowerCase() === username?.trim().toLowerCase());

      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Usuario no encontrado' },
          { status: 401 }
        );
      }

      if (user.password !== password) {
        return NextResponse.json(
          { success: false, error: 'Contraseña incorrecta' },
          { status: 401 }
        );
      }

      const isExpired = user.role !== 'admin' && isUserLicenseExpired(user);

      // Obtener el capital del mes en curso para el usuario
      const currentMonthKey = new Date().toISOString().slice(0, 7);
      const userCurrentCapital = user.monthlyCapitals?.[currentMonthKey]?.capital ?? 5000;

      return NextResponse.json({
        success: true,
        message: 'Acceso autorizado',
        token: 'token_ricardo_' + Buffer.from(Date.now().toString()).toString('base64'),
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          companyName: user.companyName || 'Mi Empresa',
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
        }
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

      const existing = db.users.find(u => u.username?.toLowerCase() === username?.trim().toLowerCase());
      if (existing) {
        return NextResponse.json(
          { success: false, error: 'El nombre de usuario ya está registrado' },
          { status: 400 }
        );
      }

      // Generar licencia automática aleatoria con fecha de caducidad en meses
      const months = parseInt(licenseDurationMonths, 10) || 1;
      const licenseObj = generateRandomLicense(months);

      const newUser = {
        id: 'usr_' + Date.now(),
        username: username.trim(),
        name: name.trim(),
        companyName: companyName ? companyName.trim() : `${name.trim()}'s Business`,
        address: address ? address.trim() : '',
        phone: phone ? phone.trim() : '',
        role: 'user', // Rol de usuario final
        password: password.trim(),
        licenseKey: assignedLicenseKey ? assignedLicenseKey.trim().toUpperCase() : licenseObj.licenseKey,
        licenseAssignedAt: licenseObj.assignedAt,
        licenseExpiresAt: licenseObj.expiresAt,
        licenseDurationMonths: months,
        monthlyCapitals: getDefaultMonthlyCapital(5000),
        createdAt: new Date().toISOString()
      };

      db.users.push(newUser);
      const saved = saveDb(db);
      if (!saved) {
        return NextResponse.json({
          success: false,
          error: 'No se pudo guardar el usuario en la base de datos (data/db.json). Verifica permisos de escritura o exclusiones del antivirus y reintenta.'
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Usuario final ${newUser.name} registrado con éxito con empresa asignada: ${newUser.companyName}`,
        user: newUser
      });
    }

    // ACTION: CHANGE PASSWORD (Para el usuario activo o admin)
    if (action === 'change_password') {
      if (!newPassword || newPassword.length < 4) {
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

      user.password = newPassword.trim();
      if (user.role === 'admin') {
        db.settings.adminPassword = newPassword.trim();
      }
      saveDb(db);

      return NextResponse.json({ success: true, message: 'Contraseña actualizada con éxito' });
    }

    // ACTION: RENEW / ACTIVATE LICENSE (Usuario final introduce nueva licencia o admin la renueva)
    if (action === 'activate_license') {
      if (!licenseKey || !licenseKey.trim()) {
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

      user.licenseKey = licenseKey.trim().toUpperCase();
      user.licenseAssignedAt = now.toISOString();
      user.licenseExpiresAt = expiresAt.toISOString();
      user.licenseDurationMonths = months;

      saveDb(db);

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
        }
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
