import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `server-only` lanza fuera de un RSC; en el test sólo queremos las funciones
// puras de los builders, no el cliente admin de Supabase.
vi.mock('server-only', () => ({}))

const scope = vi.hoisted(() => ({ saved: 0 }))

vi.mock('../../../lib/server/supabase-store', () => ({
  saveStateForRequest: async () => { scope.saved += 1; return true },
  persistenceInfo: () => ({ mode: 'test' }),
}))

import {
  buildSettingsBody,
  getReceiptPatternImageUrls,
  prepareSettings,
} from '../../../lib/server/dashboard-builders'
import { ALLOWED_PROVIDERS, maskKey } from '../../../lib/server/settings-shared'

function makeDb(role: 'admin' | 'user') {
  const currentUser = role === 'admin'
    ? { id: 'usr_admin', username: 'admin', role: 'admin' }
    : { id: 'usr_1', username: 'cliente', role: 'user' }

  return {
    __currentUser: currentUser,
    users: [
      { id: 'usr_admin', username: 'admin', role: 'admin' },
      { id: 'usr_1', username: 'cliente', role: 'user' },
    ],
    settings: {
      aiProvider: 'openai',
      currency: '$',
      ocrApiKeys: {
        openai: 'sk-test-1234567890',
        gemini: '',
        ocrspace: 'ocs-test-abcdef',
        tesseract: '',
      },
    },
    receiptPatterns: [
      { id: 'pat_1', bankName: 'Banesco', imageUrl: '/img/pat-1.png', isActive: true },
    ],
  }
}

describe('M-002: settings-shared / dashboard-builders — exposición de secretos por rol', () => {
  beforeEach(() => {
    scope.saved = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no filtra claves OCR, usuarios ni patrones a un usuario no-admin', () => {
    const body: any = buildSettingsBody(makeDb('user'))

    expect(body.isAdmin).toBe(false)
    expect(body).not.toHaveProperty('ocrKeys')
    expect(body).not.toHaveProperty('users')
    expect(body).not.toHaveProperty('receiptPatterns')
    expect(body.settings).not.toHaveProperty('ocrKeys')
    expect(body.settings).not.toHaveProperty('aiApiKeyMasked')
    expect(body.settings.aiProvider).toBe('openai')
  })

  it('entrega claves y usuarios al admin, con las claves también enmascaradas', () => {
    const body: any = buildSettingsBody(makeDb('admin'))

    expect(body.isAdmin).toBe(true)
    expect(body.settings.ocrKeys).toEqual({
      openai: 'sk-test-1234567890',
      gemini: '',
      ocrspace: 'ocs-test-abcdef',
      tesseract: '',
    })
    expect(body.settings.ocrKeysMasked.openai).toBe('sk-t...7890')
    expect(body.settings.aiApiKeyMasked).toBe('sk-t...7890')
    expect(body.users.map((u: any) => u.username)).toEqual(['admin', 'cliente'])
    expect(body.receiptPatterns).toHaveLength(1)
    expect(body.receiptPatterns[0].imageUrl).toBe('/img/pat-1.png')
  })

  it('sólo devuelve URLs de patrones al admin', () => {
    expect(getReceiptPatternImageUrls(makeDb('user'))).toEqual([])
    expect(getReceiptPatternImageUrls(makeDb('admin'))).toEqual(['/img/pat-1.png'])
  })

  it('repara un proveedor inválido y lo guarda, sin escribir si ya es válido', async () => {
    const request = {} as Request

    const broken = makeDb('admin')
    broken.settings.aiProvider = 'proveedor-inexistente'
    await prepareSettings(broken, request)
    expect(broken.settings.aiProvider).toBe('openai')
    expect(scope.saved).toBe(1)

    const valid = makeDb('admin')
    valid.settings.aiProvider = 'gemini'
    await prepareSettings(valid, request)
    expect(valid.settings.aiProvider).toBe('gemini')
    expect(scope.saved).toBe(1)
  })

  it('usa la lista de proveedores y el enmascarado compartidos', () => {
    expect(ALLOWED_PROVIDERS).toEqual(['openai', 'gemini', 'ocrspace', 'tesseract'])
    expect(maskKey('sk-test-1234567890')).toBe('sk-t...7890')
  })
})
