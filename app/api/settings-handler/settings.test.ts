import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `server-only` lanza fuera de un RSC; en el test sólo queremos las funciones
// puras de los builders, no el cliente admin de Supabase.
vi.mock('server-only', () => ({}))

const scope = vi.hoisted(() => ({ saved: 0 }))

vi.mock('@/server/persistence/supabase-store', () => ({
  saveStateForRequest: async () => { scope.saved += 1; return true },
  persistenceInfo: () => ({ mode: 'test' }),
}))

import {
  buildSettingsBody,
  getReceiptPatternImageUrls,
  prepareSettings,
} from '@/server/dashboard/builders'
import { ALLOWED_PROVIDERS, maskKey } from '@/server/settings/settings-shared'

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

  it('entrega usuarios y sólo máscaras de clave al admin, nunca las claves en claro', () => {
    const body: any = buildSettingsBody(makeDb('admin'))

    expect(body.isAdmin).toBe(true)
    expect(body.settings).not.toHaveProperty('ocrKeys')
    expect(JSON.stringify(body)).not.toContain('sk-test-1234567890')
    expect(JSON.stringify(body)).not.toContain('ocs-test-abcdef')
    expect(body.settings.ocrKeysMasked.openai).toBe('sk-t...7890')
    expect(body.settings.ocrKeysMasked.ocrspace).toBe('ocs-...cdef')
    expect(body.settings.aiApiKeyMasked).toBe('sk-t...7890')
    expect(body.settings.hasOcrSpaceKey).toBe(true)
    expect(body.users.map((u: any) => u.username)).toEqual(['admin', 'cliente'])
    expect(body.receiptPatterns).toHaveLength(1)
    expect(body.receiptPatterns[0].imageUrl).toBe('/img/pat-1.png')
  })

  it('toma el proveedor y las máscaras del DTO global sin exponer credenciales', () => {
    const db: any = makeDb('admin')
    db.__globalOcr = {
      configured: true,
      provider: 'gemini',
      hasKeys: { openai: false, gemini: true, ocrspace: false, tesseract: false },
      maskedKeys: { openai: '', gemini: 'gen-...abcd', ocrspace: '', tesseract: '' },
      endpoints: {},
      models: {},
      thresholds: {},
      confidenceMin: 0.7,
      routingRules: {},
      autoAssignEnabled: true,
      updatedAt: null,
      hasAiKey: true,
      aiApiKeyMasked: 'gen-...abcd',
      hasOcrSpaceKey: false,
      ocrSpaceKeyMasked: '',
    }

    const body: any = buildSettingsBody(db)
    expect(body.settings.aiProvider).toBe('gemini')
    expect(body.settings.ocrConfigured).toBe(true)
    expect(body.settings.ocrConfidenceMin).toBe(0.7)
    expect(body.settings.ocrKeysMasked.gemini).toBe('gen-...abcd')
    expect(body.settings).not.toHaveProperty('ocrKeys')
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
