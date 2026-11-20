import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decryptSecret,
  encryptSecret,
  encryptionAvailable,
  hashPassword,
  isEncryptedSecret,
  isPasswordHash,
  sanitizeUserForClient,
  upgradePasswordIfNeeded,
  verifyPassword,
} from '@/server/security/security.js'
import { maskKey } from '@/server/settings/settings-shared'

// Hex de 64 caracteres usado SOLO como clave de prueba (no es un secreto real).
const TEST_KEY_HEX = 'a1b2c3d4'.repeat(8)
const ORIGINAL_KEY = process.env.SETTINGS_ENCRYPTION_KEY

describe('M-005: security.js — hashing y cifrado de secretos', () => {
  beforeEach(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = TEST_KEY_HEX
  })

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY
    else process.env.SETTINGS_ENCRYPTION_KEY = ORIGINAL_KEY
  })

  describe('encryptSecret / decryptSecret', () => {
    it('hace round-trip del valor cifrado y usa el prefijo de versión', () => {
      expect(encryptionAvailable()).toBe(true)
      const plain = 'sk-prueba-local-1234'
      const encrypted = encryptSecret(plain)

      expect(isEncryptedSecret(encrypted)).toBe(true)
      expect(encrypted).toMatch(/^enc:v1:/)
      expect(encrypted).not.toBe(plain)
      expect(decryptSecret(encrypted)).toBe(plain)
    })

    it('genera IV distinto en cada cifrado del mismo valor', () => {
      const first = encryptSecret('valor-de-prueba')
      const second = encryptSecret('valor-de-prueba')
      expect(first).not.toBe(second)
      expect(decryptSecret(first)).toBe(decryptSecret(second))
    })

    it('no filtra el blob cifrado cuando falta la clave de descifrado', () => {
      const encrypted = encryptSecret('secreto-de-prueba')
      delete process.env.SETTINGS_ENCRYPTION_KEY

      expect(encryptionAvailable()).toBe(false)
      expect(encryptSecret('texto-plano')).toBe('texto-plano')
      expect(decryptSecret(encrypted)).toBe('')
      expect(decryptSecret('valor-legado')).toBe('valor-legado')
    })

    it('respeta valores nulos y cadenas vacías', () => {
      expect(encryptSecret(null)).toBeNull()
      expect(decryptSecret(undefined)).toBeUndefined()
      expect(encryptSecret('')).toBe('')
      expect(decryptSecret('')).toBe('')
    })
  })

  describe('maskKey', () => {
    it('nunca devuelve la clave completa', () => {
      const key = 'sk-test-1234567890'
      const masked = maskKey(key)
      expect(masked).toBe('sk-t...7890')
      expect(masked).not.toBe(key)
      expect(masked).not.toContain('12345678')
    })

    it('enmascara por completo las claves cortas y vacías', () => {
      expect(maskKey('abc')).toBe('********')
      expect(maskKey('')).toBe('')
      expect(maskKey(undefined)).toBe('')
    })
  })

  describe('hashPassword / verifyPassword', () => {
    it('verifica la contraseña correcta y rechaza una incorrecta', async () => {
      const hash = await hashPassword('ClaveDePrueba123')
      expect(hash).toMatch(/^scrypt\$/)
      expect(isPasswordHash(hash)).toBe(true)
      expect(await verifyPassword('ClaveDePrueba123', hash)).toEqual({
        ok: true,
        legacy: false,
        needsMigration: false,
      })
      expect((await verifyPassword('otra-clave', hash)).ok).toBe(false)
    })

    it('migra una contraseña en texto plano eliminándola del usuario', async () => {
      const user: any = { id: 'u1', password: 'clave-legada' }
      expect(await upgradePasswordIfNeeded(user, 'clave-legada')).toBe(true)
      expect(user.passwordHash).toMatch(/^scrypt\$/)
      expect(user.password).toBeUndefined()
      expect(await verifyPassword('clave-legada', user.passwordHash)).toMatchObject({ ok: true })

      const other: any = { id: 'u2', password: 'clave-legada' }
      expect(await upgradePasswordIfNeeded(other, 'incorrecta')).toBe(false)
      expect(other.passwordHash).toBeUndefined()
    })

    it('no expone campos secretos al serializar el usuario', () => {
      const clean = sanitizeUserForClient({
        id: 'u1',
        username: 'demo',
        password: 'secreto',
        passwordHash: 'scrypt$hash',
      } as never) as any
      expect(clean).not.toHaveProperty('password')
      expect(clean).not.toHaveProperty('passwordHash')
      expect(clean.hasPassword).toBe(true)
      expect(clean.username).toBe('demo')
    })
  })
})
