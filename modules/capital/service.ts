// Fachada de dominio: re-exporta las capacidades usadas por /api/capital-movements.
export {
  checkWritePermission,
  getRequestUser,
  canAccessRecord,
  scopeRecords,
} from '@/shared/lib/db.js';
export { getStateForRequest, saveStateForRequest } from '@/server/persistence/supabase-store';
export { buildCapitalBody, normalizeDashboardState, summarize } from '@/server/dashboard/builders';
