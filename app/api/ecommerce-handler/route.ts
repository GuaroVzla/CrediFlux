import { NextResponse } from 'next/server';
import path from 'path';
import { checkWritePermission, getRequestUser, scopeRecords, canAccessRecord } from '../../../lib/db.js';
import { parseReceiptWithAI } from '../../../lib/ocrEngine.js';
import { getStateForRequest, saveStateForRequest, persistenceInfo } from '../../../lib/server/supabase-store';
import { saveUpload, resolveUploadUrl, resolveUploadUrls } from '../../../lib/storage/uploads.js';

// El OCR local (Tesseract.js) y las llamadas a proveedores externos pueden tardar;
// 300 s es el máximo de Hobby. Límite de payload de Vercel: 4.5 MB.
export const maxDuration = 300;
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024; // 4 MB (margen bajo el límite de Vercel)

export async function GET(request: Request) {
  try {
    const db = await getStateForRequest(request);
    const currentUser = getRequestUser(request, db);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    // Obtener capital mensual asignado del usuario correspondiente al mes en curso (YYYY-MM).
    // No se inventa un capital por defecto: si el usuario no tiene un valor configurado,
    // el capital asignado es 0. Evita reportar $5.000 que no existen en ningún lado.
    const currentMonthKey = new Date().toISOString().slice(0, 7);
    const configuredCapital = currentUser?.monthlyCapitals?.[currentMonthKey]?.capital;
    const assignedCapital = Number.isFinite(Number(configuredCapital))
      ? Math.max(0, Number(configuredCapital))
      : 0;

    // Query params for period filtering
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period'); // 'day' | 'month' | 'year'
    const dateParam = searchParams.get('date'); // YYYY-MM-DD | YYYY-MM | YYYY

    const scopedTransactions = scopeRecords(db.ecommerce || [], currentUser);
    const chronological = scopedTransactions.slice().reverse(); // oldest first
    // El bucket `receipts` es privado: convertimos las referencias `supabase://`
    // guardadas en BD en URLs firmadas vigentes para que el navegador las abra.
    const resolvedReceiptUrls = await resolveUploadUrls(chronological.map((t) => t.receiptUrl));
    const allTransactions = chronological.map((t, index) => ({
      ...t,
      receiptUrl: resolvedReceiptUrls[index] || t.receiptUrl
    }));

    // Filter transactions by period
    let transactions = allTransactions;
    if (period && dateParam) {
      transactions = allTransactions.filter(t => {
        const txDate = t.date || (t.createdAt ? t.createdAt.slice(0, 10) : '');
        if (period === 'day') return txDate === dateParam;
        if (period === 'month') return txDate.startsWith(dateParam); // YYYY-MM
        if (period === 'year') return txDate.startsWith(dateParam);  // YYYY
        return true;
      });
    }

    // Bs totals (con 2 decimales exactos)
    const totalPurchasesBs = transactions
      .filter(t => t.type === 'compra')
      .reduce((sum, t) => sum + (Number(t.amountBs) || Number(t.amount) || 0), 0);

    const totalSalesBs = transactions
      .filter(t => t.type === 'venta')
      .reduce((sum, t) => sum + (Number(t.amountBs) || Number(t.amount) || 0), 0);

    const netProfitBs = Number((totalSalesBs - totalPurchasesBs - assignedCapital).toFixed(2));

    // USD totals (estrictamente 2 decimales)
    const totalPurchasesUSD = transactions
      .filter(t => t.type === 'compra')
      .reduce((sum, t) => sum + (Number(t.amountUSD) || 0), 0);

    const totalSalesUSD = transactions
      .filter(t => t.type === 'venta')
      .reduce((sum, t) => sum + (Number(t.amountUSD) || 0), 0);

    const grossNetUSD = totalSalesUSD - totalPurchasesUSD; // margen bruto (base para ROI y margen)
    const netProfitUSD = Number((totalSalesUSD - totalPurchasesUSD - assignedCapital).toFixed(2));

    // Legacy USD totals
    const totalPurchases = Number(totalPurchasesUSD.toFixed(2)) || transactions
      .filter(t => t.type === 'compra')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalSales = Number(totalSalesUSD.toFixed(2)) || transactions
      .filter(t => t.type === 'venta')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const netProfit = Number((totalSales - totalPurchases - assignedCapital).toFixed(2));
    const profitMargin = totalPurchases > 0 ? Number(((grossNetUSD / totalPurchases) * 100).toFixed(1)) : 0;
    const capitalRoi = assignedCapital > 0 ? Number(((grossNetUSD / assignedCapital) * 100).toFixed(1)) : 0;
    const remainingCapital = Number((assignedCapital - totalPurchases + totalSales).toFixed(2));

    return NextResponse.json({
      success: true,
      summary: {
        assignedCapital: Number(assignedCapital.toFixed(2)),
        currentMonthKey,
        // Bs
        totalPurchasesBs: Number(totalPurchasesBs.toFixed(2)),
        totalSalesBs: Number(totalSalesBs.toFixed(2)),
        netProfitBs,
        // USD (con 2 decimales)
        totalPurchasesUSD: Number(totalPurchasesUSD.toFixed(2)),
        totalSalesUSD: Number(totalSalesUSD.toFixed(2)),
        netProfitUSD,
        // Legacy / capital
        totalPurchases: Number(totalPurchases.toFixed(2)),
        totalSales: Number(totalSales.toFixed(2)),
        netProfit,
        profitMargin,
        capitalRoi,
        remainingCapital,
        totalTransactions: allTransactions.length
      },
      transactions: allTransactions, // always return all in chronological order
      persistence: persistenceInfo(),
    });
  } catch (error) {
    console.error('Ecommerce GET error:', error);
    return NextResponse.json({ success: false, error: 'Error al obtener transacciones' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const db = await getStateForRequest(request);
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const currentUser = perm.user || getRequestUser(request, db);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    const formData = await request.formData();

    // Type: 'venta_usdt' | 'compra_usdt' (from UI) -> stored as 'venta' | 'compra'
    const rawType = formData.get('type') || 'venta';
    const type = rawType === 'compra_usdt' ? 'compra' : rawType === 'venta_usdt' ? 'venta' : rawType;

    // BCV rate sent from frontend state (dolarRates.oficial)
    const bcvRate = Number(formData.get('bcvRate')) || 0;

    const manualRef = formData.get('reference');
    const manualDate = formData.get('date');
    const isManual = String(formData.get('manual') || '') === 'true';
    const manualBankOrigin = String(formData.get('bankOrigin') || '').trim();
    const manualReference = String(formData.get('reference') || '').trim();
    const file = formData.get('receiptFile');

    let receiptUrl: string | null = null;
    let ocrResult = null;

    // Patrones activos registrados por el Admin para validación cruzada.
    const registeredPatterns = (db.receiptPatterns || []).filter((p: any) => p && p.isActive !== false);

    // If a file was uploaded, run OCR with pattern cross-validation
    if (file && typeof file === 'object' && file.size > 0) {
      // Validar tamaño antes de leer el buffer: Vercel corta bodies > 4.5 MB.
      if (file.size > MAX_RECEIPT_BYTES) {
        return NextResponse.json({
          success: false,
          error: `El comprobante pesa ${(file.size / (1024 * 1024)).toFixed(1)} MB y supera el máximo de 4 MB. Comprime o reduce la imagen e inténtalo de nuevo.`,
          code: 'PAYLOAD_TOO_LARGE'
        }, { status: 413 });
      }

      if (file.type && !String(file.type).startsWith('image/')) {
        return NextResponse.json({
          success: false,
          error: 'El archivo debe ser una imagen (PNG, JPG o JPEG) del comprobante.',
          code: 'INVALID_FILE_TYPE'
        }, { status: 415 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      // Persistencia best-effort: Vercel Blob si está configurado; en Vercel sin Blob
      // el FS es de solo lectura, así que un fallo de guardado NO debe romper el OCR.
      try {
        const extension = path.extname(file.name || '') || '.png';
        const cleanFileName = `voucher_${Date.now()}_${Math.random().toString(36).substring(7)}${extension}`;
        const uploaded = await (saveUpload as any)(buffer, {
          filename: cleanFileName,
          folder: 'uploads',
          contentType: file.type || undefined,
          userId: currentUser.id,
        });
        receiptUrl = uploaded.url;
      } catch (uploadError: any) {
        console.warn('No se pudo almacenar el comprobante (se continúa solo con OCR):', uploadError?.message || uploadError);
      }

      // Regla de Asignación Automática de IA con validación cruzada de patrones
      // Autenticación dinámica: cada proveedor usa su propia clave/configuración guardada
      const activeProvider = db.settings.aiProvider || 'openai';
      const ocrApiKeys = {
        openai: db.settings?.ocrApiKeys?.openai || db.settings?.aiApiKey || '',
        gemini: db.settings?.ocrApiKeys?.gemini || db.settings?.aiApiKey || '',
        ocrspace: db.settings?.ocrApiKeys?.ocrspace || db.settings?.ocrSpaceApiKey || '',
      };
      ocrResult = await parseReceiptWithAI({
        imageBuffer: buffer,
        mimeType: file.type || 'image/png',
        apiKey: (activeProvider === 'openai' || activeProvider === 'gemini')
          ? (ocrApiKeys[activeProvider] || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)
          : undefined,
        provider: activeProvider,
        registeredPatterns,
        ocrSpaceApiKey: ocrApiKeys.ocrspace || process.env.OCR_SPACE_API_KEY || null,
        endpoint: db.settings?.ocrEndpoints?.[activeProvider] || db.settings?.providerConfig?.endpoints?.[activeProvider] || undefined,
        model: db.settings?.ocrModels?.[activeProvider] || db.settings?.providerConfig?.models?.[activeProvider] || undefined,
        confidenceThreshold: db.settings?.ocrConfidenceMin ?? db.settings?.ocrThresholds?.ocrConfidenceMin ?? 0.8
      });
    }

    // Extract fields from OCR (en registro manual no hay comprobante ni OCR)
    const ocrData = ocrResult?.data || {};

    // Monto en Bs exacto adaptado a bancos VE (2 decimales)
    const amountBs = isManual
      ? Number(Number(formData.get('amountBs') || 0).toFixed(2))
      : Number(Number(ocrData.monto || 0).toFixed(2));

    if (isManual) {
      // El registro manual captura todos los datos en el modal; se validan aquí
      // antes de persistir para no crear transacciones incompletas.
      if (!manualBankOrigin || !manualReference) {
        return NextResponse.json({
          success: false,
          error: 'El banco emisor y la referencia son obligatorios en el registro manual.',
          code: 'MISSING_MANUAL_FIELDS'
        }, { status: 400 });
      }
      if (!Number.isFinite(amountBs) || amountBs <= 0) {
        return NextResponse.json({
          success: false,
          error: 'El monto en Bs debe ser un número mayor a cero.',
          code: 'INVALID_AMOUNT'
        }, { status: 400 });
      }
      if (!(bcvRate > 0)) {
        return NextResponse.json({
          success: false,
          error: 'No hay una tasa BCV disponible para calcular el monto en USD. Inténtalo de nuevo en unos instantes.',
          code: 'MISSING_BCV_RATE'
        }, { status: 400 });
      }
    } else if (!ocrResult?.success || amountBs <= 0) {
      // REGLA DE INTEGRIDAD FINANCIERA: nunca persistir una transacción con monto
      // ilegible o inválido (0, negativo o absurdo). Se informa al operador.
      return NextResponse.json({
        success: false,
        error: ocrResult?.error ||
          'No se pudo identificar el monto del comprobante. Sube una foto más nítida, configura el lector OCR en Ajustes o regístralo manualmente.',
        code: 'OCR_EXTRACTION_FAILED',
        ocr: ocrResult // incluye provider, data y rawOcrText cuando existan
      }, { status: 422 });
    }

    // Monto en USD: estrictamente 2 decimales (misma lógica para OCR y registro manual)
    const amountUSD = bcvRate > 0 ? Number((amountBs / bcvRate).toFixed(2)) : 0;

    const bankOrigin = isManual
      ? (manualBankOrigin || 'Desconocido')
      : (ocrData.bancoOrigen || 'Desconocido');
    const bankDestination = isManual ? 'Desconocido' : (ocrData.bancoDestino || 'Desconocido');
    const finalRef = manualRef || ocrData.referencia || ('REF-' + Date.now().toString().slice(-6));
    const finalDate = manualDate || ocrData.fecha || new Date().toISOString().split('T')[0];

    const ownerId = currentUser.id;
    const newTransaction = {
      id: 'ecom_' + Date.now(),
      userId: ownerId,
      type,                      // 'venta' | 'compra'
      date: finalDate,
      bankOrigin,                // banco emisor validado
      bankDestination,           // banco receptor
      reference: finalRef,
      amountBs,                  // exacto con 2 decimales
      amountUSD,                 // solo 2 decimales en $
      bcvRate,
      receiptUrl,
      manual: isManual,
      rawOcr: ocrResult ? ocrResult.data : null,
      ocrProvider: ocrResult ? ocrResult.provider : 'Manual',
      createdAt: new Date().toISOString()
    };

    if (!db.ecommerce) db.ecommerce = [];
    db.ecommerce.push(newTransaction); // push to end for chronological order
    const saved = await saveStateForRequest(request, db);
    if (!saved) {
      return NextResponse.json({
        success: false,
        error: 'La transacción fue procesada pero no se pudo guardar en la base de datos. Verifica la configuración de persistencia (DATABASE_URL) y reintenta.'
      }, { status: 500 });
    }

    // En BD se guarda la referencia `supabase://`; al cliente se le devuelve
    // una URL firmada que puede abrir directamente.
    const responseTransaction = {
      ...newTransaction,
      receiptUrl: await resolveUploadUrl(newTransaction.receiptUrl)
    };

    return NextResponse.json({
      success: true,
      message: 'Transacción y comprobante procesados exitosamente',
      transaction: responseTransaction,
      ocr: ocrResult,
      persistence: persistenceInfo(),
    });
  } catch (error) {
    console.error('Ecommerce POST error:', error);
    return NextResponse.json({ success: false, error: 'Error al procesar comprobante' }, { status: 500 });
  }
}

// Edición exclusiva de registros creados manualmente (sin comprobante OCR).
// Recalcula amountUSD con la tasa BCV vigente; los totales se derivan en GET.
export async function PATCH(request: Request) {
  try {
    const db = await getStateForRequest(request);
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const user = perm.user || getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    const payload = await request.json().catch(() => null);
    const id = String(payload?.id || '');
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID requerido' }, { status: 400 });
    }

    const existing = (db.ecommerce || []).find((t: any) => t.id === id);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Transacción no encontrada' }, { status: 404 });
    }
    if (!canAccessRecord(user, existing)) {
      return NextResponse.json({ success: false, error: 'No autorizado para editar esta transacción' }, { status: 403 });
    }
    // Los registros provenientes de OCR no se editan desde este flujo.
    if (existing.manual !== true && existing.ocrProvider !== 'Manual') {
      return NextResponse.json({
        success: false,
        error: 'Solo los registros manuales pueden ser editados.',
        code: 'NOT_MANUAL_RECORD'
      }, { status: 403 });
    }

    const typeRaw = String(payload.type || existing.type || '').toLowerCase();
    const type = typeRaw === 'venta' || typeRaw === 'venta_usdt'
      ? 'venta'
      : typeRaw === 'compra' || typeRaw === 'compra_usdt'
        ? 'compra'
        : '';
    if (type !== 'venta' && type !== 'compra') {
      return NextResponse.json({ success: false, error: 'Tipo de operación inválido.', code: 'INVALID_TYPE' }, { status: 400 });
    }

    const bankOrigin = String(payload.bankOrigin || '').trim();
    const reference = String(payload.reference || '').trim();
    const date = String(payload.date || '').trim() || new Date().toISOString().split('T')[0];
    if (!bankOrigin || !reference) {
      return NextResponse.json({
        success: false,
        error: 'El banco emisor y la referencia son obligatorios.',
        code: 'MISSING_MANUAL_FIELDS'
      }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ success: false, error: 'La fecha debe tener formato YYYY-MM-DD.', code: 'INVALID_DATE' }, { status: 400 });
    }

    const amountBs = Number(Number(payload.amountBs || 0).toFixed(2));
    if (!Number.isFinite(amountBs) || amountBs <= 0) {
      return NextResponse.json({ success: false, error: 'El monto en Bs debe ser un número mayor a cero.', code: 'INVALID_AMOUNT' }, { status: 400 });
    }

    const bcvRate = Number(payload.bcvRate) || Number(existing.bcvRate) || 0;
    if (!(bcvRate > 0)) {
      return NextResponse.json({
        success: false,
        error: 'No hay una tasa BCV disponible para recalcular el monto en USD.',
        code: 'MISSING_BCV_RATE'
      }, { status: 400 });
    }
    const amountUSD = Number((amountBs / bcvRate).toFixed(2));

    Object.assign(existing, {
      type,
      date,
      bankOrigin,
      reference,
      amountBs,
      amountUSD,
      bcvRate,
      manual: true,
      updatedAt: new Date().toISOString()
    });

    const saved = await saveStateForRequest(request, db);
    if (!saved) {
      return NextResponse.json({
        success: false,
        error: 'No se pudo guardar el cambio en la base de datos. Verifica la configuración de persistencia (DATABASE_URL).'
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Registro manual actualizado exitosamente',
      transaction: {
        ...existing,
        receiptUrl: await resolveUploadUrl(existing.receiptUrl)
      },
      persistence: persistenceInfo()
    });
  } catch (error) {
    console.error('Ecommerce PATCH error:', error);
    return NextResponse.json({ success: false, error: 'Error al editar transacción' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const db = await getStateForRequest(request);
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const user = perm.user || getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ID requerido' }, { status: 400 });

    const existing = (db.ecommerce || []).find((t: any) => t.id === id);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Transacción no encontrada' }, { status: 404 });
    }
    if (!canAccessRecord(user, existing)) {
      return NextResponse.json({ success: false, error: 'No autorizado para eliminar esta transacción' }, { status: 403 });
    }

    db.ecommerce = (db.ecommerce || []).filter((t: any) => t.id !== id);

    const saved = await saveStateForRequest(request, db);
    if (!saved) {
      return NextResponse.json({
        success: false,
        error: 'No se pudo guardar el cambio en la base de datos. Verifica la configuración de persistencia (DATABASE_URL).'
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Transacción eliminada exitosamente', persistence: persistenceInfo() });
  } catch (error) {
    console.error('Ecommerce DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Error al eliminar transacción' }, { status: 500 });
  }
}
