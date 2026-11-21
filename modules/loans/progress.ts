import { pendingBalance, roundMoney, type AbonoInstallment } from './abono';

export interface LoanProgressInput {
  totalAmount?: unknown;
  installmentCount?: unknown;
  installments?: AbonoInstallment[];
}

export interface LoanProgress {
  /** Total original pactado; nunca se reduce por pagos ni abonos. */
  totalAmount: number;
  /** Cantidad original de cuotas; nunca se reduce por pagos ni abonos. */
  totalInstallments: number;
  fullyPaidCount: number;
  /** Cuotas cubiertas incluyendo abonos parciales (puede ser decimal). */
  coveredInstallments: number;
  /** Cuotas restantes en equivalente (puede ser decimal). */
  remainingEquivalent: number;
  collectedAmount: number;
  pendingAmount: number;
  progressPercent: number;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function computeLoanProgress(loan: LoanProgressInput): LoanProgress {
  const installments = Array.isArray(loan.installments) ? loan.installments : [];
  const totalInstallments = Math.max(
    positiveInt(loan.installmentCount, 0),
    installments.length,
    1,
  );
  const scheduleTotal = roundMoney(
    installments.reduce((sum, inst) => sum + Math.max(0, Number(inst?.amount) || 0), 0),
  );
  const totalAmount = roundMoney(Math.max(0, Number(loan.totalAmount) || scheduleTotal));
  const pendingAmount = Math.min(pendingBalance(installments), totalAmount || Infinity);
  const collectedAmount = roundMoney(
    Math.min(Math.max(totalAmount - pendingAmount, 0), totalAmount || 0),
  );
  const fullyPaidCount = installments.filter((inst) => Boolean(inst?.paid)).length;

  let coveredInstallments = fullyPaidCount;
  let progressPercent = 0;

  if (totalAmount > 0) {
    coveredInstallments = roundMoney(
      Math.min((collectedAmount * totalInstallments) / totalAmount, totalInstallments),
    );
    progressPercent = Math.min(100, Math.round((collectedAmount / totalAmount) * 100));
  } else if (pendingAmount <= 0) {
    progressPercent = 100;
  }

  coveredInstallments = Math.min(Math.max(coveredInstallments, 0), totalInstallments);

  return {
    totalAmount,
    totalInstallments,
    fullyPaidCount,
    coveredInstallments,
    remainingEquivalent: roundMoney(Math.max(totalInstallments - coveredInstallments, 0)),
    collectedAmount,
    pendingAmount,
    progressPercent,
  };
}
