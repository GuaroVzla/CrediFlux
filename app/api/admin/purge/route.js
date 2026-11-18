import { NextResponse } from 'next/server';
import { checkWritePermission } from '../../../../lib/db.js';
import { getStateForRequest } from '../../../../lib/server/supabase-store';
import { isSupabaseConfigured, isSupabaseAdminConfigured } from '../../../../lib/supabase/env';
import {
  executePurge,
  hasSelectedPurgeTargets,
  normalizePurgeTargets,
} from '../../../../lib/server/admin-purge';

export async function POST(request) {
  try {
    const db = await getStateForRequest(request);
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }

    // Solo el administrador autenticado puede vaciar datos y debe indicar
    // explícitamente el usuario destino (nunca una limpieza global).
    if (perm.user?.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Solo el administrador puede vaciar datos' }, { status: 403 });
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
        { success: false, error: 'Supabase admin no configurado: se requiere service_role para purgar por usuario' },
        { status: 503 }
      );
    }

    const filter = body.filter && typeof body.filter === 'object' ? body.filter : { period: 'all' };
    const summary = await executePurge({ request, db, targetUserId, targets, filter });

    return NextResponse.json({
      success: true,
      message: 'Limpieza de datos ejecutada',
      summary,
      userId: targetUserId,
      target_user_id: targetUserId,
    });
  } catch (error) {
    console.error('Admin purge error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error al vaciar datos' },
      { status: 500 }
    );
  }
}
