import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_ID || 'default';

const DEFAULT_TRUST_TIERS = [
  { tier: 'ALTO', label: 'Alta', description: 'Cliente confiable: buen historial y bajo riesgo de incumplimiento.', sortOrder: 1, criteria: { minScore: 80, maxDelayDays: 0 } },
  { tier: 'MEDIO', label: 'Media', description: 'Cliente con comportamiento aceptable: riesgo moderado y seguimiento recomendado.', sortOrder: 2, criteria: { minScore: 50, maxDelayDays: 7 } },
  { tier: 'RIESGOSO', label: 'Riesgosa', description: 'Cliente de alto riesgo: requiere controles adicionales y límites estrictos.', sortOrder: 3, criteria: { minScore: 0, maxDelayDays: 15 } },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('[seed] DATABASE_URL no configurado. Omitiendo seed (usa JSON local en desarrollo).');
    return;
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug: DEFAULT_TENANT_SLUG },
    update: {},
    create: { slug: DEFAULT_TENANT_SLUG, name: 'CrediFlux Principal' },
  });

  await prisma.adminSetting.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      companyName: 'CrediFlux',
      currency: '$',
      ecommerceCapital: 5000,
      timezone: 'America/Caracas',
      aiProvider: 'ocrspace',
      aiAutoAssignEnabled: true,
      aiRoutingRules: { receipt: 'ocrspace', document: 'openai', fallback: 'tesseract' },
      ocrConfidenceMin: 0.8,
      ocrApiKeys: { openai: '', gemini: '', ocrspace: '' },
    },
  });

  for (const t of DEFAULT_TRUST_TIERS) {
    await prisma.trustLevelConfig.upsert({
      where: { tenantId_tier: { tenantId: tenant.id, tier: t.tier } },
      update: {},
      create: { tenantId: tenant.id, ...t },
    });
  }

  console.log(`[seed] Tenant/configuración base asegurados para '${tenant.slug}' (${tenant.id}).`);
}

main()
  .catch((e) => {
    console.error('[seed] Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
