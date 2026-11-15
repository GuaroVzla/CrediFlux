import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { checkWritePermission, getRequestUser, scopeRecords, canAccessRecord } from '../../../lib/db.js';
import { parseReceiptWithAI } from '../../../lib/ocrEngine.js';
import { getAppState, saveAppState, persistenceInfo } from '../../../lib/server/persistence.js';

export async function GET(request: Request) {
  try {
    const db = await getAppState();
    const currentUser = getRequestUser(request, db);

    // Obtener capital mensual asignado del usuario correspondiente al mes en curso (YYYY-MM)
    const currentMonthKey = new Date().toISOString().slice(0, 7);
    const assignedCapital = currentUser?.monthlyCapitals?.[currentMonthKey]?.capital ?? 5000;

    // Query params for period filtering
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period'); // 'day' | 'month' | 'year'
    const dateParam = searchParams.get('date'); // YYYY-MM-DD | YYYY-MM | YYYY

    const scopedTransactions = scopeRecords(db.ecommerce || [], currentUser);
    const allTransactions = scopedTransactions.slice().reverse(); // chronological order (oldest first)

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
    const db = await getAppState();
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }

    const formData = await request.formData();

    // Type: 'venta_usdt' | 'compra_usdt' (from UI) -> stored as 'venta' | 'compra'
    const rawType = formData.get('type') || 'venta';
    const type = rawType === 'compra_usdt' ? 'compra' : rawType === 'venta_usdt' ? 'venta' : rawType;

    // BCV rate sent from frontend state (dolarRates.oficial)
    const bcvRate = Number(formData.get('bcvRate')) || 0;

    const manualRef = formData.get('reference');
    const manualDate = formData.get('date');
    const file = formData.get('receiptFile');

    let receiptUrl = '/uploads/sample-voucher.png';
    let ocrResult = null;

    // Patrones de comprobantes registrados por el Admin para validación cruzada
    const registeredPatterns = db.receiptPatterns || [];

    // If a file was uploaded, run OCR with pattern cross-validation
    if (file && typeof file === 'object' && file.size > 0) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const extension = path.extname(file.name) || '.png';
      const cleanFileName = `voucher_${Date.now()}_${Math.random().toString(36).substring(7)}${extension}`;
      const filePath = path.join(uploadsDir, cleanFileName);

      fs.writeFileSync(filePath, buffer);
      receiptUrl = `/uploads/${cleanFileName}`;

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
        ocrSpaceApiKey: ocrApiKeys.ocrspace || process.env.OCR_SPACE_API_KEY || null
      });
    }

    // Extract fields from OCR
    const ocrData = ocrResult?.data || {};

    // Monto en Bs exacto adaptado a bancos VE (2 decimales)
    const amountBs = Number(Number(ocrData.monto || 0).toFixed(2));

    // REGLA DE INTEGRIDAD FINANCIERA: nunca persistir una transacción con monto
    // ilegible o inválido (0, negativo o absurdo). Se informa al operador.
    if (!ocrResult?.success || amountBs <= 0) {
      return NextResponse.json({
        success: false,
        error: ocrResult?.error ||
          'No se pudo identificar el monto del comprobante. Sube una foto más nítida, configura el lector OCR en Ajustes o regístralo manualmente.'
      }, { status: 422 });
    }


    // Monto en USD: estrictamente 2 decimales
    const amountUSD = bcvRate > 0 ? Number((amountBs / bcvRate).toFixed(2)) : 0;

    const bankOrigin = ocrData.bancoOrigen || 'Desconocido';
    const bankDestination = ocrData.bancoDestino || 'Desconocido';
    const finalRef = manualRef || ocrData.referencia || ('REF-' + Date.now().toString().slice(-6));
    const finalDate = manualDate || ocrData.fecha || new Date().toISOString().split('T')[0];

    const currentUser = perm.user || getRequestUser(request, db);
    const ownerId = currentUser?.id || 'usr_admin';
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
      rawOcr: ocrResult ? ocrResult.data : null,
      ocrProvider: ocrResult ? ocrResult.provider : 'Manual',
      createdAt: new Date().toISOString()
    };

    if (!db.ecommerce) db.ecommerce = [];
    db.ecommerce.push(newTransaction); // push to end for chronological order
    const saved = await saveAppState(db);
    if (!saved) {
      return NextResponse.json({
        success: false,
        error: 'La transacción fue procesada pero no se pudo guardar en la base de datos. Verifica la configuración de persistencia (DATABASE_URL) y reintenta.'
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Transacción y comprobante procesados exitosamente',
      transaction: newTransaction,
      ocr: ocrResult,
      persistence: persistenceInfo(),
    });
  } catch (error) {
    console.error('Ecommerce POST error:', error);
    return NextResponse.json({ success: false, error: 'Error al procesar comprobante' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const db = await getAppState();
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const user = perm.user || getRequestUser(request, db);

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

    const saved = await saveAppState(db);
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
