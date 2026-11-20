import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStateForRequest: vi.fn(),
  checkWritePermission: vi.fn(),
  getRequestUser: vi.fn(),
  applyLoanEdit: vi.fn(),
  saveStateForRequest: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

vi.mock('@/modules/loans/service', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    getStateForRequest: mocks.getStateForRequest,
    checkWritePermission: mocks.checkWritePermission,
    getRequestUser: mocks.getRequestUser,
    applyLoanEdit: mocks.applyLoanEdit,
    saveStateForRequest: mocks.saveStateForRequest,
  }
})

import { PATCH } from './route'

const user = { id: 'usr_1', role: 'user' }

function makeDb() {
  const loan = {
    id: 'ln_1',
    userId: 'usr_1',
    clientId: 'cli_1',
    type: 'producto',
    productId: 'p1',
    items: [{ productId: 'p1', quantity: 1 }],
    principal: 500,
    interestRate: 10,
    downPayment: 0,
    totalAmount: 550,
    installmentCount: 4,
    installments: [
      { number: 1, amount: 137.5, paid: true, paidDate: '2026-01-01', receiptRef: 'ABONO-1' },
      { number: 2, amount: 137.5, paid: false },
      { number: 3, amount: 137.5, paid: false },
      { number: 4, amount: 137.5, paid: false },
    ],
  }
  return {
    loans: [loan],
    clients: [{ id: 'cli_1', userId: 'usr_1', name: 'Cliente', dni: 'V-1' }],
    products: [{ id: 'p1', userId: 'usr_1', name: 'Laptop', costPrice: 500, stock: 2 }],
    payments: [{ id: 'pay_1', loanId: 'ln_1', amount: 137.5, installmentNumber: 1 }],
  }
}

function patchRequest(body: unknown, id = 'ln_1') {
  return new Request(`http://localhost/api/loans?id=${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/loans', () => {
  beforeEach(() => vi.clearAllMocks())

  it('recalcula el plan y deja los pagos intactos', async () => {
    const db = makeDb()
    db.products[0].costPrice = 9999
    mocks.getStateForRequest.mockResolvedValue(db)
    mocks.checkWritePermission.mockReturnValue({ allowed: true, user })
    mocks.getRequestUser.mockReturnValue(user)
    mocks.applyLoanEdit.mockResolvedValue(undefined)

    const res: any = await PATCH(patchRequest({
      interestMode: 'percent',
      interestRate: 20,
      installmentCount: 5,
      frequency: 'semanal',
      startDate: '2026-03-01',
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.paidAmount).toBe(137.5)
    expect(body.remainingAmount).toBeCloseTo(600 - 137.5, 2)
    expect(body.installmentAmount).toBeCloseTo((600 - 137.5) / 4, 2)
    expect(db.payments).toHaveLength(1)
    const call = mocks.applyLoanEdit.mock.calls[0][0]
    expect(call.frequency).toBe('semanal')
    expect(call.plan.principal).toBe(500)
    expect(call.plan.installments[0]).toMatchObject({ paid: true, receiptRef: 'ABONO-1' })
    expect(call.plan.installments).toHaveLength(5)
    expect(mocks.saveStateForRequest).not.toHaveBeenCalled()
  })

  it('rechaza la edición de un préstamo de otro usuario', async () => {
    const db = makeDb()
    db.loans[0].userId = 'otro'
    mocks.getStateForRequest.mockResolvedValue(db)
    mocks.checkWritePermission.mockReturnValue({ allowed: true, user })
    mocks.getRequestUser.mockReturnValue(user)

    const res: any = await PATCH(patchRequest({ installmentCount: 4 }))
    expect(res.status).toBe(403)
    expect(mocks.applyLoanEdit).not.toHaveBeenCalled()
  })

  it('rechaza intentos de modificar datos congelados', async () => {
    const db = makeDb()
    mocks.getStateForRequest.mockResolvedValue(db)
    mocks.checkWritePermission.mockReturnValue({ allowed: true, user })
    mocks.getRequestUser.mockReturnValue(user)

    const res: any = await PATCH(patchRequest({
      clientId: 'otro_cliente',
      principal: 9999,
      items: [{ productId: 'p1', quantity: 5 }],
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/cliente.*productos.*monto base|Solo se editan las condiciones de pago/)
    expect(mocks.applyLoanEdit).not.toHaveBeenCalled()
  })

  it('rechaza un nuevo total menor al total ya abonado', async () => {
    const db = makeDb()
    db.payments[0].amount = 700
    mocks.getStateForRequest.mockResolvedValue(db)
    mocks.checkWritePermission.mockReturnValue({ allowed: true, user })
    mocks.getRequestUser.mockReturnValue(user)

    const res: any = await PATCH(patchRequest({ interestRate: 0 }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/no puede ser menor al monto ya abonado/)
    expect(mocks.applyLoanEdit).not.toHaveBeenCalled()
  })
})
