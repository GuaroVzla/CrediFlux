// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useDebouncedValue from './useDebouncedValue'

describe('useDebouncedValue', () => {
  afterEach(() => vi.useRealTimers())

  it('retrasela actualización hasta cumplir el delay', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebouncedValue(value, delay),
      { initialProps: { value: 'ana', delay: 250 } },
    )

    expect(result.current).toBe('ana')
    rerender({ value: 'luis', delay: 250 })
    expect(result.current).toBe('ana')

    act(() => vi.advanceTimersByTime(249))
    expect(result.current).toBe('ana')

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe('luis')
  })

  it('cancela el valor pendiente si cambia antes del delay', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'a' } },
    )

    rerender({ value: 'b' })
    act(() => vi.advanceTimersByTime(100))
    rerender({ value: 'c' })
    act(() => vi.advanceTimersByTime(100))

    expect(result.current).toBe('a')

    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe('c')
  })
})
