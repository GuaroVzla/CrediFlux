import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStateForRequest: vi.fn(),
  saveStateForRequest: vi.fn(),
  checkWritePermission: vi.fn(),
  getRequestUser: vi.fn(),
  canAccessRecord: vi.fn(() => true),
  buildClientsBody: vi.fn((db: any) => ({ success: true, clients: db.clients })),
  normalizeDashboardState: vi.fn(),
  computeLoanStatus: vi.fn(() => 'activo'),
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

vi.mock('@/modules/clients/service', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    getStateForRequest: mocks.getStateForRequest,
    saveStateForRequest: mocks.saveStateForRequest,
    checkWritePermission: mocks.checkWritePermission,
    getRequestUser: mocks.getRequestUser,
    canAccessRecord: mocks.canAccessRecord,
    buildClientsBody: mocks.buildClientsBody,
    normalizeDashboardState: mocks.normalizeDashboardState,
    computeLoanStatus: mocks.computeLoanStatus,
  }
})

import { GET, POST, DELETE } from './route'

const user = { id: 'usr_1', role: 'user' }

function makeDb() {
  return {
    clients: [{ id: 'cli_1', userId: 'usr_1', name: 'Ana', dni: 'V-1' }],
    loans: [{
      id: 'ln_1',
      userId: 'usr_1',
      clientId: 'cli_1',
      status: 'activo',
    }],
    blacklist: [],
  }
}

function postRequest(body: unknown) {
  return new Request('http://localhost/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(id: string) {
  return new Request(`http://localhost/api/clients?id=${id}`, { method: 'DELETE' })
}

describe('GET /api/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canAccessRecord.mockReturnValue(true)
  })

  it('devuelve 401 cuando no hay usuario autenticado', async () => {
    const db = makeDb()
    mocks.getStateForRequest.mockResolvedValue(db)
    mocks.getRequestUser.mockReturnValue(null)

    const res: any = await GET(new Request('http://localhost/api/clients'))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({ success: false, error: 'No autenticado' })
    expect(mocks.buildClientsBody).not.toHaveBeenCalled()
  })

  it('devuelve el body construido para el usuario autenticado', async () => {
    const db = makeDb()
    mocks.getStateForRequest.mockResolvedValue(db)
    mocks.getRequestUser.mockReturnValue(user)

    const res: any = await GET(new Request('http://localhost/api/clients'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.clients).toEqual(db.clients)
    expect(mocks.normalizeDashboardState).toHaveBeenCalledWith(db)
  })
})

describe('POST /api/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkWritePermission.mockReturnValue({ allowed: true, user })
    mocks.getRequestUser.mockReturnValue(user)
    mocks.canAccessRecord.mockReturnValue(true)
    mocks.saveStateForRequest.mockResolvedValue(undefined)
  })

  it('registra un cliente recortando espacios', async () => {
    const db = makeDb()
    mocks.getStateForRequest.mockResolvedValue(db)

    const res: any = await POST(postRequest({
      name: '  Luis  ',
      dni: ' V-123 ',
      phone: ' 0414-123 ',
      notes: '  Cliente preferente  ',
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.client).toMatchObject({
      name: 'Luis',
      dni: 'V-123',
      phone: '0414-123',
      notes: 'Cliente preferente',
      userId: 'usr_1',
      trustLevel: 'Medio',
    })
    expect(db.clients[0]).toMatchObject(body.client)
    expect(mocks.saveStateForRequest).toHaveBeenCalledWith(expect.anything(), db)
  })

  it('rechaza un payload sin nombre o cédula', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())

    const res: any = await POST(postRequest({ name: '  ', dni: '' }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toMatchObject({ success: false, error: 'Nombre y Cédula/DNI son obligatorios' })
    expect(mocks.saveStateForRequest).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkWritePermission.mockReturnValue({ allowed: true, user })
    mocks.getRequestUser.mockReturnValue(user)
    mocks.canAccessRecord.mockReturnValue(true)
    mocks.saveStateForRequest.mockResolvedValue(undefined)
  })

  it('elimina el cliente y archiva sus financiamientos', async () => {
    const db = makeDb()
    mocks.getStateForRequest.mockResolvedValue(db)

    const res: any = await DELETE(deleteRequest('cli_1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, message: 'Cliente eliminado' })
    expect(db.clients).toHaveLength(0)
    expect(db.loans[0]).toMatchObject({
      archived: true,
      archiveReason: 'Cliente eliminado manualmente',
      finalStatus: 'incumplimiento',
    })
    expect(mocks.saveStateForRequest).toHaveBeenCalledWith(expect.anything(), db)
  })

  it('devuelve 404 si el cliente no existe', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())

    const res: any = await DELETE(deleteRequest('cli_inexistente'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Cliente no encontrado')
    expect(mocks.saveStateForRequest).not.toHaveBeenCalled()
  })
})
