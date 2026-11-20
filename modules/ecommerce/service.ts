// Fachada de dominio: re-exporta las capacidades usadas por /api/ecommerce-handler.
export {
  checkWritePermission,
  getRequestUser,
  canAccessRecord,
} from '@/shared/lib/db.js';
export { parseReceiptWithAI } from '@/server/services/ocr.js';
export { getStateForRequest, saveStateForRequest, persistenceInfo } from '@/server/persistence/supabase-store';
export { buildEcommerceBody, normalizeDashboardState } from '@/server/dashboard/builders';
export { saveUpload, resolveUploadUrl, resolveUploadUrls } from '@/server/services/uploads.js';
