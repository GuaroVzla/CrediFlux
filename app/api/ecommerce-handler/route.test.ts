import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const scope = vi.hoisted(() => {
  class OcrNotConfiguredError extends Error {
    code = 'OCR_NOT_CONFIGURED'
  }
  return {
    allow: true,
    user: { id: 'usr_1', role: 'admin' } as { id: string; role: string } | null,
    saveCount: 0,
    ocrConfigured: true,
    OcrNotConfiguredError,
    globalPatterns: [
      {
        id: 'pat-admin-1',
        bankName: 'Banesco',
        keywords: ['banesco', 'pago movil'],
        referenceFormat: '8-12 dígitos',
        referenceRegex: '',
        extra: {},
        isActive: true,
        version: 1,
      },
    ] as any[],
    patternSource: 'global-admin',
    adminProfiles: 1,
  }
})

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
      json: async () => body,
    }),
  },
}))

vi.mock('@/shared/lib/db.js', () => ({
  checkWritePermission: () => scope.allow
    ? { allowed: true, user: scope.user, isAdmin: scope.user?.role === 'admin' }
    : { allowed: false, error: 'Licencia del sistema caducada' },
  getRequestUser: () => scope.user,
  canAccessRecord: () => true,
}))

vi.mock('@/server/services/ocr.js', () => ({
  parseReceiptWithAI: vi.fn(async () => ({
    success: true,
    provider: 'Tesseract.js (Motor Local)',
    data: {
      monto: 100,
      fecha: '2026-06-15',
      referencia: '123456789',
      bancoOrigen: 'Banesco',
      bancoDestino: 'Desconocido',
    },
  })),
}))

vi.mock('@/server/ocr/global-config', () => ({
  OcrNotConfiguredError: scope.OcrNotConfiguredError,
  resolveOcrRuntimeConfig: vi.fn(async () => {
    if (!scope.ocrConfigured) {
      throw new scope.OcrNotConfiguredError('El administrador debe configurar el servicio OCR en Ajustes Admin antes de procesar comprobantes.')
    }
    return {
      provider: 'tesseract',
      apiKey: '',
      ocrSpaceApiKey: null,
      endpoint: undefined,
      model: undefined,
      confidenceThreshold: 0.8,
    }
  }),
}))

vi.mock('@/server/ocr/global-patterns', () => ({
  resolveGlobalOcrPatterns: vi.fn(async () => ({
    patterns: scope.globalPatterns,
    source: scope.patternSource,
    adminProfiles: scope.adminProfiles,
  })),
}))

vi.mock('@/server/persistence/supabase-store', () => ({
  getStateForRequest: async () => ({
    ecommerce: [],
    users: [scope.user],
    settings: { aiProvider: 'tesseract' },
    receiptPatterns: [{ id: 'pat-sesion', bankName: 'Banco del Usuario', isActive: true }],
  }),
  saveStateForRequest: async () => { scope.saveCount += 1; return true },
  persistenceInfo: () => ({ mode: 'test' }),
}))

vi.mock('@/server/dashboard/builders', () => ({
  normalizeDashboardState: () => {},
  buildEcommerceBody: () => ({ success: true }),
}))

vi.mock('@/server/services/uploads.js', () => ({
  saveUpload: vi.fn(async () => ({ url: '/uploads/recibo.png' })),
  resolveUploadUrl: async (url: string | null) => url || '',
  resolveUploadUrls: async (urls: string[]) => urls,
}))

import { parseReceiptWithAI } from '@/server/services/ocr.js'
import { resolveGlobalOcrPatterns } from '@/server/ocr/global-patterns'
import { POST } from './route.js'

function requestWith(fields: Record<string, unknown>): Request {
  const form = new Map(Object.entries(fields))
  return { formData: async () => form } as unknown as Request
}

const imageFile = {
  size: 8,
  type: 'image/png',
  name: 'recibo.png',
  arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
}

describe('M-003: POST /api/ecommerce-handler — validación antes de OCR y persistencia', () => {
  beforeEach(() => {
    scope.allow = true
    scope.user = { id: 'usr_1', role: 'admin' }
    scope.saveCount = 0
    scope.ocrConfigured = true
    scope.globalPatterns = [
      {
        id: 'pat-admin-1',
        bankName: 'Banesco',
        keywords: ['banesco', 'pago movil'],
        referenceFormat: '8-12 dígitos',
        referenceRegex: '',
        extra: {},
        isActive: true,
        version: 1,
      },
    ]
    scope.patternSource = 'global-admin'
    scope.adminProfiles = 1
    vi.mocked(parseReceiptWithAI).mockClear()
    vi.mocked(resolveGlobalOcrPatterns).mockClear()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rechaza la petición sin usuario autenticado antes de invocar al OCR', async () => {
    scope.user = null
    const response = await POST(requestWith({ manual: 'true' }))

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ success: false, error: 'No autenticado' })
    expect(parseReceiptWithAI).not.toHaveBeenCalled()
    expect(scope.saveCount).toBe(0)
  })

  it('devuelve 400 si el registro manual omite banco o referencia y no llama al OCR', async () => {
    const response = await POST(requestWith({
      manual: 'true',
      amountBs: '100',
      bcvRate: '40',
      bankOrigin: '',
      reference: '',
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'MISSING_MANUAL_FIELDS',
      error: 'El banco emisor y la referencia son obligatorios en el registro manual.',
    })
    expect(parseReceiptWithAI).not.toHaveBeenCalled()
    expect(scope.saveCount).toBe(0)
  })

  it('devuelve 422 si no hay comprobante ni datos manuales, sin invocar al OCR', async () => {
    const response = await POST(requestWith({ type: 'venta' }))

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'OCR_EXTRACTION_FAILED',
    })
    expect(parseReceiptWithAI).not.toHaveBeenCalled()
    expect(scope.saveCount).toBe(0)
  })

  it('rechaza archivos que no son imágenes antes de leerlos o enviarlos al OCR', async () => {
    const response = await POST(requestWith({
      receiptFile: { size: 8, type: 'application/pdf', name: 'recibo.pdf' },
    }))

    expect(response.status).toBe(415)
    expect(await response.json()).toMatchObject({ success: false, code: 'INVALID_FILE_TYPE' })
    expect(parseReceiptWithAI).not.toHaveBeenCalled()
  })

  it('persiste un registro manual completo sin pasar por el OCR', async () => {
    const response = await POST(requestWith({
      manual: 'true',
      type: 'venta',
      amountBs: '100',
      bcvRate: '40',
      bankOrigin: 'Banesco',
      reference: 'REF-123456',
      date: '2026-06-15',
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.transaction).toMatchObject({
      userId: 'usr_1',
      type: 'venta',
      amountBs: 100,
      amountUSD: 2.5,
      bcvRate: 40,
      bankOrigin: 'Banesco',
      reference: 'REF-123456',
      manual: true,
      ocrProvider: 'Manual',
    })
    expect(scope.saveCount).toBe(1)
    expect(parseReceiptWithAI).not.toHaveBeenCalled()
  })

  it('devuelve 503 con mensaje del administrador si no hay motor OCR global configurado', async () => {
    scope.ocrConfigured = false

    const response = await POST(requestWith({ receiptFile: imageFile }))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'OCR_NOT_CONFIGURED',
      error: 'El administrador debe configurar el servicio OCR en Ajustes Admin antes de procesar comprobantes.',
    })
    expect(parseReceiptWithAI).not.toHaveBeenCalled()
    expect(scope.saveCount).toBe(0)
  })

  it('llama al OCR con el proveedor configurado cuando se sube una imagen', async () => {
    const response = await POST(requestWith({ receiptFile: imageFile }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(parseReceiptWithAI).toHaveBeenCalledTimes(1)
    expect(vi.mocked(parseReceiptWithAI).mock.calls[0][0]).toMatchObject({
      provider: 'tesseract',
      mimeType: 'image/png',
    })
    expect(body.transaction).toMatchObject({
      amountBs: 100,
      bankOrigin: 'Banesco',
      reference: '123456789',
      receiptUrl: '/uploads/recibo.png',
    })
    expect(scope.saveCount).toBe(1)
  })

  it('usa los patrones globales del admin para un usuario final y devuelve banco_emisor', async () => {
    scope.user = { id: 'usr_final', role: 'user' }

    const response = await POST(requestWith({
      receiptFile: imageFile,
      bcvRate: '40',
    }))

    expect(response.status).toBe(200)
    expect(resolveGlobalOcrPatterns).toHaveBeenCalledTimes(1)

    const parseArgs: any = vi.mocked(parseReceiptWithAI).mock.calls[0][0]
    expect(parseArgs.registeredPatterns).toEqual(scope.globalPatterns)

    const body: any = await response.json()
    expect(body.banco_emisor).toBe('Banesco')
    expect(body.ocr.data.banco_emisor).toBe('Banesco')
    expect(body.ocr.data.bancoOrigen).toBe('Banesco')
    expect(body.transaction).toMatchObject({
      userId: 'usr_final',
      bankOrigin: 'Banesco',
    })

    const infoCalls = vi.mocked(console.info).mock.calls as any[][]
    expect(infoCalls.some(([message, meta]) => (
      message === '[ocr-patterns] carga' && meta?.role === 'user' && meta?.loaded === 1
    ))).toBe(true)
    expect(infoCalls.some(([message, meta]) => (
      message === '[ocr-patterns] matching' && meta?.patternsLoaded === 1 && meta?.bancoEmisor === 'Banesco'
    ))).toBe(true)
  })

  it('ignora patrones del estado del usuario aunque el DTO scoped los traiga', async () => {
    scope.user = { id: 'usr_final', role: 'user' }
    const response = await POST(requestWith({ receiptFile: imageFile, bcvRate: '40' }))

    const parseArgs: any = vi.mocked(parseReceiptWithAI).mock.calls[0][0]
    expect(parseArgs.registeredPatterns).toHaveLength(1)
    expect(parseArgs.registeredPatterns[0].id).toBe('pat-admin-1')
    expect(response.status).toBe(200)
  })
})
