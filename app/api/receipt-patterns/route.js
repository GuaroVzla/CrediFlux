import { NextResponse } from 'next/server';
import { getStateForRequest, saveStateForRequest, persistenceInfo } from '../../../lib/server/supabase-store';
import { syncAdminStateToNormalized, logAudit, ensureAdminConfigSeed, hasDatabase } from '../../../lib/server/admin-config.js';
import { saveUpload, deleteUpload } from '../../../lib/storage/uploads.js';
import { checkWritePermission, getRequestUser } from '../../../lib/db.js';

function findUser(db, request) {
  return getRequestUser(request, db);
}

export async function GET(request) {
  try {
    const db = await getStateForRequest(request);
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const currentUser = getRequestUser(request, db) || findUser(db, request);
    if (currentUser?.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Acceso restringido: Solo el administrador puede gestionar patrones' }, { status: 403 });
    }
    const patterns = Array.isArray(db.receiptPatterns) ? db.receiptPatterns : [];
    return NextResponse.json({
      success: true,
      patterns,
      persistence: persistenceInfo(),
    });
  } catch (error) {
    console.error('Receipt patterns GET error:', error);
    return NextResponse.json({ success: false, error: 'Error al obtener patrones de comprobantes' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = await getStateForRequest(request);

    // Permisos (compatibilidad con lógica existente)
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const currentUser = getRequestUser(request, db) || findUser(db, request);
    if (currentUser?.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Acceso restringido: Solo el administrador puede gestionar patrones' }, { status: 403 });
    }

    const formData = await request.formData();
    const bankName = String(formData.get('bankName') || '').trim();
    const referenceFormat = String(formData.get('referenceFormat') || '').trim();
    const keywordsRaw = String(formData.get('keywords') || '');
    const notes = String(formData.get('notes') || '').trim();
    const file = formData.get('patternImage');

    if (!bankName) {
      return NextResponse.json({ success: false, error: 'El nombre del banco emisor es obligatorio' }, { status: 400 });
    }

    let imageUrl = '/uploads/sample-voucher.png';
    let imageKey = null;
    let imageMime = null;

    if (file && typeof file === 'object' && typeof file.arrayBuffer === 'function' && file.size > 0) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = (file.name && file.name.includes('.')) ? `.${file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '')}` : '.png';
      const safeBank = bankName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'bank';
      const filename = `pattern_${Date.now()}_${safeBank}${ext || '.png'}`;
      const uploaded = await saveUpload(buffer, { filename, folder: 'uploads/patterns', contentType: file.type || undefined });
      imageUrl = uploaded.url;
      imageKey = uploaded.key || null;
      imageMime = file.type || null;
    }

    const keywords = keywordsRaw
      ? keywordsRaw.split(',').map(k => k.trim()).filter(Boolean)
      : [bankName.toLowerCase()];
    if (!keywords.some(k => k.toLowerCase() === bankName.toLowerCase())) {
      keywords.unshift(bankName.toLowerCase());
    }

    const newPattern = {
      id: 'pat_' + Date.now(),
      bankName,
      keywords,
      imageUrl,
      imageKey,
      imageMime,
      referenceFormat: referenceFormat || '6 a 12 dígitos',
      notes: notes || 'Patrón oficial de comprobante para validación cruzada OCR',
      createdAt: new Date().toISOString(),
    };

    if (!Array.isArray(db.receiptPatterns)) db.receiptPatterns = [];
    db.receiptPatterns.unshift(newPattern);

    await saveStateForRequest(request, db);

    if (hasDatabase()) {
      await ensureAdminConfigSeed().catch(() => {});
      await syncAdminStateToNormalized(db).catch(() => {});
      await logAudit({ entity: 'ReceiptPattern', entityId: newPattern.id, action: 'CREATE', before: null, after: newPattern, actorLegacyId: currentUser?.id }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      message: 'Patrón de comprobante registrado exitosamente',
      pattern: newPattern,
      patterns: db.receiptPatterns,
      persistence: persistenceInfo(),
    });
  } catch (error) {
    console.error('Receipt pattern POST error:', error);
    return NextResponse.json({ success: false, error: 'Error al registrar patrón' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const db = await getStateForRequest(request);
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const currentUser = getRequestUser(request, db) || findUser(db, request);
    if (currentUser?.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Solo el administrador puede eliminar patrones' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ID de patrón requerido' }, { status: 400 });

    const existing = (db.receiptPatterns || []).find(p => p.id === id) || null;
    db.receiptPatterns = (db.receiptPatterns || []).filter(p => p.id !== id);
    await saveStateForRequest(request, db);

    if (existing) {
      await deleteUpload({ key: existing.imageKey, url: existing.imageUrl }).catch(() => {});
    }

    if (hasDatabase()) {
      await syncAdminStateToNormalized(db).catch(() => {});
      await logAudit({ entity: 'ReceiptPattern', entityId: id, action: 'DELETE', before: existing, after: null, actorLegacyId: currentUser?.id }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      message: 'Patrón de comprobante eliminado exitosamente',
      patterns: db.receiptPatterns,
      persistence: persistenceInfo(),
    });
  } catch (error) {
    console.error('Receipt pattern DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Error al eliminar patrón' }, { status: 500 });
  }
}
