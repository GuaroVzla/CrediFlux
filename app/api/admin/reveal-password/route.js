import { NextResponse } from 'next/server';
import { checkWritePermission } from '@/shared/lib/db.js';
import { getStateForRequest } from '@/server/persistence/supabase-store';
import { resolveRequestAuth } from '@/server/auth/request-auth';
import { isSupabaseConfigured } from '@/server/supabase/env';
import { canRevealPasswords, readPasswordPreview } from '@/server/auth/password-preview.js';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

function deny(message, status = 403) {
  return NextResponse.json({ success: false, error: message }, { status, headers: NO_STORE });
}

/**
 * Devuelve la clave de un usuario SOLO mientras el admin mantiene presionado el
 * botón de visibilidad. Nunca se incluye en el listado ni se cachea: la copia
 * reversible se desciftra en este momento y la respuesta es no-store.
 */
export async function POST(request) {
  try {
    const auth = await resolveRequestAuth(request);
    if (isSupabaseConfigured() && (!auth.userId || !auth.supabase)) {
      return deny('Sesión activa requerida');
    }

    const db = await getStateForRequest(request);
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json(
        { success: false, error: perm.error, licenseExpired: true },
        { status: 403, headers: NO_STORE }
      );
    }

    const sessionUser = isSupabaseConfigured() ? db.__currentUser : perm.user;
    const isActiveAdmin =
      Boolean(sessionUser) &&
      sessionUser.role === 'admin' &&
      sessionUser.isActive !== false &&
      (!isSupabaseConfigured() || String(sessionUser.id) === String(auth.userId));
    if (!isActiveAdmin) {
      return deny('Solo un administrador activo puede ver claves de acceso');
    }

    const body = await request.json().catch(() => ({}));
    const targetUserId = String(body.userId ?? body.targetUserId ?? '').trim();
    if (!targetUserId) {
      return deny('Usuario destino requerido', 400);
    }
    if (isSupabaseConfigured() && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
      return deny('Identificador de usuario destino inválido', 400);
    }

    const target = Array.isArray(db.users)
      ? db.users.find((u) => String(u?.id) === targetUserId)
      : null;
    if (!target) {
      return deny('Usuario destino no encontrado', 404);
    }

    if (!canRevealPasswords()) {
      return NextResponse.json(
        {
          success: false,
          error: 'La vista previa requiere SETTINGS_ENCRYPTION_KEY en el servidor.',
          code: 'PREVIEW_UNAVAILABLE',
        },
        { status: 503, headers: NO_STORE }
      );
    }

    const password = await readPasswordPreview(targetUserId, target);
    if (!password) {
      return NextResponse.json(
        {
          success: true,
          available: false,
          password: null,
          reason: 'hash',
          message: 'Esta clave fue almacenada con hash y no puede recuperarse. Cámbiala para habilitar la vista previa.',
        },
        { status: 200, headers: NO_STORE }
      );
    }

    console.info('[admin] Clave revelada bajo demanda', { adminId: sessionUser.id, targetUserId });
    return NextResponse.json(
      { success: true, available: true, password },
      { status: 200, headers: NO_STORE }
    );
  } catch (error) {
    console.error('Admin reveal password error:', error?.message || error);
    return NextResponse.json(
      { success: false, error: 'No se pudo revelar la clave', code: 'REVEAL_FAILED' },
      { status: 500, headers: NO_STORE }
    );
  }
}
