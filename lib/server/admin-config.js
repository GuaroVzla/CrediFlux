import { getPrisma, hasDatabase } from '../prisma.js';

export const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_ID || 'default';

export const DEFAULT_TRUST_TIERS = [
  { tier: 'ALTO', label: 'Alta', description: 'Cliente confiable: buen historial y bajo riesgo de incumplimiento.', sortOrder: 1, criteria: { minScore: 80 } },
  { tier: 'MEDIO', label: 'Media', description: 'Cliente con comportamiento aceptable: riesgo moderado y seguimiento recomendado.', sortOrder: 2, criteria: { minScore: 50 } },
  { tier: 'RIESGOSO', label: 'Riesgosa', description: 'Cliente de alto riesgo: requiere controles adicionales y límites estrictos.', sortOrder: 3, criteria: { minScore: 0 } },
];

export function getDefaultAdminSettings() {
  return {
    companyName: 'CrediFlux',
    currency: '$',
    ecommerceCapital: 5000,
    timezone: 'America/Caracas',
    aiProvider: 'ocrspace',
    aiAutoAssignEnabled: true,
    aiRoutingRules: { receipt: 'ocrspace', document: 'openai', fallback: 'tesseract' },
    ocrConfidenceMin: 0.8,
    ocrApiKeys: { openai: '', gemini: '', ocrspace: '' },
    providerConfig: {},
    featureFlags: {},
    metadata: {},
    systemLicenseKey: '',
  };
}

export async function ensureTenant(prisma, slug = DEFAULT_TENANT_SLUG) {
  return prisma.tenant.upsert({
    where: { slug },
    update: {},
    create: { slug, name: slug === 'default' ? 'CrediFlux Principal' : slug },
  });
}

export async function ensureAdminConfigSeed() {
  const prisma = getPrisma();
  if (!prisma) return { seeded: false, reason: 'no-database' };

  const tenant = await ensureTenant(prisma);

  await prisma.adminSetting.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id, ...getDefaultAdminSettings() },
  });

  for (const t of DEFAULT_TRUST_TIERS) {
    await prisma.trustLevelConfig.upsert({
      where: { tenantId_tier: { tenantId: tenant.id, tier: t.tier } },
      update: {},
      create: { tenantId: tenant.id, ...t },
    });
  }

  return { seeded: true, tenantId: tenant.id };
}

// ---------- Normalización entre AppState (JSON) y tablas normalizadas ----------

export function normalizeTierKey(value) {
  const v = String(value || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  if (v.includes('alt')) return 'ALTO';
  if (v.includes('med')) return 'MEDIO';
  if (v.includes('ries')) return 'RIESGOSO';
  if (v === 'alto') return 'ALTO';
  if (v === 'medio') return 'MEDIO';
  if (v === 'riesgoso' || v === 'riesgosa') return 'RIESGOSO';
  return null;
}

export function buildTrustConfigFromTiers(tiers = []) {
  // Mantiene compatibilidad con la forma usada por lib/trust.js (levels/thresholds)
  const byTier = {};
  for (const t of tiers) byTier[t.tier] = t;
  const get = (tier, fallback) => byTier[tier] || fallback;
  const alto = get('ALTO', { label: 'Alta', description: '', criteria: {} });
  const medio = get('MEDIO', { label: 'Media', description: '', criteria: {} });
  const riesgoso = get('RIESGOSO', { label: 'Riesgosa', description: '', criteria: {} });
  const criteria = (t) => (t?.criteria && typeof t.criteria === 'object' ? t.criteria : {});
  return {
    levels: {
      alto: { label: alto.label || 'Alta', description: alto.description || '' },
      medio: { label: medio.label || 'Media', description: medio.description || '' },
      riesgoso: { label: riesgoso.label || 'Riesgosa', description: riesgoso.description || '' },
    },
    thresholds: {
      altoMaxDelayDays: Number(criteria(alto).altoMaxDelayDays ?? criteria(alto).maxDelayDays ?? 0),
      mediaMaxDelayDays: Number(criteria(medio).mediaMaxDelayDays ?? criteria(medio).maxDelayDays ?? 7),
      riesgoMaxDelayDays: Number(criteria(riesgoso).riesgoMaxDelayDays ?? criteria(riesgoso).maxDelayDays ?? 15),
    },
    _tiers: { alto: criteria(alto), medio: criteria(medio), riesgoso: criteria(riesgoso) },
  };
}

export async function syncAdminStateToNormalized(dbState) {
  const prisma = getPrisma();
  if (!prisma || !dbState) return { synced: false, reason: 'no-database' };
  try {
    const tenant = await ensureTenant(prisma);
    const s = dbState.settings || {};

    // AdminSetting
    await prisma.adminSetting.upsert({
      where: { tenantId: tenant.id },
      update: {
        companyName: s.companyName ?? 'CrediFlux',
        currency: s.currency ?? '$',
        ecommerceCapital: Number.isFinite(Number(s.ecommerceCapital)) ? Number(s.ecommerceCapital) : 5000,
        aiProvider: s.aiProvider || 'ocrspace',
        aiAutoAssignEnabled: s.aiAutoAssignEnabled !== false,
        aiRoutingRules: s.aiRoutingRules ?? undefined,
        ocrApiKeys: s.ocrApiKeys ?? (s.ocrSpaceApiKey || s.aiApiKey ? { openai: s.aiProvider === 'openai' ? (s.aiApiKey || '') : '', gemini: s.aiProvider === 'gemini' ? (s.aiApiKey || '') : '', ocrspace: s.ocrSpaceApiKey || '' } : undefined),
        systemLicenseKey: s.licenseKey || s.systemLicenseKey || undefined,
        adminPasswordLegacy: s.adminPassword || undefined,
        metadata: { ...(s.metadata || {}), trustLevelConfig: s.trustLevelConfig || undefined },
      },
      create: {
        tenantId: tenant.id,
        ...getDefaultAdminSettings(),
        companyName: s.companyName ?? 'CrediFlux',
        currency: s.currency ?? '$',
        ecommerceCapital: Number.isFinite(Number(s.ecommerceCapital)) ? Number(s.ecommerceCapital) : 5000,
        aiProvider: s.aiProvider || 'ocrspace',
        ocrApiKeys: s.ocrApiKeys ?? { openai: '', gemini: '', ocrspace: s.ocrSpaceApiKey || '' },
        systemLicenseKey: s.licenseKey || '',
        adminPasswordLegacy: s.adminPassword || null,
      },
    });

    // Trust levels (desde settings.trustLevelConfig si existe)
    const tlc = s.trustLevelConfig;
    if (tlc && typeof tlc === 'object') {
      const levels = tlc.levels || {};
      const thresholds = tlc.thresholds || {};
      const map = [
        { tier: 'ALTO', src: levels.alto || levels.Alto || levels.ALTA, delay: thresholds.altoMaxDelayDays, order: 1 },
        { tier: 'MEDIO', src: levels.medio || levels.Medio || levels.MEDIA, delay: thresholds.mediaMaxDelayDays, order: 2 },
        { tier: 'RIESGOSO', src: levels.riesgoso || levels.riesgosa || levels.Riesgoso || levels.RIESGOSO, delay: thresholds.riesgoMaxDelayDays, order: 3 },
      ];
      for (const m of map) {
        const label = m.src?.label || (m.tier === 'ALTO' ? 'Alta' : m.tier === 'MEDIO' ? 'Media' : 'Riesgosa');
        const description = m.src?.description || '';
        const criteria = { ...(m.src?.criteria || {}), maxDelayDays: Number.isFinite(Number(m.delay)) ? Number(m.delay) : undefined };
        await prisma.trustLevelConfig.upsert({
          where: { tenantId_tier: { tenantId: tenant.id, tier: m.tier } },
          update: { label, description, criteria },
          create: { tenantId: tenant.id, tier: m.tier, label, description, criteria, sortOrder: m.order },
        });
      }
    } else {
      await ensureAdminConfigSeed();
    }

    // Receipt patterns
    const patterns = Array.isArray(dbState.receiptPatterns) ? dbState.receiptPatterns : [];
    for (const p of patterns) {
      const legacyId = p.id ? String(p.id) : null;
      const data = {
        tenantId: tenant.id,
        legacyId,
        bankName: p.bankName || p.bank || 'Banco',
        keywords: Array.isArray(p.keywords) ? p.keywords : (p.keywords ? [String(p.keywords)] : []),
        referenceFormat: p.referenceFormat || null,
        referenceRegex: p.referenceRegex || null,
        notes: p.notes || null,
        imageUrl: p.imageUrl || null,
        imageKey: p.imageKey || null,
        imageMime: p.imageMime || null,
        isActive: p.isActive !== false,
        extra: p,
      };
      if (legacyId) {
        await prisma.receiptPattern.upsert({
          where: { tenantId_legacyId: { tenantId: tenant.id, legacyId } },
          update: data,
          create: data,
        });
      } else {
        await prisma.receiptPattern.create({ data });
      }
    }

    // Usuarios y licencias (normalización básica)
    const users = Array.isArray(dbState.users) ? dbState.users : [];
    for (const u of users) {
      const legacyId = u.id ? String(u.id) : null;
      const username = u.username || u.name || legacyId || `user_${Date.now()}`;
      const role = (u.role === 'admin' || u.role === 'ADMIN') ? 'ADMIN' : 'USER';
      const user = await prisma.user.upsert({
        where: legacyId ? { tenantId_legacyId: { tenantId: tenant.id, legacyId } } : { tenantId_username: { tenantId: tenant.id, username } },
        update: {
          username,
          name: u.name || username,
          companyName: u.companyName || null,
          email: u.email || null,
          address: u.address || null,
          phone: u.phone || null,
          passwordLegacy: u.password || null,
          role,
          monthlyCapitals: u.monthlyCapitals || null,
          isActive: u.isActive !== false,
        },
        create: {
          tenantId: tenant.id,
          legacyId,
          username,
          name: u.name || username,
          companyName: u.companyName || null,
          email: u.email || null,
          address: u.address || null,
          phone: u.phone || null,
          passwordLegacy: u.password || null,
          role,
          monthlyCapitals: u.monthlyCapitals || null,
          isActive: u.isActive !== false,
        },
      });

      if (u.licenseKey || u.licenseExpiresAt) {
        const licenseKey = String(u.licenseKey || `LEGACY-${user.id}`);
        await prisma.license.upsert({
          where: { tenantId_licenseKey: { tenantId: tenant.id, licenseKey } },
          update: {
            userId: user.id,
            durationMonths: Number(u.licenseDurationMonths) || 1,
            assignedAt: u.licenseAssignedAt ? new Date(u.licenseAssignedAt) : undefined,
            expiresAt: u.licenseExpiresAt ? new Date(u.licenseExpiresAt) : null,
            status: 'ACTIVE',
          },
          create: {
            tenantId: tenant.id,
            userId: user.id,
            licenseKey,
            durationMonths: Number(u.licenseDurationMonths) || 1,
            assignedAt: u.licenseAssignedAt ? new Date(u.licenseAssignedAt) : new Date(),
            expiresAt: u.licenseExpiresAt ? new Date(u.licenseExpiresAt) : null,
            status: 'ACTIVE',
          },
        });
      }
    }

    return { synced: true, tenantId: tenant.id };
  } catch (e) {
    console.error('[admin-config] syncAdminStateToNormalized error:', e?.message || e);
    return { synced: false, error: e?.message || String(e) };
  }
}

export async function loadNormalizedAdminExtras() {
  const prisma = getPrisma();
  if (!prisma) return null;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: DEFAULT_TENANT_SLUG },
      include: { trustLevels: true, receiptPatterns: { orderBy: { createdAt: 'desc' } }, settings: true },
    });
    if (!tenant) return null;
    return {
      tenantId: tenant.id,
      settings: tenant.settings,
      trustLevels: tenant.trustLevels,
      receiptPatterns: tenant.receiptPatterns,
    };
  } catch (e) {
    return null;
  }
}

export async function logAudit({ entity, entityId, action, before, after, actorLegacyId }) {
  const prisma = getPrisma();
  if (!prisma) return;
  try {
    const tenant = await ensureTenant(prisma);
    let actorId = null;
    if (actorLegacyId) {
      const u = await prisma.user.findFirst({ where: { tenantId: tenant.id, legacyId: String(actorLegacyId) } });
      actorId = u?.id || null;
    }
    await prisma.settingAuditLog.create({
      data: { tenantId: tenant.id, actorId, entity, entityId: entityId ? String(entityId) : null, action, before: before ?? null, after: after ?? null },
    });
  } catch (e) {
    // best-effort
  }
}

export { hasDatabase };
