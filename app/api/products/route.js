import { NextResponse } from 'next/server';
import { checkWritePermission, getRequestUser, scopeRecords, canAccessRecord } from '../../../lib/db.js';
import { getAppState, saveAppState } from '../../../lib/server/persistence.js';

export async function GET(request) {
  try {
    const db = await getAppState();
    if (!Array.isArray(db.products)) db.products = [];
    const user = getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }
    const scoped = scopeRecords(db.products, user);
    const enrichedProducts = scoped.map(prod => {
      const cost = Number(prod.costPrice) || 0;
      const sale = Number(prod.salePrice) || 0;
      const profitMarginAmount = Number((sale - cost).toFixed(2));
      const profitMarginPercent = cost > 0 ? Number(((profitMarginAmount / cost) * 100).toFixed(1)) : 0;

      return {
        ...prod,
        profitMarginAmount,
        profitMarginPercent
      };
    });

    return NextResponse.json({ success: true, products: enrichedProducts });
  } catch (error) {
    console.error('Products GET error:', error);
    return NextResponse.json({ success: false, error: 'Error al obtener productos' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = await getAppState();
    if (!Array.isArray(db.products)) db.products = [];
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const user = perm.user || getRequestUser(request, db);
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { id, name, category, costPrice, salePrice, stock, profitMarginPercent, manualSalePrice } = body;

    if (!name || !String(name).trim()) {
      return NextResponse.json({ success: false, error: 'El nombre del producto es obligatorio' }, { status: 400 });
    }

    const hasNumber = (value) =>
      value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));

    if (id) {
      const idx = db.products.findIndex(p => p.id === id);
      if (idx === -1) {
        return NextResponse.json({ success: false, error: 'Producto no encontrado' }, { status: 404 });
      }
      if (!canAccessRecord(user, db.products[idx])) {
        return NextResponse.json({ success: false, error: 'No autorizado para modificar este producto' }, { status: 403 });
      }

      const prev = db.products[idx];
      const cost = hasNumber(costPrice) ? Number(costPrice) : (Number(prev.costPrice) || 0);
      const isManual = manualSalePrice !== undefined ? Boolean(manualSalePrice) : Boolean(prev.manualSalePrice);
      let margin = hasNumber(profitMarginPercent)
        ? Number(profitMarginPercent)
        : (Number.isFinite(Number(prev.profitMarginPercent)) ? Number(prev.profitMarginPercent) : 30);

      let finalSale;
      if (isManual) {
        finalSale = hasNumber(salePrice) ? Number(salePrice) : (Number(prev.salePrice) || 0);
        margin = cost > 0 ? Number((((finalSale - cost) / cost) * 100).toFixed(1)) : 0;
      } else {
        finalSale = Number((cost * (1 + margin / 100)).toFixed(2));
      }

      db.products[idx] = {
        ...prev,
        name: String(name).trim(),
        category: category !== undefined ? (category ? String(category).trim() : '') : (prev.category || ''),
        costPrice: cost,
        salePrice: finalSale,
        profitMarginPercent: margin,
        manualSalePrice: isManual,
        stock: Number.isFinite(Number(stock)) ? Number(stock) : (prev.stock || 0),
      };
      await saveAppState(db);
      return NextResponse.json({ success: true, message: 'Producto actualizado', product: db.products[idx] });
    } else {
      const cost = hasNumber(costPrice) ? Number(costPrice) : 0;
      const isManual = Boolean(manualSalePrice);
      let margin = hasNumber(profitMarginPercent) ? Number(profitMarginPercent) : 30;

      let finalSale;
      if (isManual) {
        finalSale = hasNumber(salePrice) ? Number(salePrice) : cost;
        margin = cost > 0 ? Number((((finalSale - cost) / cost) * 100).toFixed(1)) : 0;
      } else {
        finalSale = Number((cost * (1 + margin / 100)).toFixed(2));
      }

      const ownerId = user?.id || 'usr_admin';
      const newProduct = {
        id: 'prod_' + Date.now(),
        userId: ownerId,
        name: String(name).trim(),
        category: category ? String(category).trim() : '',
        costPrice: cost,
        salePrice: finalSale,
        profitMarginPercent: margin,
        manualSalePrice: isManual,
        stock: Number.isFinite(Number(stock)) ? Number(stock) : 0,
        createdAt: new Date().toISOString()
      };
      db.products.unshift(newProduct);
      await saveAppState(db);
      return NextResponse.json({ success: true, message: 'Producto registrado', product: newProduct });
    }
  } catch (error) {
    console.error('Products POST error:', error);
    return NextResponse.json({ success: false, error: 'Error al guardar producto' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const db = await getAppState();
    if (!Array.isArray(db.products)) db.products = [];
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

    const existing = db.products.find(p => p.id === id);
    if (!existing) return NextResponse.json({ success: false, error: 'Producto no encontrado' }, { status: 404 });
    if (!canAccessRecord(user, existing)) {
      return NextResponse.json({ success: false, error: 'No autorizado para eliminar este producto' }, { status: 403 });
    }

    db.products = db.products.filter(p => p.id !== id);
    await saveAppState(db);

    return NextResponse.json({ success: true, message: 'Producto eliminado' });
  } catch (error) {
    console.error('Products DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Error al eliminar producto' }, { status: 500 });
  }
}
