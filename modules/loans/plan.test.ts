import { describe, expect, it } from 'vitest'
import { computeLoanPlan, getLoanItems } from './plan'

const products = [
  { id: 'p1', name: 'Laptop', costPrice: 500, stock: 5 },
  { id: 'p2', name: 'Mouse', costPrice: 50, stock: 2 },
]

const baseInput = {
  type: 'producto',
  products,
  downPayment: 0,
  interestRate: 0,
  installmentCount: 4,
  frequency: 'mensual',
  startDate: '2026-01-01',
}

describe('computeLoanPlan', () => {
  it('calcula la base desde varios productos y genera el cronograma', () => {
    const plan = computeLoanPlan({
      ...baseInput,
      items: [{ productId: 'p1', quantity: 1 }, { productId: 'p2', quantity: 2 }],
    })

    expect(plan.principal).toBe(600)
    expect(plan.totalAmount).toBe(600)
    expect(plan.installmentCount).toBe(4)
    expect(plan.installments).toHaveLength(4)
    expect(plan.installments.reduce((sum, i) => sum + i.amount, 0)).toBeCloseTo(600, 2)
    expect(plan.installments.map((i) => i.dueDate)).toEqual([
      '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01',
    ])
    expect(plan.stockDeltas).toEqual([
      { productId: 'p1', delta: 1, name: 'Laptop' },
      { productId: 'p2', delta: 2, name: 'Mouse' },
    ])
  })

  it('conserva cuotas pagadas y recalcula el saldo sin tocar los abonos', () => {
    const plan = computeLoanPlan({
      ...baseInput,
      items: [{ productId: 'p1', quantity: 1 }],
      existingItems: [{ productId: 'p1', quantity: 1 }],
      existingInstallments: [{
        number: 1,
        dueDate: '2025-12-01',
        amount: 100,
        paid: true,
        paidDate: '2025-12-01',
        receiptRef: 'ABONO-123',
      }],
    })

    expect(plan.paidAmount).toBe(100)
    expect(plan.remainingAmount).toBe(400)
    expect(plan.installments[0]).toMatchObject({
      number: 1, paid: true, amount: 100, receiptRef: 'ABONO-123',
    })
    expect(plan.installments.slice(1).map((i) => i.number)).toEqual([2, 3, 4])
    expect(plan.installments.slice(1).reduce((sum, i) => sum + i.amount, 0)).toBeCloseTo(400, 2)
    // Cambiar el cronograma no modifica el historial de pagos.
    expect(plan.stockDeltas).toHaveLength(0)
  })

  it('calcula el interés fijo sobre el saldo pendiente', () => {
    const plan = computeLoanPlan({
      ...baseInput,
      items: [{ productId: 'p1', quantity: 1 }],
      interestMode: 'fixed',
      interestAmount: 75,
      existingInstallments: [{ number: 1, amount: 25, paid: true }],
    })

    expect(plan.interestAmount).toBe(75)
    expect(plan.totalAmount).toBe(575)
    expect(plan.remainingAmount).toBe(550)
    expect(plan.installmentAmount).toBeCloseTo(183.33, 2)
    expect(plan.installments.filter((i) => !i.paid).reduce((sum, i) => sum + i.amount, 0)).toBeCloseTo(550, 2)
  })

  it('usa los pagos confirmados como fuente de verdad y protege el total abonado', () => {
    const input = {
      ...baseInput,
      items: [{ productId: 'p1', quantity: 1 }],
      existingInstallments: [{ number: 1, amount: 100, paid: true }],
    }

    expect(() => computeLoanPlan({ ...input, paidAmountOverride: 600 }))
      .toThrow(/no puede ser menor al monto ya abonado/)

    const plan = computeLoanPlan({ ...input, paidAmountOverride: 250 })
    expect(plan.paidAmount).toBe(250)
    expect(plan.totalAmount).toBe(500)
    expect(plan.remainingAmount).toBe(250)
    expect(plan.installments.filter((i) => !i.paid).reduce((sum, i) => sum + i.amount, 0)).toBeCloseTo(250, 2)
  })

  it('congela el monto base original aunque cambie el costo del catálogo', () => {
    const plan = computeLoanPlan({
      ...baseInput,
      products: [{ id: 'p1', name: 'Laptop', costPrice: 9999, stock: 5 }],
      items: [{ productId: 'p1', quantity: 1 }],
      fixedPrincipal: 500,
      fixedProductName: 'Laptop',
    })
    expect(plan.principal).toBe(500)
    expect(plan.productName).toBe('Laptop')
    expect(plan.totalAmount).toBe(500)
  })

  it('devuelve stock de productos removidos', () => {
    const plan = computeLoanPlan({
      ...baseInput,
      items: [{ productId: 'p2', quantity: 1 }],
      existingItems: [{ productId: 'p1', quantity: 2 }],
    })
    expect(plan.stockDeltas).toEqual([
      { productId: 'p1', delta: -2, name: 'Laptop' },
      { productId: 'p2', delta: 1, name: 'Mouse' },
    ])
  })

  it('rechaza valores inválidos', () => {
    expect(() => computeLoanPlan({ ...baseInput, interestRate: 0, items: [] })).toThrow(/producto/i)
    expect(() => computeLoanPlan({ ...baseInput, interestRate: 0, installmentCount: 0, items: [{ productId: 'p1', quantity: 1 }] })).toThrow(/cuotas/i)
    expect(() => computeLoanPlan({ ...baseInput, interestRate: 0, downPayment: -1, items: [{ productId: 'p1', quantity: 1 }] })).toThrow(/negativo|enganche/i)
    expect(() => computeLoanPlan({ ...baseInput, interestRate: 0, downPayment: 900, items: [{ productId: 'p1', quantity: 1 }] })).toThrow(/enganche/i)
    expect(() => computeLoanPlan({
      ...baseInput,
      interestRate: 0,
      items: [{ productId: 'p2', quantity: 3 }],
      existingItems: [],
    })).toThrow(/stock/i)
    expect(() => computeLoanPlan({
      ...baseInput,
      interestRate: 0,
      installmentCount: 1,
      items: [{ productId: 'p1', quantity: 1 }],
      existingInstallments: [{ number: 1, amount: 10, paid: true }, { number: 2, amount: 10, paid: true }],
    })).toThrow(/ya pagadas/i)
  })

  it('lee productos de financiamientos legados con un solo productId', () => {
    expect(getLoanItems({ productId: 'p1' })).toEqual([{ productId: 'p1', quantity: 1 }])
    expect(getLoanItems({ items: [{ productId: 'p2', quantity: 4 }] })).toEqual([{ productId: 'p2', quantity: 4 }])
  })
})
