import { describe, expect, it } from 'vitest'
import { computeAbono, pendingBalance } from './abono'
import { computeInstallmentPayment } from './installment'

const schedule = () => [
  { number: 1, amount: 100, paid: true, paidDate: '2026-01-01', receiptRef: 'ABONO-1' },
  { number: 2, amount: 100, paid: false, dueDate: '2026-02-01' },
  { number: 3, amount: 100, paid: false, dueDate: '2026-03-01' },
  { number: 4, amount: 100, paid: false, dueDate: '2026-04-01' },
]

describe('computeAbono', () => {
  it('marca como pagada la cuota que cubre y deja el resto pendiente', () => {
    const result = computeAbono({ installments: schedule(), amount: 100 })

    expect(result.currentBalance).toBe(300)
    expect(result.appliedAmount).toBe(100)
    expect(result.newBalance).toBe(200)
    expect(result.remainingInstallments).toBe(2)
    expect(result.settledInstallments).toBe(1)
    expect(result.settled).toBe(false)
    expect(result.installments[0]).toMatchObject({ paid: true, amount: 100, receiptRef: 'ABONO-1' })
    expect(result.installments[1]).toMatchObject({ paid: true, amount: 100 })
    expect(pendingBalance(result.installments)).toBe(200)
    expect(result.installmentAmount).toBe(100)
  })

  it('acepta abonos parciales y reduce la cuota actual', () => {
    const result = computeAbono({ installments: schedule(), amount: 10.5 })
    expect(result.newBalance).toBe(289.5)
    expect(result.remainingInstallments).toBe(3)
    expect(result.settledInstallments).toBe(0)
    expect(result.partialInstallment).toEqual({ number: 2, remaining: 89.5 })
    expect(result.installmentAmount).toBe(89.5)
    expect(pendingBalance(result.installments)).toBe(289.5)
  })

  it('divide el abono entre varias cuotas y deja la última parcial', () => {
    const result = computeAbono({ installments: schedule(), amount: 250 })
    expect(result.newBalance).toBe(50)
    expect(result.remainingInstallments).toBe(1)
    expect(result.settledInstallments).toBe(2)
    expect(result.partialInstallment).toEqual({ number: 4, remaining: 50 })
    expect(result.distribution.map(d => d.applied)).toEqual([100, 100, 50])
  })

  it('ajusta centavos en la cuota alcanzada por el abono', () => {
    const result = computeAbono({
      installments: [
        { number: 1, amount: 33.33, paid: false },
        { number: 2, amount: 33.33, paid: false },
        { number: 3, amount: 33.34, paid: false },
      ],
      amount: 0.01,
    })
    expect(result.newBalance).toBe(99.99)
    expect(result.partialInstallment).toEqual({ number: 1, remaining: 33.32 })
    expect(pendingBalance(result.installments)).toBe(99.99)
    expect(result.settledInstallments).toBe(0)
  })

  it('liquida el financiamiento cuando el abono cubre el saldo', () => {
    const result = computeAbono({
      installments: schedule(),
      amount: 300,
      paidDate: '2026-02-10',
      reference: 'TOTAL-123',
    })
    expect(result.settled).toBe(true)
    expect(result.newBalance).toBe(0)
    expect(result.remainingInstallments).toBe(0)
    expect(result.settledInstallments).toBe(3)
    expect(result.installments.filter((i) => !i.paid)).toHaveLength(0)
    expect(result.installments.slice(1).every((i) => i.paidDate === '2026-02-10' && i.receiptRef === 'TOTAL-123')).toBe(true)
  })

  it('nunca deja saldo negativo y limita el abono dentro de la tolerancia', () => {
    const result = computeAbono({ installments: schedule(), amount: 300.005 })
    expect(result.appliedAmount).toBe(300)
    expect(result.newBalance).toBe(0)
    expect(pendingBalance(result.installments)).toBe(0)
  })

  it('rechaza montos inválidos o superiores al saldo', () => {
    expect(() => computeAbono({ installments: schedule(), amount: 0 })).toThrow(/mayor que cero/i)
    expect(() => computeAbono({ installments: schedule(), amount: -5 })).toThrow(/mayor que cero/i)
    expect(() => computeAbono({ installments: schedule(), amount: NaN })).toThrow(/mayor que cero/i)
    expect(() => computeAbono({ installments: schedule(), amount: 301 })).toThrow(/supera el saldo/i)
    expect(() => computeAbono({ installments: [{ number: 1, amount: 10, paid: true }], amount: 5 }))
      .toThrow(/sin saldo pendiente|no tiene cuotas pendientes/i)
  })
})

describe('computeInstallmentPayment', () => {
  it('marca como pagada la cuota seleccionada sin alterar el total', () => {
    const result = computeInstallmentPayment({
      installments: schedule(),
      installmentNumber: 3,
      amount: 100,
    })
    expect(result.settledInstallments).toBe(1)
    expect(result.newBalance).toBe(200)
    expect(result.remainingInstallments).toBe(2)
    expect(result.installments.find(i => i.number === 3)?.paid).toBe(true)
    expect(result.installments).toHaveLength(4)
  })

  it('rechaza cuotas ya pagadas y montos distintos al de la cuota', () => {
    expect(() => computeInstallmentPayment({ installments: schedule(), installmentNumber: 1 }))
      .toThrow(/ya fue cancelada/i)
    expect(() => computeInstallmentPayment({ installments: schedule(), installmentNumber: 2, amount: 99 }))
      .toThrow(/debe coincidir con la cuota/i)
  })
})
