// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import usePaginationController from './usePaginationController'

const items = Array.from({ length: 25 }, (_, index) => ({ id: index + 1 }))

describe('usePaginationController', () => {
  it('calcula página, desplazamiento y rango visible', () => {
    const { result } = renderHook(() => usePaginationController(10))

    const first = result.current.slice(items)
    expect(first).toMatchObject({ page: 1, totalPages: 3, total: 25, from: 1, to: 10 })
    expect(first.items.map((item: any) => item.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    act(() => result.current.setPage(3))
    const last = result.current.slice(items)
    expect(last).toMatchObject({ page: 3, totalPages: 3, total: 25, from: 21, to: 25 })
    expect(last.items).toHaveLength(5)
  })

  it('reclampa la página cuando la lista se acorta', () => {
    const { result } = renderHook(() => usePaginationController(10))

    act(() => result.current.setPage(3))
    let shrunk: any
    act(() => {
      shrunk = result.current.slice(items.slice(0, 12))
    })

    expect(shrunk).toMatchObject({ page: 2, totalPages: 2, total: 12, from: 11, to: 12 })
    expect(shrunk.items.map((item: any) => item.id)).toEqual([11, 12])
  })

  it('vuelve a la primera página cuando cambia resetKey o pageSize', () => {
    const { result, rerender } = renderHook(
      ({ resetKey, pageSize }: { resetKey: string; pageSize: number }) =>
        usePaginationController(pageSize, resetKey),
      { initialProps: { resetKey: 'clientes', pageSize: 10 } },
    )

    act(() => result.current.setPage(3))
    expect(result.current.page).toBe(3)

    rerender({ resetKey: 'productos', pageSize: 10 })
    expect(result.current.page).toBe(1)

    act(() => result.current.setPage(2))
    rerender({ resetKey: 'productos', pageSize: 5 })
    expect(result.current.page).toBe(1)
  })

  it('devuelve un rango vacío cuando no hay registros', () => {
    const { result } = renderHook(() => usePaginationController(10))
    expect(result.current.slice([])).toMatchObject({ page: 1, totalPages: 1, total: 0, from: 0, to: 0 })
  })
})
