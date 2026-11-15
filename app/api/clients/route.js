import { NextResponse } from 'next/server';
import { computeLoanStatus, checkWritePermission, normalizeDni, getRequestUser, scopeRecords, canAccessRecord } from '../../../lib/db.js';
import { getAppState, saveAppState } from '../../../lib/server/persistence.js';
import { getTrustLevelConfig, computeClientTrust } from '../../../lib/trust.js';

export async function GET(request) {
  try {
    const db = await getAppState();
    if (!Array.isArray(db.clients)) db.clients = [];
    if (!Array.isArray(db.loans)) db.loans = [];
    if (!Array.isArray(db.blacklist)) db.blacklist = [];
    const user = getRequestUser(request, db);
    const trustConfig = getTrustLevelConfig(db.settings);

    const visibleClients = scopeRecords(db.clients || [], user);
    const visibleLoans = scopeRecords(db.loans || [], user);
    const visibleBlacklist = scopeRecords(db.blacklist || [], user);

    // Enrich clients with real-time financial stats (scoped)
    const enrichedClients = visibleClients.map(client => {
      const allClientLoans = visibleLoans.filter(l => l.clientId === client.id);
      // Los financiamientos archivados no participan en la deuda activa,
      // pero se conservan en el récord crediticio del cliente.
      const clientLoans = allClientLoans.filter(l => !l.archived);

      const totalFinanced = allClientLoans.reduce((sum, l) => sum + (l.financedAmount || 0), 0);
      const activeLoans = clientLoans.filter(l => computeLoanStatus(l) !== 'completado');

      let activeDebt = 0;
      let overdueDebt = 0;
      let paidInstallmentsCount = 0;
      let totalInstallmentsCount = 0;

      clientLoans.forEach(loan => {
        (loan.installments || []).forEach(inst => {
          totalInstallmentsCount++;
          if (inst.paid) {
            paidInstallmentsCount++;
          } else {
            activeDebt += inst.amount;
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const dueDate = new Date(inst.dueDate);
            dueDate.setHours(0, 0, 0, 0);
            if (dueDate < now) {
              overdueDebt += inst.amount;
            }
          }
        });
      });

      return {
        ...client,
        // Nivel de confianza calculado automáticamente según el comportamiento de pago
        trust: computeClientTrust(clientLoans, trustConfig),
        stats: {
          totalLoansCount: allClientLoans.length,
          activeLoansCount: activeLoans.length,
          totalFinanced,
          activeDebt: Number(activeDebt.toFixed(2)),
          overdueDebt: Number(overdueDebt.toFixed(2)),
          paidRatio: totalInstallmentsCount > 0 ? Math.round((paidInstallmentsCount / totalInstallmentsCount) * 100) : 100
        },
        creditHistory: allClientLoans.map(l => ({
          id: l.id,
          productName: l.productName,
          type: l.type,
          totalAmount: l.totalAmount,
          status: computeLoanStatus(l),
          archived: Boolean(l.archived),
          startDate: l.startDate,
          installmentsCount: (l.installments || []).length,
          paidCount: (l.installments || []).filter(i => i.paid).length
        }))
      };
    });

    return NextResponse.json({
      success: true,
      clients: enrichedClients,
      blacklist: visibleBlacklist
    });
  } catch (error) {
    console.error('Clients GET error:', error);
    return NextResponse.json({ success: false, error: 'Error al obtener clientes' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = await getAppState();
    if (!Array.isArray(db.clients)) db.clients = [];
    if (!Array.isArray(db.loans)) db.loans = [];
    if (!Array.isArray(db.blacklist)) db.blacklist = [];
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const user = perm.user || getRequestUser(request, db);
    const isAdmin = user?.role === 'admin';

    const body = await request.json();
    const { id, name, dni, phone, address, notes, action, blacklistId } = body;

    // Reincorporación de un cliente desde la Lista Negra
    if (action === 'restore') {
      if (!blacklistId) {
        return NextResponse.json({ success: false, error: 'Registro de Lista Negra requerido' }, { status: 400 });
      }

      const entryIndex = (db.blacklist || []).findIndex(entry => entry.id === blacklistId);
      if (entryIndex === -1) {
        return NextResponse.json({ success: false, error: 'Registro no encontrado en la Lista Negra' }, { status: 404 });
      }

      const entry = db.blacklist[entryIndex];
      if (!canAccessRecord(user, entry)) {
        return NextResponse.json({ success: false, error: 'No autorizado para reincorporar este registro' }, { status: 403 });
      }

      const ownerId = entry.userId || user?.id || 'usr_admin';
      const entryDniKey = normalizeDni(entry.dni);
      const duplicate = (db.clients || []).find(c => (isAdmin || c.userId === ownerId) && entryDniKey && normalizeDni(c.dni) === entryDniKey);
      if (duplicate) {
        return NextResponse.json({
          success: false,
          error: `Ya existe un cliente activo con la cédula ${entry.dni} (${duplicate.name}).`
        }, { status: 409 });
      }

      const restoredClient = {
        id: entry.clientId && !db.clients.some(c => c.id === entry.clientId)
          ? entry.clientId
          : 'cli_' + Date.now(),
        userId: ownerId,
        name: entry.name,
        dni: entry.dni,
        phone: entry.phone || '',
        address: entry.address || '',
        trustLevel: 'Medio',
        creditLimit: 500,
        notes: entry.notes || '',
        createdAt: entry.createdAt || new Date().toISOString(),
        restoredAt: new Date().toISOString()
      };

      db.clients.unshift(restoredClient);
      db.blacklist.splice(entryIndex, 1);
      await saveAppState(db);

      return NextResponse.json({
        success: true,
        message: `${restoredClient.name} fue reincorporado a la tabla de clientes activos.`,
        client: restoredClient
      });
    }

    if (!name || !dni) {
      return NextResponse.json({ success: false, error: 'Nombre y Cédula/DNI son obligatorios' }, { status: 400 });
    }

    // Bloquear creación/edición con una cédula restringida en Lista Negra (scoped por usuario)
    const dniKey = normalizeDni(dni);
    if (dniKey) {
      const blocked = (db.blacklist || []).find(entry => {
        if (!entry || normalizeDni(entry.dni) !== dniKey) return false;
        if (!isAdmin && user && entry.userId !== user.id) return false;
        // Al editar, permite conservar la cédula del mismo cliente activo
        return !id || entry.clientId !== id;
      });

      if (blocked) {
        return NextResponse.json({
          success: false,
          blacklisted: true,
          error: `La cédula ${dni.trim()} está restringida en la Lista Negra (${blocked.name}). Reincorpore al cliente desde el botón "Lista Negra" antes de registrarlo nuevamente.`
        }, { status: 409 });
      }
    }

    if (id) {
      // Update existing
      const idx = db.clients.findIndex(c => c.id === id);
      if (idx === -1) {
        return NextResponse.json({ success: false, error: 'Cliente no encontrado' }, { status: 404 });
      }
      if (!canAccessRecord(user, db.clients[idx])) {
        return NextResponse.json({ success: false, error: 'No autorizado para modificar este cliente' }, { status: 403 });
      }
      db.clients[idx] = {
        ...db.clients[idx],
        name: name.trim(),
        dni: dni.trim(),
        phone: phone ? phone.trim() : '',
        address: address ? address.trim() : '',
        notes: notes ? notes.trim() : ''
      };
      await saveAppState(db);
      return NextResponse.json({ success: true, message: 'Cliente actualizado', client: db.clients[idx] });
    } else {
      // Create new. El nivel de confianza es automático y el límite de crédito
      // conserva un valor base para compatibilidad con el módulo de financiamiento.
      const ownerId = user?.id || 'usr_admin';
      const newClient = {
        id: 'cli_' + Date.now(),
        userId: ownerId,
        name: name.trim(),
        dni: dni.trim(),
        phone: phone ? phone.trim() : '',
        address: address ? address.trim() : '',
        trustLevel: 'Medio',
        creditLimit: 500,
        notes: notes ? notes.trim() : '',
        createdAt: new Date().toISOString()
      };
      db.clients.unshift(newClient);
      await saveAppState(db);
      return NextResponse.json({ success: true, message: 'Cliente registrado', client: newClient });
    }
  } catch (error) {
    console.error('Clients POST error:', error);
    return NextResponse.json({ success: false, error: 'Error al guardar cliente' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const db = await getAppState();
    if (!Array.isArray(db.clients)) db.clients = [];
    if (!Array.isArray(db.loans)) db.loans = [];
    if (!Array.isArray(db.blacklist)) db.blacklist = [];
    const perm = checkWritePermission(request, db);
    if (!perm.allowed) {
      return NextResponse.json({ success: false, error: perm.error, licenseExpired: true }, { status: 403 });
    }
    const user = perm.user || getRequestUser(request, db);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ID requerido' }, { status: 400 });

    const client = (db.clients || []).find(c => c.id === id);
    if (!client) return NextResponse.json({ success: false, error: 'Cliente no encontrado' }, { status: 404 });
    if (!canAccessRecord(user, client)) {
      return NextResponse.json({ success: false, error: 'No autorizado para eliminar este cliente' }, { status: 403 });
    }

    // Al eliminar un cliente manualmente, archivamos sus financiamientos para
    // no dejar deudas huérfanas fuera de la cartera activa.
    const archivedAt = new Date().toISOString();
    db.loans = (db.loans || []).map(loan => {
      if (loan.clientId !== id || loan.archived) return loan;
      if (!canAccessRecord(user, loan) && loan.userId !== client.userId) return loan;
      const previousStatus = computeLoanStatus(loan);
      return {
        ...loan,
        archived: true,
        archivedAt,
        archiveReason: 'Cliente eliminado manualmente',
        finalStatus: previousStatus === 'completado' ? 'completado' : 'incumplimiento'
      };
    });

    db.clients = (db.clients || []).filter(c => c.id !== id);
    await saveAppState(db);

    return NextResponse.json({ success: true, message: 'Cliente eliminado' });
  } catch (error) {
    console.error('Clients DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Error al eliminar cliente' }, { status: 500 });
  }
}
