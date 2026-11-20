import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LICENSE_EXPIRED_MESSAGE,
  canAccessRecord,
  checkWritePermission,
  computeLoanStatus,
  getRequestUser,
  normalizeDni,
  scopeRecords,
} from '@/shared/lib/db.js'

const DAY_MS = 24 * 60 * 60 * 1000

/** Fecha relativa a "hoy" en el formato YYYY-MM-DD que usa el store. */
function isoDay(offset: number): string {
  return new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10)
}

function loanWithDueDates(dueDates: string[], paid = false) {
  return {
    installments: dueDates.map((dueDate, index) => ({
      number: index + 1,
      dueDate,
      amount: 100,
      paid,
    })),
  }
}

describe('M-006: db.js — cálculo de estado y aislamiento multi-tenant', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Mediodía local: evita que la conversión UTC -> local cambie el día.
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  describe('computeLoanStatus', () => {
    it('devuelve "completado" cuando todas las cuotas están pagas', () => {
      const loan = loanWithDueDates([isoDay(-10), isoDay(-3)], true)
      expect(computeLoanStatus(loan as never)).toBe('completado')
    })

    it('devuelve "moroso" cuando existe una cuota impaga con vencimiento pasado', () => {
      const loan = loanWithDueDates([isoDay(-1)])
      expect(computeLoanStatus(loan as never)).toBe('moroso')
    })

    it('devuelve "proximo" cuando el próximo vencimiento impago está a 3 días o menos', () => {
      expect(computeLoanStatus(loanWithDueDates([isoDay(1)]) as never)).toBe('proximo')
      expect(computeLoanStatus(loanWithDueDates([isoDay(3)]) as never)).toBe('proximo')
    })

    it('devuelve "al_dia" cuando el próximo vencimiento está más allá de 3 días', () => {
      const loan = loanWithDueDates([isoDay(5)])
      expect(computeLoanStatus(loan as never)).toBe('al_dia')
    })

    it('respeta el archivado aunque queden cuotas impagas', () => {
      const loan = { ...loanWithDueDates([isoDay(-1)]), archived: true }
      expect(computeLoanStatus(loan as never)).toBe('archivado')
    })
  })

  describe('canAccessRecord', () => {
    const user = { id: 'usr_1', role: 'user' }

    it('permite el acceso al registro propio', () => {
      expect(canAccessRecord(user as never, { id: 'ln_1', userId: 'usr_1' } as never)).toBe(true)
    })

    it('niega el acceso a un registro de otro usuario', () => {
      expect(canAccessRecord(user as never, { id: 'ln_2', userId: 'usr_2' } as never)).toBe(false)
    })

    it('niega el acceso sin usuario o sin propietario en el registro', () => {
      expect(canAccessRecord(null as never, { userId: 'usr_1' } as never)).toBe(false)
      expect(canAccessRecord(user as never, { id: 'ln_3' } as never)).toBe(false)
    })
  })

  describe('scopeRecords', () => {
    const user = { id: 'usr_1', role: 'user' }
    const records = [
      { id: 'a', userId: 'usr_1' },
      { id: 'b', userId: 'usr_2' },
      { id: 'c', userId: 'usr_1' },
    ]

    it('devuelve únicamente los registros del usuario autenticado', () => {
      expect(scopeRecords(records as never, user as never).map((r: any) => r.id)).toEqual(['a', 'c'])
    })

    it('devuelve una lista vacía sin usuario o con entrada inválida', () => {
      expect(scopeRecords(records as never, null as never)).toEqual([])
      expect(scopeRecords(null as never, user as never)).toEqual([])
    })
  })

  describe('normalizeDni', () => {
    it('elimina separadores y normaliza a minúsculas', () => {
      expect(normalizeDni('V-18.452.910')).toBe('v18452910')
      expect(normalizeDni(' J-1234567-8 ')).toBe('j12345678')
    })

    it('devuelve cadena vacía para valores ausentes', () => {
      expect(normalizeDni(null)).toBe('')
      expect(normalizeDni(undefined)).toBe('')
    })
  })

  describe('getRequestUser / checkWritePermission', () => {
    it('da prioridad al usuario resuelto por Supabase sobre el header legado', () => {
      const db = {
        users: [{ id: 'usr_admin', role: 'admin' }, { id: 'usr_2', role: 'user' }],
        __currentUser: { id: 'usr_admin', role: 'admin' },
      }
      const request = { headers: { get: () => 'usr_2' } }
      expect(getRequestUser(request as never, db as never)?.id).toBe('usr_admin')
      expect(checkWritePermission(request as never, db as never)).toMatchObject({
        allowed: true,
        isAdmin: true,
      })
    })

    it('rechaza la escritura de un usuario con la licencia vencida', () => {
      const expiredUser = {
        id: 'usr_2',
        role: 'user',
        licenseExpiresAt: new Date(Date.now() - DAY_MS).toISOString(),
      }
      const db = { users: [expiredUser], __currentUser: expiredUser }
      const request = { headers: { get: () => null } }
      expect(checkWritePermission(request as never, db as never)).toEqual({
        allowed: false,
        user: expiredUser,
        isAdmin: false,
        error: LICENSE_EXPIRED_MESSAGE,
      })
    })
  })

  describe('P0: identidad por header sólo en desarrollo/pruebas', () => {
    const db = { users: [{ id: 'usr_admin', role: 'admin' }] }
    const headerRequest = () => new Request('http://x', {
      headers: { 'x-user-id': 'usr_admin' },
    })

    it('en producción ignora x-user-id y cierra la escritura (fail-closed)', () => {
      vi.stubEnv('NODE_ENV', 'production')

      expect(getRequestUser(headerRequest(), db as never)).toBeNull()
      expect(checkWritePermission(headerRequest(), db as never)).toMatchObject({
        allowed: false,
        user: null,
        isAdmin: false,
        error: 'No autenticado',
      })
    })

    it('en test siempre resuelve el usuario del header y permite la escritura', () => {
      vi.stubEnv('NODE_ENV', 'test')

      expect(getRequestUser(headerRequest(), db as never)).toMatchObject({
        id: 'usr_admin',
        role: 'admin',
      })
      expect(checkWritePermission(headerRequest(), db as never)).toMatchObject({
        allowed: true,
        isAdmin: true,
        user: { id: 'usr_admin', role: 'admin' },
      })
    })
  })
})
