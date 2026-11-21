import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStateForRequest: vi.fn(),
  saveStateForRequest: vi.fn(),
  checkWritePermission: vi.fn(),
  getRequestUser: vi.fn(),
  canAccessRecord: vi.fn(() => true),
  scopeRecords: vi.fn((records: any) => records),
  summarize: vi.fn(() => ({ netCapital: 100 })),
  buildCapitalBody: vi.fn((db: any) => ({ success: true, movements: db.capitalMovements })),
  normalizeDashboardState: vi.fn(),
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

vi.mock('@/modules/capital/service', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    getStateForRequest: mocks.getStateForRequest,
    saveStateForRequest: mocks.saveStateForRequest,
    checkWritePermission: mocks.checkWritePermission,
    getRequestUser: mocks.getRequestUser,
    canAccessRecord: mocks.canAccessRecord,
    scopeRecords: mocks.scopeRecords,
    summarize: mocks.summarize,
    buildCapitalBody: mocks.buildCapitalBody,
    normalizeDashboardState: mocks.normalizeDashboardState,
  }
})

import { GET, POST, DELETE } from './route'

const user = { id: 'usr_1', role: 'user' }

function makeDb() {
  return {
    capitalMovements: [{
      id: 'cap_1',
      userId: 'usr_1',
      type: 'APORTE_CAPITAL',
      amountUsd: 100,
      currencyOrigin: 'USD',
    }],
  }
}

function postRequest(body: unknown) {
  return new Request('http://localhost/api/capital-movements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(id: string) {
  return new Request(`http://localhost/api/capital-movements?id=${id}`, { method: 'DELETE' })
}

describe('GET /api/capital-movements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scopeRecords.mockImplementation((records: any) => records)
  })

  it('devuelve 401 sin usuario', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())
    mocks.getRequestUser.mockReturnValue(null)

    const res: any = await GET(new Request('http://localhost/api/capital-movements'))
    expect(res.status).toBe(401)
  })

  it('devuelve los movimientos del usuario', async () => {
    const db = makeDb()
    mocks.getStateForRequest.mockResolvedValue(db)
    mocks.getRequestUser.mockReturnValue(user)

    const res: any = await GET(new Request('http://localhost/api/capital-movements'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.movements).toEqual(db.capitalMovements)
  })
})

describe('POST /api/capital-movements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkWritePermission.mockReturnValue({ allowed: true, user })
    mocks.getRequestUser.mockReturnValue(user)
    mocks.canAccessRecord.mockReturnValue(true)
    mocks.scopeRecords.mockImplementation((records: any) => records)
    mocks.summarize.mockReturnValue({ netCapital: 100 })
    mocks.saveStateForRequest.mockResolvedValue(undefined)
  })

  it('registra un aporte en USD con equivalencia 1:1', async () => {
    const db = makeDb()
    mocks.getStateForRequest.mockResolvedValue(db)

    const res: any = await POST(postRequest({
      type: 'APORTE_CAPITAL',
      currencyOrigin: 'USD',
      amount: 250,
      notes: '  Capital inicial  ',
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.movement).toMatchObject({
      userId: 'usr_1',
      type: 'APORTE_CAPITAL',
      amountUsd: 250,
      currencyOrigin: 'USD',
      notes: 'Capital inicial',
      metadata: { amountOriginal: 250 },
    })
    expect(body.summary).toEqual({ netCapital: 100 })
    expect(db.capitalMovements[0]).toMatchObject(body.movement)
    expect(mocks.saveStateForRequest).toHaveBeenCalledWith(expect.anything(), db)
  })

  it('rechaza un monto en VES sin tasa de cambio', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())

    const res: any = await POST(postRequest({
      type: 'APORTE_CAPITAL',
      currencyOrigin: 'VES',
      amount: 1000,
    }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/tasa de cambio es obligatoria/)
    expect(mocks.saveStateForRequest).not.toHaveBeenCalled()
  })

  it('rechaza un retiro superior al capital neto', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())
    mocks.summarize.mockReturnValue({ netCapital: 50 })

    const res: any = await POST(postRequest({
      type: 'RETIRO_CAPITAL',
      currencyOrigin: 'USD',
      amount: 80,
    }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toMatch(/supera el Capital Invertido Neto/)
    expect(body.summary).toEqual({ netCapital: 50 })
    expect(mocks.saveStateForRequest).not.toHaveBeenCalled()
  })

  it('rechaza un tipo de movimiento inválido', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())

    const res: any = await POST(postRequest({ type: 'COMPRA', amount: 10 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Tipo inválido/)
  })
})

describe('DELETE /api/capital-movements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkWritePermission.mockReturnValue({ allowed: true, user })
    mocks.getRequestUser.mockReturnValue(user)
    mocks.canAccessRecord.mockReturnValue(true)
    mocks.scopeRecords.mockImplementation((records: any) => records)
    mocks.summarize.mockReturnValue({ netCapital: 100 })
    mocks.saveStateForRequest.mockResolvedValue(undefined)
  })

  it('elimina el movimiento y marca sincronización de capital', async () => {
    const db = makeDb()
    mocks.getStateForRequest.mockResolvedValue(db)

    const res: any = await DELETE(deleteRequest('cap_1'))
    expect(res.status).toBe(200)
    expect(db.capitalMovements).toHaveLength(0)
    expect((db as any).__syncCapital).toBe(true)
    expect(mocks.saveStateForRequest).toHaveBeenCalledWith(expect.anything(), db)
  })

  it('devuelve 404 para un movimiento inexistente', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())

    const res: any = await DELETE(deleteRequest('cap_inexistente'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Movimiento no encontrado')
  })
})
