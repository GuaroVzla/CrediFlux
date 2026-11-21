import { isSupabaseConfigured } from '@/server/supabase/env';
import {
  registerLoanPaymentAtomic,
  saveStateForRequestWithResult,
  type PaymentRpcResult,
} from '@/server/persistence/supabase-store';
import { computeLoanStatus } from '@/shared/lib/db.js';
import { computeLoanProgress } from './progress';
import type { PaymentCalculation } from './abono';

type AnyRecord = Record<string, any>;

/**
 * Aplica un pago/abono ya calculado y validado.
 *
 * - Supabase: RPC única y transaccional (fila bloqueada + payments + cuotas +
 *   saldo, contador de cuotas y progreso). No reescribe el estado completo.
 * - Legado: mutación del estado JSON y una sola escritura.
 */
export async function applyLoanPayment(params: {
  request: Request;
  db: AnyRecord;
  loan: AnyRecord;
  calculation: PaymentCalculation;
  payment: AnyRecord;
}): Promise<{ result: PaymentRpcResult; persisted: 'supabase' | 'legacy' }> {
  const { request, db, loan, calculation, payment } = params;

  if (isSupabaseConfigured()) {
    const result = await registerLoanPaymentAtomic({ request, loan, calculation, payment });
    payment.id = result.paymentId;
    payment.amount = result.appliedAmount;
    syncLoan(loan, calculation, payment, result);
    return { result, persisted: 'supabase' };
  }

  syncLoan(loan, calculation, payment);
  db.payments.unshift(payment);

  const saved = await saveStateForRequestWithResult(request, db);
  if (!saved.ok) throw new Error(saved.error || 'No se pudo guardar el pago');

  const progress = computeLoanProgress(loan);
  return {
    result: {
      paymentId: String(payment.id),
      appliedAmount: calculation.appliedAmount,
      currentBalance: calculation.currentBalance,
      newBalance: calculation.newBalance,
      remainingInstallments: progress.remainingEquivalent,
      settledInstallments: calculation.settledInstallments,
      partialInstallment: calculation.partialInstallment,
      installmentAmount: calculation.installmentAmount,
      settled: calculation.settled,
      status: loan.status,
      ...progress,
    },
    persisted: 'legacy',
  };
}

function syncLoan(
  loan: AnyRecord,
  calculation: PaymentCalculation,
  payment: AnyRecord,
  result?: Partial<PaymentRpcResult>,
): void {
  loan.installments = calculation.installments;
  loan.installmentAmount = calculation.installmentAmount;
  loan.status = computeLoanStatus(loan);

  if (loan.status === 'completado') {
    loan.completedAt = payment.date;
    loan.finalStatus = 'completado';
  } else {
    delete loan.completedAt;
    delete loan.finalStatus;
  }

  const progress = computeLoanProgress(loan);
  Object.assign(loan, {
    progressPercent: result?.progressPercent ?? progress.progressPercent,
    coveredInstallments: result?.coveredInstallments ?? progress.coveredInstallments,
    remainingEquivalent: result?.remainingEquivalent ?? progress.remainingEquivalent,
    paidAmount: result?.collectedAmount ?? progress.collectedAmount,
    pendingAmount: result?.pendingAmount ?? progress.pendingAmount,
  });
}
