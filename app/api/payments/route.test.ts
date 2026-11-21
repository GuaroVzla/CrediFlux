import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStateForRequest: vi.fn(),
  checkWritePermission: vi.fn(),
  getRequestUser: vi.fn(),
  canAccessRecord: vi.fn(() => true),
  saveStateForRequest: vi.fn(async () => true),
  buildPaymentsBody: vi.fn((db: any) => ({ success: true, payments: db.payments })),
  normalizeDashboardState: vi.fn(),
  applyLoanPayment: vi.fn(),
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

vi.mock('@/modules/payments/service', () => ({
  computeLoanStatus: (loan: any) => loan.installments.every((i: any) => i.paid) ? 'completado' : loan.status,
  checkWritePermission: mocks.checkWritePermission,
  getRequestUser: mocks.getRequestUser,
  canAccessRecord: mocks.canAccessRecord,
  getStateForRequest: mocks.getStateForRequest,
  saveStateForRequest: mocks.saveStateForRequest,
  buildPaymentsBody: mocks.buildPaymentsBody,
  normalizeDashboardState: mocks.normalizeDashboardState,
}))

vi.mock('@/modules/loans/apply', () => ({ applyLoanPayment: mocks.applyLoanPayment }))

import { DELETE, POST } from './route'

const user = { id: 'usr_1', role: 'user' }

function makeDb() {
  const loan = {
    id: 'ln_1',
    userId: 'usr_1',
    clientId: 'cli_1',
    clientName: 'Cliente',
    totalAmount: 400,
    installmentCount: 4,
    installmentAmount: 100,
    status: 'al_dia',
    installments: [
      { number: 1, amount: 100, paid: true, paidDate: '2026-01-01', receiptRef: 'ABONO-1', dueDate: '2026-01-01' },
      { number: 2, amount: 100, paid: false, dueDate: '2026-02-01' },
      { number: 3, amount: 100, paid: false, dueDate: '2026-03-01' },
      { number: 4, amount: 100, paid: false, dueDate: '2026-04-01' },
    ],
  }
  return {
    loans: [loan],
    payments: [{ id: 'pay_0', loanId: 'ln_1', amount: 100, createdAt: '2026-01-01T00:00:00.000Z' }],
    products: [],
  }
}

function postRequest(body: unknown) {
  return new Request('http://localhost/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

function deleteRequest(id: string) {
  return new Request(`http://localhost/api/payments?id=${id}`, { method: 'DELETE' }) as any
}

describe('POST /api/payments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkWritePermission.mockReturnValue({ allowed: true, user })
    mocks.getRequestUser.mockReturnValue(user)
    mocks.applyLoanPayment.mockImplementation(async ({ calculation, payment }: any) => ({
      result: {
        paymentId: payment.id,
        appliedAmount: calculation.appliedAmount,
        currentBalance: calculation.currentBalance,
        newBalance: calculation.newBalance,
        remainingInstallments: calculation.remainingInstallments,
        settledInstallments: calculation.settledInstallments,
        partialInstallment: calculation.partialInstallment,
        installmentAmount: calculation.installmentAmount,
        settled: calculation.settled,
        status: calculation.settled ? 'completado' : 'al_dia',
        totalAmount: 400,
        totalInstallments: 4,
        coveredInstallments: (400 - calculation.newBalance) / 100,
        remainingEquivalent: calculation.newBalance / 100,
        collectedAmount: 400 - calculation.newBalance,
        pendingAmount: calculation.newBalance,
        progressPercent: Math.round((400 - calculation.newBalance) / 400 * 100),
      },
      persisted: 'legacy',
    }))
  })

  it('marca cuotas pagadas con un abono y actualiza el progreso', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())

    const res: any = await POST(postRequest({ mode: 'abono', loanId: 'ln_1', amount: 250 }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.preview.settledInstallments).toBe(2)
    expect(body.preview.newBalance).toBe(50)
    expect(body.preview.totalInstallments).toBe(4)
    expect(body.preview.progressPercent).toBe(88)
    const { calculation } = mocks.applyLoanPayment.mock.calls[0][0]
    expect(calculation.installments.filter((i: any) => i.paid).map((i: any) => i.number)).toEqual([1, 2, 3, 4].slice(0, 3))
    expect(calculation.installments.find((i: any) => i.number === 4)?.amount).toBe(50)
  })

  it('registra pago de una cuota seleccionada', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())

    const res: any = await POST(postRequest({ mode: 'cuota', loanId: 'ln_1', installmentNumber: 3, amount: 100 }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.preview.settledInstallments).toBe(1)
    expect(body.preview.newBalance).toBe(200)
    expect(body.payment.kind).toBe('cuota')
    expect(body.payment.installmentNumber).toBe(3)
  })

  it('rechaza abonos mayores al saldo y montos no positivos', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())

    const over: any = await POST(postRequest({ mode: 'abono', loanId: 'ln_1', amount: 301 }))
    expect(over.status).toBe(409)
    expect((await over.json()).error).toMatch(/supera el saldo/i)

    const zero: any = await POST(postRequest({ mode: 'abono', loanId: 'ln_1', amount: 0 }))
    expect(zero.status).toBe(400)
    expect((await zero.json()).error).toMatch(/mayor que cero/i)
    expect(mocks.applyLoanPayment).not.toHaveBeenCalled()
  })

  it('liquida el financiamiento cuando el abono cubre el saldo', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())

    const res: any = await POST(postRequest({ mode: 'abono', loanId: 'ln_1', amount: 300 }))
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.preview.settled).toBe(true)
    expect(body.preview.newBalance).toBe(0)
    expect(body.loanStatus).toBe('completado')
    expect(body.message).toMatch(/liquidado/i)
  })
})

describe('DELETE /api/payments — reversión de pagos y abonos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkWritePermission.mockReturnValue({ allowed: true, user })
    mocks.getRequestUser.mockReturnValue(user)
  })

  it('restaura el cronograma previo al abono más reciente', async () => {
    const db = makeDb()
    const loan: any = db.loans[0]
    loan.installments = loan.installments.map((i: any) => i.paid ? i : { ...i, amount: 50 })
    loan.status = 'al_dia'
    const abono = {
      id: 'pay_abono',
      loanId: 'ln_1',
      amount: 250,
      createdAt: '2026-02-01T00:00:00.000Z',
      metadata: {
        kind: 'abono',
        previousInstallmentAmount: 100,
        previousInstallments: [
          { number: 2, amount: 100 }, { number: 3, amount: 100 }, { number: 4, amount: 100 },
        ],
      },
    }
    db.payments.push(abono)
    mocks.getStateForRequest.mockResolvedValue(db)

    const res: any = await DELETE(deleteRequest('pay_abono'))

    expect(res.status).toBe(200)
    expect(loan.installments.filter((i: any) => !i.paid).map((i: any) => i.amount)).toEqual([100, 100, 100])
    expect(loan.installmentAmount).toBe(100)
    expect(loan.progressPercent).toBe(25)
    expect(db.payments.some((p: any) => p.id === 'pay_abono')).toBe(false)
  })
})
