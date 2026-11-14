import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDb, saveDb, checkWritePermission } from '../../lib/db.js';

export async function GET(request) {
  try {
    const db = getDb();
    const patterns = db.receiptPatterns || [];
    return NextResponse.json({
      success: true,
      patterns
    });
  } catch (error) {
    console.error('Receipt patterns GET error:', error);
    return NextResponse.json({ success: false, error: 'Error al obtener patrones de comprobantes' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = getDb();
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }

    const userId = request.headers.get('x-user-id');
    const currentUser = db.users.find(u => u.id === userId);
    if (currentUser?.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Acceso restringido: Solo el administrador puede gestionar patrones' }, { status: 403 });
    }

    const formData = await request.formData();
    const bankName = (formData.get('bankName') || '').trim();
    const referenceFormat = (formData.get('referenceFormat') || '').trim();
    const keywordsRaw = formData.get('keywords') || '';
    const notes = (formData.get('notes') || '').trim();
    const file = formData.get('patternImage');

    if (!bankName) {
      return NextResponse.json({ success: false, error: 'El nombre del banco emisor es obligatorio' }, { status: 400 });
    }

    let imageUrl = '/uploads/sample-voucher.png';

    if (file && typeof file === 'object' && file.size > 0) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const patternsDir = path.join(process.cwd(), 'public', 'uploads', 'patterns');
      if (!fs.existsSync(patternsDir)) {
        fs.mkdirSync(patternsDir, { recursive: true });
      }

      const extension = path.extname(file.name) || '.png';
      const cleanFileName = `pattern_${Date.now()}_${bankName.toLowerCase().replace(/[^a-z0-9]/g, '_')}${extension}`;
      const filePath = path.join(patternsDir, cleanFileName);

      fs.writeFileSync(filePath, buffer);
      imageUrl = `/uploads/patterns/${cleanFileName}`;
    }

    // Parsear palabras clave para validación cruzada
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
      referenceFormat: referenceFormat || '6 a 12 dígitos',
      notes: notes || 'Patrón oficial de comprobante para validación cruzada OCR',
      createdAt: new Date().toISOString()
    };

    if (!db.receiptPatterns) db.receiptPatterns = [];
    db.receiptPatterns.unshift(newPattern);
    saveDb(db);

    return NextResponse.json({
      success: true,
      message: 'Patrón de comprobante registrado exitosamente',
      pattern: newPattern,
      patterns: db.receiptPatterns
    });
  } catch (error) {
    console.error('Receipt pattern POST error:', error);
    return NextResponse.json({ success: false, error: 'Error al registrar patrón' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const db = getDb();
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }

    const userId = request.headers.get('x-user-id');
    const currentUser = db.users.find(u => u.id === userId);
    if (currentUser?.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Solo el administrador puede eliminar patrones' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ID de patrón requerido' }, { status: 400 });

    db.receiptPatterns = (db.receiptPatterns || []).filter(p => p.id !== id);
    saveDb(db);

    return NextResponse.json({
      success: true,
      message: 'Patrón de comprobante eliminado exitosamente',
      patterns: db.receiptPatterns
    });
  } catch (error) {
    console.error('Receipt pattern DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Error al eliminar patrón' }, { status: 500 });
  }
}

