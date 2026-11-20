'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Control de paginación client-side. Los datos siguen viniendo completos del
 * servidor (no cambia ningún contrato); sólo se corta el array que se renderiza.
 * `slice(array)` se usa dentro de los callbacks condicionales de cada pestaña,
 * manteniendo los hooks siempre en el nivel superior del componente.
 */
function usePaginationController(pageSize = 10, resetKey = '') {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [resetKey, pageSize]);

  const slice = useCallback((array) => {
    const list = Array.isArray(array) ? array : [];
    const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    // Tras borrar registros la lista puede encogerse sin que `resetKey` cambie.
    // Ajustar el estado durante el render evita que "Anterior" opere sobre una
    // página interna obsoleta (React re-renderiza inmediatamente este componente).
    if (safePage !== page) setPage(safePage);
    const offset = (safePage - 1) * pageSize;
    return {
      items: list.slice(offset, offset + pageSize),
      page: safePage,
      setPage,
      totalPages,
      total: list.length,
      from: list.length === 0 ? 0 : offset + 1,
      to: Math.min(offset + pageSize, list.length),
    };
  }, [page, pageSize]);

  return { page, setPage, slice };
}

export default usePaginationController;
