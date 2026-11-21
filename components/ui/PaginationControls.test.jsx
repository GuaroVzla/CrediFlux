// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PaginationControls from './PaginationControls'

describe('PaginationControls UI Component', () => {
  const defaultPaging = {
    page: 2,
    totalPages: 5,
    from: 11,
    to: 20,
    total: 50,
    setPage: vi.fn(),
  }

  it('no renderiza nada cuando total es 0 o paging no está definido', () => {
    const { container: c1 } = render(<PaginationControls paging={null} />)
    expect(c1).toBeEmptyDOMElement()

    const { container: c2 } = render(<PaginationControls paging={{ ...defaultPaging, total: 0 }} />)
    expect(c2).toBeEmptyDOMElement()
  })

  it('renderiza rango y botones de navegación correctamente', () => {
    render(<PaginationControls paging={defaultPaging} label="clientes" themeDark={true} />)

    expect(screen.getByText(/Mostrando 11-20 de 50 clientes/i)).toBeInTheDocument()
    expect(screen.getByText('2 / 5')).toBeInTheDocument()

    const prevBtn = screen.getByRole('button', { name: /Anterior/i })
    const nextBtn = screen.getByRole('button', { name: /Siguiente/i })

    expect(prevBtn).toBeEnabled()
    expect(nextBtn).toBeEnabled()
  })

  it('deshabilita el botón Anterior en la primera página', () => {
    const pagingFirst = { ...defaultPaging, page: 1, from: 1, to: 10 }
    render(<PaginationControls paging={pagingFirst} themeDark={false} />)

    const prevBtn = screen.getByRole('button', { name: /Anterior/i })
    const nextBtn = screen.getByRole('button', { name: /Siguiente/i })

    expect(prevBtn).toBeDisabled()
    expect(nextBtn).toBeEnabled()
  })

  it('deshabilita el botón Siguiente en la última página', () => {
    const pagingLast = { ...defaultPaging, page: 5, from: 41, to: 50 }
    render(<PaginationControls paging={pagingLast} themeDark={true} />)

    const prevBtn = screen.getByRole('button', { name: /Anterior/i })
    const nextBtn = screen.getByRole('button', { name: /Siguiente/i })

    expect(prevBtn).toBeEnabled()
    expect(nextBtn).toBeDisabled()
  })

  it('llama a setPage al interactuar con Anterior y Siguiente', () => {
    const setPageMock = vi.fn()
    const paging = { ...defaultPaging, setPage: setPageMock }

    render(<PaginationControls paging={paging} themeDark={false} />)

    const prevBtn = screen.getByRole('button', { name: /Anterior/i })
    const nextBtn = screen.getByRole('button', { name: /Siguiente/i })

    fireEvent.click(prevBtn)
    expect(setPageMock).toHaveBeenCalledTimes(1)

    fireEvent.click(nextBtn)
    expect(setPageMock).toHaveBeenCalledTimes(2)
  })

  it('aplica clases de contraste según el modo claro / oscuro', () => {
    const { rerender } = render(<PaginationControls paging={defaultPaging} themeDark={true} />)
    let prevBtn = screen.getByRole('button', { name: /Anterior/i })
    expect(prevBtn.className).toContain('border-slate-700')
    expect(prevBtn.className).toContain('text-slate-300')

    rerender(<PaginationControls paging={defaultPaging} themeDark={false} />)
    prevBtn = screen.getByRole('button', { name: /Anterior/i })
    expect(prevBtn.className).toContain('border-slate-300')
    expect(prevBtn.className).toContain('text-slate-700')
  })
})
