// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LoanCreateModal from './LoanCreateModal'

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    draft: {
      clientId: 'cli_1',
      type: 'producto',
      principal: 500,
      downPayment: 0,
      interestRate: 15,
      interestMode: 'percent',
      installmentCount: 4,
      frequency: 'quincenal',
      startDate: '2026-11-20',
      notes: '',
      interestRateUnlocked: false,
    },
    onPatch: vi.fn(),
    onItemsChange: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    clients: [
      { id: 'cli_1', name: 'Ana', dni: 'V-1' },
      { id: 'cli_2', name: 'Luis', dni: 'V-2' },
    ],
    availableProducts: [
      { id: 'p1', name: 'Laptop', stock: 5 },
      { id: 'p2', name: 'Tablet', stock: 3 },
    ],
    pricedItems: [{ productId: 'p1', quantity: 1, subtotal: 500, product: { name: 'Laptop' } }],
    base: 500,
    down: 0,
    rate: 15,
    interestMode: 'percent' as const,
    interesMonto: 75,
    totalAPagar: 575,
    remainingAmount: 575,
    installmentCountNum: 4,
    remainingInstallments: 4,
    perInstallment: 143.75,
    saving: false,
    theme: {
      modal: 'bg-slate-900',
      field: 'border-slate-700',
      border: 'border-slate-700/60',
    },
    ...overrides,
  }
}

describe('LoanCreateModal', () => {
  it('muestra el layout compacto con cálculos y resumen', () => {
    render(<LoanCreateModal {...makeProps()} />)

    expect(screen.getByRole('dialog', { name: 'Nuevo financiamiento' })).toBeInTheDocument()
    expect(screen.getByText('Datos principales')).toBeInTheDocument()
    expect(screen.getByText('Cálculos y montos')).toBeInTheDocument()
    expect(screen.getByText('Condiciones de pago')).toBeInTheDocument()
    expect(screen.getByText('Resumen financiero')).toBeInTheDocument()
    expect(screen.getAllByText('$575.00')).toHaveLength(2)
    expect(screen.getByText('$143.75 × 4')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Luis \(V-2\)/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generar Contrato' })).toBeInTheDocument()
  })

  it('notifica cambios de cliente y de modalidad', () => {
    const props = makeProps()
    const { container } = render(<LoanCreateModal {...props} />)

    fireEvent.change(screen.getByLabelText('Cliente *'), { target: { value: 'cli_2' } })
    expect(props.onPatch).toHaveBeenCalledWith({ clientId: 'cli_2' })

    const typeSelect = container.querySelector('#create-type') as HTMLSelectElement
    fireEvent.change(typeSelect, { target: { value: 'dinero' } })
    expect(props.onPatch).toHaveBeenCalledWith({
      type: 'dinero',
      productId: '',
      items: [],
      interestRateUnlocked: false,
    })
  })

  it('agrega y edita productos del catálogo', () => {
    const props = makeProps()
    render(<LoanCreateModal {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(props.onItemsChange).toHaveBeenCalledWith([
      expect.objectContaining({ productId: 'p1', quantity: 1 }),
      { productId: '', quantity: 1 },
    ])

    fireEvent.change(screen.getByLabelText('Producto 1'), { target: { value: 'p2' } })
    expect(props.onItemsChange).toHaveBeenCalledWith([
      expect.objectContaining({ productId: 'p2', quantity: 1 }),
    ])
  })

  it('bloquea la tasa sugerida hasta desbloquearla explícitamente', () => {
    const props = makeProps()
    const { container, unmount } = render(<LoanCreateModal {...props} />)

    expect((container.querySelector('#create-interest-value') as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('Permitir editar la tasa sugerida'))
    expect(props.onPatch).toHaveBeenCalledWith({ interestRateUnlocked: true })
    unmount()

    const unlocked = render(<LoanCreateModal {...makeProps({
      draft: {
        ...makeProps().draft,
        interestRateUnlocked: true,
      },
    })} />)
    expect((unlocked.container.querySelector('#create-interest-value') as HTMLInputElement).disabled).toBe(false)
  })

  it('cierra, envía y deshabilita acciones durante el guardado', () => {
    const props = makeProps()
    const { unmount } = render(<LoanCreateModal {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)

    const form = screen.getByRole('button', { name: 'Generar Contrato' }).closest('form') as HTMLFormElement
    fireEvent.submit(form)
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
    unmount()

    render(<LoanCreateModal {...makeProps({ saving: true })} />)
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Guardando/ })).toBeDisabled()
  })
})
