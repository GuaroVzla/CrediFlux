import { NextResponse } from 'next/server';
import {
  computeLoanStatus, checkWritePermission, getRequestUser, canAccessRecord,
  getStateForRequest, saveStateForRequest, buildPaymentsBody, normalizeDashboardState,
} from '@/modules/payments/service';
import { computeAbono, pendingBalance } from '@/modules/loans/abono';
import { computeInstallmentPayment } from '@/modules/loans/installment';
import { computeLoanProgress } from '@/modules/loans/progress';
import { applyLoanPayment } from '@/modules/loans/apply';

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
    const { loanId, installmentNumber, amount, date, payAll = false, bcvRate } = body;

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
    const numericBcvRate = Number(bcvRate) > 0 ? Number(bcvRate) : null;
    const isTotal = payAll === true || installmentNumber === 'all' || installmentNumber === 'total';
    const mode = body.mode === 'abono' || isTotal ? 'abono' : 'cuota';

    let calculation;
    try {
      if (mode === 'abono') {
        const balance = pendingBalance(loan.installments || []);
        calculation = computeAbono({
          installments: loan.installments || [],
          amount: isTotal || amount == null || amount === '' ? balance : amount,
          paidDate: payDate,
        });
      } else {
        calculation = computeInstallmentPayment({
          installments: loan.installments || [],
          installmentNumber: installmentNumber || (loan.installments || []).find(i => !i.paid)?.number,
          amount,
          paidDate: payDate,
        });
      }
    } catch (error) {
      const message = error?.message || 'No se pudo calcular el pago';
      const status = /supera el saldo|ya fue cancelada|no se encontró la cuota/i.test(message) ? 409 : 400;
      return NextResponse.json({ success: false, error: message }, { status });
    }

    const progress = computeLoanProgress({ ...loan, installments: calculation.installments });
    const paidNumbers = calculation.distribution.filter(d => d.settled).map(d => d.number);
    const kind = mode === 'abono' ? 'abono' : 'cuota';
    const receiptRef = `${kind === 'abono' ? 'ABONO' : 'CUOTA'}-${Math.floor(1000 + Math.random() * 9000)}`;
    const partialNote = calculation.partialInstallment
      ? ` • cuota #${calculation.partialInstallment.number} queda en $${calculation.partialInstallment.remaining.toFixed(2)}`
      : '';
    const notes = kind === 'abono'
      ? `${calculation.settled ? 'Liquidación' : 'Abono'} sobre ${paidNumbers.length} cuota(s)${partialNote}`
      : `Pago de cuota #${paidNumbers[0]}`;

    const newPayment = {
      id: 'pay_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000),
      userId: loan.userId || user?.id || 'usr_admin',
      loanId: loan.id,
      clientId: loan.clientId || null,
      clientName: loan.clientName,
      kind,
      installmentNumber: kind === 'cuota' ? paidNumbers[0] : null,
      installmentNumbers: paidNumbers,
      amount: calculation.appliedAmount,
      amountBs: numericBcvRate ? Number((calculation.appliedAmount * numericBcvRate).toFixed(2)) : null,
      bcvRate: numericBcvRate,
      date: payDate,
      method: kind === 'abono' ? 'Abono' : 'Pago de cuota',
      reference: receiptRef,
      notes,
      metadata: {
        kind,
        balanceBefore: calculation.currentBalance,
        balanceAfter: calculation.newBalance,
        appliedAmount: calculation.appliedAmount,
        previousInstallmentAmount: Number(loan.installmentAmount) || 0,
        previousInstallments: calculation.distribution.map(d => ({ number: d.number, amount: d.before })),
        appliedToInstallments: calculation.distribution,
        nextInstallments: calculation.installments.filter(i => !i.paid).map(i => ({ number: i.number, amount: i.amount })),
        settledInstallments: calculation.settledInstallments,
        partialInstallment: calculation.partialInstallment,
        settled: calculation.settled,
        ...progress,
      },
      createdAt: new Date().toISOString()
    };

    try {
      const { result } = await applyLoanPayment({ request, db, loan, calculation, payment: newPayment });
      const message = calculation.settled
        ? `Financiamiento liquidado (${calculation.settledInstallments} cuota(s) cerrada(s))`
        : kind === 'abono'
          ? `Abono de $${result.appliedAmount.toFixed(2)} registrado. ${calculation.settledInstallments} cuota(s) liquidadas. Saldo: $${result.newBalance.toFixed(2)}`
          : `Cuota #${paidNumbers[0]} pagada. Saldo: $${result.newBalance.toFixed(2)}`;

      return NextResponse.json({
        success: true,
        message,
        payment: newPayment,
        preview: { ...result, ...progress },
        loanStatus: result.status
      });
    } catch (error) {
      console.error('Payments POST error:', error);
      const message = error?.message || 'No se pudo registrar el pago';
      const status = /abono|saldo|cronograma|autenticado|encontrado|instalada/i.test(message) ? 409 : 500;
      return NextResponse.json({ success: false, error: message }, { status });
    }
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
      if (payment.metadata?.kind === 'abono' || payment.metadata?.kind === 'cuota') {
        // El movimiento guardó el cronograma previo. Sólo se restaura si es el
        // más reciente: con pagos posteriores, restaurarlo sobrescribiría un
        // cronograma más nuevo.
        const isLatest = !(db.payments || []).some(p =>
          p.id !== payment.id &&
          String(p.loanId) === String(payment.loanId) &&
          new Date(p.createdAt || 0) > new Date(payment.createdAt || 0)
        );
        if (isLatest && Array.isArray(payment.metadata.previousInstallments)) {
          const before = new Map(payment.metadata.previousInstallments.map(i => [Number(i.number), Number(i.amount)]));
          loan.installments = loan.installments.map(inst => before.has(Number(inst.number))
            ? { ...inst, amount: before.get(Number(inst.number)), paid: false, paidDate: null, receiptRef: null }
            : inst);
          if (Number.isFinite(Number(payment.metadata.previousInstallmentAmount))) {
            loan.installmentAmount = Number(payment.metadata.previousInstallmentAmount);
          }
        }
        loan.status = computeLoanStatus(loan);
        if (loan.status !== 'completado' && loan.status !== 'archivado') {
          delete loan.completedAt;
          delete loan.finalStatus;
        }
      } else {
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
      }

      // Recalcular estado del préstamo; si deja de estar completado, vuelve a la cartera activa
      loan.status = computeLoanStatus(loan);
      if (loan.status !== 'completado' && loan.status !== 'archivado') {
        delete loan.completedAt;
        delete loan.finalStatus;
      }

      const progress = computeLoanProgress(loan);
      loan.progressPercent = progress.progressPercent;
      loan.coveredInstallments = progress.coveredInstallments;
      loan.remainingEquivalent = progress.remainingEquivalent;
      loan.paidAmount = progress.collectedAmount;
      loan.pendingAmount = progress.pendingAmount;
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

