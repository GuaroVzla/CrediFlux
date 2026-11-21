'use client';

import type { FormEvent } from 'react';
import { Calendar, Coins, Plus, RefreshCw, X } from 'lucide-react';
import type { LoanEditDraft, LoanEditItem, LoanEditTheme } from './LoanEditModal';

export interface LoanCreateDraft extends LoanEditDraft {
  notes?: string;
  interestRateUnlocked?: boolean;
}

export interface LoanCreateClient {
  id: string;
  name: string;
  dni?: string;
}

export interface LoanCreateProduct {
  id: string;
  name: string;
  stock?: number | string;
}

export interface LoanCreateModalProps {
  draft: LoanCreateDraft;
  onPatch: (patch: Partial<LoanCreateDraft>) => void;
  onItemsChange: (items: Array<{ productId?: string; quantity?: number | string }>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  clients: LoanCreateClient[];
  availableProducts: LoanCreateProduct[];
  pricedItems: LoanEditItem[];
  base: number;
  down: number;
  rate: number;
  interestMode: 'percent' | 'fixed';
  interesMonto: number;
  totalAPagar: number;
  remainingAmount: number;
  installmentCountNum: number;
  remainingInstallments: number;
  perInstallment: number;
  saving: boolean;
  theme: LoanEditTheme;
}

const labelCls = 'block text-[11px] font-semibold leading-tight text-slate-300';
const summaryLabelCls = 'text-[11px] text-slate-400';
const summaryValueCls = 'font-semibold tabular-nums';

export default function LoanCreateModal({
  draft,
  onPatch,
  onItemsChange,
  onClose,
  onSubmit,
  clients,
  availableProducts,
  pricedItems,
  base,
  down,
  rate,
  interestMode,
  interesMonto,
  totalAPagar,
  remainingAmount,
  installmentCountNum,
  remainingInstallments,
  perInstallment,
  saving,
  theme,
}: LoanCreateModalProps) {
  const controlCls = `w-full min-w-0 rounded-lg border px-2.5 py-1.5 text-xs leading-5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${theme.field}`;
  const numberCls = `${controlCls} font-bold tabular-nums`;
  const isProduct = (draft.type || 'producto') === 'producto';
  const rateLocked = isProduct && pricedItems.length > 0 && !draft.interestRateUnlocked && interestMode === 'percent';

  const updateItem = (index: number, patch: Partial<{ productId: string; quantity: number | string }>) => {
    onItemsChange(pricedItems.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Nuevo financiamiento"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm"
    >
      <div
        className={`w-full max-w-3xl ${theme.modal} border rounded-2xl shadow-2xl max-h-[92dvh] overflow-y-auto`}
      >
        <header className={`sticky top-0 z-10 flex items-start justify-between gap-3 border-b px-4 py-3 ${theme.border} ${theme.modal}`}>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-slate-200">Nuevo financiamiento</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Captura compacta con cálculos automáticos y resumen financiero.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
            title="Cerrar"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={onSubmit} className="space-y-2.5 px-4 py-3">
          <section className={`rounded-xl border px-3 py-2.5 ${theme.border} bg-slate-800/40`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Datos principales
              </h4>
              <span className="text-[10px] text-slate-400">Cliente y modalidad</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <label className={labelCls} htmlFor="create-client">
                  Cliente *
                </label>
                <select
                  id="create-client"
                  value={draft.clientId || ''}
                  onChange={(event) => onPatch({ clientId: event.target.value })}
                  required
                  className={`${controlCls} mt-0.5`}
                >
                  <option value="">-- Elige un cliente --</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name} ({client.dni})
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label className={labelCls} htmlFor="create-type">
                  Modalidad
                </label>
                <select
                  id="create-type"
                  value={draft.type || 'producto'}
                  onChange={(event) =>
                    onPatch({
                      type: event.target.value,
                      productId: '',
                      items: [],
                      interestRateUnlocked: false,
                    })
                  }
                  className={`${controlCls} mt-0.5`}
                >
                  <option value="producto">Equipo / producto</option>
                  <option value="dinero">Dinero / efectivo</option>
                </select>
              </div>
            </div>

            {isProduct && (
              <div className={`mt-2 rounded-lg border px-2.5 py-2 ${theme.border} bg-slate-900/30`}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Productos financiados ({pricedItems.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => onItemsChange([...pricedItems, { productId: '', quantity: 1 }])}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 px-2 py-1 text-[10px] font-bold text-emerald-400 hover:bg-emerald-500/10"
                  >
                    <Plus className="h-3 w-3" /> Agregar
                  </button>
                </div>
                {pricedItems.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    Agrega al menos un producto del catálogo para calcular el monto base.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {pricedItems.map((item, index) => (
                      <div key={`${item.productId || 'nuevo'}-${index}`} className="flex flex-wrap items-center gap-1.5">
                        <select
                          value={item.productId || ''}
                          onChange={(event) => updateItem(index, { productId: event.target.value })}
                          className={`${controlCls} min-w-[140px] flex-1`}
                          aria-label={`Producto ${index + 1}`}
                        >
                          <option value="">-- Producto --</option>
                          {availableProducts.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name} — stock {Number(product.stock) || 0}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="1"
                          max="999"
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(index, { quantity: Math.max(1, parseInt(event.target.value, 10) || 1) })
                          }
                          className={`${numberCls} w-16`}
                          title="Cantidad"
                          aria-label={`Cantidad del producto ${index + 1}`}
                        />
                        <span className="w-20 shrink-0 text-right text-[11px] font-semibold text-slate-300 tabular-nums">
                          ${(item.subtotal || 0).toFixed(2)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onItemsChange(pricedItems.filter((_, i) => i !== index))}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-rose-400 hover:bg-rose-500/10"
                          title="Quitar producto"
                          aria-label="Quitar producto"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className={`rounded-xl border px-3 py-2.5 ${theme.border} bg-slate-800/40`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Cálculos y montos
              </h4>
              <span className="text-[10px] text-slate-400">Base, inicial y notas</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="min-w-0">
                <label className={labelCls} htmlFor="create-principal">
                  Monto base ($) *
                </label>
                <input
                  id="create-principal"
                  type="number"
                  step="any"
                  min="0"
                  value={draft.principal === '' ? '' : draft.principal}
                  onChange={(event) =>
                    onPatch({ principal: event.target.value === '' ? '' : Number(event.target.value) })
                  }
                  required
                  className={`${numberCls} mt-0.5`}
                  placeholder="700"
                />
              </div>
              <div className="min-w-0">
                <label className={labelCls} htmlFor="create-down-payment">
                  Inicial / enganche ($)
                </label>
                <input
                  id="create-down-payment"
                  type="number"
                  step="any"
                  min="0"
                  value={draft.downPayment ?? 0}
                  onChange={(event) =>
                    onPatch({ downPayment: event.target.value === '' ? 0 : Number(event.target.value) })
                  }
                  className={`${numberCls} mt-0.5`}
                />
              </div>
              <div className="min-w-0">
                <label className={labelCls} htmlFor="create-notes">
                  Notas / condiciones
                </label>
                <input
                  id="create-notes"
                  type="text"
                  value={draft.notes || ''}
                  onChange={(event) => onPatch({ notes: event.target.value })}
                  className={`${controlCls} mt-0.5`}
                />
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            <section className={`min-w-0 rounded-xl border px-3 py-2.5 ${theme.border} bg-slate-800/40`}>
              <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Condiciones de pago
              </h4>

              <div className="space-y-2">
                <fieldset className={`min-w-0 rounded-lg border px-2.5 py-2 ${theme.border} bg-slate-900/30`}>
                  <legend className="flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    <Coins className="h-3 w-3 text-emerald-400" /> Interés
                  </legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[108px_minmax(0,1fr)]">
                    <div className="min-w-0">
                      <label className={labelCls} htmlFor="create-interest-mode">
                        Modalidad
                      </label>
                      <select
                        id="create-interest-mode"
                        value={interestMode}
                        onChange={(event) => onPatch({ interestMode: event.target.value })}
                        className={`${controlCls} mt-0.5`}
                      >
                        <option value="percent">Porcentaje</option>
                        <option value="fixed">Monto fijo</option>
                      </select>
                    </div>
                    <div className="min-w-0">
                      <label className={labelCls} htmlFor="create-interest-value">
                        {interestMode === 'fixed' ? 'Monto fijo ($)' : 'Tasa (%)'}
                      </label>
                      <input
                        id="create-interest-value"
                        type="number"
                        step="any"
                        min="0"
                        value={interestMode === 'fixed' ? draft.interestAmount ?? 0 : draft.interestRate ?? ''}
                        onChange={(event) =>
                          onPatch(
                            interestMode === 'fixed'
                              ? { interestAmount: event.target.value === '' ? 0 : Number(event.target.value) }
                              : { interestRate: event.target.value === '' ? '' : Number(event.target.value) },
                          )
                        }
                        disabled={rateLocked}
                        className={`${numberCls} mt-0.5 text-emerald-400`}
                      />
                    </div>
                  </div>
                  {isProduct && pricedItems.length > 0 && interestMode === 'percent' && (
                    <label
                      className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-slate-300"
                      title="Editar porcentaje excepcionalmente"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(draft.interestRateUnlocked)}
                        onChange={(event) => onPatch({ interestRateUnlocked: event.target.checked })}
                        className="h-3.5 w-3.5 accent-emerald-500"
                      />
                      Permitir editar la tasa sugerida
                    </label>
                  )}
                </fieldset>

                <fieldset className={`min-w-0 rounded-lg border px-2.5 py-2 ${theme.border} bg-slate-900/30`}>
                  <legend className="flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    <Calendar className="h-3 w-3 text-emerald-400" /> Calendario
                  </legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="min-w-0">
                      <label className={labelCls} htmlFor="create-installment-count">
                        Cuotas
                      </label>
                      <input
                        id="create-installment-count"
                        type="number"
                        min="1"
                        max="360"
                        value={draft.installmentCount ?? 4}
                        onChange={(event) => onPatch({ installmentCount: event.target.value })}
                        className={`${numberCls} mt-0.5`}
                      />
                    </div>
                    <div className="min-w-0">
                      <label className={labelCls} htmlFor="create-frequency">
                        Frecuencia
                      </label>
                      <select
                        id="create-frequency"
                        value={draft.frequency || 'quincenal'}
                        onChange={(event) => onPatch({ frequency: event.target.value })}
                        className={`${controlCls} mt-0.5`}
                      >
                        <option value="semanal">Semanal</option>
                        <option value="quincenal">Quincenal</option>
                        <option value="mensual">Mensual</option>
                      </select>
                    </div>
                    <div className="min-w-0">
                      <label className={labelCls} htmlFor="create-start-date">
                        Inicio
                      </label>
                      <input
                        id="create-start-date"
                        type="date"
                        value={draft.startDate || new Date().toISOString().slice(0, 10)}
                        onChange={(event) => onPatch({ startDate: event.target.value })}
                        className={`${controlCls} mt-0.5 tabular-nums`}
                      />
                    </div>
                  </div>
                </fieldset>
              </div>
            </section>

            <section className="min-w-0 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
              <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">
                Resumen financiero
              </h4>
              <div className="space-y-1 text-[11px]">
                <div className="flex items-center justify-between gap-2 text-slate-300">
                  <span className={summaryLabelCls}>Monto base</span>
                  <span className={summaryValueCls}>${base.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-slate-300">
                  <span className={summaryLabelCls}>
                    Intereses {interestMode === 'fixed' ? '(fijo)' : `(${rate || 0}%)`}
                  </span>
                  <span className={`${summaryValueCls} text-teal-400`}>${interesMonto.toFixed(2)}</span>
                </div>
                {down > 0 && (
                  <div className="flex items-center justify-between gap-2 text-slate-300">
                    <span className={summaryLabelCls}>Enganche</span>
                    <span className={`${summaryValueCls} text-amber-400`}>− ${down.toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div className="mt-2 space-y-1 border-t border-emerald-500/20 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400/80">
                    Total del financiamiento
                  </span>
                  <span className="text-base font-extrabold leading-none text-slate-200 tabular-nums">
                    ${totalAPagar.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md bg-amber-500/10 px-2 py-1">
                  <span className="text-[11px] text-slate-300">Monto a financiar</span>
                  <span className="text-sm font-extrabold text-amber-400 tabular-nums">
                    ${remainingAmount.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
                  <span className={summaryLabelCls}>Valor estimado por cuota</span>
                  <span className={`${summaryValueCls} text-slate-200`}>
                    ${perInstallment.toFixed(2)} × {remainingInstallments}
                  </span>
                </div>
                <p className="pt-0.5 text-[10px] text-slate-500 tabular-nums">
                  {installmentCountNum} cuota(s) pactadas
                </p>
              </div>
            </section>
          </div>

          <footer className={`flex flex-col gap-2 border-t pt-2 sm:flex-row sm:items-center sm:justify-between ${theme.border}`}>
            <p className="text-[11px] text-slate-400">
              Obligatorios: cliente, monto base y producto si aplica.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="rounded-lg bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-300 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {saving ? 'Guardando…' : 'Generar Contrato'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
