// Reglas globales de nivel de confianza de clientes.
// Módulo puro (sin Node APIs) para poder usarse tanto en el servidor como en el cliente.

export const DEFAULT_TRUST_CONFIG = {
  levels: {
    alto: {
      label: 'Alta',
      description: 'Pagos al día o cumpliendo estrictamente con el cronograma estimado.'
    },
    medio: {
      label: 'Media',
      description: 'Retrasos menores (hasta la tolerancia configurada), con historial de cancelación total de cuotas.'
    },
    riesgoso: {
      label: 'Riesgosa',
      description: 'Retrasos superiores al límite permitido o cuotas vencidas pendientes de pago.'
    }
  },
  thresholds: {
    altoMaxDelayDays: 0,
    mediaMaxDelayDays: 7,
    riesgoMaxDelayDays: 15
  }
};

const MAX_LABEL_LENGTH = 32;
const MAX_DESCRIPTION_LENGTH = 240;

function toBoundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function cleanText(value, fallback, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

/**
 * Normaliza y valida la configuración de niveles de confianza.
 * Acepta configuraciones parciales o corruptas y siempre devuelve una estructura completa.
 */
export function normalizeTrustConfig(rawConfig) {
  const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const rawLevels = raw.levels && typeof raw.levels === 'object' ? raw.levels : {};
  const rawThresholds = raw.thresholds && typeof raw.thresholds === 'object' ? raw.thresholds : {};

  const levels = {};
  Object.keys(DEFAULT_TRUST_CONFIG.levels).forEach(key => {
    const fallback = DEFAULT_TRUST_CONFIG.levels[key];
    const source = rawLevels[key] && typeof rawLevels[key] === 'object' ? rawLevels[key] : {};
    levels[key] = {
      label: cleanText(source.label, fallback.label, MAX_LABEL_LENGTH),
      description: cleanText(source.description, fallback.description, MAX_DESCRIPTION_LENGTH)
    };
  });

  const thresholds = {
    altoMaxDelayDays: toBoundedInt(
      rawThresholds.altoMaxDelayDays,
      DEFAULT_TRUST_CONFIG.thresholds.altoMaxDelayDays,
      0,
      60
    ),
    mediaMaxDelayDays: toBoundedInt(
      rawThresholds.mediaMaxDelayDays,
      DEFAULT_TRUST_CONFIG.thresholds.mediaMaxDelayDays,
      0,
      120
    ),
    riesgoMaxDelayDays: toBoundedInt(
      rawThresholds.riesgoMaxDelayDays,
      DEFAULT_TRUST_CONFIG.thresholds.riesgoMaxDelayDays,
      0,
      365
    )
  };

  // Mantener coherencia entre umbrales: alto <= medio <= riesgo
  if (thresholds.mediaMaxDelayDays < thresholds.altoMaxDelayDays) {
    thresholds.mediaMaxDelayDays = thresholds.altoMaxDelayDays;
  }
  if (thresholds.riesgoMaxDelayDays < thresholds.mediaMaxDelayDays) {
    thresholds.riesgoMaxDelayDays = thresholds.mediaMaxDelayDays;
  }

  return { levels, thresholds };
}

/**
 * Obtiene la configuración global desde el objeto de settings o desde el db completo.
 */
export function getTrustLevelConfig(source) {
  if (!source || typeof source !== 'object') return normalizeTrustConfig(null);
  const stored = source.settings?.trustLevelConfig ?? source.trustLevelConfig;
  return normalizeTrustConfig(stored);
}

function parseDateOnly(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Calcula automáticamente el nivel de confianza de un cliente a partir de sus
 * financiamientos y del comportamiento real de pago (fechas de vencimiento vs. pago).
 *
 * - Alta: sin cuotas vencidas y retraso máximo dentro del umbral "alto".
 * - Media: sin cuotas vencidas y retrasos dentro de los umbrales medios.
 * - Riesgosa: cuotas vencidas sin pagar o retraso máximo superior al umbral de riesgo.
 */
export function computeClientTrust(clientLoans, configInput, now = new Date()) {
  const config = normalizeTrustConfig(configInput);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let maxDelayDays = 0;
  let overdueInstallments = 0;
  let paidInstallments = 0;
  let totalInstallments = 0;
  let hasHistory = false;

  (Array.isArray(clientLoans) ? clientLoans : []).forEach(loan => {
    (Array.isArray(loan?.installments) ? loan.installments : []).forEach(installment => {
      const dueDate = parseDateOnly(installment?.dueDate);
      if (!dueDate) return;
      totalInstallments += 1;

      if (installment.paid) {
        paidInstallments += 1;
        hasHistory = true;
        const paidDate = parseDateOnly(installment.paidDate);
        if (paidDate) {
          const delay = Math.max(0, Math.round((paidDate.getTime() - dueDate.getTime()) / DAY_MS));
          if (delay > maxDelayDays) maxDelayDays = delay;
        }
      } else if (dueDate < today) {
        overdueInstallments += 1;
        const delay = Math.round((today.getTime() - dueDate.getTime()) / DAY_MS);
        if (delay > maxDelayDays) maxDelayDays = delay;
      }
    });
  });

  const { altoMaxDelayDays, mediaMaxDelayDays, riesgoMaxDelayDays } = config.thresholds;

  let level = 'medio';
  let reason = 'Sin historial de pagos registrado todavía.';

  if (overdueInstallments > 0) {
    level = 'riesgoso';
    reason = `${overdueInstallments} cuota(s) vencida(s) sin pagar.`;
  } else if (maxDelayDays > riesgoMaxDelayDays) {
    level = 'riesgoso';
    reason = `Retraso máximo de ${maxDelayDays} días (límite de riesgo: ${riesgoMaxDelayDays}).`;
  } else if (hasHistory && maxDelayDays <= altoMaxDelayDays) {
    level = 'alto';
    reason = maxDelayDays === 0
      ? 'Pagos al día según el cronograma.'
      : `Retraso máximo de ${maxDelayDays} día(s), dentro del margen preferente.`;
  } else if (hasHistory && maxDelayDays <= mediaMaxDelayDays) {
    level = 'medio';
    reason = `Retraso máximo de ${maxDelayDays} día(s), con cuotas canceladas.`;
  } else if (hasHistory) {
    level = 'medio';
    reason = `Retraso máximo de ${maxDelayDays} día(s), dentro de la tolerancia.`;
  }

  const levelConfig = config.levels[level] || config.levels.medio;

  return {
    level,
    label: levelConfig.label,
    description: levelConfig.description,
    reason,
    maxDelayDays,
    overdueInstallments,
    paidInstallments,
    totalInstallments,
    paidRatio: totalInstallments > 0 ? Math.round((paidInstallments / totalInstallments) * 100) : 100,
    hasHistory
  };
}
