'use client';

/** Controles visuales reutilizables: Previous / Next + "Mostrando X-Y de Z". */
function PaginationControls({ paging, label = 'registros', themeDark = true }) {
  if (!paging || paging.total === 0) return null;
  const btnBase = 'px-3 py-2 min-h-[44px] min-w-[44px] rounded-lg text-xs sm:min-h-0 sm:min-w-0 sm:px-2.5 sm:py-1.5 sm:text-[11px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const btnTheme = themeDark
    ? 'border-slate-700 bg-slate-800/70 text-slate-300 hover:bg-slate-700'
    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100';
  const nav = (dir) => paging.setPage(prev => Math.min(Math.max(1, prev + dir), paging.totalPages));
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t ${themeDark ? 'border-slate-800' : 'border-slate-200'}`}>
      <span className={`text-xs sm:text-[11px] ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>
        Mostrando {paging.from}-{paging.to} de {paging.total} {label}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={paging.page <= 1} onClick={() => nav(-1)} className={`${btnBase} ${btnTheme}`}>Anterior</button>
        <span className={`text-xs sm:text-[11px] tabular-nums ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>{paging.page} / {paging.totalPages}</span>
        <button type="button" disabled={paging.page >= paging.totalPages} onClick={() => nav(1)} className={`${btnBase} ${btnTheme}`}>Siguiente</button>
      </div>
    </div>
  );
}

export default PaginationControls;
