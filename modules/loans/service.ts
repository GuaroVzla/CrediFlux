// Fachada de dominio: re-exporta las capacidades usadas por /api/loans.
export {
  computeLoanStatus,
  normalizeDni,
  checkWritePermission,
  getRequestUser,
  canAccessRecord,
} from '@/shared/lib/db.js';
export { getStateForRequest, saveStateForRequest } from '@/server/persistence/supabase-store';
export { buildLoansBody, normalizeDashboardState } from '@/server/dashboard/builders';
