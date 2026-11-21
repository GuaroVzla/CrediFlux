import 'server-only';

import { getSupabaseAdminClientOrNull } from '@/server/supabase/admin';
import { isSupabaseConfigured } from '@/server/supabase/env';

// -----------------------------------------------------------------------------
// Patrones de comprobantes GLOBALES para el motor OCR.
//
// Los patrones los crea el Admin en Ajustes, pero RLS de `receipt_patterns` es
// estrictamente `user_id = auth.uid()`. Eso es correcto para el CRUD (un usuario
// final no debe ver, editar ni borrar los patrones del admin), pero deja el
// escáner del usuario final sin patrones porque `/api/ecommerce-handler` leía
// `db.receiptPatterns` del estado scoped.
//
// Este DAL es la única fuente de patrones para OCR: usa service_role, filtra por
// perfiles con rol admin y devuelve un DTO mínimo que nunca viaja al navegador.
// -----------------------------------------------------------------------------

type AnyRecord = Record<string, any>;

export type GlobalOcrPatternDto = {
  id: string;
  bankName: string;
  keywords: string[];
  referenceFormat: string;
  referenceRegex: string;
  extra: AnyRecord;
  analysisRules?: AnyRecord;
  visualSignature?: unknown;
  isActive: boolean;
  version: number;
};

export type GlobalOcrPatternsResult = {
  patterns: GlobalOcrPatternDto[];
  source: 'global-admin' | 'session-fallback' | 'unavailable';
  adminProfiles: number;
  reason?: string;
};

const PATTERN_COLUMNS = 'id, bank_name, keywords, reference_format, reference_regex, extra, is_active, version';

function objectOrEmpty(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function normalizePattern(row: AnyRecord | null | undefined): GlobalOcrPatternDto | null {
  if (!row || typeof row !== 'object') return null;

  const bankName = String(row.bankName ?? row.bank_name ?? '').trim();
  if (!bankName) return null;

  const isActive = row.isActive !== false && row.is_active !== false;
  if (!isActive) return null;

  const keywords = Array.isArray(row.keywords)
    ? row.keywords.map((keyword: unknown) => String(keyword)).filter(Boolean)
    : [];

  const dto: GlobalOcrPatternDto = {
    id: String(row.id ?? ''),
    bankName,
    keywords,
    referenceFormat: String(row.referenceFormat ?? row.reference_format ?? ''),
    referenceRegex: String(row.referenceRegex ?? row.reference_regex ?? ''),
    extra: objectOrEmpty(row.extra),
    isActive: true,
    version: Number(row.version) || 1,
  };

  // El matchingOCR consume estos campos cuando vienen en un estado legado.
  const analysisRules = objectOrEmpty(row.analysisRules);
  if (Object.keys(analysisRules).length > 0) dto.analysisRules = analysisRules;
  if (row.visualSignature !== undefined) dto.visualSignature = row.visualSignature;

  return dto;
}

function normalizeSessionPatterns(sessionPatterns: unknown): GlobalOcrPatternDto[] {
  if (!Array.isArray(sessionPatterns)) return [];
  return sessionPatterns
    .map((row) => normalizePattern(row as AnyRecord))
    .filter((row): row is GlobalOcrPatternDto => Boolean(row));
}

/**
 * Devuelve los patrones activos creados por administradores activos.
 *
 * `sessionPatterns` sólo se usa en el modo legado (sin Supabase), donde no
 * existe service_role y el estado local es la única fuente disponible.
 */
export async function resolveGlobalOcrPatterns(sessionPatterns: unknown = []): Promise<GlobalOcrPatternsResult> {
  if (!isSupabaseConfigured()) {
    return {
      patterns: normalizeSessionPatterns(sessionPatterns),
      source: 'session-fallback',
      adminProfiles: 0,
    };
  }

  const admin = getSupabaseAdminClientOrNull();
  if (!admin) {
    const reason = 'No hay cliente service_role; no se pueden leer los patrones OCR globales.';
    console.error('[global-ocr-patterns]', reason);
    return { patterns: [], source: 'unavailable', adminProfiles: 0, reason };
  }

  try {
    const { data: adminRows, error: adminError } = await (admin as any)
      .from('profiles')
      .select('id')
      .eq('role', 'admin')
      .eq('is_active', true);

    if (adminError) throw new Error(adminError.message);

    const adminIds = (adminRows || [])
      .map((row: AnyRecord) => String(row?.id ?? ''))
      .filter(Boolean);

    if (adminIds.length === 0) {
      console.warn('[global-ocr-patterns] No hay perfiles admin activos; el OCR no cargará patrones globales.');
      return { patterns: [], source: 'global-admin', adminProfiles: 0 };
    }

    const { data: patternRows, error: patternError } = await (admin as any)
      .from('receipt_patterns')
      .select(PATTERN_COLUMNS)
      .in('user_id', adminIds)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (patternError) throw new Error(patternError.message);

    const patterns = (patternRows || [])
      .map((row: AnyRecord) => normalizePattern(row))
      .filter((row: GlobalOcrPatternDto | null): row is GlobalOcrPatternDto => Boolean(row));

    return { patterns, source: 'global-admin', adminProfiles: adminIds.length };
  } catch (error: any) {
    const reason = error?.message || String(error);
    // Fail closed: ante un error de lectura no se usan patrones del estado del
    // usuario (podrían ser incompletos) y se deja constancia en el servidor.
    console.error('[global-ocr-patterns] Error al cargar patrones globales:', reason);
    return { patterns: [], source: 'unavailable', adminProfiles: 0, reason };
  }
}
