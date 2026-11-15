import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APP_STATE_ID = 'main';
const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_ID || 'default';

const JSON_DB_PATH = path.join(process.cwd(), 'data', 'crediflux-store.json');
const LEGACY_DB_PATHS = [
  path.join(process.cwd(), 'data', 'ricardo-store.json'),
  path.join(process.cwd(), 'data', 'db.json'),
];

function readJson() {
  const candidates = [JSON_DB_PATH, ...LEGACY_DB_PATHS];
  const p = candidates.find((c) => fs.existsSync(c));
  if (!p) throw new Error('No se encontró data/crediflux-store.json ni archivos JSON legados (ricardo-store.json/db.json)');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

const DEFAULT_TRUST_TIERS = [
  { tier: 'ALTO', label: 'Alta', description: 'Cliente confiable: buen historial y bajo riesgo de incumplimiento.', sortOrder: 1, criteria: { maxDelayDays: 0 } },
  { tier: 'MEDIO', label: 'Media', description: 'Cliente con comportamiento aceptable: riesgo moderado y seguimiento recomendado.', sortOrder: 2, criteria: { maxDelayDays: 7 } },
  { tier: 'RIESGOSO', label: 'Riesgosa', description: 'Cliente de alto riesgo: requiere controles adicionales y límites estrictos.', sortOrder: 3, criteria: { maxDelayDays: 15 } },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está configurado');
  const data = readJson();

  // 1) Persistir estado completo (compatibilidad total inmediata)
  await prisma.appState.upsert({
    where: { id: APP_STATE_ID },
    update: { data },
    create: { id: APP_STATE_ID, data },
  });

  // 2) Normalizar dominio de configuración admin
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEFAULT_TENANT_SLUG },
    update: {},
    create: { slug: DEFAULT_TENANT_SLUG, name: 'CrediFlux Principal' },
  });

  const s = data.settings || {};
  await prisma.adminSetting.upsert({
    where: { tenantId: tenant.id },
    update: {
      companyName: s.companyName ?? 'CrediFlux',
      currency: s.currency ?? '$',
      ecommerceCapital: Number.isFinite(Number(s.ecommerceCapital)) ? Number(s.ecommerceCapital) : 5000,
      aiProvider: s.aiProvider || 'ocrspace',
      ocrApiKeys: s.ocrApiKeys ?? { openai: '', gemini: '', ocrspace: s.ocrSpaceApiKey || '' },
      systemLicenseKey: s.licenseKey || null,
      adminPasswordLegacy: s.adminPassword || null,
      metadata: { trustLevelConfig: s.trustLevelConfig || null },
    },
    create: {
      tenantId: tenant.id,
      companyName: s.companyName ?? 'CrediFlux',
      currency: s.currency ?? '$',
      ecommerceCapital: Number.isFinite(Number(s.ecommerceCapital)) ? Number(s.ecommerceCapital) : 5000,
      aiProvider: s.aiProvider || 'ocrspace',
      ocrApiKeys: s.ocrApiKeys ?? { openai: '', gemini: '', ocrspace: s.ocrSpaceApiKey || '' },
      systemLicenseKey: s.licenseKey || null,
      adminPasswordLegacy: s.adminPassword || null,
      metadata: { trustLevelConfig: s.trustLevelConfig || null },
    },
  });

  const tlc = s.trustLevelConfig;
  if (tlc?.levels) {
    const th = tlc.thresholds || {};
    const rows = [
      { tier: 'ALTO', src: tlc.levels.alto, delay: th.altoMaxDelayDays ?? 0, order: 1 },
      { tier: 'MEDIO', src: tlc.levels.medio, delay: th.mediaMaxDelayDays ?? 7, order: 2 },
      { tier: 'RIESGOSO', src: tlc.levels.riesgoso, delay: th.riesgoMaxDelayDays ?? 15, order: 3 },
    ];
    for (const r of rows) {
      await prisma.trustLevelConfig.upsert({
        where: { tenantId_tier: { tenantId: tenant.id, tier: r.tier } },
        update: { label: r.src?.label || r.tier, description: r.src?.description || '', criteria: { maxDelayDays: Number(r.delay) } },
        create: { tenantId: tenant.id, tier: r.tier, label: r.src?.label || r.tier, description: r.src?.description || '', criteria: { maxDelayDays: Number(r.delay) }, sortOrder: r.order },
      });
    }
  } else {
    for (const t of DEFAULT_TRUST_TIERS) {
      await prisma.trustLevelConfig.upsert({ where: { tenantId_tier: { tenantId: tenant.id, tier: t.tier } }, update: {}, create: { tenantId: tenant.id, ...t } });
    }
  }

  for (const p of (data.receiptPatterns || [])) {
    if (!p?.id) continue;
    await prisma.receiptPattern.upsert({
      where: { tenantId_legacyId: { tenantId: tenant.id, legacyId: String(p.id) } },
      update: { bankName: p.bankName || 'Banco', keywords: p.keywords || [], referenceFormat: p.referenceFormat || null, notes: p.notes || null, imageUrl: p.imageUrl || null, extra: p },
      create: { tenantId: tenant.id, legacyId: String(p.id), bankName: p.bankName || 'Banco', keywords: p.keywords || [], referenceFormat: p.referenceFormat || null, notes: p.notes || null, imageUrl: p.imageUrl || null, extra: p },
    });
  }

  for (const u of (data.users || [])) {
    const legacyId = u?.id ? String(u.id) : null;
    const username = u.username || u.name || legacyId || `user_${Math.random().toString(36).slice(2)}`;
    const role = u.role === 'admin' ? 'ADMIN' : 'USER';
    const where = legacyId ? { tenantId_legacyId: { tenantId: tenant.id, legacyId } } : { tenantId_username: { tenantId: tenant.id, username } };
    const user = await prisma.user.upsert({
      where,
      update: { username, name: u.name || username, companyName: u.companyName || null, address: u.address || null, phone: u.phone || null, passwordLegacy: u.password || null, role, monthlyCapitals: u.monthlyCapitals || null },
      create: { tenantId: tenant.id, legacyId, username, name: u.name || username, companyName: u.companyName || null, address: u.address || null, phone: u.phone || null, passwordLegacy: u.password || null, role, monthlyCapitals: u.monthlyCapitals || null },
    });
    if (u.licenseKey || u.licenseExpiresAt) {
      const licenseKey = String(u.licenseKey);
      if (licenseKey && licenseKey !== 'N/A (Admin)') {
        await prisma.license.upsert({
          where: { tenantId_licenseKey: { tenantId: tenant.id, licenseKey } },
          update: { userId: user.id, durationMonths: Number(u.licenseDurationMonths) || 1, expiresAt: u.licenseExpiresAt ? new Date(u.licenseExpiresAt) : null },
          create: { tenantId: tenant.id, userId: user.id, licenseKey, durationMonths: Number(u.licenseDurationMonths) || 1, assignedAt: u.licenseAssignedAt ? new Date(u.licenseAssignedAt) : new Date(), expiresAt: u.licenseExpiresAt ? new Date(u.licenseExpiresAt) : null },
        });
      }
    }
  }

  console.log('[migrate] Migración completada: AppState + configuración admin normalizada.');
}

main().catch((e) => { console.error('[migrate] Error:', e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
