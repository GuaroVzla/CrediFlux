import { isSupabaseConfigured } from '@/server/supabase/env';
import {
  saveStateForRequest,
  updateLoanPlanAtomic,
} from '@/server/persistence/supabase-store';
import { computeLoanStatus } from '@/shared/lib/db.js';
import type { LoanPlanResult } from './plan';

/**
 * Aplica un plan ya calculado y validado a un financiamiento existente.
 *
 * - Supabase: RPC única y transaccional que sólo toca condiciones de pago.
 * - Legado: mutación del estado JSON seguida de una sola escritura.
 *
 * En ambos casos quedan congelados cliente, productos, stock, monto base y
 * enganche. `payments` y las cuotas pagadas nunca se modifican; el saldo se
 * recalcula descontando ese total abonado.
 */
export async function applyLoanEdit(params: {
  request: Request;
  db: any;
  loan: any;
  plan: LoanPlanResult;
  frequency?: string;
}): Promise<void> {
  const { request, db, loan, plan, frequency } = params;

  if (isSupabaseConfigured()) {
    await updateLoanPlanAtomic({ request, loan: { ...loan, frequency: frequency || loan.frequency }, plan });
    return;
  }

  Object.assign(loan, {
    interestRate: plan.interestRate,
    interestMode: plan.interestMode,
    interestAmount: plan.interestAmount,
    totalAmount: plan.totalAmount,
    installmentCount: plan.installmentCount,
    installmentAmount: plan.installmentAmount,
    frequency: frequency || loan.frequency,
    installments: plan.installments,
    startDate: plan.startDate,
  });

  loan.status = computeLoanStatus(loan);
  if (loan.status === 'completado') {
    loan.completedAt = loan.completedAt || new Date().toISOString().slice(0, 10);
    loan.finalStatus = 'completado';
  } else if (loan.status !== 'archivado') {
    delete loan.completedAt;
    delete loan.finalStatus;
  }

  await saveStateForRequest(request, db);
}
