import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const pagePath = fileURLToPath(new URL('./page.jsx', import.meta.url))
const paginationHookPath = fileURLToPath(new URL('../hooks/usePaginationController.js', import.meta.url))
let source = ''
let paginationSource = ''

describe('M-009: page.jsx — invariantes de paginación y sesión', () => {
  beforeAll(() => {
    source = fs.readFileSync(pagePath, 'utf8')
    paginationSource = fs.readFileSync(paginationHookPath, 'utf8')
  })

  it('numera las filas usando el desplazamiento real de la paginación de financiamientos', () => {
    expect(source).toContain('loanPaging.from + index')
    expect(source).toContain('loanPaging.items.map')
    expect(source).toContain('loanPagingController = usePaginationController')
  })

  it('define y limpia la cookie de inicio de sesión', () => {
    expect(source).toContain("const SESSION_START_COOKIE = 'cf_session_start'")
    expect(source).toContain('${SESSION_START_COOKIE}=; path=/; max-age=0')
  })

  it('ajusta el estado de la página cuando el rango válido cambia', () => {
    expect(paginationSource).toContain('const safePage = Math.min(Math.max(1, page), totalPages);')
    expect(paginationSource).toContain('if (safePage !== page) setPage(safePage);')
    expect(paginationSource).toContain('const offset = (safePage - 1) * pageSize;')
  })

  it('no deja enlaces inactivos con href="#"', () => {
    expect(source).not.toContain('href="#"')
    expect(source).not.toMatch(/href=\{["']#["']\}/)
  })

  it('expone la edición restringida a condiciones de pago con resumen contable', () => {
    expect(source).toContain('aria-label="Editar financiamiento"')
    expect(source).toContain('bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/30')
    expect(source).toContain("isEdit ? 'Editar Condiciones de Pago' : 'Nuevo Financiamiento o Préstamo'")
    expect(source).toContain("method: isEdit ? 'PATCH' : 'POST'")
    expect(source).toContain('const payload = isEdit ? condiciones : {')
    expect(source).toContain('Datos congelados')
    expect(source).toContain('Monto Base Original')
    expect(source).toContain('Total Abonado / Pagado')
    expect(source).toContain('Saldo Pendiente Real')
    expect(source).toContain('Nuevo Valor por Cuota')
    expect(source).toContain('fetchAllData();')
    expect(source).not.toContain('manualInstallmentAmount')
  })
})
