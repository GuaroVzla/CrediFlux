/**
 * Cálculo puro de pagos aplicados al cronograma de un financiamiento.
 *
 * Regla de negocio:
 * - `Pago de cuota` marca como liquidada la cuota seleccionada.
 * - `Abono` se aplica en orden desde la primera cuota pendiente: liquida las
 *   cuotas que cubre por completo y reduce el saldo de la cuota parcialmente
 *   cubierta. El número total de cuotas nunca se modifica.
 *
 * El módulo no accede a base de datos: lo usa el formulario para la
 * previsualización y el servidor para validar y aplicar el movimiento.
 */

export interface AbonoInstallment {
  number: number;
  dueDate?: string;
  amount: number;
  paid?: boolean;
  paidDate?: string | null;
  receiptRef?: string | null;
  id?: string;
}

export type PaymentInstallment = AbonoInstallment;

export interface AbonoInput {
  installments: AbonoInstallment[];
  /** Monto tecleado por el usuario (se valida y se limita al saldo). */
  amount: unknown;
  paidDate?: string;
  reference?: string;
}

export interface AbonoDistributionItem {
  number: number;
  before: number;
  after: number;
  /** Monto del abono aplicado a esta cuota. */
  applied: number;
  /** La cuota quedó liquidada con este movimiento. */
  settled: boolean;
  /** La cuota recibió abono pero sigue pendiente. */
  partial: boolean;
}

export type PaymentDistributionItem = AbonoDistributionItem;

export interface AbonoCalculation {
  requestedAmount: number;
  appliedAmount: number;
  currentBalance: number;
  newBalance: number;
  /** Cuotas que siguen pendientes tras aplicar el movimiento. */
  remainingInstallments: number;
  /** Cuotas liquidadas por este movimiento. */
  settledInstallments: number;
  /** Cuota con abono parcial, si la hay. */
  partialInstallment: { number: number; remaining: number } | null;
  /** Saldo de la próxima cuota pendiente (0 si ya no hay). */
  installmentAmount: number;
  settled: boolean;
  installments: AbonoInstallment[];
  distribution: AbonoDistributionItem[];
}

export type PaymentCalculation = AbonoCalculation;

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Saldo pendiente con precisión de centavos. */
export function pendingBalance(installments: AbonoInstallment[]): number {
  const pending = Array.isArray(installments) ? installments.filter((i) => !i?.paid) : [];
  return roundMoney(pending.reduce((sum, i) => sum + Math.max(0, finiteNumber(i?.amount)), 0));
}

export function normalizeInstallments(installments: AbonoInstallment[]): AbonoInstallment[] {
  return (Array.isArray(installments) ? installments : [])
    .map((inst) => ({
      ...inst,
      number: Math.floor(finiteNumber(inst?.number, 0)),
      amount: roundMoney(Math.max(0, finiteNumber(inst?.amount))),
    }))
    .sort((a, b) => a.number - b.number);
}

/** Envuelve el resultado con la validación común de montos y saldo. */
export function validatePaymentAmount(
  installments: AbonoInstallment[],
  requested: unknown,
  label: 'abono' | 'pago',
): { normalized: AbonoInstallment[]; currentBalance: number; requested: number; applied: number; settled: boolean } {
  const normalized = normalizeInstallments(installments);
  const pending = normalized.filter((inst) => !inst.paid);

  if (pending.length === 0) {
    throw new Error('El financiamiento no tiene cuotas pendientes');
  }

  const currentBalance = roundMoney(pending.reduce((sum, inst) => sum + inst.amount, 0));
  if (currentBalance <= 0) {
    throw new Error('El financiamiento no tiene saldo pendiente');
  }

  const value = Number(requested);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`El ${label} debe ser mayor que cero`);
  }
  if (value > currentBalance + 0.01) {
    throw new Error(
      `El ${label} ($${value.toFixed(2)}) supera el saldo pendiente ($${currentBalance.toFixed(2)})`,
    );
  }

  let applied = Math.min(roundMoney(value), currentBalance);
  let newBalance = roundMoney(currentBalance - applied);
  const settled = newBalance <= 0 || newBalance < pending.length * 0.01 - 0.001;

  if (settled) {
    applied = currentBalance;
    newBalance = 0;
  }

  return { normalized, currentBalance, requested: value, applied, settled };
}

/** Construye el resultado común a partir del cronograma ya mutado. */
export function buildPaymentResult(params: {
  requested: number;
  applied: number;
  currentBalance: number;
  installments: AbonoInstallment[];
  distribution: AbonoDistributionItem[];
  settledAll: boolean;
}): AbonoCalculation {
  const next = params.installments.filter((inst) => !inst.paid);
  const newBalance = pendingBalance(params.installments);
  const partial = params.distribution.find((item) => item.partial && !item.settled);

  return {
    requestedAmount: params.requested,
    appliedAmount: params.applied,
    currentBalance: params.currentBalance,
    newBalance,
    remainingInstallments: next.length,
    settledInstallments: params.distribution.filter((item) => item.settled).length,
    partialInstallment: partial ? { number: partial.number, remaining: partial.after } : null,
    installmentAmount: next.length > 0 ? next[0].amount : 0,
    settled: params.settledAll || newBalance <= 0,
    installments: params.installments,
    distribution: params.distribution,
  };
}

/**
 * Aplica un abono desde la primera cuota pendiente, marcando como pagadas las
 * cuotas que cubre íntegramente y restando el resto de la cuota parcial.
 */
export function computeAbono(input: AbonoInput): AbonoCalculation {
  const { normalized, currentBalance, requested, applied, settled: settledAll } =
    validatePaymentAmount(input.installments, input.amount, 'abono');

  const distribution: AbonoDistributionItem[] = [];
  let remaining = applied;

  for (const inst of normalized) {
    if (inst.paid || remaining <= 0) continue;

    const before = inst.amount;
    const appliedHere = roundMoney(Math.min(before, remaining));
    const after = roundMoney(before - appliedHere);

    distribution.push({
      number: inst.number,
      before,
      after,
      applied: appliedHere,
      settled: after <= 0,
      partial: after > 0 && appliedHere > 0,
    });

    if (after <= 0) {
      inst.paid = true;
      inst.paidDate = input.paidDate || inst.paidDate || null;
      inst.receiptRef = input.reference || inst.receiptRef || null;
    } else {
      inst.amount = after;
    }

    remaining = roundMoney(remaining - appliedHere);
  }

  return buildPaymentResult({ requested, applied, currentBalance, installments: normalized, distribution, settledAll });
}
