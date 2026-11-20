import { NextResponse } from 'next/server';
import { getRequestUser, scopeRecords } from '../../../lib/db.js';
import { getStateForRequest } from '../../../lib/server/supabase-store';
import { resolveUploadUrls } from '../../../lib/storage/uploads.js';
import {
  buildCapitalBody,
  buildClientsBody,
  buildEcommerceBody,
  buildLoansBody,
  buildPaymentsBody,
  buildProductsBody,
  buildSettingsBody,
  getReceiptPatternImageUrls,
  normalizeDashboardState,
  prepareSettings
} from '../../../lib/server/dashboard-builders';

//Los datos son específicos de la sesión: nunca cachear ni prerenderizar.
export const dynamic = 'force-dynamic';

/**
 * Bootstrap del dashboard en una sola lectura del estado.
 *
 * Devuelve los mismos 7 shapes de siempre, pero como sub-objetos
 * (`clients`, `products`, `loans`, `payments`, `ecommerce`, `settings`,
 * `capitalMovements`) para que no colisionen claves como `success` o
 * `persistence`. Los endpoints individuales siguen disponibles y ahora
 * comparten exactamente estos builders.
 */
export async function GET(request: Request) {
  try {
    const db = await getStateForRequest(request);
    normalizeDashboardState(db);

    const user = getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    // Autocorrección que antes ocurría dentro de GET /api/settings.
    await prepareSettings(db, request);

    // Un único lote de firmado de URLs para comprobantes de ecommerce y
    // patrones de OCR. resolveUploadUrls ya agrupa por bucket.
    const chronological = scopeRecords(db.ecommerce || [], user).slice().reverse();
    const ecomUrls = chronological.map((t: any) => t.receiptUrl);
    const patternUrls = getReceiptPatternImageUrls(db);
    const resolvedAll = ecomUrls.length + patternUrls.length
      ? await resolveUploadUrls([...ecomUrls, ...patternUrls])
      : [];
    const resolvedEcomUrls = resolvedAll.slice(0, ecomUrls.length);
    const resolvedPatternUrls = resolvedAll.slice(ecomUrls.length);

    const { searchParams } = new URL(request.url);

    return NextResponse.json({
      success: true,
      clients: buildClientsBody(db, user),
      products: buildProductsBody(db, user),
      loans: buildLoansBody(db, user),
      payments: buildPaymentsBody(db, user),
      ecommerce: buildEcommerceBody(db, user, resolvedEcomUrls, searchParams),
      settings: buildSettingsBody(db, resolvedPatternUrls),
      capitalMovements: buildCapitalBody(db, user),
    });
  } catch (error) {
    console.error('Dashboard GET error:', error);
    return NextResponse.json({ success: false, error: 'Error al obtener el dashboard' }, { status: 500 });
  }
}
