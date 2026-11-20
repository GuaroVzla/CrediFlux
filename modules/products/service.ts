// Fachada de dominio: re-exporta las capacidades usadas por /api/products-api.
export {
  checkWritePermission,
  getRequestUser,
  canAccessRecord,
} from '@/shared/lib/db.js';
export { getStateForRequest, saveStateForRequest } from '@/server/persistence/supabase-store';
export { buildProductsBody, normalizeDashboardState } from '@/server/dashboard/builders';
export { getProductMargin, getAutoSalePrice } from '@/modules/products/pricing.js';
