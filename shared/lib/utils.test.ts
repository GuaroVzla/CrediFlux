import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LICENSE_EXPIRED_MESSAGE,
  MONTH_NAMES,
  getDefaultMonthlyCapital,
  isUserLicenseExpired,
} from '@/shared/lib/db.js'
import { computeClientTrust, getTrustLevelConfig, normalizeTrustConfig } from '@/modules/trust/service.js'

const DAY_MS = 24 * 60 * 60 * 1000
const isoDay = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10)

describe('M-010: helpers reales de capital, licencias y confianza', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getDefaultMonthlyCapital', () => {
    it('genera los 12 meses del año en curso con el capital base solicitado', () => {
      const capitals = getDefaultMonthlyCapital(7500)
      const year = new Date().getFullYear()

      expect(Object.keys(capitals)).toHaveLength(12)
      expect(Object.keys(capitals)).toContain(`${year}-01`)
      expect(Object.keys(capitals)).toContain(`${year}-12`)
      expect(capitals[`${year}-01`]).toEqual({
        monthIndex: 1,
        monthName: 'Enero',
        year,
        capital: 7500,
      })
      expect(capitals[`${year}-12`].monthName).toBe('Diciembre')
    })

    it('usa 5000 como capital por defecto', () => {
      const capitals = getDefaultMonthlyCapital()
      const key = `${new Date().getFullYear()}-06`
      expect(capitals[key].capital).toBe(5000)
      expect(MONTH_NAMES).toHaveLength(12)
      expect(MONTH_NAMES[5]).toBe('Junio')
    })
  })

  describe('getTrustLevelConfig / normalizeTrustConfig', () => {
    it('aplica valores por defecto cuando la configuración es inválida', () => {
      const config = getTrustLevelConfig(null)
      expect(Object.keys(config.levels)).toEqual(['alto', 'medio', 'riesgoso'])
      expect(config.levels.alto.label).toBe('Alta')
      expect(config.thresholds).toEqual({
        altoMaxDelayDays: 0,
        mediaMaxDelayDays: 7,
        riesgoMaxDelayDays: 15,
      })
    })

    it('normaliza configuración parcial y mantiene los umbrales ordenados', () => {
      const config = getTrustLevelConfig({
        settings: {
          trustLevelConfig: {
            levels: { alto: { label: 'Excelente' } },
            thresholds: { mediaMaxDelayDays: 3, riesgoMaxDelayDays: 2 },
          },
        },
      })

      expect(config.levels.alto.label).toBe('Excelente')
      expect(config.levels.medio.label).toBe('Media')
      expect(config.thresholds.mediaMaxDelayDays).toBe(3)
      // riesgo no puede ser menor que medio
      expect(config.thresholds.riesgoMaxDelayDays).toBe(3)
    })

    it('acepta la configuración directa (sin contenedor settings) y acota valores', () => {
      const config = normalizeTrustConfig({
        thresholds: { altoMaxDelayDays: 999, mediaMaxDelayDays: -4 },
      })
      expect(config.thresholds.altoMaxDelayDays).toBe(60)
      expect(config.thresholds.mediaMaxDelayDays).toBe(60)
      expect(config.thresholds.riesgoMaxDelayDays).toBe(60)
    })
  })

  describe('isUserLicenseExpired', () => {
    it('exime a los administradores y considera vencida una licencia pasada', () => {
      expect(isUserLicenseExpired({ role: 'admin' } as never)).toBe(false)
      expect(
        isUserLicenseExpired({
          role: 'user',
          licenseExpiresAt: new Date(Date.now() - DAY_MS).toISOString(),
        } as never),
      ).toBe(true)
    })

    it('considera vigente una licencia futura y vencida una ausencia de fecha', () => {
      expect(
        isUserLicenseExpired({
          role: 'user',
          licenseExpiresAt: new Date(Date.now() + 10 * DAY_MS).toISOString(),
        } as never),
      ).toBe(false)
      expect(isUserLicenseExpired({ role: 'user' } as never)).toBe(true)
      expect(LICENSE_EXPIRED_MESSAGE).toContain('Licencia del sistema caducada')
    })
  })

  describe('computeClientTrust', () => {
    const config = normalizeTrustConfig(null)

    it('clasifica como "alto" a un cliente con pagos puntuales', () => {
      const loans = [{
        installments: [{
          dueDate: isoDay(-10),
          paidDate: isoDay(-10),
          paid: true,
        }],
      }]
      const result = computeClientTrust(loans as never, config as never)
      expect(result.level).toBe('alto')
      expect(result.label).toBe('Alta')
      expect(result.maxDelayDays).toBe(0)
      expect(result.paidRatio).toBe(100)
    })

    it('clasifica como "riesgoso" cuando hay cuotas vencidas sin pagar', () => {
      const loans = [{
        installments: [
          { dueDate: isoDay(-2), paidDate: null, paid: false },
          { dueDate: isoDay(5), paidDate: null, paid: false },
        ],
      }]
      const result = computeClientTrust(loans as never, config as never)
      expect(result.level).toBe('riesgoso')
      expect(result.overdueInstallments).toBe(1)
      expect(result.totalInstallments).toBe(2)
    })
  })
})
