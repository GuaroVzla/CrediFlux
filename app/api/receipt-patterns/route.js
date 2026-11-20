import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getStateForRequest, saveStateForRequest, persistenceInfo } from '@/server/persistence/supabase-store';
import { syncAdminStateToNormalized, logAudit, ensureAdminConfigSeed, hasDatabase, enrichReceiptPattern } from '@/server/admin/config.js';
import { saveUpload, deleteUpload, resolveUploadUrl, resolveUploadUrls } from '@/server/services/uploads.js';
import { checkWritePermission, getRequestUser } from '@/shared/lib/db.js';

function findUser(db, request) {
  return getRequestUser(request, db);
}

// Debe coincidir con el límite MIME/tamaño del bucket privado `receipts`.
const MAX_PATTERN_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_PATTERN_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
};
const DEFAULT_PATTERN_IMAGE = '/uploads/sample-voucher.svg';

function validatePatternImage(file) {
  if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function' || !file.size) {
    return { ok: true, file: null };
  }
  const mime = String(file.type || '').toLowerCase();
  if (!ALLOWED_PATTERN_MIME.has(mime)) {
    return {
      ok: false,
      status: 400,
      error: 'La imagen del patrón debe ser PNG, JPEG o WebP.',
    };
  }
  if (file.size > MAX_PATTERN_IMAGE_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'La imagen del patrón supera el límite de 10 MB.',
    };
  }
  return { ok: true, file, mime, ext: EXT_BY_MIME[mime] };
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['false', '0', 'no', 'off', 'inactive'].includes(String(value).toLowerCase());
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
    const resolvedImageUrls = await resolveUploadUrls(patterns.map((p) => p.imageUrl));
    const responsePatterns = patterns.map((pattern, index) => ({
      ...pattern,
      imageUrl: resolvedImageUrls[index] || pattern.imageUrl
    }));
    return NextResponse.json({
      success: true,
      patterns: responsePatterns,
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

    const imageValidation = validatePatternImage(file);
    if (!imageValidation.ok) {
      return NextResponse.json({ success: false, error: imageValidation.error }, { status: imageValidation.status });
    }

    let imageUrl = DEFAULT_PATTERN_IMAGE;
    let imageKey = null;
    let imageMime = null;

    if (imageValidation.file) {
      const buffer = Buffer.from(await imageValidation.file.arrayBuffer());
      const safeBank = bankName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'bank';
      const filename = `pattern_${Date.now()}_${safeBank}.${imageValidation.ext}`;
      const uploaded = await saveUpload(buffer, {
        filename,
        folder: 'uploads/patterns',
        contentType: imageValidation.mime,
        userId: currentUser?.id
      });
      imageUrl = uploaded.url;
      imageKey = uploaded.key || null;
      imageMime = imageValidation.mime;
    }

    const keywords = keywordsRaw
      ? keywordsRaw.split(',').map(k => k.trim()).filter(Boolean)
      : [bankName.toLowerCase()];
    if (!keywords.some(k => k.toLowerCase() === bankName.toLowerCase())) {
      keywords.unshift(bankName.toLowerCase());
    }

    const newPattern = enrichReceiptPattern({
      // UUID real: coincide con la PK de Supabase y permite borrar/editar
      // inmediatamente con el id devuelto por esta misma respuesta.
      id: randomUUID(),
      bankName,
      keywords,
      imageUrl,
      imageKey,
      imageMime,
      referenceFormat: referenceFormat || '6 a 12 dígitos',
      notes: notes || 'Patrón oficial de comprobante para validación cruzada OCR',
      isActive: true,
      createdAt: new Date().toISOString(),
    });

    if (!Array.isArray(db.receiptPatterns)) db.receiptPatterns = [];
    db.receiptPatterns.unshift(newPattern);

    await saveStateForRequest(request, db);

    if (hasDatabase()) {
      await ensureAdminConfigSeed().catch(() => {});
      await syncAdminStateToNormalized(db).catch(() => {});
      await logAudit({ entity: 'ReceiptPattern', entityId: newPattern.id, action: 'CREATE', before: null, after: newPattern, actorLegacyId: currentUser?.id }).catch(() => {});
    }

    const responsePattern = { ...newPattern, imageUrl: await resolveUploadUrl(newPattern.imageUrl) };
    return NextResponse.json({
      success: true,
      message: 'Patrón de comprobante registrado exitosamente',
      pattern: responsePattern,
      patterns: db.receiptPatterns.map((p) => p.id === newPattern.id ? responsePattern : p),
      persistence: persistenceInfo(),
    });
  } catch (error) {
    console.error('Receipt pattern POST error:', error);
    return NextResponse.json({ success: false, error: 'Error al registrar patrón' }, { status: 500 });
  }
}

export async function PATCH(request) {
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

    const formData = await request.formData();
    const url = new URL(request.url);
    const id = String(formData.get('id') || url.searchParams.get('id') || '');
    if (!id) return NextResponse.json({ success: false, error: 'ID de patrón requerido' }, { status: 400 });

    const patterns = Array.isArray(db.receiptPatterns) ? db.receiptPatterns : [];
    const index = patterns.findIndex((p) => p && String(p.id) === id);
    if (index < 0) return NextResponse.json({ success: false, error: 'Patrón no encontrado' }, { status: 404 });

    const existing = patterns[index];
    const before = { ...existing };
    const bankNameRaw = formData.get('bankName');
    const bankName = bankNameRaw === null ? String(existing.bankName || '') : String(bankNameRaw).trim();
    if (!bankName) {
      return NextResponse.json({ success: false, error: 'El nombre del banco emisor es obligatorio' }, { status: 400 });
    }

    const keywordsRaw = formData.get('keywords');
    let keywords = existing.keywords;
    if (keywordsRaw !== null) {
      keywords = String(keywordsRaw)
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      if (!keywords.some((k) => k.toLowerCase() === bankName.toLowerCase())) {
        keywords.unshift(bankName.toLowerCase());
      }
      if (keywords.length === 0) keywords = [bankName.toLowerCase()];
    }

    const changes = {
      ...existing,
      bankName,
      keywords,
      version: Math.max(1, Number(existing.version) || 1) + 1,
    };
    for (const field of ['referenceFormat', 'notes']) {
      const value = formData.get(field);
      if (value !== null) changes[field] = String(value).trim();
    }
    const activeValue = formData.get('isActive') ?? formData.get('active');
    if (activeValue !== null) changes.isActive = parseBoolean(activeValue, existing.isActive !== false);

    const imageValidation = validatePatternImage(formData.get('patternImage'));
    if (!imageValidation.ok) {
      return NextResponse.json({ success: false, error: imageValidation.error }, { status: imageValidation.status });
    }
    if (imageValidation.file) {
      const buffer = Buffer.from(await imageValidation.file.arrayBuffer());
      const safeBank = bankName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'bank';
      const filename = `pattern_${Date.now()}_${safeBank}.${imageValidation.ext}`;
      const uploaded = await saveUpload(buffer, {
        filename,
        folder: 'uploads/patterns',
        contentType: imageValidation.mime,
        userId: currentUser?.id,
      });
      changes.imageUrl = uploaded.url;
      changes.imageKey = uploaded.key || null;
      changes.imageMime = imageValidation.mime;
    }

    const updated = enrichReceiptPattern(changes);
    patterns[index] = updated;
    db.receiptPatterns = patterns;
    await saveStateForRequest(request, db);

    // Solo borra el objeto anterior si tenía clave de Storage. Las rutas
    // `/uploads/...` legadas se conservan porque pueden ser compartidas.
    if (imageValidation.file && existing.imageKey) {
      await deleteUpload({ key: existing.imageKey, url: existing.imageUrl }).catch(() => {});
    }

    if (hasDatabase()) {
      await ensureAdminConfigSeed().catch(() => {});
      await syncAdminStateToNormalized(db).catch(() => {});
      await logAudit({ entity: 'ReceiptPattern', entityId: id, action: 'UPDATE', before, after: updated, actorLegacyId: currentUser?.id }).catch(() => {});
    }

    const responsePattern = { ...updated, imageUrl: await resolveUploadUrl(updated.imageUrl) };
    return NextResponse.json({
      success: true,
      message: 'Patrón de comprobante actualizado exitosamente',
      pattern: responsePattern,
      patterns: patterns.map((p) => (p.id === updated.id ? responsePattern : p)),
      persistence: persistenceInfo(),
    });
  } catch (error) {
    console.error('Receipt pattern PATCH error:', error);
    return NextResponse.json({ success: false, error: 'Error al actualizar patrón' }, { status: 500 });
  }
}

export async function PUT(request) {
  return PATCH(request);
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

    // No borrar rutas `/uploads/...` legadas: pueden ser compartidas por varios
    // patrones o ser el placeholder por defecto del propio sistema.
    if (existing?.imageKey) {
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
