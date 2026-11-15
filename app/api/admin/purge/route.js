import { NextResponse } from 'next/server';
import { checkWritePermission } from '../../../../lib/db.js';
import { getAppState, saveAppState } from '../../../../lib/server/persistence.js';

function dateStrOf(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function matchesPeriod(dateStr, filter) {
  if (!filter || !filter.period || filter.period === 'all') return true;
  if (!dateStr) return false;
  const { period, day, month, year, until } = filter;
  if (period === 'day') return day ? dateStr === day : true;
  if (period === 'month') return month ? dateStr.startsWith(month) : true; // YYYY-MM
  if (period === 'year') return year ? dateStr.startsWith(String(year)) : true; // YYYY
  if (period === 'until') return until ? dateStr <= until : true; // hasta fecha en concreto
  return true;
}

export async function POST(request) {
  try {
    const db = await getAppState();
    if (!Array.isArray(db.loans)) db.loans = [];
    if (!Array.isArray(db.payments)) db.payments = [];
    if (!Array.isArray(db.clients)) db.clients = [];
    if (!Array.isArray(db.products)) db.products = [];
    if (!Array.isArray(db.ecommerce)) db.ecommerce = [];
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }

    // Solo administrador puede ejecutar limpieza masiva
    if (perm.user && perm.user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Solo el administrador puede vaciar datos' }, { status: 403 });
    }

    const body = await request.json();
    const {
      targets = {},
      filter = { period: 'all' },
      userId = null // target user whose records to purge (admin per-user management)
    } = body;

    const targetUserId = userId || null;
    const ownedByTarget = (item) => !targetUserId || (item && item.userId === targetUserId);

    const summary = {
      payments: 0,
      loans: 0,
      clients: 0,
      products: 0,
      ecommerce: 0
    };

    // Determinar préstamos a eliminar (para limpieza segura de pagos vinculados)
    let deletedLoanIds = new Set();
    if (targets.loans) {
      const loansBefore = (db.loans || []).length;
      const keptLoans = [];
      (db.loans || []).forEach(l => {
        if (ownedByTarget(l) && matchesPeriod(dateStrOf(l.createdAt || l.startDate), filter)) {
          deletedLoanIds.add(l.id);
        } else {
          keptLoans.push(l);
        }
      });
      db.loans = keptLoans;
      summary.loans = loansBefore - db.loans.length;

      // Limpieza segura: eliminar pagos asociados a financiamientos eliminados
      // para evitar registros huérfanos en el historial.
      if (deletedLoanIds.size > 0) {
        const beforeLinked = (db.payments || []).length;
        db.payments = (db.payments || []).filter(p => !(ownedByTarget(p) && deletedLoanIds.has(p.loanId)));
        summary.payments += (beforeLinked - db.payments.length);
      }
    }

    // Historial de financiamientos (pagos registrados y su impacto en préstamos)
    if (targets.payments) {
      const before = (db.payments || []).length;
      const toRemove = new Set(
        (db.payments || [])
          .filter(p => ownedByTarget(p) && matchesPeriod(dateStrOf(p.date || p.createdAt), filter))
          .map(p => p.id)
      );

      // Revertir cuotas asociadas a pagos que se eliminarán (solo si el préstamo aún existe)
      (db.payments || []).forEach(payment => {
        if (!toRemove.has(payment.id)) return;
        const loan = (db.loans || []).find(l => l.id === payment.loanId);
        if (!loan || !Array.isArray(loan.installments)) return;

        let targetNumbers = Array.isArray(payment.installmentNumbers)
          ? payment.installmentNumbers.map(n => parseInt(n, 10)).filter(Number.isFinite)
          : [];
        if (targetNumbers.length === 0) {
          if (payment.installmentNumber === 'total' || payment.installmentNumber === 'all') {
            targetNumbers = loan.installments
              .filter(i => i.paid && ((payment.reference && i.receiptRef === payment.reference) || (payment.date && i.paidDate === payment.date)))
              .map(i => i.number);
          } else if (payment.installmentNumber != null) {
            const n = parseInt(payment.installmentNumber, 10);
            if (Number.isFinite(n)) targetNumbers = [n];
          }
        }
        if (targetNumbers.length === 0 && (payment.reference || payment.date)) {
          targetNumbers = loan.installments
            .filter(i => i.paid && ((payment.reference && i.receiptRef === payment.reference) || (!payment.reference && payment.date && i.paidDate === payment.date)))
            .map(i => i.number);
        }

        loan.installments = loan.installments.map(inst => {
          if (!targetNumbers.includes(inst.number)) return inst;
          return { ...inst, paid: false, paidDate: null, receiptRef: null };
        });
        // recompute status best-effort
        const unpaid = loan.installments.filter(i => !i.paid);
        if (unpaid.length === 0) {
          loan.status = 'completado';
        } else {
          // basic recompute without importing computeLoanStatus again complexities
          const now = new Date(); now.setHours(0,0,0,0);
          let st = 'al_dia';
          for (const inst of unpaid) {
            const d = new Date(inst.dueDate); d.setHours(0,0,0,0);
            if (d < now) { st = 'moroso'; break; }
          }
          if (st !== 'moroso') {
            const nearest = new Date(unpaid[0].dueDate); nearest.setHours(0,0,0,0);
            const diffDays = Math.ceil((nearest - now) / (1000 * 60 * 60 * 24));
            if (diffDays <= 3 && diffDays >= 0) st = 'proximo';
          }
          loan.status = st;
          delete loan.completedAt;
          delete loan.finalStatus;
        }
      });

      db.payments = (db.payments || []).filter(p => !toRemove.has(p.id));
      summary.payments += (before - db.payments.length);
    }

    // Clientes
    if (targets.clients) {
      const before = (db.clients || []).length;
      db.clients = (db.clients || []).filter(c => !(ownedByTarget(c) && matchesPeriod(dateStrOf(c.createdAt || c.registeredAt), filter)));
      summary.clients = before - (db.clients || []).length;
    }

    // Productos
    if (targets.products) {
      const before = (db.products || []).length;
      db.products = (db.products || []).filter(p => !(ownedByTarget(p) && matchesPeriod(dateStrOf(p.createdAt), filter)));
      summary.products = before - (db.products || []).length;
    }

    // Registro cronológico de transacciones de e-commerce
    if (targets.ecommerce) {
      const before = (db.ecommerce || []).length;
      db.ecommerce = (db.ecommerce || []).filter(t => !(ownedByTarget(t) && matchesPeriod(dateStrOf(t.date || t.createdAt), filter)));
      summary.ecommerce = before - (db.ecommerce || []).length;
    }

    await saveAppState(db);

    return NextResponse.json({
      success: true,
      message: 'Limpieza de datos ejecutada',
      summary,
      userId
    });
  } catch (error) {
    console.error('Admin purge error:', error);
    return NextResponse.json({ success: false, error: 'Error al vaciar datos' }, { status: 500 });
  }
}
