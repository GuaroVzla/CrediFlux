import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const scope = vi.hoisted(() => ({
  users: [] as any[],
  settings: {} as Record<string, unknown>,
  supabaseConfigured: false,
  signOutError: null as { message: string } | null,
  signOutCount: 0,
  saveCount: 0,
  cookieNames: [] as string[],
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
      json: async () => body,
      cookies: {
        set: (name: string) => { scope.cookieNames.push(name) },
      },
    }),
  },
}))

vi.mock('../../../lib/server/supabase-store', () => ({
  getStateForRequest: async () => ({
    users: scope.users,
    settings: scope.settings,
    __currentUser: null,
  }),
  saveStateForRequest: async () => { scope.saveCount += 1; return true },
  persistenceInfo: () => ({ mode: 'test' }),
}))

vi.mock('../../../lib/supabase/env', () => ({
  isSupabaseConfigured: () => scope.supabaseConfigured,
  isLegacyAuthAllowed: () => process.env.NODE_ENV !== 'production',
  usernameToEmail: (username: string) => `${username}@test.local`,
}))

vi.mock('../../../lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
  createSupabaseRouteClient: () => ({
    supabase: {
      auth: {
        signInWithPassword: async () => ({
          error: { message: 'Invalid login credentials' },
          data: {},
        }),
        getUser: async () => ({ data: { user: null } }),
        signOut: async () => {
          scope.signOutCount += 1
          return { error: scope.signOutError }
        },
      },
    },
    applyCookies: (response: unknown) => response,
  }),
}))

vi.mock('../../../lib/server/request-auth', () => ({
  resolveRequestAuth: async () => ({ userId: null, profile: null }),
  profileToLegacyUser: (profile: any) => profile,
}))

vi.mock('../../../lib/supabase/admin', () => ({
  getSupabaseAdminClientOrNull: () => null,
}))

vi.mock('../../../lib/server/password-preview.js', () => ({
  setLegacyPasswordPreview: () => {},
  storePasswordPreview: async () => {},
}))

import { POST } from './route.js'

function jsonRequest(body: unknown): Request {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Request
}

describe('M-001: POST /api/auth — acciones reales con dependencias simuladas', () => {
  beforeEach(() => {
    scope.users = []
    scope.settings = {}
    scope.supabaseConfigured = false
    scope.signOutError = null
    scope.signOutCount = 0
    scope.saveCount = 0
    scope.cookieNames = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('responde 400 ante una acción desconocida', async () => {
    const response = await POST(jsonRequest({ action: 'accion-inexistente' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Acción no válida',
    })
    expect(scope.signOutCount).toBe(0)
    expect(scope.saveCount).toBe(0)
  })

  it('responde 503 en producción sin Supabase: el login legacy está deshabilitado', async () => {
    scope.supabaseConfigured = false
    vi.stubEnv('NODE_ENV', 'production')

    const response = await POST(jsonRequest({
      action: 'login',
      username: 'demo',
      password: 'clave-de-prueba',
    }))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Modo legado deshabilitado en producción. Configura Supabase Auth para continuar.',
    })
    expect(scope.saveCount).toBe(0)
    expect(scope.signOutCount).toBe(0)
  })

  it('rechaza credenciales inválidas sin exponer stack ni detalles internos', async () => {
    scope.users = [{ id: 'usr_1', username: 'demo', password: 'clave-valida', role: 'user' }]

    const response = await POST(jsonRequest({
      action: 'login',
      username: 'demo',
      password: 'clave-incorrecta',
    }))

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body).toMatchObject({ success: false, error: 'Contraseña incorrecta' })
    expect(body.stack).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('stack')
    expect(scope.saveCount).toBe(0)
  })

  it('devuelve 500 cuando Supabase falla al cerrar la sesión', async () => {
    scope.supabaseConfigured = true
    scope.signOutError = { message: 'fallo controlado de prueba' }

    const response = await POST(jsonRequest({ action: 'logout' }))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({
      success: false,
      error: 'No se pudo cerrar la sesión en el servidor',
    })
    expect(body.stack).toBeUndefined()
    expect(scope.signOutCount).toBe(1)
  })

  it('limpia las cookies de sesión cuando el logout termina correctamente', async () => {
    scope.supabaseConfigured = true

    const response = await POST(jsonRequest({ action: 'logout' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, message: 'Sesión cerrada' })
    expect(scope.signOutCount).toBe(1)
    expect(scope.cookieNames).toEqual(['cf_session_start', 'cf_last_activity'])
  })
})
