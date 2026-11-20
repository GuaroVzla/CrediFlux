// Fachada de dominio: re-exporta las capacidades usadas por /api/payments.
export {
  computeLoanStatus,
  checkWritePermission,
  getRequestUser,
  canAccessRecord,
} from '@/shared/lib/db.js';
export { getStateForRequest, saveStateForRequest } from '@/server/persistence/supabase-store';
export { buildPaymentsBody, normalizeDashboardState } from '@/server/dashboard/builders';
