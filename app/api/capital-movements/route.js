import { NextResponse } from 'next/server';
import {
  checkWritePermission, getRequestUser, canAccessRecord, scopeRecords,
  getStateForRequest, saveStateForRequest, buildCapitalBody, normalizeDashboardState, summarize,
} from '@/modules/capital/service';

const MOVEMENT_TYPES = ['APORTE_CAPITAL', 'RETIRO_CAPITAL'];
const CURRENCIES = ['USD', 'USDT', 'VES'];

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export async function GET(request) {
  try {
    const db = await getStateForRequest(request);
    normalizeDashboardState(db);
    const user = getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }
    return NextResponse.json(buildCapitalBody(db, user));
  } catch (error) {
    console.error('Capital movements GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Error al listar movimientos de capital' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const db = await getStateForRequest(request);
    if (!Array.isArray(db.capitalMovements)) db.capitalMovements = [];
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json(
        { success: false, error: perm.error, licenseExpired: true },
        { status: 403 }
      );
    }
    const user = perm.user || getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const type = String(body.type || '').trim().toUpperCase();
    if (!MOVEMENT_TYPES.includes(type)) {
      return NextResponse.json(
        { success: false, error: 'Tipo inválido: use APORTE_CAPITAL o RETIRO_CAPITAL' },
        { status: 400 }
      );
    }

    const currencyOrigin = String(body.currencyOrigin || body.currency || 'USD').trim().toUpperCase();
    if (!CURRENCIES.includes(currencyOrigin)) {
      return NextResponse.json(
        { success: false, error: 'Moneda inválida: use USD, USDT o VES' },
        { status: 400 }
      );
    }

    const amount = count(body.amount);
    if (amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'El monto debe ser mayor que cero' },
        { status: 400 }
      );
    }

    let exchangeRate = null;
    let amountUsd;
    if (currencyOrigin === 'VES') {
      exchangeRate = count(body.exchangeRate);
      if (exchangeRate <= 0) {
        return NextResponse.json(
          { success: false, error: 'La tasa de cambio es obligatoria para montos en VES' },
          { status: 400 }
        );
      }
      amountUsd = amount / exchangeRate;
    } else {
      // USD y USDT se tratan 1:1 para efectos contables.
      amountUsd = amount;
      const providedRate = count(body.exchangeRate);
      exchangeRate = providedRate > 0 ? providedRate : null;
    }

    amountUsd = round2(amountUsd);
    if (amountUsd <= 0) {
      return NextResponse.json(
        { success: false, error: 'El monto equivale a 0 USD con la tasa indicada' },
        { status: 400 }
      );
    }

    if (type === 'RETIRO_CAPITAL') {
      const current = summarize(scopeRecords(db.capitalMovements, user));
      if (amountUsd > current.netCapital) {
        return NextResponse.json(
          {
            success: false,
            error: `El retiro ($${amountUsd.toFixed(2)}) supera el Capital Invertido Neto disponible ($${current.netCapital.toFixed(2)}).`,
            summary: current,
          },
          { status: 409 }
        );
      }
    }

    const now = new Date().toISOString();
    const movement = {
      id:
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `cap_${Date.now()}`,
      userId: user.id,
      type,
      amountUsd,
      currencyOrigin,
      exchangeRate,
      notes: body.notes ? String(body.notes).trim() : '',
      createdAt: now,
      metadata: { amountOriginal: round2(amount) },
    };

    db.capitalMovements.unshift(movement);
    await saveStateForRequest(request, db);

    const summary = summarize(scopeRecords(db.capitalMovements, user));
    return NextResponse.json({
      success: true,
      message: type === 'APORTE_CAPITAL' ? 'Aporte registrado' : 'Retiro registrado',
      movement,
      summary,
    });
  } catch (error) {
    console.error('Capital movements POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Error al guardar movimiento de capital' },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const db = await getStateForRequest(request);
    if (!Array.isArray(db.capitalMovements)) db.capitalMovements = [];
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json(
        { success: false, error: perm.error, licenseExpired: true },
        { status: 403 }
      );
    }
    const user = perm.user || getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID requerido' }, { status: 400 });
    }

    const movement = db.capitalMovements.find((m) => m.id === id);
    if (!movement) {
      return NextResponse.json(
        { success: false, error: 'Movimiento no encontrado' },
        { status: 404 }
      );
    }
    if (!canAccessRecord(user, movement)) {
      return NextResponse.json(
        { success: false, error: 'No autorizado para eliminar este movimiento' },
        { status: 403 }
      );
    }

    db.capitalMovements = db.capitalMovements.filter((m) => m.id !== id);
    db.__syncCapital = true;
    await saveStateForRequest(request, db);

    const summary = summarize(scopeRecords(db.capitalMovements, user));
    return NextResponse.json({ success: true, message: 'Movimiento eliminado', summary });
  } catch (error) {
    console.error('Capital movements DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Error al eliminar movimiento de capital' },
      { status: 500 }
    );
  }
}
