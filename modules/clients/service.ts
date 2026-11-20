// Fachada de dominio: re-exporta las capacidades usadas por /api/clients.
// Los cálculos siguen viviendo en sus módulos canónicos.
export {
  computeLoanStatus,
  normalizeDni,
  checkWritePermission,
  getRequestUser,
  canAccessRecord,
} from '@/shared/lib/db.js';
export { getStateForRequest, saveStateForRequest } from '@/server/persistence/supabase-store';
export { buildClientsBody, normalizeDashboardState } from '@/server/dashboard/builders';
