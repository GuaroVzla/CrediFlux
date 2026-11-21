import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const scope = vi.hoisted(() => ({
  supabaseConfigured: true,
  adminClient: null as any,
  queries: [] as Array<{ table: string; filters: any[] }>,
  profileRows: [] as any[],
  patternRows: [] as any[],
  profileError: null as { message: string } | null,
  patternError: null as { message: string } | null,
}))

vi.mock('@/server/supabase/env', () => ({
  isSupabaseConfigured: () => scope.supabaseConfigured,
}))

vi.mock('@/server/supabase/admin', () => ({
  getSupabaseAdminClientOrNull: () => scope.adminClient,
}))

import { resolveGlobalOcrPatterns } from './global-patterns'

function makeQuery(table: string) {
  const entry = { table, filters: [] as any[] }
  scope.queries.push(entry)

  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      entry.filters.push(['eq', column, value])
      return query
    }),
    in: vi.fn((column: string, values: unknown[]) => {
      entry.filters.push(['in', column, values])
      return query
    }),
    order: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => {
      const payload = table === 'profiles'
        ? { data: scope.profileRows, error: scope.profileError }
        : { data: scope.patternRows, error: scope.patternError }
      return Promise.resolve(payload).then(resolve, reject)
    },
  }
  return query
}

describe('M-OCR: patrones globales de comprobantes para el escáner', () => {
  beforeEach(() => {
    scope.supabaseConfigured = true
    scope.queries = []
    scope.profileRows = [{ id: 'admin-1' }]
    scope.patternRows = [{
      id: 'pat-1',
      bank_name: 'Banesco',
      keywords: ['banesco', 'pago movil'],
      reference_format: '8-12 dígitos',
      reference_regex: '^(\\d{8,12})$',
      extra: { visualSignature: { hash: 'abc' } },
      is_active: true,
      version: 2,
    }]
    scope.profileError = null
    scope.patternError = null
    scope.adminClient = { from: vi.fn((table: string) => makeQuery(table)) }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('lee con service_role los patrones activos de los admin activos y devuelve un DTO mínimo', async () => {
    const result = await resolveGlobalOcrPatterns([{ id: ' sesion', bankName: 'Del usuario' }])

    expect(result.source).toBe('global-admin')
    expect(result.adminProfiles).toBe(1)
    expect(result.patterns).toHaveLength(1)
    expect(result.patterns[0]).toMatchObject({
      id: 'pat-1',
      bankName: 'Banesco',
      keywords: ['banesco', 'pago movil'],
      referenceFormat: '8-12 dígitos',
      referenceRegex: '^(\\d{8,12})$',
      isActive: true,
      version: 2,
    })
    expect(result.patterns[0].extra).toEqual({ visualSignature: { hash: 'abc' } })
    expect(result.patterns[0]).not.toHaveProperty('user_id')
    expect(result.patterns[0]).not.toHaveProperty('image_key')
    expect(result.patterns[0]).not.toHaveProperty('image_url')
    expect(result.patterns[0]).not.toHaveProperty('notes')

    expect(scope.adminClient.from).toHaveBeenCalledWith('profiles')
    expect(scope.adminClient.from).toHaveBeenCalledWith('receipt_patterns')

    const profilesQuery = scope.queries.find((q) => q.table === 'profiles')!
    expect(profilesQuery.filters).toEqual(expect.arrayContaining([
      ['eq', 'role', 'admin'],
      ['eq', 'is_active', true],
    ]))

    const patternsQuery = scope.queries.find((q) => q.table === 'receipt_patterns')!
    expect(patternsQuery.filters).toEqual(expect.arrayContaining([
      ['in', 'user_id', ['admin-1']],
      ['eq', 'is_active', true],
    ]))
  })

  it('omite patrones inactivos o sin nombre de banco', async () => {
    scope.patternRows = [
      { id: 'pat-1', bank_name: 'Banesco', is_active: true },
      { id: 'pat-2', bank_name: 'Mercantil', is_active: false },
      { id: 'pat-3', bank_name: '', is_active: true },
    ]

    const result = await resolveGlobalOcrPatterns()

    expect(result.patterns.map((pattern) => pattern.id)).toEqual(['pat-1'])
  })

  it('no consulta patrones si no hay administradores activos', async () => {
    scope.profileRows = []

    const result = await resolveGlobalOcrPatterns()

    expect(result).toMatchObject({ source: 'global-admin', adminProfiles: 0, patterns: [] })
    expect(scope.adminClient.from).toHaveBeenCalledTimes(1)
  })

  it('falla cerrado si falla la lectura con service_role', async () => {
    scope.patternError = { message: 'permission denied' }

    const result = await resolveGlobalOcrPatterns([{ id: 'sesion', bankName: 'Del usuario' }])

    expect(result.source).toBe('unavailable')
    expect(result.patterns).toEqual([])
    expect(result.reason).toContain('permission denied')
    expect(console.error).toHaveBeenCalled()
  })

  it('usa el estado local únicamente en el modo legado sin Supabase', async () => {
    scope.supabaseConfigured = false

    const result = await resolveGlobalOcrPatterns([
      { id: 'pat-local', bankName: 'Banesco', keywords: ['banesco'], isActive: true },
      { id: 'pat-off', bankName: 'Mercantil', isActive: false },
    ])

    expect(result.source).toBe('session-fallback')
    expect(result.patterns.map((pattern) => pattern.id)).toEqual(['pat-local'])
    expect(scope.adminClient.from).not.toHaveBeenCalled()
  })
})
