import { NextResponse } from 'next/server';
import { generateRandomLicense, isUserLicenseExpired, getDefaultMonthlyCapital, getRequestUser } from '@/shared/lib/db.js';
import { getStateForRequest, saveStateForRequest, persistenceInfo } from '@/server/persistence/supabase-store';
import { hashPassword, verifyPassword, sanitizeUserForClient } from '@/server/security/security.js';
import { createSupabaseServerClient, createSupabaseRouteClient } from '@/server/supabase/server';
import { getSupabaseAdminClientOrNull } from '@/server/supabase/admin';
import { isLegacyAuthAllowed, isSupabaseConfigured, usernameToEmail } from '@/server/supabase/env';
import { profileToLegacyUser, resolveRequestAuth } from '@/server/auth/request-auth';
import { setLegacyPasswordPreview, storePasswordPreview } from '@/server/auth/password-preview.js';

function supabaseUnavailable() {
  return NextResponse.json({
    success: false,
    error: 'Supabase Auth no está configurado. Define NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.'
  }, { status: 503 });
}

/** En producción no existe el modo legado: no se emiten sesiones ni se muta por header. */
function legacyUnavailable() {
  return NextResponse.json({
    success: false,
    error: 'Modo legado deshabilitado en producción. Configura Supabase Auth para continuar.'
  }, { status: 503 });
}

async function loadProfileById(userId, fallbackClient) {
  const admin = getSupabaseAdminClientOrNull();
  if (admin) {
    const { data } = await admin.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (data) return data;
  }
  const supabase = fallbackClient || (await createSupabaseServerClient());
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return data || null;
}

/**
 * Migración transparente: si las credenciales coinciden con el almacén legado
 * (hash scrypt del JSON/Postgres anterior), se crea el usuario en Supabase Auth
 * con esa misma contraseña y se enlaza su perfil.
 */
async function tryLegacyBootstrap(username, password) {
  const admin = getSupabaseAdminClientOrNull();
  if (!admin) return null;
  try {
    const { getAppState: getLegacyState } = await import('@/server/persistence/persistence.js');
    const legacy = await getLegacyState();
    const user = (legacy.users || []).find(
      (u) => u?.username?.toLowerCase() === String(username || '').trim().toLowerCase()
    );
    if (!user) return null;

    const stored = user.passwordHash || user.password || user.passwordLegacy || '';
    const ver = await verifyPassword(password, stored);
    if (!ver.ok) return null;

    const email = usernameToEmail(user.username);
    const created = await admin.auth.admin.createUser({
      email,
      password: String(password),
      email_confirm: true,
      user_metadata: { username: user.username, full_name: user.name || user.username },
    });
    if (created.error || !created.data?.user) {
      console.warn('[auth] Bootstrap legado no pudo crear el usuario:', created.error?.message);
      return null;
    }

    const authUser = created.data.user;
    await admin.from('profiles').upsert({
      id: authUser.id,
      username: user.username,
      full_name: user.name || user.username,
      company_name: user.companyName || null,
      email,
      address: user.address || null,
      phone: user.phone || null,
      role: user.role === 'admin' ? 'admin' : 'user',
      is_active: user.isActive !== false,
      license_key: user.licenseKey || null,
      license_status: 'active',
      license_assigned_at: user.licenseAssignedAt || null,
      license_expires_at: user.licenseExpiresAt || null,
      license_duration_months: user.licenseDurationMonths || 1,
      monthly_capitals: user.monthlyCapitals || getDefaultMonthlyCapital(5000),
    }, { onConflict: 'id' });

    return authUser;
  } catch (error) {
    console.error('[auth] Error en bootstrap legado:', error?.message || error);
    return null;
  }
}

async function supabaseLogin(request, { username, password }) {
  const { supabase, applyCookies } = createSupabaseRouteClient(request);
  const email = usernameToEmail(username);

  let session = null;
  let authedUser = null;
  const signIn = await supabase.auth.signInWithPassword({ email, password: String(password || '') });

  if (signIn.error || !signIn.data?.user) {
    const bootstrapped = await tryLegacyBootstrap(username, password);
    if (!bootstrapped) {
      return NextResponse.json(
        { success: false, error: signIn.error?.message || 'Usuario o contraseña incorrectos' },
        { status: 401 }
      );
    }
    const retry = await supabase.auth.signInWithPassword({ email, password: String(password || '') });
    if (retry.error) {
      return NextResponse.json({ success: false, error: retry.error.message }, { status: 401 });
    }
    session = retry.data.session;
    authedUser = retry.data.user;
  } else {
    session = signIn.data.session;
    authedUser = signIn.data.user;
  }

  const profile = await loadProfileById(
    authedUser?.id || (await supabase.auth.getUser()).data.user?.id,
    supabase
  );
  if (!profile) {
    return NextResponse.json(
      { success: false, error: 'No se encontró el perfil del usuario en Supabase.' },
      { status: 404 }
    );
  }

  const user = profileToLegacyUser(profile);
  const isExpired = user.role !== 'admin' && isUserLicenseExpired(user);
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const userCurrentCapital = user.monthlyCapitals?.[currentMonthKey]?.capital ?? 5000;

  return applyCookies(NextResponse.json({
    success: true,
    message: 'Acceso autorizado',
    token: session?.access_token || 'supabase-session',
    user: {
      ...user,
      isExpired,
      licenseKey: user.licenseKey || '',
      licenseExpiresAt: user.licenseExpiresAt || null,
      licenseAssignedAt: user.licenseAssignedAt || null,
      monthlyCapitals: user.monthlyCapitals || getDefaultMonthlyCapital(5000),
    },
    settings: { currency: '$', ecommerceCapital: userCurrentCapital },
    security: { passwordMigrated: false },
    persistence: persistenceInfo(),
  }));
}

async function supabaseRegister({ requester, username, password, name, address, phone, companyName, licenseDurationMonths, assignedLicenseKey }) {
  if (!requester || requester.role !== 'admin') {
    return NextResponse.json(
      { success: false, error: 'Acceso denegado: El registro de nuevos usuarios está reservado exclusivamente al Administrador.' },
      { status: 403 }
    );
  }
  if (!username || !password || !name) {
    return NextResponse.json({ success: false, error: 'Nombre y Apellido, Usuario y Clave son obligatorios' }, { status: 400 });
  }
  const admin = getSupabaseAdminClientOrNull();
  if (!admin) return supabaseUnavailable();

  const months = parseInt(licenseDurationMonths, 10) || 1;
  const licenseObj = generateRandomLicense(months);
  const email = usernameToEmail(username);

  const created = await admin.auth.admin.createUser({
    email,
    password: String(password).trim(),
    email_confirm: true,
    user_metadata: { username: String(username).trim(), full_name: String(name).trim() },
  });

  if (created.error || !created.data?.user) {
    const message = created.error?.message || 'No se pudo crear el usuario en Supabase Auth';
    const duplicate = /already|registered|exists/i.test(message);
    return NextResponse.json(
      { success: false, error: duplicate ? 'El nombre de usuario ya está registrado' : message },
      { status: duplicate ? 400 : 500 }
    );
  }

  const authUser = created.data.user;
  const profile = {
    id: authUser.id,
    username: String(username).trim(),
    full_name: String(name).trim(),
    company_name: companyName ? String(companyName).trim() : null,
    email,
    address: address ? String(address).trim() : null,
    phone: phone ? String(phone).trim() : null,
    role: 'user',
    is_active: true,
    license_key: assignedLicenseKey ? String(assignedLicenseKey).trim().toUpperCase() : licenseObj.licenseKey,
    license_status: 'active',
    license_assigned_at: licenseObj.assignedAt,
    license_expires_at: licenseObj.expiresAt,
    license_duration_months: months,
    monthly_capitals: getDefaultMonthlyCapital(5000),
  };

  const { data, error } = await admin.from('profiles').upsert(profile, { onConflict: 'id' }).select('*').single();
  if (error) {
    await admin.auth.admin.deleteUser(authUser.id).catch(() => {});
    return NextResponse.json({ success: false, error: `No se pudo guardar el perfil: ${error.message}` }, { status: 500 });
  }

  // Copia reversible únicamente para claves nuevas; el login sigue usando Auth.
  await storePasswordPreview(authUser.id, password).catch((previewError) => {
    console.warn('[auth] No se pudo guardar la vista previa de la clave:', previewError?.message || previewError);
  });

  return NextResponse.json({
    success: true,
    message: `Usuario final ${profile.full_name} registrado con éxito en CrediFlux.`,
    user: sanitizeUserForClient(profileToLegacyUser(data)),
    persistence: persistenceInfo(),
  });
}

export async function GET(request) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ success: false, error: 'Supabase no configurado' }, { status: 503 });
    }
    const auth = await resolveRequestAuth(request);
    if (!auth.userId || !auth.profile) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }
    const user = profileToLegacyUser(auth.profile);
    return NextResponse.json({
      success: true,
      user: { ...user, isExpired: user.role !== 'admin' && isUserLicenseExpired(user) },
      persistence: persistenceInfo(),
    });
  } catch (error) {
    console.error('Auth session error:', error);
    return NextResponse.json({ success: false, error: 'Error al recuperar la sesión' }, { status: 500 });
  }
}

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
    const db = await getStateForRequest(request);
    if (!Array.isArray(db.users)) db.users = [];
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};

    // El modo legado (login con contraseña del JSON local, registro y funciones
    // administrativas sin sesión) queda restringido a desarrollo/pruebas.
    // `logout` se permite para que el cliente pueda limpiar su estado local.
    if (!isSupabaseConfigured() && !isLegacyAuthAllowed() && action !== 'logout') {
      return legacyUnavailable();
    }

    // ACTION: LOGIN
    if (action === 'login') {
      if (isSupabaseConfigured()) {
        return supabaseLogin(request, { username, password });
      }
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
        await saveStateForRequest(request, db);
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
      if (isSupabaseConfigured()) {
        return supabaseRegister({
          requester: db.__currentUser || null,
          username, password, name, address, phone, companyName,
          licenseDurationMonths, assignedLicenseKey,
        });
      }
      const requester = getRequestUser(request, db);

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

      setLegacyPasswordPreview(newUser, password);
      db.users.push(newUser);
      const saved = await saveStateForRequest(request, db);
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
      if (isSupabaseConfigured()) {
        if (!newPassword || String(newPassword).length < 4) {
          return NextResponse.json({ success: false, error: 'La nueva contraseña debe tener al menos 4 caracteres' }, { status: 400 });
        }
        const auth = await resolveRequestAuth(request);
        if (!auth.userId) {
          return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
        }
        const targetId = userId || auth.userId;
        if (targetId !== auth.userId && auth.profile?.role !== 'admin') {
          return NextResponse.json({ success: false, error: 'No autorizado para cambiar la contraseña de otro usuario' }, { status: 403 });
        }
        const admin = getSupabaseAdminClientOrNull();
        if (!admin) return supabaseUnavailable();
        const { error } = await admin.auth.admin.updateUserById(targetId, { password: String(newPassword).trim() });
        if (error) {
          return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        }
        await storePasswordPreview(targetId, newPassword).catch((previewError) => {
          console.warn('[auth] No se pudo actualizar la vista previa de la clave:', previewError?.message || previewError);
        });
        return NextResponse.json({
          success: true,
          message: 'Contraseña actualizada con éxito',
          persistence: persistenceInfo(),
        });
      }
      if (!newPassword || String(newPassword).length < 4) {
        return NextResponse.json(
          { success: false, error: 'La nueva contraseña debe tener al menos 4 caracteres' },
          { status: 400 }
        );
      }

      const requester = getRequestUser(request, db);
      if (!requester) {
        return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
      }
      const targetId = userId || requester.id;
      if (targetId !== requester.id && requester.role !== 'admin') {
        return NextResponse.json(
          { success: false, error: 'No autorizado para cambiar la contraseña de otro usuario' },
          { status: 403 }
        );
      }
      const user = db.users.find(u => u.id === targetId);

      if (!user) {
        return NextResponse.json({ success: false, error: 'Usuario no encontrado' }, { status: 404 });
      }

      const newHash = await hashPassword(String(newPassword).trim());
      user.passwordHash = newHash;
      delete user.password;
      delete user.passwordLegacy;
      setLegacyPasswordPreview(user, newPassword);
      if (user.role === 'admin') {
        db.settings.adminPasswordHash = newHash;
        delete db.settings.adminPassword;
        delete db.settings.adminPasswordLegacy;
      }
      await saveStateForRequest(request, db);

      return NextResponse.json({ success: true, message: 'Contraseña actualizada con éxito', persistence: persistenceInfo() });
    }

    // ACTION: RENEW / ACTIVATE LICENSE (Usuario final introduce nueva licencia o admin la renueva)
    if (action === 'activate_license') {
      if (isSupabaseConfigured()) {
        if (!licenseKey || !String(licenseKey).trim()) {
          return NextResponse.json({ success: false, error: 'La clave de licencia es requerida' }, { status: 400 });
        }
        const auth = await resolveRequestAuth(request);
        if (!auth.userId) {
          return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
        }
        const targetId = userId || auth.userId;
        if (targetId !== auth.userId && auth.profile?.role !== 'admin') {
          return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });
        }
        const admin = getSupabaseAdminClientOrNull();
        if (!admin) return supabaseUnavailable();
        const months = parseInt(licenseDurationMonths, 10) || 1;
        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setMonth(expiresAt.getMonth() + months);
        const { data, error } = await admin.from('profiles').update({
          license_key: String(licenseKey).trim().toUpperCase(),
          license_status: 'active',
          license_assigned_at: now.toISOString(),
          license_expires_at: expiresAt.toISOString(),
          license_duration_months: months,
        }).eq('id', targetId).select('*').single();
        if (error) {
          return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        }
        return NextResponse.json({
          success: true,
          message: 'Licencia actualizada y activada exitosamente',
          user: profileToLegacyUser(data),
          persistence: persistenceInfo(),
        });
      }
      if (!licenseKey || !String(licenseKey).trim()) {
        return NextResponse.json({ success: false, error: 'La clave de licencia es requerida' }, { status: 400 });
      }

      const requester = getRequestUser(request, db);
      if (!requester) {
        return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
      }
      const targetId = userId || requester.id;
      if (targetId !== requester.id && requester.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });
      }
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

      await saveStateForRequest(request, db);

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
      const requester = getRequestUser(request, db);
      if (!requester || requester.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'Solo el administrador puede generar licencias' }, { status: 403 });
      }

      const months = parseInt(licenseDurationMonths, 10) || 1;
      const licenseObj = generateRandomLicense(months);
      return NextResponse.json({ success: true, ...licenseObj });
    }

    // ACTION: LOGOUT (cierra la sesión de Supabase y limpia cookies)
    if (action === 'logout') {
      if (isSupabaseConfigured()) {
        const { supabase, applyCookies } = createSupabaseRouteClient(request);
        const { error } = await supabase.auth.signOut();
        if (error) {
          console.error('Logout error:', error.message);
          return NextResponse.json({ success: false, error: 'No se pudo cerrar la sesión en el servidor' }, { status: 500 });
        }
        const response = NextResponse.json({ success: true, message: 'Sesión cerrada' });
        // El proxy limpia estas cookies en la siguiente request; hacerlo aquí
        // evita que una pestaña siga considerando la sesión activa.
        response.cookies.set('cf_session_start', '', { path: '/', maxAge: 0, expires: new Date(0) });
        response.cookies.set('cf_last_activity', '', { path: '/', maxAge: 0, expires: new Date(0) });
        return applyCookies(response);
      }
      return NextResponse.json({ success: true, message: 'Sesión cerrada' });
    }

    return NextResponse.json({ success: false, error: 'Acción no válida' }, { status: 400 });
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json({ success: false, error: 'Error interno en el servidor de autenticación' }, { status: 500 });
  }
}
