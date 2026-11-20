import fs from 'fs';
import path from 'path';
import { isLegacyAuthAllowed } from './supabase/env';

const DB_PATH = path.join(process.cwd(), 'data', 'crediflux-store.json');
const LEGACY_DB_PATHS = [
  path.join(process.cwd(), 'data', 'ricardo-store.json'),
  path.join(process.cwd(), 'data', 'db.json'),
];

export const LICENSE_EXPIRED_MESSAGE = "Licencia del sistema caducada, favor comunicarse con el administrador del sistema. Informacion de contacto: telefono: +584126770824 correo: Oswaldoserrano18@gmail.com";

// Nombres de los 12 meses
export const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

// Helper para inicializar capitales de 12 meses (por defecto 0 o valor base)
export function getDefaultMonthlyCapital(baseValue = 5000) {
  const currentYear = new Date().getFullYear();
  const months = {};
  for (let i = 1; i <= 12; i++) {
    const key = `${currentYear}-${String(i).padStart(2, '0')}`;
    months[key] = {
      monthIndex: i,
      monthName: MONTH_NAMES[i - 1],
      year: currentYear,
      capital: baseValue
    };
  }
  return months;
}

// Default initial dataset
const INITIAL_DATA = {
  settings: {
    licenseKey: "CREDIFLUX-FINTECH-2026",
    adminPassword: "admin123",
    currency: "$",
    aiProvider: "openai", // Asignado exclusivamente por el Admin
    aiApiKey: ""
  },
  users: [
    {
      id: "usr_admin",
      username: "admin",
      name: "Administrador del Sistema",
      role: "admin",
      password: "admin123",
      monthlyCapitals: getDefaultMonthlyCapital(5000),
      createdAt: "2026-01-01T08:00:00.000Z"
    }
  ],
  clients: [
    {
      id: "cli_1",
      name: "Carlos Mendoza",
      dni: "V-18.452.910",
      phone: "+58 414-5551234",
      address: "Av. Bolívar, Res. Los Sauces, Apto 4B",
      trustLevel: "Alto",
      creditLimit: 1200,
      notes: "Cliente puntual en pagos anteriores. Excelente récord.",
      createdAt: "2026-01-15T10:00:00.000Z"
    },
    {
      id: "cli_2",
      name: "María Fernanda Gómez",
      dni: "V-22.189.654",
      phone: "+58 424-8889911",
      address: "Urb. El Rosal, Calle 3, Casa #14",
      trustLevel: "Medio",
      creditLimit: 750,
      notes: "Comerciante independiente, suele pagar quincenal.",
      createdAt: "2026-02-01T14:30:00.000Z"
    },
    {
      id: "cli_3",
      name: "José Alejandro Rivas",
      dni: "V-15.772.301",
      phone: "+58 412-3334455",
      address: "Sector La Candelaria, Edif. Centro",
      trustLevel: "Riesgoso",
      creditLimit: 300,
      notes: "Presentó retrasos de más de 10 días en el financiamiento anterior.",
      createdAt: "2026-02-10T09:15:00.000Z"
    }
  ],
  products: [
    {
      id: "prod_1",
      name: "iPhone 15 128GB (Sellado)",
      category: "Smartphones",
      costPrice: 650,
      salePrice: 850,
      stock: 4,
      createdAt: "2026-01-10T12:00:00.000Z"
    },
    {
      id: "prod_2",
      name: "Samsung Galaxy A55 256GB",
      category: "Smartphones",
      costPrice: 280,
      salePrice: 380,
      stock: 7,
      createdAt: "2026-01-12T15:00:00.000Z"
    },
    {
      id: "prod_3",
      name: "Laptop Lenovo ThinkPad i5 16GB",
      category: "Computación",
      costPrice: 420,
      salePrice: 590,
      stock: 3,
      createdAt: "2026-01-20T11:00:00.000Z"
    },
    {
      id: "prod_4",
      name: "Moto Bera SBR 150cc 2026",
      category: "Movilidad",
      costPrice: 780,
      salePrice: 1050,
      stock: 2,
      createdAt: "2026-02-01T16:00:00.000Z"
    }
  ],
  // Clientes dados de baja por incumplimiento (Lista Negra)
  blacklist: [],
  loans: [
    {
      id: "ln_1",
      clientId: "cli_1",
      clientName: "Carlos Mendoza",
      type: "producto",
      productId: "prod_1",
      productName: "iPhone 15 128GB (Sellado)",
      principal: 850,
      downPayment: 150,
      financedAmount: 700,
      interestRate: 15,
      totalAmount: 805,
      installmentCount: 6,
      installmentAmount: 134.17,
      frequency: "quincenal",
      startDate: "2026-02-01",
      notes: "Financiamiento de equipo con inicial de $150",
      status: "al_dia",
      installments: [
        { number: 1, dueDate: "2026-02-15", amount: 134.17, paid: true, paidDate: "2026-02-14", receiptRef: "REF-9921" },
        { number: 2, dueDate: "2026-03-01", amount: 134.17, paid: true, paidDate: "2026-02-28", receiptRef: "REF-1044" },
        { number: 3, dueDate: "2026-03-15", amount: 134.17, paid: false, paidDate: null, receiptRef: null },
        { number: 4, dueDate: "2026-03-30", amount: 134.17, paid: false, paidDate: null, receiptRef: null },
        { number: 5, dueDate: "2026-04-15", amount: 134.17, paid: false, paidDate: null, receiptRef: null },
        { number: 6, dueDate: "2026-04-30", amount: 134.17, paid: false, paidDate: null, receiptRef: null }
      ],
      createdAt: "2026-02-01T10:00:00.000Z"
    },
    {
      id: "ln_2",
      clientId: "cli_2",
      clientName: "María Fernanda Gómez",
      type: "dinero",
      productId: null,
      productName: "Préstamo en Efectivo/Transferencia",
      principal: 400,
      downPayment: 0,
      financedAmount: 400,
      interestRate: 20,
      totalAmount: 480,
      installmentCount: 4,
      installmentAmount: 120,
      frequency: "semanal",
      startDate: "2026-02-20",
      notes: "Capital de trabajo para su tienda.",
      status: "proximo",
      installments: [
        { number: 1, dueDate: "2026-02-27", amount: 120, paid: true, paidDate: "2026-02-27", receiptRef: "PAG-7822" },
        { number: 2, dueDate: "2026-03-12", amount: 120, paid: false, paidDate: null, receiptRef: null },
        { number: 3, dueDate: "2026-03-19", amount: 120, paid: false, paidDate: null, receiptRef: null },
        { number: 4, dueDate: "2026-03-26", amount: 120, paid: false, paidDate: null, receiptRef: null }
      ],
      createdAt: "2026-02-20T11:00:00.000Z"
    },
    {
      id: "ln_3",
      clientId: "cli_3",
      clientName: "José Alejandro Rivas",
      type: "dinero",
      productId: null,
      productName: "Préstamo de Emergencia",
      principal: 250,
      downPayment: 0,
      financedAmount: 250,
      interestRate: 20,
      totalAmount: 300,
      installmentCount: 3,
      installmentAmount: 100,
      frequency: "quincenal",
      startDate: "2026-01-10",
      notes: "Retrasado en 2da cuota.",
      status: "moroso",
      installments: [
        { number: 1, dueDate: "2026-01-25", amount: 100, paid: true, paidDate: "2026-01-28", receiptRef: "PM-1190" },
        { number: 2, dueDate: "2026-02-10", amount: 100, paid: false, paidDate: null, receiptRef: null },
        { number: 3, dueDate: "2026-02-25", amount: 100, paid: false, paidDate: null, receiptRef: null }
      ],
      createdAt: "2026-01-10T14:00:00.000Z"
    }
  ],
  payments: [
    {
      id: "pay_1",
      loanId: "ln_1",
      clientName: "Carlos Mendoza",
      installmentNumber: 1,
      amount: 134.17,
      date: "2026-02-14",
      method: "Pago Móvil",
      reference: "REF-9921",
      notes: "Cuota 1/6 cancelada puntual",
      createdAt: "2026-02-14T16:00:00.000Z"
    },
    {
      id: "pay_2",
      loanId: "ln_1",
      clientName: "Carlos Mendoza",
      installmentNumber: 2,
      amount: 134.17,
      date: "2026-02-28",
      method: "Transferencia Bancaria",
      reference: "REF-1044",
      notes: "Cuota 2/6 cancelada",
      createdAt: "2026-02-28T18:30:00.000Z"
    },
    {
      id: "pay_3",
      loanId: "ln_2",
      clientName: "María Fernanda Gómez",
      installmentNumber: 1,
      amount: 120,
      date: "2026-02-27",
      method: "Efectivo USD",
      reference: "PAG-7822",
      notes: "Cuota 1/4 cancelada",
      createdAt: "2026-02-27T12:00:00.000Z"
    },
    {
      id: "pay_4",
      loanId: "ln_3",
      clientName: "José Alejandro Rivas",
      installmentNumber: 1,
      amount: 100,
      date: "2026-01-28",
      method: "Pago Móvil",
      reference: "PM-1190",
      notes: "Cuota 1/3 con 3 días de retraso",
      createdAt: "2026-01-28T19:00:00.000Z"
    }
  ],
  ecommerce: [
    {
      id: "ecom_1",
      type: "compra",
      title: "Lote de 3 iPhone 15 Pro",
      amount: 2100,
      date: "2026-01-25",
      bank: "Banesco Panamá / Zelle",
      reference: "ZL-8837192",
      receiptUrl: "/uploads/demo-recibo-1.png",
      rawOcr: {
        monto: 2100,
        fecha: "2026-01-25",
        referencia: "ZL-8837192",
        banco: "Zelle",
        confianza: "98%"
      },
      createdAt: "2026-01-25T14:00:00.000Z"
    },
    {
      id: "ecom_2",
      type: "venta",
      title: "Venta iPhone 15 Pro contado a David P.",
      amount: 880,
      date: "2026-02-05",
      bank: "Banesco Pago Móvil",
      reference: "0103449102",
      receiptUrl: "/uploads/demo-recibo-2.png",
      rawOcr: {
        monto: 880,
        fecha: "2026-02-05",
        referencia: "0103449102",
        banco: "Banesco",
        confianza: "95%"
      },
      createdAt: "2026-02-05T17:20:00.000Z"
    },
    {
      id: "ecom_3",
      type: "compra",
      title: "Adquisición 2 Laptops Lenovo",
      amount: 840,
      date: "2026-02-12",
      bank: "Bancaribe",
      reference: "BC-551029",
      receiptUrl: "/uploads/demo-recibo-3.png",
      rawOcr: {
        monto: 840,
        fecha: "2026-02-12",
        referencia: "BC-551029",
        banco: "Bancaribe",
        confianza: "92%"
      },
      createdAt: "2026-02-12T10:15:00.000Z"
    },
    {
      id: "ecom_4",
      type: "venta",
      title: "Venta Laptop Lenovo ThinkPad a Dra. Pérez",
      amount: 600,
      date: "2026-02-22",
      bank: "Mercantil Pago Móvil",
      reference: "MPM-401928",
      receiptUrl: "/uploads/demo-recibo-4.png",
      rawOcr: {
        monto: 600,
        fecha: "2026-02-22",
        referencia: "MPM-401928",
        banco: "Mercantil",
        confianza: "99%"
      },
      createdAt: "2026-02-22T15:40:00.000Z"
    }
  ]
};

// Generar una clave de licencia aleatoria formateada
export function generateRandomLicense(months = 1) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let segment1 = '';
  let segment2 = '';
  let segment3 = '';
  for (let i = 0; i < 4; i++) segment1 += chars.charAt(Math.floor(Math.random() * chars.length));
  for (let i = 0; i < 4; i++) segment2 += chars.charAt(Math.floor(Math.random() * chars.length));
  for (let i = 0; i < 4; i++) segment3 += chars.charAt(Math.floor(Math.random() * chars.length));
  const licenseKey = `CFLX-${segment1}-${segment2}-${segment3}`;

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + Number(months));

  return {
    licenseKey,
    assignedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    durationMonths: Number(months)
  };
}

// Verifica si la licencia de un usuario está expirada
export function isUserLicenseExpired(user) {
  if (!user || user.role === 'admin') return false;
  if (!user.licenseExpiresAt) return true;
  const expiry = new Date(user.licenseExpiresAt);
  const now = new Date();
  return expiry.getTime() < now.getTime();
}

// Normaliza una cédula/DNI para comparaciones tolerantes a formato.
// Ej: "V-18.452.910" -> "v18452910"
export function normalizeDni(value) {
  return String(value || '').replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
}

// Helper to ensure database file exists and schema migrations
export function getDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      let seed = INITIAL_DATA;
      for (const legacyPath of LEGACY_DB_PATHS) {
        if (fs.existsSync(/*turbopackIgnore: true*/ legacyPath)) {
          try {
            seed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ legacyPath, 'utf-8'));
            break;
          } catch (e) {
            seed = INITIAL_DATA;
          }
        }
      }
      fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2), 'utf-8');
      return seed;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const data = JSON.parse(raw);

    let modified = false;

    // Asegurar que el usuario admin exista
    if (!data.users || data.users.length === 0) {
      data.users = INITIAL_DATA.users;
      modified = true;
    }

    // Migración: asegurar que cada usuario tenga monthlyCapitals
    data.users.forEach(u => {
      if (!u.monthlyCapitals) {
        u.monthlyCapitals = getDefaultMonthlyCapital(5000);
        modified = true;
      }
    });

    // Migración: Lista Negra de clientes dados de baja
    if (!Array.isArray(data.blacklist)) {
      data.blacklist = [];
      modified = true;
    }

    // Migración multi-tenancy: aislar datos por usuario (userId/ownerId).
    const adminOwner = (data.users.find(u => u.role === 'admin') || data.users[0] || { id: 'usr_admin' });
    const defaultOwnerId = adminOwner.id || 'usr_admin';
    const ownableCollections = ['clients', 'products', 'loans', 'payments', 'ecommerce', 'blacklist'];
    ownableCollections.forEach((key) => {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key] = data[key].map((item) => {
        if (!item || typeof item !== 'object') return item;
        if (!item.userId) {
          modified = true;
          return { ...item, userId: defaultOwnerId };
        }
        return item;
      });
    });
    const clientOwnerById = {};
    (data.clients || []).forEach(c => { if (c && c.id) clientOwnerById[c.id] = c.userId || defaultOwnerId; });
    const loanOwnerById = {};
    (data.loans || []).forEach(l => {
      if (!l || !l.id) return;
      const owner = l.userId || clientOwnerById[l.clientId] || defaultOwnerId;
      if (l.userId !== owner) { l.userId = owner; modified = true; }
      loanOwnerById[l.id] = owner;
    });
    (data.payments || []).forEach(p => {
      if (!p) return;
      const owner = p.userId || loanOwnerById[p.loanId] || clientOwnerById[p.clientId] || defaultOwnerId;
      if (p.userId !== owner) { p.userId = owner; modified = true; }
    });

    if (modified) {
      saveDb(data);
    }

    return data;
  } catch (error) {
    console.error('Error reading DB:', error);
    return INITIAL_DATA;
  }
}

// Helper to save database file atomically
export function saveDb(data) {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Error saving DB:', error);
    return false;
  }
}

// Resuelve el usuario autenticado.
// - Con Supabase: la capa de datos adjunta `db.__currentUser` tras validar la sesión.
// - Modo legado (sólo dev/test): se conserva el header x-user-id como compatibilidad.
// En producción NUNCA se acepta la identidad desde un header del cliente.
export function getRequestUser(request, db) {
  if (db && Object.prototype.hasOwnProperty.call(db, '__currentUser')) {
    return db.__currentUser || null;
  }
  if (!isLegacyAuthAllowed()) return null;
  const userId = request?.headers?.get?.('x-user-id');
  if (!userId) return null;
  return (db.users || []).find(u => u.id === userId) || null;
}

// Helper para validar si el usuario que hace la solicitud puede escribir/crear registros
export function checkWritePermission(request, db) {
  const user = getRequestUser(request, db);
  // Fail-closed: sin identidad verificada no hay permiso de escritura.
  if (!user) {
    return { allowed: false, user: null, isAdmin: false, error: 'No autenticado' };
  }

  if (user.role === 'admin') {
    return { allowed: true, user, isAdmin: true };
  }

  if (isUserLicenseExpired(user)) {
    return {
      allowed: false,
      user,
      isAdmin: false,
      error: LICENSE_EXPIRED_MESSAGE
    };
  }

  return { allowed: true, user, isAdmin: false };
}

// Multi-tenancy: aislamiento estricto - un registro solo es accesible por su propietario autenticado
export function canAccessRecord(user, record) {
  if (!user) return false;
  if (!record || !record.userId) return false;
  return record.userId === user.id;
}

// Multi-tenancy: aislamiento estricto - filtra registros por propietario para todos los roles
export function scopeRecords(records, user) {
  const list = Array.isArray(records) ? records : [];
  if (!user) return [];
  return list.filter(r => r && r.userId === user.id);
}

// Status calculation logic based on current date
export function computeLoanStatus(loan) {
  // Financiamientos dados de baja por incumplimiento: se archivan y no
  // vuelven a participar en la cartera activa ni en los KPIs.
  if (loan.archived) {
    return 'archivado';
  }

  const unpaidInstallments = loan.installments.filter(i => !i.paid);
  if (unpaidInstallments.length === 0) {
    return 'completado';
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (const inst of unpaidInstallments) {
    const dueDate = new Date(inst.dueDate);
    dueDate.setHours(0, 0, 0, 0);
    if (dueDate < now) {
      return 'moroso';
    }
  }

  const nearest = unpaidInstallments[0];
  const dueDate = new Date(nearest.dueDate);
  dueDate.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

  if (diffDays <= 3 && diffDays >= 0) {
    return 'proximo';
  }

  return 'al_dia';
}
