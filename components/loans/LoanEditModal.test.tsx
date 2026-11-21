// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LoanEditModal from './LoanEditModal'

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    draft: {
      id: 'ln_1',
      clientId: 'cli_1',
      type: 'producto',
      interestRate: 15,
      interestMode: 'percent',
      installmentCount: 4,
      frequency: 'quincenal',
      startDate: '2026-11-20',
    },
    onPatch: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    clientName: 'Ana Pérez',
    pricedItems: [{ productId: 'p1', product: { name: 'Laptop' }, quantity: 1, subtotal: 500 }],
    base: 500,
    down: 0,
    rate: 15,
    interestMode: 'percent' as const,
    interesMonto: 75,
    paidCount: 1,
    paidAmount: 137.5,
    remainingAmount: 437.5,
    installmentCountNum: 4,
    remainingInstallments: 3,
    perInstallment: 145.83,
    totalAPagar: 575,
    totalBelowPaid: false,
    saving: false,
    theme: {
      modal: 'bg-slate-900',
      field: 'border-slate-700',
      border: 'border-slate-700/60',
    },
    ...overrides,
  }
}

describe('LoanEditModal', () => {
  it('muestra datos congelados, condiciones editables y resumen financiero', () => {
    render(<LoanEditModal {...makeProps()} />)

    expect(screen.getByRole('dialog', { name: 'Editar condiciones de pago' })).toBeInTheDocument()
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument()
    expect(screen.getByText('Laptop ×1')).toBeInTheDocument()
    expect(screen.getAllByText('$500.00')).toHaveLength(2)
    expect(screen.getByText('Datos de referencia')).toBeInTheDocument()
    expect(screen.getByText('Condiciones editables')).toBeInTheDocument()
    expect(screen.getByText('Resumen financiero')).toBeInTheDocument()
    expect(screen.getByText('$437.50')).toBeInTheDocument()
    expect(screen.getByText('$145.83 × 3')).toBeInTheDocument()
    expect(screen.getByText('Guardar cambios')).toBeInTheDocument()
  })

  it('notifica el cambio de tasa y de frecuencia sin tocar datos congelados', () => {
    const props = makeProps()
    render(<LoanEditModal {...props} />)

    fireEvent.change(screen.getByLabelText('Tasa (%)'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Frecuencia'), { target: { value: 'mensual' } })

    expect(props.onPatch).toHaveBeenCalledWith({ interestRate: 20 })
    expect(props.onPatch).toHaveBeenCalledWith({ frequency: 'mensual' })
    expect(props.onPatch).not.toHaveBeenCalledWith(expect.objectContaining({ clientId: expect.anything() }))
  })

  it('avisar que los abonos se conservan y advierte cuando el total baja de lo abonado', () => {
    const { unmount } = render(<LoanEditModal {...makeProps()} />)
    expect(screen.getByText(/1 cuota\(s\) pagadas \(\$137\.50\)/)).toBeInTheDocument()
    unmount()

    render(<LoanEditModal {...makeProps({ totalBelowPaid: true })} />)
    expect(screen.getByText(/El nuevo total es menor a lo ya abonado/)).toBeInTheDocument()
  })

  it('cierra con Cancelar y envía el formulario con Guardar cambios', () => {
    const props = makeProps()
    render(<LoanEditModal {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)

    const form = screen.getByRole('button', { name: 'Guardar cambios' }).closest('form') as HTMLFormElement
    fireEvent.submit(form)
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('deshabilita las acciones mientras guarda', () => {
    render(<LoanEditModal {...makeProps({ saving: true })} />)

    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Guardando/ })).toBeDisabled()
  })
})
