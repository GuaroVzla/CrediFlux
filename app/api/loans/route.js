import { NextResponse } from 'next/server';
import { getDb, saveDb, computeLoanStatus, checkWritePermission, normalizeDni, getRequestUser, scopeRecords, canAccessRecord } from '../../lib/db.js';

export async function GET(request) {
  try {
    const db = getDb();
    const user = getRequestUser(request, db);
    const visibleLoans = scopeRecords(db.loans || [], user);

    // Map loans with updated computed status & amortization progress
    const enrichedLoans = visibleLoans.map(loan => {
      const status = computeLoanStatus(loan);
      const installments = loan.installments || [];
      const totalInstallments = installments.length;
      const paidInstallments = installments.filter(i => i.paid);
      const paidCount = paidInstallments.length;
      const paidAmount = paidInstallments.reduce((sum, i) => sum + i.amount, 0);
      const pendingAmount = installments.filter(i => !i.paid).reduce((sum, i) => sum + i.amount, 0);
      const progressPercent = totalInstallments > 0 ? Math.round((paidCount / totalInstallments) * 100) : 0;

      // Project profit
      const baseCost = loan.type === 'producto'
        ? ((db.products || []).find(p => p.id === loan.productId)?.costPrice || loan.principal * 0.75)
        : loan.principal;
      const projectedProfit = Math.max(0, (loan.totalAmount + (loan.downPayment || 0)) - baseCost);

      return {
        ...loan,
        status,
        stats: {
          totalInstallments,
          paidCount,
          pendingCount: totalInstallments - paidCount,
          paidAmount: Number(paidAmount.toFixed(2)),
          pendingAmount: Number(pendingAmount.toFixed(2)),
          progressPercent,
          projectedProfit: Number(projectedProfit.toFixed(2))
        }
      };
    });

    return NextResponse.json({ success: true, loans: enrichedLoans });
  } catch (error) {
    console.error('Loans GET error:', error);
    return NextResponse.json({ success: false, error: 'Error al obtener financiamientos' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = getDb();
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const user = perm.user || getRequestUser(request, db);

    const body = await request.json();
    const {
      clientId,
      type, // 'producto' | 'dinero'
      productId,
      principal,
      downPayment = 0,
      interestRate = 15, // %
      installmentCount = 4,
      frequency = 'quincenal', // 'semanal' | 'quincenal' | 'mensual'
      startDate,
      notes = ''
    } = body;

    const client = (db.clients || []).find(c => c.id === clientId);
    if (!client) {
      return NextResponse.json({ success: false, error: 'Cliente no encontrado' }, { status: 404 });
    }
    if (!canAccessRecord(user, client)) {
      return NextResponse.json({ success: false, error: 'No autorizado para usar este cliente' }, { status: 403 });
    }

    let productName = 'Préstamo en Efectivo';
    let basePrice = Number(principal) || 0;

    if (type === 'producto') {
      const product = (db.products || []).find(p => p.id === productId);
      if (!product) {
        return NextResponse.json({ success: false, error: 'Producto no encontrado en catálogo' }, { status: 404 });
      }
      if (!canAccessRecord(user, product)) {
        return NextResponse.json({ success: false, error: 'No autorizado para usar este producto' }, { status: 403 });
      }
      productName = product.name;
      // Para financiamientos originados en inventario, el monto base es el costo registrado del producto
      basePrice = Number(product.costPrice) || 0;

      // Decrement stock if available
      if (product.stock > 0) {
        product.stock -= 1;
      }
    }

    const numericDownPayment = Number(downPayment) || 0;
    const numericRate = Number(interestRate) || 0;
    // Regla de negocio: Total a Pagar = (Monto Base + Intereses/Porcentaje de Ganancia) - Inicial
    // donde Intereses = Monto Base * (Porcentaje / 100)
    const totalInterest = (basePrice * numericRate) / 100;
    const totalAmount = Number(Math.max(0, (basePrice + totalInterest) - numericDownPayment).toFixed(2));
    const financedAmount = Math.max(0, basePrice - numericDownPayment);
    const count = parseInt(installmentCount, 10) || 1;
    const installmentAmount = Number((totalAmount / count).toFixed(2));

    // Generate schedule dates
    const start = startDate ? new Date(startDate) : new Date();
    const installments = [];

    for (let i = 1; i <= count; i++) {
      const dueDate = new Date(start);
      if (frequency === 'semanal') {
        dueDate.setDate(dueDate.getDate() + (i * 7));
      } else if (frequency === 'quincenal') {
        dueDate.setDate(dueDate.getDate() + (i * 14));
      } else {
        dueDate.setMonth(dueDate.getMonth() + i);
      }

      installments.push({
        number: i,
        dueDate: dueDate.toISOString().split('T')[0],
        amount: installmentAmount,
        paid: false,
        paidDate: null,
        receiptRef: null
      });
    }

    const ownerId = client.userId || user?.id || 'usr_admin';
    const newLoan = {
      id: 'ln_' + Date.now(),
      userId: ownerId,
      clientId,
      clientName: client.name,
      type,
      productId: type === 'producto' ? productId : null,
      productName,
      principal: basePrice,
      downPayment: numericDownPayment,
      financedAmount,
      interestRate: numericRate,
      totalAmount,
      installmentCount: count,
      installmentAmount,
      frequency,
      startDate: start.toISOString().split('T')[0],
      notes,
      status: 'al_dia',
      installments,
      createdAt: new Date().toISOString()
    };

    db.loans.unshift(newLoan);
    saveDb(db);

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

export async function DELETE(request) {
  try {
    const db = getDb();
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const user = perm.user || getRequestUser(request, db);
    const isAdmin = user?.role === 'admin';

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ID requerido' }, { status: 400 });

    const loan = (db.loans || []).find(l => l.id === id);
    if (!loan) {
      return NextResponse.json({ success: false, error: 'Financiamiento no encontrado' }, { status: 404 });
    }
    if (!canAccessRecord(user, loan)) {
      return NextResponse.json({ success: false, error: 'No autorizado para dar de baja este financiamiento' }, { status: 403 });
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
      if (!isAdmin && user && item.userId !== loan.userId) return item;

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
    db.clients = (db.clients || []).filter(c => !(c.id === loan.clientId && (isAdmin || c.userId === loan.userId)));

    // Persistir en Lista Negra evitando duplicados por cédula dentro del mismo propietario
    let blacklisted = false;
    if (client && (isAdmin || client.userId === loan.userId)) {
      const ownerId = client.userId || loan.userId || user?.id || 'usr_admin';
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

    saveDb(db);

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

