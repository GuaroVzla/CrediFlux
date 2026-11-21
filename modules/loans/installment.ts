import {
  buildPaymentResult,
  normalizeInstallments,
  roundMoney,
  validatePaymentAmount,
  type AbonoCalculation,
  type AbonoDistributionItem,
  type AbonoInstallment,
} from './abono';

export interface InstallmentPaymentInput {
  installments: AbonoInstallment[];
  /** Número de cuota preseleccionado por el formulario. */
  installmentNumber: unknown;
  /** Monto mostrado al usuario; si se omite se toma el de la cuota. */
  amount?: unknown;
  paidDate?: string;
  reference?: string;
}

/** Marca como pagada una cuota concreta del cronograma. */
export function computeInstallmentPayment(input: InstallmentPaymentInput): AbonoCalculation {
  const normalized = normalizeInstallments(input.installments);
  const number = Math.floor(Number(input.installmentNumber));
  const target = normalized.find((inst) => inst.number === number);

  if (!target) {
    throw new Error(`No se encontró la cuota #${input.installmentNumber}`);
  }
  if (target.paid) {
    throw new Error(`La cuota #${number} ya fue cancelada`);
  }

  const expected = roundMoney(target.amount);
  const requested = input.amount == null || input.amount === '' ? expected : Number(input.amount);
  if (Number.isFinite(requested) && Math.abs(requested - expected) > 0.01) {
    throw new Error(`El monto debe coincidir con la cuota #${number} ($${expected.toFixed(2)})`);
  }

  const { currentBalance, requested: validRequested, settled } = validatePaymentAmount(
    normalized,
    expected,
    'pago',
  );

  const before = target.amount;
  target.paid = true;
  target.paidDate = input.paidDate || target.paidDate || null;
  target.receiptRef = input.reference || target.receiptRef || null;

  const distribution: AbonoDistributionItem[] = [{
    number: target.number,
    before,
    after: 0,
    applied: expected,
    settled: true,
    partial: false,
  }];

  return buildPaymentResult({
    requested: validRequested,
    applied: expected,
    currentBalance,
    installments: normalized,
    distribution,
    settledAll: settled,
  });
}
