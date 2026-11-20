import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AI_ROUTING_RULES,
  DEFAULT_OCR_ENDPOINTS,
  DEFAULT_OCR_MODELS,
  DEFAULT_OCR_THRESHOLDS,
  INTERNAL_OCR_CONFIG,
  createTestReceiptPngBuffer,
  extractVenezuelanAmount,
  getInternalOcrConfig,
  matchBankWithPatterns,
  parseVenezuelanNumber,
  structurePlainOcrText,
} from '@/server/services/ocr.js'

describe('M-004: ocrEngine.js — funciones puras y configuración', () => {
  describe('parseVenezuelanNumber', () => {
    it('interpreta la coma como decimal y el punto como millar', () => {
      expect(parseVenezuelanNumber('500,00')).toBe(500)
      expect(parseVenezuelanNumber('1.234,50')).toBe(1234.5)
      expect(parseVenezuelanNumber('1.234')).toBe(1234)
      expect(parseVenezuelanNumber('Bs. 1.850,75')).toBe(1850.75)
    })

    it('redondea números y descarta entradas inválidas o fuera de rango', () => {
      expect(parseVenezuelanNumber(12.345)).toBe(12.35)
      expect(parseVenezuelanNumber('abc')).toBe(0)
      expect(parseVenezuelanNumber('')).toBe(0)
      expect(parseVenezuelanNumber(-5)).toBe(0)
      expect(parseVenezuelanNumber(1_000_000_000)).toBe(0)
    })
  })

  describe('extractVenezuelanAmount', () => {
    it('extrae el monto de etiquetas comunes', () => {
      expect(extractVenezuelanAmount('Monto: 500,00')).toBe(500)
      expect(extractVenezuelanAmount('Total: 1.000')).toBe(1000)
      expect(extractVenezuelanAmount('Bs. 1.234,50')).toBe(1234.5)
    })

    it('ignora teléfonos, cédulas y comisiones', () => {
      expect(extractVenezuelanAmount('Pago móvil 0414-123-4567 Monto: 250,00')).toBe(250)
      expect(extractVenezuelanAmount('Cédula V-18.452.910\nMonto: 300,00')).toBe(300)
      expect(extractVenezuelanAmount('Comisión: Bs. 5,00\nMonto: 500,00')).toBe(500)
    })
  })

  describe('matchBankWithPatterns', () => {
    const patterns = [
      { bankName: 'Banesco', keywords: ['banesco', 'banco universal'], isActive: true },
      { bankName: 'Mercantil', keywords: ['mercantil'], isActive: true },
    ]

    it('devuelve el banco detectado cuando no hay patrones activos', () => {
      expect(matchBankWithPatterns('texto', 'Bancaribe', [])).toBe('Bancaribe')
      expect(matchBankWithPatterns('texto', '', [])).toBe('Desconocido')
    })

    it('normaliza el nombre del banco usando palabras clave activas', () => {
      expect(matchBankWithPatterns('Pago desde BANESCO universal', 'Otro banco', patterns)).toBe('Banesco')
      expect(matchBankWithPatterns('Recibo tpago Mercantil', 'Desconocido', patterns)).toBe('Mercantil')
    })

    it('ignora patrones inactivos', () => {
      const inactive = [{ bankName: 'Banesco', keywords: ['banesco'], isActive: false }]
      expect(matchBankWithPatterns('Banesco', 'Otro banco', inactive)).toBe('Otro banco')
    })
  })

  describe('structurePlainOcrText', () => {
    it('estructura monto, fecha, referencia y banco del texto OCR', () => {
      const text = [
        'Comprobante de pago',
        'Banco: Banesco',
        'Monto: Bs. 1.234,50',
        'Fecha: 15/03/2026',
        'Referencia: 123456789',
      ].join('\n')

      const result = structurePlainOcrText(text, [])
      expect(result.monto).toBe(1234.5)
      expect(result.fecha).toBe('2026-03-15')
      expect(result.referencia).toBe('123456789')
      expect(result.bancoOrigen).toBe('Banesco')
      expect(result.bancoDestino).toBe('Desconocido')
      expect(result.confianza).toBe('85%')
      expect(result.textoIdentificado).toContain('Banco: Banesco')
    })

    it('usa la referencia personalizada de un patrón activo coincidente', () => {
      const text = 'Banco: Banesco\nMonto: 100,00\nSecuencia: 987654321'
      const patterns = [{
        bankName: 'Banesco',
        referenceRegex: 'Secuencia:\\s*(\\d+)',
        isActive: true,
      }]
      expect(structurePlainOcrText(text, patterns).referencia).toBe('987654321')
    })
  })

  describe('configuración exportada', () => {
    it('expone los endpoints y modelos por proveedor', () => {
      expect(DEFAULT_OCR_ENDPOINTS.openai).toBe('https://api.openai.com/v1/chat/completions')
      expect(DEFAULT_OCR_ENDPOINTS.ocrspace).toBe('https://api.ocr.space/parse/image')
      expect(DEFAULT_OCR_ENDPOINTS.tesseract).toBe('local')
      expect(DEFAULT_OCR_MODELS.openai).toBe('gpt-4o-mini')
      expect(DEFAULT_OCR_MODELS.tesseract).toBe('spa+eng')
    })

    it('expone umbrales y reglas de enrutado concretos', () => {
      expect(DEFAULT_OCR_THRESHOLDS.ocrConfidenceMin).toBe(0.8)
      expect(DEFAULT_OCR_THRESHOLDS.requireReferenceMatch).toBe(true)
      expect(DEFAULT_OCR_THRESHOLDS.maxAmount).toBe(999999999.99)
      expect(DEFAULT_AI_ROUTING_RULES).toEqual({
        receipt: 'ocrspace',
        document: 'openai',
        fallback: 'tesseract',
      })
    })

    it('marca Tesseract como proveedor interno sin clave de usuario', () => {
      expect(INTERNAL_OCR_CONFIG.tesseract.requiresUserKey).toBe(false)
      expect(INTERNAL_OCR_CONFIG.tesseract.internalLicense).toBe(true)
      expect(getInternalOcrConfig('tesseract')).toBe(INTERNAL_OCR_CONFIG.tesseract)
      expect(getInternalOcrConfig('inexistente')).toBeNull()
    })
  })

  describe('createTestReceiptPngBuffer', () => {
    it('genera un PNG válido de 320x120 sin invocar Tesseract', () => {
      const buffer = createTestReceiptPngBuffer()
      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect([...buffer.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect(buffer.readUInt32BE(16)).toBe(320)
      expect(buffer.readUInt32BE(20)).toBe(120)
    })
  })
})
