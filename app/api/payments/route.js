import { NextResponse } from 'next/server';
import { computeLoanStatus, checkWritePermission, getRequestUser, canAccessRecord } from '../../../lib/db.js';
import { getStateForRequest, saveStateForRequest } from '../../../lib/server/supabase-store';
import { buildPaymentsBody, normalizeDashboardState } from '../../../lib/server/dashboard-builders';

export async function GET(request) {
  try {
    const db = await getStateForRequest(request);
    normalizeDashboardState(db);
    const user = getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }
    return NextResponse.json(buildPaymentsBody(db, user));
  } catch (error) {
    console.error('Payments GET error:', error);
    return NextResponse.json({ success: false, error: 'Error al obtener pagos' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = await getStateForRequest(request);
    if (!Array.isArray(db.payments)) db.payments = [];
    if (!Array.isArray(db.loans)) db.loans = [];
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }

    const user = perm.user || getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const {
      loanId,
      installmentNumber,
      amount,
      date,
      method = 'Pago Móvil',
      reference = '',
      notes = '',
      payAll = false,
      bcvRate
    } = body;

    if (!loanId) {
      return NextResponse.json({ success: false, error: 'ID de financiamiento requerido' }, { status: 400 });
    }

    const loan = (db.loans || []).find(l => l.id === loanId);
    if (!loan) {
      return NextResponse.json({ success: false, error: 'Financiamiento no encontrado' }, { status: 404 });
    }
    if (!canAccessRecord(user, loan)) {
      return NextResponse.json({ success: false, error: 'No autorizado para registrar pagos en este financiamiento' }, { status: 403 });
    }

    if (loan.archived) {
      return NextResponse.json({ success: false, error: 'Este financiamiento fue dado de baja y no admite pagos' }, { status: 400 });
    }

    const payDate = date || new Date().toISOString().split('T')[0];
    const isPayAll = payAll === true || installmentNumber === 'all' || installmentNumber === 'total';
    const numericBcvRate = Number(bcvRate) > 0 ? Number(bcvRate) : null;

    // Pago total: liquida todas las cuotas pendientes en una sola transacción
    if (isPayAll) {
      const unpaidInstallments = loan.installments.filter(i => !i.paid);
      if (unpaidInstallments.length === 0) {
        return NextResponse.json({ success: false, error: 'No se encontraron cuotas pendientes para este préstamo' }, { status: 400 });
      }

      const totalPending = Number(unpaidInstallments.reduce((sum, i) => sum + (Number(i.amount) || 0), 0).toFixed(2));
      const payAmount = Number.isFinite(Number(amount)) && Number(amount) > 0 ? Number(amount) : totalPending;
      const receiptRef = reference || ('TOTAL-' + Math.floor(1000 + Math.random() * 9000));

      unpaidInstallments.forEach(inst => {
        inst.paid = true;
        inst.paidDate = payDate;
        inst.receiptRef = receiptRef;
      });

      // Recompute loan overall status
      loan.status = computeLoanStatus(loan);

      // Cierre del crédito: se registra la fecha de cancelación total para que
      // el contrato salga de la cartera activa y quede archivado en el Historial.
      if (loan.status === 'completado') {
        loan.completedAt = payDate;
        loan.finalStatus = 'completado';
      }

      // Record consolidated payment in payments history
      const installmentNumbers = unpaidInstallments.map(i => i.number);
      const newPayment = {
        id: 'pay_' + Date.now(),
        userId: loan.userId || user?.id || 'usr_admin',
        loanId: loan.id,
        clientId: loan.clientId || null,
        clientName: loan.clientName,
        installmentNumber: 'total',
        installmentNumbers,
        amount: payAmount,
        amountBs: numericBcvRate ? Number((payAmount * numericBcvRate).toFixed(2)) : null,
        bcvRate: numericBcvRate,
        date: payDate,
        method,
        reference: receiptRef,
        notes: notes || `Pago total de ${unpaidInstallments.length} cuota(s) pendiente(s)`,
        createdAt: new Date().toISOString()
      };

      db.payments.unshift(newPayment);
      await saveStateForRequest(request, db);

      return NextResponse.json({
        success: true,
        message: `Pago total registrado con éxito (${unpaidInstallments.length} cuota(s) liquidadas)`,
        payment: newPayment,
        loanStatus: loan.status
      });
    }

    // Find installment to pay
    let targetInstallment = null;
    if (installmentNumber) {
      targetInstallment = loan.installments.find(i => i.number === parseInt(installmentNumber, 10));
    } else {
      // Find the first unpaid installment
      targetInstallment = loan.installments.find(i => !i.paid);
    }

    if (!targetInstallment) {
      return NextResponse.json({ success: false, error: 'No se encontraron cuotas pendientes para este préstamo' }, { status: 400 });
    }

    const payAmount = Number(amount) || targetInstallment.amount;

    // Mark installment as paid
    targetInstallment.paid = true;
    targetInstallment.paidDate = payDate;
    targetInstallment.receiptRef = reference || ('ABONO-' + Math.floor(1000 + Math.random() * 9000));

    // Recompute loan overall status
    loan.status = computeLoanStatus(loan);

    // Cierre del crédito: se registra la fecha de cancelación total para que
    // el contrato salga de la cartera activa y quede archivado en el Historial.
    if (loan.status === 'completado') {
      loan.completedAt = payDate;
      loan.finalStatus = 'completado';
    }

    // Record payment in payments history
    const newPayment = {
      id: 'pay_' + Date.now(),
      userId: loan.userId || user?.id || 'usr_admin',
      loanId: loan.id,
      clientId: loan.clientId || null,
      clientName: loan.clientName,
      installmentNumber: targetInstallment.number,
      installmentNumbers: [targetInstallment.number],
      amount: payAmount,
      amountBs: numericBcvRate ? Number((payAmount * numericBcvRate).toFixed(2)) : null,
      bcvRate: numericBcvRate,
      date: payDate,
      method,
      reference: targetInstallment.receiptRef,
      notes: notes || `Pago de cuota #${targetInstallment.number}`,
      createdAt: new Date().toISOString()
    };

    db.payments.unshift(newPayment);
    await saveStateForRequest(request, db);

    return NextResponse.json({
      success: true,
      message: `Cuota #${targetInstallment.number} pagada con éxito`,
      payment: newPayment,
      loanStatus: loan.status
    });
  } catch (error) {
    console.error('Payments POST error:', error);
    return NextResponse.json({ success: false, error: 'Error al registrar pago' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const db = await getStateForRequest(request);
    if (!Array.isArray(db.payments)) db.payments = [];
    if (!Array.isArray(db.loans)) db.loans = [];
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const user = perm.user || getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID de pago requerido' }, { status: 400 });
    }

    const paymentIndex = (db.payments || []).findIndex(p => p.id === id);
    if (paymentIndex === -1) {
      return NextResponse.json({ success: false, error: 'Pago no encontrado' }, { status: 404 });
    }

    const payment = db.payments[paymentIndex];
    if (!canAccessRecord(user, payment)) {
      return NextResponse.json({ success: false, error: 'No autorizado para eliminar este pago' }, { status: 403 });
    }
    const loan = (db.loans || []).find(l => l.id === payment.loanId);
    if (loan && !canAccessRecord(user, loan)) {
      return NextResponse.json({ success: false, error: 'No autorizado para modificar el financiamiento asociado' }, { status: 403 });
    }

    // Revertir cuotas asociadas al pago eliminado para mantener la integridad
    // de la cartera y que los cuadros estadísticos se actualicen en tiempo real.
    if (loan && Array.isArray(loan.installments)) {
      let targetNumbers = Array.isArray(payment.installmentNumbers)
        ? payment.installmentNumbers.map(n => parseInt(n, 10)).filter(Number.isFinite)
        : [];

      if (targetNumbers.length === 0) {
        if (payment.installmentNumber === 'total' || payment.installmentNumber === 'all') {
          targetNumbers = loan.installments
            .filter(i => i.paid && (
              (payment.reference && i.receiptRef === payment.reference) ||
              (payment.date && i.paidDate === payment.date)
            ))
            .map(i => i.number);
        } else if (payment.installmentNumber != null) {
          const n = parseInt(payment.installmentNumber, 10);
          if (Number.isFinite(n)) targetNumbers = [n];
        }
      }

      // Fallback conservador: si no se pudo identificar, buscar por ref/fecha
      if (targetNumbers.length === 0 && (payment.reference || payment.date)) {
        targetNumbers = loan.installments
          .filter(i => i.paid && (
            (payment.reference && i.receiptRef === payment.reference) ||
            (!payment.reference && payment.date && i.paidDate === payment.date)
          ))
          .map(i => i.number);
      }

      loan.installments = loan.installments.map(inst => {
        if (!targetNumbers.includes(inst.number)) return inst;
        return {
          ...inst,
          paid: false,
          paidDate: null,
          receiptRef: null
        };
      });

      // Recalcular estado del préstamo; si deja de estar completado, vuelve a la cartera activa
      loan.status = computeLoanStatus(loan);
      if (loan.status !== 'completado' && loan.status !== 'archivado') {
        delete loan.completedAt;
        delete loan.finalStatus;
      }
    }

    db.payments.splice(paymentIndex, 1);
    await saveStateForRequest(request, db);

    return NextResponse.json({
      success: true,
      message: 'Pago eliminado y cartera actualizada',
      loanStatus: loan?.status || null
    });
  } catch (error) {
    console.error('Payments DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Error al eliminar pago' }, { status: 500 });
  }
}

