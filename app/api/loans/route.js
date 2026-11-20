import { NextResponse } from 'next/server';
import {
  computeLoanStatus, normalizeDni, checkWritePermission, getRequestUser, canAccessRecord,
  getStateForRequest, saveStateForRequest, buildLoansBody, normalizeDashboardState,
  computeLoanPlan, getLoanItems, applyLoanEdit,
} from '@/modules/loans/service';

function today() {
  return new Date().toISOString().split('T')[0];
}

/** Unifica el payload de alta y edición para no duplicar normalizaciones. */
function readLoanPayload(body) {
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.length
    ? rawItems
    : body.productId ? [{ productId: body.productId, quantity: 1 }] : [];
  return {
    clientId: body.clientId,
    type: body.type === 'producto' ? 'producto' : 'dinero',
    items,
    manualPrincipal: body.principal,
    downPayment: body.downPayment ?? 0,
    interestMode: body.interestMode === 'fixed' ? 'fixed' : 'percent',
    interestRate: body.interestRate ?? 0,
    interestAmount: body.interestAmount,
    installmentCount: body.installmentCount ?? 4,
    frequency: body.frequency ?? 'quincenal',
    startDate: body.startDate || today(),
    notes: body.notes ?? '',
  };
}

/**
 * La edición está restringida a condiciones de pago. Si el cliente intenta
 * cambiar datos congelados se rechaza la petición en vez de ignorarlos en
 * silencio.
 */
function lockedFieldsError(body, loan) {
  const changed = [];
  const sameId = (a, b) => a === undefined || a === null || String(a) === String(b || '');
  const sameNumber = (a, b) => a === undefined || Number(a) === Number(b || 0);

  if (!sameId(body.clientId, loan.clientId)) changed.push('cliente');
  if (body.type !== undefined && body.type !== loan.type) changed.push('modalidad');
  if (!sameId(body.productId, loan.productId)) changed.push('productos');
  if (Array.isArray(body.items) &&
      JSON.stringify(body.items) !== JSON.stringify(getLoanItems(loan))) changed.push('productos');
  if (!sameNumber(body.principal, loan.principal)) changed.push('monto base');
  if (!sameNumber(body.downPayment, loan.downPayment)) changed.push('enganche');
  if (body.notes !== undefined && String(body.notes) !== String(loan.notes || '')) changed.push('notas');

  return changed.length
    ? `No se pueden modificar: ${changed.join(', ')}. Solo se editan las condiciones de pago.`
    : null;
}

function productAccessError(db, user, items) {
  for (const item of items) {
    const product = (db.products || []).find(p => String(p?.id) === String(item.productId));
    if (!product) return 'Producto no encontrado en catálogo';
    if (!canAccessRecord(user, product)) return 'No autorizado para usar este producto';
  }
  return null;
}

function planErrorResponse(error) {
  const message = error?.message || 'Datos del financiamiento inválidos';
  const status = /stock|cuotas|enganche|producto|monto|total|abonado|interés|interes/i.test(message) ? 409 : 400;
  return NextResponse.json({ success: false, error: message }, { status });
}

function prepareState(db) {
  if (!Array.isArray(db.loans)) db.loans = [];
  if (!Array.isArray(db.clients)) db.clients = [];
  if (!Array.isArray(db.products)) db.products = [];
  if (!Array.isArray(db.blacklist)) db.blacklist = [];
}

export async function GET(request) {
  try {
    const db = await getStateForRequest(request);
    normalizeDashboardState(db);
    const user = getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }
    return NextResponse.json(buildLoansBody(db, user));
  } catch (error) {
    console.error('Loans GET error:', error);
    return NextResponse.json({ success: false, error: 'Error al obtener financiamientos' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = await getStateForRequest(request);
    prepareState(db);
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const user = perm.user || getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    const cfg = readLoanPayload(await request.json());
    const client = db.clients.find(c => c.id === cfg.clientId);
    if (!client) {
      return NextResponse.json({ success: false, error: 'Cliente no encontrado' }, { status: 404 });
    }
    if (!canAccessRecord(user, client)) {
      return NextResponse.json({ success: false, error: 'No autorizado para usar este cliente' }, { status: 403 });
    }
    if (cfg.type === 'producto') {
      const accessError = productAccessError(db, user, cfg.items);
      if (accessError) return NextResponse.json({ success: false, error: accessError }, { status: 403 });
    }

    let plan;
    try {
      plan = computeLoanPlan({ ...cfg, products: db.products, existingItems: [], existingInstallments: [] });
    } catch (error) {
      return planErrorResponse(error);
    }

    // El alta descuenta el inventario reservado por los productos del plan.
    for (const delta of plan.stockDeltas) {
      const product = db.products.find(p => String(p?.id) === delta.productId);
      if (product) product.stock = Math.floor(Number(product.stock) || 0) - delta.delta;
    }

    const ownerId = client.userId || user?.id || 'usr_admin';
    const newLoan = {
      id: 'ln_' + Date.now(),
      userId: ownerId,
      clientId: cfg.clientId,
      clientName: client.name,
      type: cfg.type,
      productId: plan.productId,
      productName: plan.productName,
      items: plan.items,
      principal: plan.principal,
      downPayment: plan.downPayment,
      financedAmount: plan.financedAmount,
      interestRate: plan.interestRate,
      interestMode: plan.interestMode,
      interestAmount: plan.interestAmount,
      totalAmount: plan.totalAmount,
      installmentCount: plan.installmentCount,
      installmentAmount: plan.installmentAmount,
      frequency: cfg.frequency,
      startDate: plan.startDate,
      notes: cfg.notes,
      status: 'al_dia',
      installments: plan.installments,
      metadata: {
        items: plan.items,
        interestMode: plan.interestMode,
        interestAmount: plan.interestAmount,
      },
      createdAt: new Date().toISOString(),
    };

    db.loans.unshift(newLoan);
    await saveStateForRequest(request, db);

    return NextResponse.json({
      success: true,
      message: 'Financiamiento creado exitosamente',
      loan: newLoan
    });
  } catch (error) {
    console.error('Loans POST error:', error);
    return NextResponse.json({ success: false, error: 'Error al registrar financiamiento' }, { status: 500 });
  }
}

/**
 * Edita únicamente las condiciones de pago de un financiamiento existente:
 * interés, cantidad de cuotas, frecuencia y fecha de inicio.
 *
 * Cliente, productos, inventario, monto base y enganche quedan congelados.
 * Los abonos confirmados (`payments`) son la fuente de verdad: sus cuotas se
 * conservan y el saldo se recalcula restando ese total pagado.
 */
export async function PATCH(request) {
  try {
    const db = await getStateForRequest(request);
    prepareState(db);
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const user = perm.user || getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id') || body.id;
    if (!id) return NextResponse.json({ success: false, error: 'ID requerido' }, { status: 400 });

    const loan = db.loans.find(l => String(l?.id) === String(id));
    if (!loan) {
      return NextResponse.json({ success: false, error: 'Financiamiento no encontrado' }, { status: 404 });
    }
    if (!canAccessRecord(user, loan)) {
      return NextResponse.json({ success: false, error: 'No autorizado para editar este financiamiento' }, { status: 403 });
    }
    if (loan.archived) {
      return NextResponse.json({ success: false, error: 'Este financiamiento fue dado de baja y no admite cambios' }, { status: 400 });
    }

    const lockedError = lockedFieldsError(body, loan);
    if (lockedError) {
      return NextResponse.json({ success: false, error: lockedError }, { status: 400 });
    }

    // Sólo se leen campos editables del body; el resto se toma del préstamo
    // guardado para que ningún pago, producto o monto histórico se reescriba.
    const cfg = readLoanPayload({
      clientId: loan.clientId,
      type: loan.type,
      items: getLoanItems(loan),
      productId: loan.productId,
      principal: loan.principal,
      downPayment: loan.downPayment,
      interestMode: body.interestMode ?? loan.interestMode ?? 'percent',
      interestRate: body.interestRate ?? loan.interestRate,
      interestAmount: body.interestAmount ?? loan.interestAmount,
      installmentCount: body.installmentCount ?? loan.installmentCount,
      frequency: body.frequency ?? loan.frequency,
      startDate: body.startDate ?? loan.startDate,
      notes: loan.notes,
    });

    const paidAmount = (db.payments || [])
      .filter(p => String(p?.loanId || p?.loan_id) === String(loan.id))
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    let plan;
    try {
      plan = computeLoanPlan({
        ...cfg,
        products: db.products,
        existingItems: getLoanItems(loan),
        existingInstallments: Array.isArray(loan.installments) ? loan.installments : [],
        paidAmountOverride: paidAmount,
        fixedPrincipal: loan.principal,
        fixedProductName: loan.productName || '',
      });
    } catch (error) {
      return planErrorResponse(error);
    }

    try {
      await applyLoanEdit({ request, db, loan, plan, frequency: cfg.frequency });
    } catch (error) {
      console.error('Loans PATCH persist error:', error);
      const message = error?.message || 'No se pudo guardar el financiamiento';
      const status = /total|abonado|cuotas|no está instalada|no autenticado|no encontrado/i.test(message) ? 409 : 500;
      return NextResponse.json({ success: false, error: message }, { status });
    }

    return NextResponse.json({
      success: true,
      message: 'Condiciones de pago actualizadas exitosamente',
      loanId: loan.id,
      paidAmount: plan.paidAmount,
      remainingAmount: plan.remainingAmount,
      installmentAmount: plan.installmentAmount,
      loanStatus: computeLoanStatus(loan),
    });
  } catch (error) {
    console.error('Loans PATCH error:', error);
    return NextResponse.json({ success: false, error: 'Error al actualizar financiamiento' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const db = await getStateForRequest(request);
    prepareState(db);
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const user = perm.user || getRequestUser(request, db);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ID requerido' }, { status: 400 });

    // mode=error -> baja limpia por error de registro; por defecto se mantiene
    // el comportamiento histórico de baja por incumplimiento.
    const mode = searchParams.get('mode') || 'incumplimiento';
    const isRegistrationError = mode === 'error';

    const loan = (db.loans || []).find(l => l.id === id);
    if (!loan) {
      return NextResponse.json({ success: false, error: 'Financiamiento no encontrado' }, { status: 404 });
    }
    if (!canAccessRecord(user, loan)) {
      return NextResponse.json({ success: false, error: 'No autorizado para dar de baja este financiamiento' }, { status: 403 });
    }

    // Error de registro: se elimina solo el financiamiento seleccionado.
    // No se archiva, no se toca la lista negra y no se altera la reputación
    // ni el historial crediticio del cliente por incumplimiento.
    if (isRegistrationError) {
      db.loans = (db.loans || []).filter(l => l.id !== id);
      await saveStateForRequest(request, db);
      return NextResponse.json({
        success: true,
        message: 'Financiamiento eliminado por error de registro. El cliente conserva su historial y no fue enviado a la Lista Negra.',
        deleted: true,
        archivedLoans: 0,
        blacklisted: false
      });
    }

    // Datos del cliente antes de retirarlo de la cartera activa
    const client = (db.clients || []).find(c => c.id === loan.clientId);
    const archivedAt = new Date().toISOString();
    const archiveReason = 'Baja por incumplimiento';
    const archivedLoanIds = [];

    // Todos los financiamientos del mismo cliente (dentro del mismo propietario)
    // se archivan para no dejar registros huérfanos ni deudas activas.
    db.loans = (db.loans || []).map(item => {
      if (item.clientId !== loan.clientId) return item;
      if (item.userId !== loan.userId) return item;

      const previousStatus = computeLoanStatus(item);
      archivedLoanIds.push(item.id);

      return {
        ...item,
        archived: true,
        archivedAt,
        archiveReason: previousStatus === 'completado'
          ? 'Cierre de cartera por baja del cliente'
          : archiveReason,
        finalStatus: previousStatus === 'completado' ? 'completado' : 'incumplimiento'
      };
    });

    // El cliente sale de la tabla activa de clientes
    db.clients = (db.clients || []).filter(c => !(c.id === loan.clientId && c.userId === loan.userId));

    // Persistir en Lista Negra evitando duplicados por cédula dentro del mismo propietario
    let blacklisted = false;
    if (client && client.userId === loan.userId) {
      const ownerId = client.userId || loan.userId || user?.id;
      const dniKey = normalizeDni(client.dni);
      const alreadyBlacklisted = (db.blacklist || []).some(entry =>
        (entry.userId === ownerId) && (
          (entry.clientId && entry.clientId === client.id) ||
          (dniKey && normalizeDni(entry.dni) === dniKey)
        )
      );

      if (!alreadyBlacklisted) {
        db.blacklist.unshift({
          id: 'bl_' + Date.now(),
          userId: ownerId,
          clientId: client.id,
          name: client.name,
          dni: client.dni,
          phone: client.phone || '',
          address: client.address || '',
          notes: client.notes || '',
          status: 'Eliminado',
          reason: archiveReason,
          archivedAt,
          loanIds: archivedLoanIds
        });
        blacklisted = true;
      }
    }

    await saveStateForRequest(request, db);

    return NextResponse.json({
      success: true,
      message: client
        ? `Financiamiento dado de baja. ${client.name} fue enviado a la Lista Negra.`
        : 'Financiamiento dado de baja y archivado en el Historial.',
      archivedLoans: archivedLoanIds.length,
      blacklisted
    });
  } catch (error) {
    console.error('Loans DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Error al dar de baja el financiamiento' }, { status: 500 });
  }
}
