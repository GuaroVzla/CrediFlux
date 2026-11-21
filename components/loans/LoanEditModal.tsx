'use client';

import type { FormEvent } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  Coins,
  Lock,
  RefreshCw,
  X,
} from 'lucide-react';

export interface LoanEditItem {
  productId?: string;
  quantity?: number | string;
  product?: { name?: string };
  subtotal?: number;
}

export interface LoanEditDraft {
  id?: string;
  clientId?: string;
  clientName?: string;
  productId?: string;
  type?: string;
  items?: LoanEditItem[];
  principal?: number | string;
  downPayment?: number | string;
  interestRate?: number | string;
  interestMode?: string;
  interestAmount?: number | string;
  installmentCount?: number | string;
  frequency?: string;
  startDate?: string;
}

export interface LoanEditTheme {
  modal: string;
  field: string;
  border: string;
}

export interface LoanEditModalProps {
  draft: LoanEditDraft;
  onPatch: (patch: Partial<LoanEditDraft>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  clientName: string;
  pricedItems: LoanEditItem[];
  base: number;
  down: number;
  rate: number;
  interestMode: 'percent' | 'fixed';
  interesMonto: number;
  paidCount: number;
  paidAmount: number;
  remainingAmount: number;
  installmentCountNum: number;
  remainingInstallments: number;
  perInstallment: number;
  totalAPagar: number;
  totalBelowPaid: boolean;
  saving: boolean;
  theme: LoanEditTheme;
}

const labelCls = 'block text-[11px] font-semibold leading-tight text-slate-300';
const summaryLabelCls = 'text-[11px] text-slate-400';
const summaryValueCls = 'font-semibold tabular-nums';

export default function LoanEditModal({
  draft,
  onPatch,
  onClose,
  onSubmit,
  clientName,
  pricedItems,
  base,
  down,
  rate,
  interestMode,
  interesMonto,
  paidCount,
  paidAmount,
  remainingAmount,
  installmentCountNum,
  remainingInstallments,
  perInstallment,
  totalAPagar,
  totalBelowPaid,
  saving,
  theme,
}: LoanEditModalProps) {
  const controlCls = `w-full min-w-0 rounded-lg border px-2.5 py-1.5 text-xs leading-5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${theme.field}`;
  const numberCls = `${controlCls} font-bold tabular-nums`;
  const readOnlyCls = `w-full min-w-0 truncate rounded-lg border px-2.5 py-1.5 text-xs font-semibold tabular-nums text-slate-300 ${theme.field} opacity-90`;

  const productsLabel = pricedItems.length
    ? pricedItems
        .map((item) => `${item.product?.name || item.productId || '—'} ×${item.quantity ?? 1}`)
        .join(', ')
    : draft.type === 'producto'
      ? '—'
      : 'Dinero / efectivo';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Editar condiciones de pago"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm"
    >
      <div
        className={`w-full max-w-3xl ${theme.modal} border rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto`}
      >
        <header className={`sticky top-0 z-10 flex items-start justify-between gap-3 border-b px-4 py-3 ${theme.border} ${theme.modal}`}>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-slate-200">Editar condiciones de pago</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Interés, cuotas, frecuencia e inicio. Abonos e histórico se conservan.
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
                Datos de referencia
              </h4>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400/90">
                <Lock className="h-3 w-3" /> Solo lectura
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="min-w-0">
                <span className={labelCls}>Cliente</span>
                <div className={`${readOnlyCls} mt-0.5`}>{clientName}</div>
              </div>
              <div className="min-w-0 sm:col-span-1">
                <span className={labelCls}>Productos / modalidad</span>
                <div className={`${readOnlyCls} mt-0.5`} title={productsLabel}>
                  {productsLabel}
                </div>
              </div>
              <div className="min-w-0">
                <span className={labelCls}>Base original</span>
                <div className={`${readOnlyCls} mt-0.5 text-right`}>${base.toFixed(2)}</div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            <section className={`min-w-0 rounded-xl border px-3 py-2.5 ${theme.border} bg-slate-800/40`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Condiciones editables
                </h4>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
                  4 campos
                </span>
              </div>

              <div className="space-y-2">
                <fieldset className={`min-w-0 rounded-lg border px-2.5 py-2 ${theme.border} bg-slate-900/30`}>
                  <legend className="flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    <Coins className="h-3 w-3 text-emerald-400" /> Interés
                  </legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[108px_minmax(0,1fr)]">
                    <div className="min-w-0">
                      <label className={labelCls} htmlFor="edit-interest-mode">
                        Modalidad
                      </label>
                      <select
                        id="edit-interest-mode"
                        value={interestMode}
                        onChange={(event) => onPatch({ interestMode: event.target.value })}
                        className={`${controlCls} mt-0.5`}
                      >
                        <option value="percent">Porcentaje</option>
                        <option value="fixed">Monto fijo</option>
                      </select>
                    </div>
                    <div className="min-w-0">
                      <label className={labelCls} htmlFor="edit-interest-value">
                        {interestMode === 'fixed' ? 'Monto fijo ($)' : 'Tasa (%)'}
                      </label>
                      <input
                        id="edit-interest-value"
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
                        className={`${numberCls} mt-0.5 text-emerald-400`}
                      />
                    </div>
                  </div>
                </fieldset>

                <fieldset className={`min-w-0 rounded-lg border px-2.5 py-2 ${theme.border} bg-slate-900/30`}>
                  <legend className="flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    <Calendar className="h-3 w-3 text-emerald-400" /> Calendario
                  </legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="min-w-0">
                      <label className={labelCls} htmlFor="edit-installment-count">
                        Cuotas
                      </label>
                      <input
                        id="edit-installment-count"
                        type="number"
                        min={Math.max(1, paidCount)}
                        max={360}
                        value={draft.installmentCount ?? 4}
                        onChange={(event) => onPatch({ installmentCount: event.target.value })}
                        className={`${numberCls} mt-0.5`}
                      />
                    </div>
                    <div className="min-w-0">
                      <label className={labelCls} htmlFor="edit-frequency">
                        Frecuencia
                      </label>
                      <select
                        id="edit-frequency"
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
                      <label className={labelCls} htmlFor="edit-start-date">
                        Inicio
                      </label>
                      <input
                        id="edit-start-date"
                        type="date"
                        value={draft.startDate || new Date().toISOString().slice(0, 10)}
                        onChange={(event) => onPatch({ startDate: event.target.value })}
                        className={`${controlCls} mt-0.5 tabular-nums`}
                      />
                    </div>
                  </div>
                </fieldset>

                {(paidCount > 0 || totalBelowPaid) && (
                  <div
                    className={`rounded-lg border px-2.5 py-2 text-[11px] ${
                      totalBelowPaid
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                        : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300/90'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {totalBelowPaid ? (
                        <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <CheckCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                      )}
                      <p className="leading-snug">
                        {totalBelowPaid
                          ? 'El nuevo total es menor a lo ya abonado. Ajusta el interés para continuar.'
                          : `${paidCount} cuota(s) pagadas ($${paidAmount.toFixed(2)}) y sus comprobantes se conservan. El saldo se distribuye entre ${remainingInstallments} cuota(s) pendiente(s).`}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="min-w-0 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
              <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">
                Resumen financiero
              </h4>
              <div className="space-y-1 text-[11px]">
                <div className="flex items-center justify-between gap-2 text-slate-300">
                  <span className={summaryLabelCls}>Base original</span>
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
                    <span className={summaryLabelCls}>Enganche original</span>
                    <span className={`${summaryValueCls} text-amber-400`}>− ${down.toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div
                className={`mt-2 space-y-1 border-t pt-2 ${
                  totalBelowPaid ? 'border-rose-500/40' : 'border-emerald-500/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400/80">
                    Nuevo total
                  </span>
                  <span className="text-base font-extrabold leading-none text-slate-200 tabular-nums">
                    ${totalAPagar.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md bg-emerald-500/10 px-2 py-1">
                  <span className="text-[11px] text-slate-300">
                    Abonado <span className="text-emerald-400">(inmutable)</span>
                  </span>
                  <span className="text-xs font-bold text-emerald-400 tabular-nums">
                    − ${paidAmount.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md bg-amber-500/10 px-2 py-1">
                  <span className="text-[11px] text-slate-300">Saldo pendiente</span>
                  <span className="text-sm font-extrabold text-amber-400 tabular-nums">
                    ${remainingAmount.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
                  <span className={summaryLabelCls}>Nuevo valor por cuota</span>
                  <span className={`${summaryValueCls} text-slate-200`}>
                    ${perInstallment.toFixed(2)} × {remainingInstallments}
                  </span>
                </div>
              </div>
            </section>
          </div>

          <footer className={`flex flex-col gap-2 border-t pt-2 sm:flex-row sm:items-center sm:justify-between ${theme.border}`}>
            <p className="text-[11px] text-slate-400">
              Se recalculan sólo las cuotas pendientes.
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
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
