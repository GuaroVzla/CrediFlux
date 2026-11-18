import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { checkWritePermission } from '../../../../lib/db.js';
import { getStateForRequest } from '../../../../lib/server/supabase-store';
import { resolveRequestAuth } from '../../../../lib/server/request-auth';
import { isSupabaseConfigured, isSupabaseAdminConfigured } from '../../../../lib/supabase/env';
import {
  executePurge,
  hasSelectedPurgeTargets,
  normalizePurgeTargets,
  publicPurgeError,
  PurgeUnavailableError,
  PurgeTransactionError,
} from '../../../../lib/server/admin-purge';

/**
 * Purga atómica y aislada por usuario.
 * La sesión y el rol se validan en servidor antes de cualquier consulta:
 * en modo Supabase se exige un usuario autenticado con perfil admin activo.
 */
export async function POST(request) {
  try {
    const auth = await resolveRequestAuth(request);
    if (isSupabaseConfigured() && (!auth.userId || !auth.supabase)) {
      return NextResponse.json(
        { success: false, error: 'Sesión activa requerida' },
        { status: 403 }
      );
    }

    const db = await getStateForRequest(request);
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }

    const sessionUser = isSupabaseConfigured() ? db.__currentUser : perm.user;
    const isActiveAdmin =
      Boolean(sessionUser) &&
      sessionUser.role === 'admin' &&
      sessionUser.isActive !== false &&
      (!isSupabaseConfigured() || String(sessionUser.id) === String(auth.userId));
    if (!isActiveAdmin) {
      return NextResponse.json(
        { success: false, error: 'Solo un administrador activo puede vaciar datos' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const targetUserId = String(body.target_user_id ?? body.targetUserId ?? body.userId ?? '').trim();
    if (!targetUserId) {
      return NextResponse.json({ success: false, error: 'Usuario destino requerido' }, { status: 400 });
    }
    if (isSupabaseConfigured() && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
      return NextResponse.json({ success: false, error: 'Identificador de usuario destino inválido' }, { status: 400 });
    }
    const targetExists = Array.isArray(db.users) && db.users.some((u) => String(u?.id) === targetUserId);
    if (!targetExists) {
      return NextResponse.json({ success: false, error: 'Usuario destino no encontrado' }, { status: 404 });
    }

    const targets = normalizePurgeTargets(body.targets);
    if (!hasSelectedPurgeTargets(targets)) {
      return NextResponse.json({ success: false, error: 'Selecciona al menos un tipo de dato para vaciar' }, { status: 400 });
    }

    if (isSupabaseConfigured() && !isSupabaseAdminConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: 'SUPABASE_SERVICE_ROLE_KEY no configurada. Se requiere service_role para purgar por usuario.',
          code: 'PURGE_MECHANISM_UNAVAILABLE',
        },
        { status: 503 }
      );
    }

    const filter = body.filter && typeof body.filter === 'object' ? body.filter : { period: 'all' };
    const summary = await executePurge({ request, db, targetUserId, targets, filter });

    revalidatePath('/');

    return NextResponse.json({
      success: true,
      message: 'Limpieza de datos ejecutada',
      summary,
      userId: targetUserId,
      target_user_id: targetUserId,
    });
  } catch (error) {
    console.error('Admin purge error:', error);

    if (error instanceof PurgeUnavailableError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: 503 }
      );
    }
    if (error instanceof PurgeTransactionError) {
      return NextResponse.json(
        { success: false, error: error.message, detail: error.detail, code: error.code },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Error al vaciar datos',
        detail: publicPurgeError(error),
        code: 'PURGE_FAILED',
      },
      { status: 500 }
    );
  }
}
