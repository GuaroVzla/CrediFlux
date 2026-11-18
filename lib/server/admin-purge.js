import { getPrisma } from '../prisma.js';
import { computeLoanStatus } from '../db.js';

/**
 * Opciones del modal "Vaciar datos del sistema" (Admin Settings).
 * Orden estable también usado por el toggle "Seleccionar todos" en la UI.
 */
export const PURGE_TARGET_KEYS = [
  'payments',
  'loans',
  'clients',
  'products',
  'ecommerce',
  'capital',
];

export function normalizePurgeTargets(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const targets = {};
  for (const key of PURGE_TARGET_KEYS) {
    targets[key] = input[key] === true || input[key] === 'true';
  }
  return targets;
}

export function hasSelectedPurgeTargets(targets) {
  return PURGE_TARGET_KEYS.some((key) => Boolean(targets?.[key]));
}

function dateStrOf(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function matchesPeriod(dateStr, filter) {
  if (!filter || !filter.period || filter.period === 'all') return true;
  if (!dateStr) return false;
  const { period, day, month, year, until } = filter;
  if (period === 'day') return day ? dateStr === String(day).slice(0, 10) : true;
  if (period === 'month') return month ? dateStr.startsWith(String(month)) : true;
  if (period === 'year') return year ? dateStr.startsWith(String(year)) : true;
  if (period === 'until') return until ? dateStr <= String(until).slice(0, 10) : true;
  return true;
}

/**
 * Calcula (sin persistir) qué registros del usuario destino deben borrarse.
 * Toda comparación exige userId === targetUserId: nunca se incluyen registros
 * de otros usuarios, incluso si el estado recibido es compartido (modo legacy).
 */
export function buildPurgePlan(state, { targetUserId, targets, filter }) {
  const nextDb = JSON.parse(JSON.stringify(state || {}));
  nextDb.loans = Array.isArray(nextDb.loans) ? nextDb.loans : [];
  nextDb.payments = Array.isArray(nextDb.payments) ? nextDb.payments : [];
  nextDb.clients = Array.isArray(nextDb.clients) ? nextDb.clients : [];
  nextDb.products = Array.isArray(nextDb.products) ? nextDb.products : [];
  nextDb.ecommerce = Array.isArray(nextDb.ecommerce) ? nextDb.ecommerce : [];
  nextDb.capitalMovements = Array.isArray(nextDb.capitalMovements) ? nextDb.capitalMovements : [];

  const ownedByTarget = (item) =>
    Boolean(item) && String(item.userId ?? item.user_id) === String(targetUserId);

  const loanIds = new Set();
  const paymentIds = new Set();
  const clientIds = new Set();
  const productIds = new Set();
  const ecommerceIds = new Set();
  const capitalIds = new Set();

  if (targets.loans) {
    for (const loan of nextDb.loans) {
      if (ownedByTarget(loan) && matchesPeriod(dateStrOf(loan.createdAt || loan.startDate), filter)) {
        loanIds.add(String(loan.id));
      }
    }
  }

  if (targets.payments) {
    for (const payment of nextDb.payments) {
      if (!ownedByTarget(payment)) continue;
      if (loanIds.has(String(payment.loanId))) continue; // se elimina con su financiamiento
      if (matchesPeriod(dateStrOf(payment.date || payment.createdAt), filter)) {
        paymentIds.add(String(payment.id));
      }
    }
  }

  // Los pagos vinculados a financiamientos borrados se eliminan siempre para
  // no dejar registros huérfanos en el historial.
  if (targets.loans) {
    for (const payment of nextDb.payments) {
      if (ownedByTarget(payment) && loanIds.has(String(payment.loanId))) {
        paymentIds.add(String(payment.id));
      }
    }
  }

  // Revertir cuotas de los pagos eliminados en financiamientos que se conservan.
  for (const payment of nextDb.payments) {
    if (!paymentIds.has(String(payment.id))) continue;
    if (loanIds.has(String(payment.loanId))) continue;

    const loan = nextDb.loans.find((l) => String(l.id) === String(payment.loanId));
    if (!loan || !Array.isArray(loan.installments)) continue;

    let targetNumbers = Array.isArray(payment.installmentNumbers)
      ? payment.installmentNumbers.map((n) => parseInt(n, 10)).filter(Number.isFinite)
      : [];
    if (targetNumbers.length === 0) {
      if (payment.installmentNumber === 'total' || payment.installmentNumber === 'all') {
        targetNumbers = loan.installments
          .filter((i) => i.paid && ((payment.reference && i.receiptRef === payment.reference) || (payment.date && i.paidDate === payment.date)))
          .map((i) => i.number);
      } else if (payment.installmentNumber != null) {
        const n = parseInt(payment.installmentNumber, 10);
        if (Number.isFinite(n)) targetNumbers = [n];
      }
    }
    if (targetNumbers.length === 0 && (payment.reference || payment.date)) {
      targetNumbers = loan.installments
        .filter((i) => i.paid && ((payment.reference && i.receiptRef === payment.reference) || (!payment.reference && payment.date && i.paidDate === payment.date)))
        .map((i) => i.number);
    }

    if (targetNumbers.length === 0) continue;
    loan.installments = loan.installments.map((inst) =>
      targetNumbers.includes(inst.number)
        ? { ...inst, paid: false, paidDate: null, receiptRef: null }
        : inst
    );
    loan.status = computeLoanStatus(loan);
    if (loan.status !== 'completado') {
      delete loan.completedAt;
      delete loan.finalStatus;
    }
  }

  if (targets.clients) {
    for (const client of nextDb.clients) {
      if (ownedByTarget(client) && matchesPeriod(dateStrOf(client.createdAt || client.registeredAt), filter)) {
        clientIds.add(String(client.id));
      }
    }
  }

  if (targets.products) {
    for (const product of nextDb.products) {
      if (ownedByTarget(product) && matchesPeriod(dateStrOf(product.createdAt), filter)) {
        productIds.add(String(product.id));
      }
    }
  }

  if (targets.ecommerce) {
    for (const tx of nextDb.ecommerce) {
      if (ownedByTarget(tx) && matchesPeriod(dateStrOf(tx.date || tx.createdAt), filter)) {
        ecommerceIds.add(String(tx.id));
      }
    }
  }

  if (targets.capital) {
    for (const movement of nextDb.capitalMovements) {
      if (ownedByTarget(movement) && matchesPeriod(dateStrOf(movement.createdAt), filter)) {
        capitalIds.add(String(movement.id));
      }
    }

    // "Monto de capital operativo": importes mensuales y capital de e-commerce
    // del usuario destino. En Supabase se corrige también user_settings.
    const targetUser = (nextDb.users || []).find((u) => String(u?.id) === String(targetUserId));
    if (targetUser) targetUser.monthlyCapitals = {};
    if (targetUser?.role === 'admin' && nextDb.settings) {
      nextDb.settings.ecommerceCapital = 0;
    }
  }

  nextDb.loans = nextDb.loans.filter((item) => !loanIds.has(String(item.id)));
  nextDb.payments = nextDb.payments.filter((item) => !paymentIds.has(String(item.id)));
  nextDb.clients = nextDb.clients.filter((item) => !clientIds.has(String(item.id)));
  nextDb.products = nextDb.products.filter((item) => !productIds.has(String(item.id)));
  nextDb.ecommerce = nextDb.ecommerce.filter((item) => !ecommerceIds.has(String(item.id)));
  nextDb.capitalMovements = nextDb.capitalMovements.filter((item) => !capitalIds.has(String(item.id)));

  const ids = {
    payments: [...paymentIds],
    loans: [...loanIds],
    clients: [...clientIds],
    products: [...productIds],
    ecommerce: [...ecommerceIds],
    capital: [...capitalIds],
  };

  return {
    nextDb,
    ids,
    resetCapital: Boolean(targets.capital),
    summary: {
      payments: ids.payments.length,
      loans: ids.loans.length,
      clients: ids.clients.length,
      products: ids.products.length,
      ecommerce: ids.ecommerce.length,
      capital: ids.capital.length,
    },
  };
}

function isMissingRpcFunction(error) {
  const message = String(error?.message || '');
  return error?.code === 'PGRST202' || /could not find the function|no function matches/i.test(message);
}

/**
 * Ejecuta la purga Supabase como UNA transacción de base de datos.
 * Preferimos la función SQL (single round-trip, atómica). Si la migración aún
 * no está aplicada se usa Prisma $transaction con SQL crudo, también atómico.
 */
async function purgeSupabaseAtomically(targetUserId, ids, resetCapital, getSupabaseAdminClientOrNull) {
  const admin = getSupabaseAdminClientOrNull();
  if (admin) {
    const { error } = await admin.rpc('admin_purge_user_system_data', {
      p_target_user_id: targetUserId,
      p_payment_ids: ids.payments,
      p_loan_ids: ids.loans,
      p_client_ids: ids.clients,
      p_product_ids: ids.products,
      p_ecommerce_ids: ids.ecommerce,
      p_capital_ids: ids.capital,
      p_reset_capital: resetCapital,
    });
    if (!error) return true;
    if (!isMissingRpcFunction(error)) {
      throw new Error(`Purga atómica fallida: ${error.message}`);
    }
  }

  const prisma = getPrisma();
  if (!prisma) return false;

  const statements = [];

  if (ids.payments.length > 0) {
    statements.push(prisma.$executeRaw`
      UPDATE public.loan_installments i
         SET paid = false, paid_date = NULL, receipt_ref = NULL, updated_at = now()
        FROM public.payments p
       WHERE p.user_id = ${targetUserId}::uuid
         AND p.id::text = ANY(${ids.payments})
         AND NOT (p.loan_id::text = ANY(${ids.loans}))
         AND i.user_id = ${targetUserId}::uuid
         AND i.loan_id = p.loan_id
         AND (
           i.id = p.installment_id
           OR (p.installment_number IS NOT NULL AND i.installment_number = p.installment_number)
           OR (p.reference IS NOT NULL AND i.receipt_ref = p.reference)
         )
    `);
    statements.push(prisma.$executeRaw`
      UPDATE public.loans l
         SET status = CASE
               WHEN NOT EXISTS (
                 SELECT 1 FROM public.loan_installments x WHERE x.loan_id = l.id AND NOT x.paid
               ) THEN 'completado'
               WHEN EXISTS (
                 SELECT 1 FROM public.loan_installments x
                  WHERE x.loan_id = l.id AND NOT x.paid AND x.due_date < CURRENT_DATE
               ) THEN 'moroso'
               WHEN EXISTS (
                 SELECT 1 FROM public.loan_installments x
                  WHERE x.loan_id = l.id AND NOT x.paid
                    AND x.due_date <= CURRENT_DATE + INTERVAL '3 days'
               ) THEN 'proximo'
               ELSE 'al_dia'
             END,
             final_status = NULL,
             updated_at = now()
       WHERE l.user_id = ${targetUserId}::uuid
         AND NOT l.archived
         AND NOT (l.id::text = ANY(${ids.loans}))
         AND l.id IN (
           SELECT DISTINCT p2.loan_id FROM public.payments p2
            WHERE p2.user_id = ${targetUserId}::uuid AND p2.id::text = ANY(${ids.payments})
         )
    `);
  }

  // Cada DELETE lleva el filtro user_id: la transacción no puede afectar
  // registros de otro usuario aunque llegaran IDs manipulados desde el cliente.
  if (ids.payments.length > 0) {
    statements.push(prisma.$executeRaw`
      DELETE FROM public.payments
       WHERE user_id = ${targetUserId}::uuid AND id::text = ANY(${ids.payments})
    `);
  }
  if (ids.loans.length > 0) {
    statements.push(prisma.$executeRaw`
      DELETE FROM public.loans
       WHERE user_id = ${targetUserId}::uuid AND id::text = ANY(${ids.loans})
    `);
  }
  if (ids.clients.length > 0) {
    statements.push(prisma.$executeRaw`
      DELETE FROM public.clients
       WHERE user_id = ${targetUserId}::uuid AND id::text = ANY(${ids.clients})
    `);
  }
  if (ids.products.length > 0) {
    statements.push(prisma.$executeRaw`
      DELETE FROM public.products
       WHERE user_id = ${targetUserId}::uuid AND id::text = ANY(${ids.products})
    `);
  }
  if (ids.ecommerce.length > 0) {
    statements.push(prisma.$executeRaw`
      DELETE FROM public.ecommerce_transactions
       WHERE user_id = ${targetUserId}::uuid AND id::text = ANY(${ids.ecommerce})
    `);
  }
  if (ids.capital.length > 0) {
    statements.push(prisma.$executeRaw`
      DELETE FROM public.capital_movements
       WHERE user_id = ${targetUserId}::uuid AND id::text = ANY(${ids.capital})
    `);
  }

  if (resetCapital) {
    statements.push(prisma.$executeRaw`
      UPDATE public.user_settings
         SET ecommerce_capital = 0, updated_at = now()
       WHERE user_id = ${targetUserId}::uuid
    `);
    statements.push(prisma.$executeRaw`
      UPDATE public.profiles
         SET monthly_capitals = '{}'::jsonb
       WHERE id = ${targetUserId}::uuid
    `);
  }

  if (statements.length > 0) {
    await prisma.$transaction(statements);
  }
  return true;
}

/**
 * Punto de entrada usado por la ruta admin.
 * - Modo Supabase: lee el estado del usuario destino con service_role y aplica
 *   todos los borrados en una sola transacción de PostgreSQL.
 * - Modo legacy: muta el estado compartido filtrando por usuario y guarda una
 *   única vez (AppState en una fila / archivo JSON).
 */
export async function executePurge({ request, db, targetUserId, targets, filter }) {
  const [{ isSupabaseConfigured }, storeModule, { getSupabaseAdminClientOrNull }] =
    await Promise.all([
      import('../supabase/env'),
      import('./supabase-store'),
      import('../supabase/admin'),
    ]);
  const { getStateForTargetUser, saveStateForRequestWithResult } = storeModule;

  const supabaseMode = isSupabaseConfigured();
  const sourceState = supabaseMode ? await getStateForTargetUser(targetUserId) : db;
  const plan = buildPurgePlan(sourceState, { targetUserId, targets, filter });

  if (supabaseMode) {
    const executed = await purgeSupabaseAtomically(
      targetUserId,
      plan.ids,
      plan.resetCapital,
      getSupabaseAdminClientOrNull
    );
    if (!executed) {
      throw new Error(
        'No hay un mecanismo atómico disponible para vaciar los datos. ' +
        'Configura SUPABASE_SERVICE_ROLE_KEY y ejecuta la migración de purga, o configura DATABASE_URL.'
      );
    }
  } else {
    if (typeof saveStateForRequestWithResult === 'function') {
      const result = await saveStateForRequestWithResult(request, plan.nextDb);
      if (!result.ok) {
        throw new Error(result.error || 'No se pudo guardar el estado tras la limpieza');
      }
    } else {
      await storeModule.saveStateForRequest(request, plan.nextDb);
    }
  }

  return plan.summary;
}
