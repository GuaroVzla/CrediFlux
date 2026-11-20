import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const schemaPath = fileURLToPath(new URL('./schema.prisma', import.meta.url))
let schema = ''

describe('M-007: prisma/schema.prisma — modelos e índices reales', () => {
  beforeAll(() => {
    schema = fs.readFileSync(schemaPath, 'utf8')
  })

  it('define los modelos centrales de multi-tenancy, usuarios y licencias', () => {
    expect(schema).toMatch(/\bmodel\s+Tenant\s*\{/)
    expect(schema).toMatch(/\bmodel\s+User\s*\{/)
    expect(schema).toMatch(/\bmodel\s+License\s*\{/)
    expect(schema).toMatch(/\bmodel\s+AdminSetting\s*\{/)
  })

  it('conserva el almacén de estado JSON y la configuración de confianza', () => {
    expect(schema).toMatch(/\bmodel\s+AppState\s*\{/)
    expect(schema).toMatch(/\bdata\s+Json\b/)
    expect(schema).toMatch(/\bmodel\s+TrustLevelConfig\s*\{/)
    expect(schema).toMatch(/\bmodel\s+SettingAuditLog\s*\{/)
  })

  it('declara índices compuestos por tenant en las consultas frecuentes', () => {
    const indexes = schema.match(/@@index\(/g) ?? []
    expect(indexes.length).toBeGreaterThanOrEqual(5)
    expect(schema).toContain('@@index([tenantId, role])')
    expect(schema).toContain('@@index([tenantId, status, expiresAt])')
    expect(schema).toContain('@@index([tenantId, entity, createdAt])')
    expect(schema).toContain('@@unique([tenantId, username])')
  })

  it('define los enum de roles y estados de licencia usados por la app', () => {
    expect(schema).toMatch(/enum\s+UserRole\s*\{[\s\S]*?ADMIN[\s\S]*?USER[\s\S]*?\}/)
    expect(schema).toMatch(/enum\s+LicenseStatus\s*\{[\s\S]*?ACTIVE[\s\S]*?EXPIRED[\s\S]*?\}/)
  })
})
