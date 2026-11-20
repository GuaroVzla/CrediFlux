import { describe, expect, it, vi } from 'vitest'

const { saveStateForRequest, updateLoanPlanAtomic } = vi.hoisted(() => ({
  saveStateForRequest: vi.fn(),
  updateLoanPlanAtomic: vi.fn(),
}))

vi.mock('@/server/supabase/env', () => ({ isSupabaseConfigured: () => false }))
vi.mock('@/server/persistence/supabase-store', () => ({
  saveStateForRequest,
  updateLoanPlanAtomic,
}))

import { computeLoanPlan } from './plan'
import { applyLoanEdit } from './update'

const request = new Request('http://localhost/api/loans?id=ln_1')

function buildScenario() {
  const payment = { id: 'pay_1', loanId: 'ln_1', amount: 100, installmentNumber: 1 }
  const loan = {
    id: 'ln_1',
    userId: 'usr_1',
    clientId: 'cli_1',
    type: 'producto',
    productId: 'p1',
    items: [{ productId: 'p1', quantity: 1 }],
    principal: 500,
    downPayment: 0,
    interestRate: 0,
    totalAmount: 500,
    installmentCount: 4,
    frequency: 'mensual',
    startDate: '2026-01-01',
    installments: [
      { number: 1, amount: 100, paid: true, paidDate: '2026-01-01', receiptRef: 'ABONO-1' },
      { number: 2, amount: 400 / 3, paid: false },
      { number: 3, amount: 400 / 3, paid: false },
      { number: 4, amount: 400 / 3, paid: false },
    ],
  }
  const db = {
    products: [
      { id: 'p1', name: 'Laptop', costPrice: 500, stock: 3 },
      { id: 'p2', name: 'Mouse', costPrice: 50, stock: 4 },
    ],
    loans: [loan],
    payments: [payment],
  }
  return { db, loan, payment }
}

describe('applyLoanEdit (modo legado)', () => {
  it('cambia sólo condiciones de pago y deja stock, cliente y pagos intactos', async () => {
    const { db, loan, payment } = buildScenario()
    const plan = computeLoanPlan({
      type: 'producto',
      items: [{ productId: 'p1', quantity: 1 }],
      existingItems: [{ productId: 'p1', quantity: 1 }],
      products: db.products,
      downPayment: 0,
      interestRate: 10,
      installmentCount: 5,
      frequency: 'quincenal',
      startDate: '2026-02-01',
      existingInstallments: loan.installments,
      paidAmountOverride: 100,
    })

    await applyLoanEdit({ request, db, loan, plan, frequency: 'quincenal' })

    expect(db.products.find((p: any) => p.id === 'p1').stock).toBe(3)
    expect(db.products.find((p: any) => p.id === 'p2').stock).toBe(4)
    expect(loan.items).toEqual([{ productId: 'p1', quantity: 1 }])
    expect(loan.productId).toBe('p1')
    expect(loan.clientId).toBe('cli_1')
    expect(loan.principal).toBe(500)
    expect(loan.totalAmount).toBe(550)
    expect(loan.installmentCount).toBe(5)
    expect(loan.frequency).toBe('quincenal')
    expect(loan.startDate).toBe('2026-02-01')
    expect(loan.installments[0]).toMatchObject({ paid: true, receiptRef: 'ABONO-1', amount: 100 })
    expect(loan.installments.slice(1).reduce((sum: number, i: any) => sum + i.amount, 0)).toBeCloseTo(450, 2)
    expect(db.payments).toEqual([payment])
    expect(saveStateForRequest).toHaveBeenCalledWith(request, db)
    expect(updateLoanPlanAtomic).not.toHaveBeenCalled()
  })
})
