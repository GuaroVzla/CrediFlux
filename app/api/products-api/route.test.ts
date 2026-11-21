import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStateForRequest: vi.fn(),
  saveStateForRequest: vi.fn(),
  checkWritePermission: vi.fn(),
  getRequestUser: vi.fn(),
  canAccessRecord: vi.fn(() => true),
  buildProductsBody: vi.fn((db: any) => ({ success: true, products: db.products })),
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

vi.mock('@/modules/products/service', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    getStateForRequest: mocks.getStateForRequest,
    saveStateForRequest: mocks.saveStateForRequest,
    checkWritePermission: mocks.checkWritePermission,
    getRequestUser: mocks.getRequestUser,
    canAccessRecord: mocks.canAccessRecord,
    buildProductsBody: mocks.buildProductsBody,
    normalizeDashboardState: mocks.normalizeDashboardState,
  }
})

import { GET, POST, DELETE } from './route'

const user = { id: 'usr_1', role: 'user' }

function makeDb() {
  return {
    products: [{ id: 'prod_1', userId: 'usr_1', name: 'Laptop', costPrice: 500, salePrice: 650 }],
  }
}

function postRequest(body: unknown) {
  return new Request('http://localhost/api/products-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(id: string) {
  return new Request(`http://localhost/api/products-api?id=${id}`, { method: 'DELETE' })
}

describe('GET /api/products-api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canAccessRecord.mockReturnValue(true)
  })

  it('devuelve 401 sin usuario', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())
    mocks.getRequestUser.mockReturnValue(null)

    const res: any = await GET(new Request('http://localhost/api/products-api'))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('No autenticado')
    expect(mocks.buildProductsBody).not.toHaveBeenCalled()
  })

  it('devuelve el catálogo del usuario', async () => {
    const db = makeDb()
    mocks.getStateForRequest.mockResolvedValue(db)
    mocks.getRequestUser.mockReturnValue(user)

    const res: any = await GET(new Request('http://localhost/api/products-api'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.products).toEqual(db.products)
  })
})

describe('POST /api/products-api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkWritePermission.mockReturnValue({ allowed: true, user })
    mocks.getRequestUser.mockReturnValue(user)
    mocks.canAccessRecord.mockReturnValue(true)
    mocks.saveStateForRequest.mockResolvedValue(undefined)
  })

  it('calcula el precio de venta desde costo y margen', async () => {
    const db = makeDb()
    mocks.getStateForRequest.mockResolvedValue(db)

    const res: any = await POST(postRequest({
      name: '  Tablet  ',
      category: ' Electrónica ',
      costPrice: 100,
      stock: 3,
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.product).toMatchObject({
      name: 'Tablet',
      category: 'Electrónica',
      costPrice: 100,
      salePrice: 130,
      profitMarginPercent: 30,
      manualSalePrice: false,
      stock: 3,
      userId: 'usr_1',
    })
    expect(mocks.saveStateForRequest).toHaveBeenCalledWith(expect.anything(), db)
  })

  it('calcula el margen cuando el precio de venta es manual', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())

    const res: any = await POST(postRequest({
      name: 'Monitor',
      costPrice: 100,
      salePrice: 150,
      manualSalePrice: true,
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.product).toMatchObject({
      salePrice: 150,
      profitMarginPercent: 50,
      manualSalePrice: true,
    })
  })

  it('rechaza un producto sin nombre', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())

    const res: any = await POST(postRequest({ name: '   ', costPrice: 10 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('El nombre del producto es obligatorio')
    expect(mocks.saveStateForRequest).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/products-api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkWritePermission.mockReturnValue({ allowed: true, user })
    mocks.getRequestUser.mockReturnValue(user)
    mocks.canAccessRecord.mockReturnValue(true)
    mocks.saveStateForRequest.mockResolvedValue(undefined)
  })

  it('elimina el producto indicado', async () => {
    const db = makeDb()
    mocks.getStateForRequest.mockResolvedValue(db)

    const res: any = await DELETE(deleteRequest('prod_1'))
    expect(res.status).toBe(200)
    expect(db.products).toHaveLength(0)
    expect(mocks.saveStateForRequest).toHaveBeenCalledWith(expect.anything(), db)
  })

  it('devuelve 404 si el producto no existe', async () => {
    mocks.getStateForRequest.mockResolvedValue(makeDb())

    const res: any = await DELETE(deleteRequest('prod_inexistente'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Producto no encontrado')
  })
})
