import { describe, expect, it } from 'vitest'
import { computeAbono } from './abono'
import { computeLoanProgress } from './progress'

describe('computeLoanProgress', () => {
  const loan = {
    totalAmount: 400,
    installmentCount: 4,
    installments: [
      { number: 1, amount: 100, paid: true },
      { number: 2, amount: 100, paid: false },
      { number: 3, amount: 100, paid: false },
      { number: 4, amount: 100, paid: false },
    ],
  }

  it('avanza con pagos de cuota sin reducir el total de cuotas', () => {
    const result = computeLoanProgress(loan)
    expect(result.totalInstallments).toBe(4)
    expect(result.progressPercent).toBe(25)
    expect(result.coveredInstallments).toBe(1)
    expect(result.remainingEquivalent).toBe(3)
  })

  it('avanza con abonos parciales aunque no se liquide ninguna cuota', () => {
    const payment = computeAbono({ installments: loan.installments, amount: 50 })
    const result = computeLoanProgress({ ...loan, installments: payment.installments })
    expect(result.totalInstallments).toBe(4)
    expect(result.collectedAmount).toBe(150)
    expect(result.pendingAmount).toBe(250)
    expect(result.progressPercent).toBe(38)
    expect(result.coveredInstallments).toBe(1.5)
    expect(result.remainingEquivalent).toBe(2.5)
  })

  it('llega al 100% al liquidar el saldo y conserva las 4 cuotas pactadas', () => {
    const payment = computeAbono({ installments: loan.installments, amount: 300 })
    const result = computeLoanProgress({ ...loan, installments: payment.installments })
    expect(result.totalInstallments).toBe(4)
    expect(result.progressPercent).toBe(100)
    expect(result.coveredInstallments).toBe(4)
    expect(result.remainingEquivalent).toBe(0)
  })
})
