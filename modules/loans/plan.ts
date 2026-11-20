/**
 * Cálculo puro de planes de financiamiento.
 *
 * Lo usan tanto el alta como la edición para no duplicar reglas de negocio.
 * Todo lo que aquí se valida es independiente del medio de persistencia: en
 * modo Supabase el RPC vuelve a comprobar stock y propiedad dentro de una
 * transacción; en modo legado se aplica sobre el JSON local.
 */

export type InterestMode = 'percent' | 'fixed';

export interface LoanItemInput {
  productId: string;
  quantity: number;
}

export interface LoanInstallmentInput {
  number: number;
  dueDate?: string;
  amount: number;
  paid?: boolean;
  paidDate?: string | null;
  receiptRef?: string | null;
}

export interface LoanPlanInput {
  type: string;
  items: LoanItemInput[];
  products: any[];
  manualPrincipal?: number | null;
  downPayment: number;
  interestMode?: InterestMode;
  interestRate: number;
  interestAmount?: number | null;
  installmentCount: number;
  frequency: string;
  startDate: string;
  existingInstallments?: LoanInstallmentInput[];
  existingItems?: LoanItemInput[];
  /** Fuente de verdad contable: suma de pagos confirmados (tabla `payments`). */
  paidAmountOverride?: number;
  /** En edición la base se toma del préstamo guardado, no del catálogo actual. */
  fixedPrincipal?: number;
  fixedProductName?: string;
}

export interface StockDelta {
  productId: string;
  delta: number;
  name: string;
}

export interface LoanPlanResult {
  principal: number;
  downPayment: number;
  financedAmount: number;
  interestAmount: number;
  /** Porcentaje equivalente guardado en la columna histórica interest_rate. */
  interestRate: number;
  interestMode: InterestMode;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  installmentCount: number;
  installmentAmount: number;
  items: LoanItemInput[];
  productId: string | null;
  productName: string;
  installments: LoanInstallmentInput[];
  stockDeltas: StockDelta[];
  startDate: string;
}

const VALID_FREQUENCIES = ['diario', 'semanal', 'quincenal', 'mensual'];

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateOnly(value: unknown): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : new Date(String(value)).toISOString().slice(0, 10);
}

function addPeriods(start: string, periods: number, frequency: string): string {
  const date = new Date(`${start}T00:00:00Z`);
  if (frequency === 'diario') date.setUTCDate(date.getUTCDate() + periods);
  else if (frequency === 'semanal') date.setUTCDate(date.getUTCDate() + periods * 7);
  else if (frequency === 'quincenal') date.setUTCDate(date.getUTCDate() + periods * 14);
  else date.setUTCMonth(date.getUTCMonth() + periods);
  return date.toISOString().slice(0, 10);
}

/** Productos del préstamo. Los préstamos antiguos sólo tenían productId. */
export function getLoanItems(loan: any): LoanItemInput[] {
  if (Array.isArray(loan?.items) && loan.items.length > 0) {
    return loan.items
      .map((item: any) => ({
        productId: String(item?.productId || item?.product_id || ''),
        quantity: Math.max(1, Math.floor(finiteNumber(item?.quantity, 1))),
      }))
      .filter((item: LoanItemInput) => Boolean(item.productId));
  }
  if (loan?.productId) {
    return [{ productId: String(loan.productId), quantity: 1 }];
  }
  return [];
}

function groupItems(items: LoanItemInput[]): LoanItemInput[] {
  const byProduct = new Map<string, number>();
  for (const item of items) {
    if (!item.productId) continue;
    const quantity = Math.floor(finiteNumber(item.quantity, 0));
    if (!Number.isFinite(quantity) || quantity < 1) {
      throw new Error('La cantidad de cada producto debe ser al menos 1');
    }
    byProduct.set(item.productId, (byProduct.get(item.productId) || 0) + quantity);
  }
  return Array.from(byProduct, ([productId, quantity]) => ({ productId, quantity }));
}

function calculateStockDeltas(oldItems: LoanItemInput[], newItems: LoanItemInput[], products: any[]): StockDelta[] {
  const oldQty = new Map(oldItems.map((item) => [item.productId, item.quantity]));
  const newQty = new Map(newItems.map((item) => [item.productId, item.quantity]));
  const ids = new Set([...oldQty.keys(), ...newQty.keys()]);
  const deltas: StockDelta[] = [];

  for (const productId of ids) {
    const delta = (newQty.get(productId) || 0) - (oldQty.get(productId) || 0);
    if (delta === 0) continue;
    const product = products.find((p) => String(p?.id) === productId);
    const currentStock = Math.floor(finiteNumber(product?.stock, 0));
    if (currentStock - delta < 0) {
      throw new Error(`Stock insuficiente para ${product?.name || 'el producto seleccionado'}`);
    }
    deltas.push({ productId, delta, name: product?.name || '' });
  }
  return deltas;
}

/**
 * Construye el plan completo: montos, cronograma (conservando las cuotas ya
 * pagadas y sus comprobantes) y deltas de inventario.
 */
export function computeLoanPlan(input: LoanPlanInput): LoanPlanResult {
  const type = input.type === 'producto' ? 'producto' : 'dinero';
  const products = Array.isArray(input.products) ? input.products : [];
  const existingInstallments = Array.isArray(input.existingInstallments) ? input.existingInstallments : [];
  const frequency = VALID_FREQUENCIES.includes(input.frequency) ? input.frequency : 'mensual';
  const interestMode: InterestMode = input.interestMode === 'fixed' ? 'fixed' : 'percent';

  const downPayment = finiteNumber(input.downPayment, 0);
  const rate = Math.max(0, finiteNumber(input.interestRate, 0));
  const fixedInterest = Math.max(0, finiteNumber(input.interestAmount, 0));
  const count = Math.floor(finiteNumber(input.installmentCount, 0));

  if (downPayment < 0 || !Number.isFinite(downPayment)) throw new Error('El enganche no puede ser negativo');
  if (!Number.isFinite(count) || count < 1 || count > 360) throw new Error('La cantidad de cuotas debe estar entre 1 y 360');
  if (!Number.isFinite(rate) || !Number.isFinite(fixedInterest)) throw new Error('Los intereses no son válidos');

  const paid = existingInstallments
    .filter((inst) => Boolean(inst?.paid))
    .map((inst) => ({ ...inst, number: Math.floor(finiteNumber(inst.number, 0)) }))
    .sort((a, b) => a.number - b.number);
  const paidCount = paid.length;
  if (count < paidCount) {
    throw new Error(`La cantidad de cuotas no puede ser menor a las ${paidCount} ya pagadas`);
  }
  const paidAmount = round2(input.paidAmountOverride !== undefined
    ? Math.max(0, finiteNumber(input.paidAmountOverride, 0))
    : paid.reduce((sum, inst) => sum + finiteNumber(inst.amount), 0));
  const lastPaidNumber = paidCount > 0 ? paid[paidCount - 1].number : 0;
  const unpaidCount = count - paidCount;

  let principal: number;
  let items: LoanItemInput[] = [];
  let productId: string | null = null;
  let productName = 'Préstamo en Efectivo';

  if (type === 'producto') {
    items = groupItems(Array.isArray(input.items) ? input.items : []);
    principal = 0;

    if (input.fixedPrincipal !== undefined) {
      // Edición: el monto base y el nombre quedan congelados aunque el
      // catálogo haya cambiado de precio desde que se originó el crédito.
      principal = round2(Math.max(0, finiteNumber(input.fixedPrincipal, 0)));
      productId = items[0]?.productId || null;
      productName = input.fixedProductName || '';
    } else {
      if (items.length === 0) throw new Error('Debe seleccionar al menos un producto');
      const names: string[] = [];
      for (const item of items) {
        const product = products.find((p) => String(p?.id) === item.productId);
        if (!product) throw new Error('Uno de los productos ya no está en el catálogo');
        if (Math.floor(finiteNumber(product.stock, 0)) < 0) throw new Error('Stock no disponible');
        principal += finiteNumber(product.costPrice) * item.quantity;
        names.push(String(product.name || 'Producto'));
      }
      principal = round2(principal);
      productId = items[0].productId;
      productName = names.join(', ');
    }
  } else {
    principal = round2(Math.max(0, finiteNumber(input.manualPrincipal, 0)));
  }

  if (!(principal > 0)) throw new Error('Ingresa un monto base válido');
  if (downPayment > principal) throw new Error('El enganche no puede superar el monto base');

  const interestAmount = round2(interestMode === 'fixed' ? fixedInterest : principal * (rate / 100));
  const equivalentRate = principal > 0 ? round2((interestAmount / principal) * 100) : 0;
  const totalAmount = round2(Math.max(0, principal + interestAmount - downPayment));
  const financedAmount = round2(Math.max(0, principal - downPayment));
  // Integridad contable: el nuevo plan no puede dejar "en negativo" lo que el
  // cliente ya pagó. Los pagos históricos nunca se reescriben.
  if (totalAmount + 0.001 < paidAmount) {
    throw new Error(`El nuevo total ($${totalAmount.toFixed(2)}) no puede ser menor al monto ya abonado ($${paidAmount.toFixed(2)})`);
  }
  const remainingAmount = round2(Math.max(0, totalAmount - paidAmount));

  const installments: LoanInstallmentInput[] = paid.map((inst) => ({
    number: inst.number,
    dueDate: dateOnly(inst.dueDate),
    amount: round2(finiteNumber(inst.amount)),
    paid: true,
    paidDate: inst.paidDate || null,
    receiptRef: inst.receiptRef || null,
  }));

  const basePerInstallment = unpaidCount > 0 ? remainingAmount / unpaidCount : 0;

  let assigned = 0;
  for (let index = 1; index <= unpaidCount; index++) {
    const number = lastPaidNumber + index;
    const isLast = index === unpaidCount;
    const amount = isLast ? round2(remainingAmount - assigned) : round2(basePerInstallment);
    if (amount <= 0) {
      throw new Error('El monto por cuota es mayor al saldo pendiente');
    }
    assigned = round2(assigned + amount);
    installments.push({
      number,
      dueDate: addPeriods(dateOnly(input.startDate), number, frequency),
      amount,
      paid: false,
      paidDate: null,
      receiptRef: null,
    });
  }

  const stockDeltas = calculateStockDeltas(
    Array.isArray(input.existingItems) ? groupItems(input.existingItems) : [],
    items,
    products
  );

  return {
    principal,
    downPayment,
    financedAmount,
    interestAmount,
    interestRate: equivalentRate,
    interestMode,
    totalAmount,
    paidAmount,
    remainingAmount,
    installmentCount: count,
    installmentAmount: round2(unpaidCount > 0 ? basePerInstallment : 0),
    items,
    productId,
    productName,
    installments: installments.sort((a, b) => a.number - b.number),
    stockDeltas,
    startDate: dateOnly(input.startDate),
  };
}
