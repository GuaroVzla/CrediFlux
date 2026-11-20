import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const pagePath = fileURLToPath(new URL('./page.jsx', import.meta.url))
let source = ''

describe('M-009: page.jsx — invariantes de paginación y sesión', () => {
  beforeAll(() => {
    source = fs.readFileSync(pagePath, 'utf8')
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
    expect(source).toContain('const safePage = Math.min(Math.max(1, page), totalPages);')
    expect(source).toContain('if (safePage !== page) setPage(safePage);')
    expect(source).toContain('const offset = (safePage - 1) * pageSize;')
  })

  it('no deja enlaces inactivos con href="#"', () => {
    expect(source).not.toContain('href="#"')
    expect(source).not.toMatch(/href=\{["']#["']\}/)
  })
})
