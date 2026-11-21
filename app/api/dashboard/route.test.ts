import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStateForRequest: vi.fn(),
  getRequestUser: vi.fn(),
  scopeRecords: vi.fn((records: any) => records),
  resolveUploadUrls: vi.fn(async (urls: string[]) => urls.map((url) => `signed:${url}`)),
  normalizeDashboardState: vi.fn(),
  prepareSettings: vi.fn(async () => undefined),
  getReceiptPatternImageUrls: vi.fn(() => ['pattern.png']),
  buildClientsBody: vi.fn(() => ({ clients: [] })),
  buildProductsBody: vi.fn(() => ({ products: [] })),
  buildLoansBody: vi.fn(() => ({ loans: [] })),
  buildPaymentsBody: vi.fn(() => ({ payments: [] })),
  buildEcommerceBody: vi.fn(() => ({ ecommerce: [] })),
  buildSettingsBody: vi.fn(() => ({ settings: {} })),
  buildCapitalBody: vi.fn(() => ({ capitalMovements: [] })),
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

vi.mock('@/shared/lib/db.js', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    getRequestUser: mocks.getRequestUser,
    scopeRecords: mocks.scopeRecords,
  }
})

vi.mock('@/server/persistence/supabase-store', () => ({
  getStateForRequest: mocks.getStateForRequest,
  persistenceInfo: vi.fn(() => ({ mode: 'supabase' })),
}))

vi.mock('@/server/services/uploads.js', () => ({
  resolveUploadUrls: mocks.resolveUploadUrls,
}))

vi.mock('@/server/dashboard/builders', () => ({
  buildCapitalBody: mocks.buildCapitalBody,
  buildClientsBody: mocks.buildClientsBody,
  buildEcommerceBody: mocks.buildEcommerceBody,
  buildLoansBody: mocks.buildLoansBody,
  buildPaymentsBody: mocks.buildPaymentsBody,
  buildProductsBody: mocks.buildProductsBody,
  buildSettingsBody: mocks.buildSettingsBody,
  getReceiptPatternImageUrls: mocks.getReceiptPatternImageUrls,
  normalizeDashboardState: mocks.normalizeDashboardState,
  prepareSettings: mocks.prepareSettings,
}))

import { dynamic, GET } from './route'

const user = { id: 'usr_1', role: 'user' }

function makeDb() {
  return {
    ecommerce: [{ id: 'tx_1', userId: 'usr_1', receiptUrl: 'receipt.png' }],
    clients: [],
    products: [],
    loans: [],
    payments: [],
    capitalMovements: [],
  }
}

describe('GET /api/dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scopeRecords.mockImplementation((records: any) => records)
    mocks.resolveUploadUrls.mockImplementation(async (urls: string[]) => urls.map((url) => `signed:${url}`))
    mocks.getReceiptPatternImageUrls.mockReturnValue(['pattern.png'])
    mocks.prepareSettings.mockResolvedValue(undefined)
  })

  it('es dinámico y devuelve 401 sin usuario', async () => {
    expect(dynamic).toBe('force-dynamic')

    mocks.getStateForRequest.mockResolvedValue(makeDb())
    mocks.getRequestUser.mockReturnValue(null)

    const res: any = await GET(new Request('http://localhost/api/dashboard'))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({ success: false, error: 'No autenticado' })
    expect(mocks.prepareSettings).not.toHaveBeenCalled()
    expect(mocks.resolveUploadUrls).not.toHaveBeenCalled()
  })

  it('devuelve los siete bloques y resuelve todas las URLs firmadas en un lote', async () => {
    const db = makeDb()
    mocks.getStateForRequest.mockResolvedValue(db)
    mocks.getRequestUser.mockReturnValue(user)

    const res: any = await GET(new Request('http://localhost/api/dashboard?page=1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(Object.keys(body).sort()).toEqual([
      'capitalMovements',
      'clients',
      'ecommerce',
      'loans',
      'payments',
      'products',
      'settings',
      'success',
    ])
    expect(body.success).toBe(true)

    expect(mocks.normalizeDashboardState).toHaveBeenCalledWith(db)
    expect(mocks.prepareSettings).toHaveBeenCalledWith(db, expect.anything())
    expect(mocks.resolveUploadUrls).toHaveBeenCalledWith(['receipt.png', 'pattern.png'])
    expect(mocks.buildEcommerceBody).toHaveBeenCalledWith(
      db,
      user,
      ['signed:receipt.png'],
      expect.anything(),
    )
    expect(mocks.buildSettingsBody).toHaveBeenCalledWith(db, ['signed:pattern.png'])
  })

  it('no firma URLs cuando no hay comprobantes ni patrones', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())
    mocks.getRequestUser.mockReturnValue(user)
    mocks.scopeRecords.mockReturnValue([])
    mocks.getReceiptPatternImageUrls.mockReturnValue([])

    const res: any = await GET(new Request('http://localhost/api/dashboard'))
    expect(res.status).toBe(200)
    expect(mocks.resolveUploadUrls).not.toHaveBeenCalled()
  })
})
