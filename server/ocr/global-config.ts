import 'server-only';

import type { AdminOcrSettingRow, Json } from '@/shared/types/database';
import { getSupabaseAdminClientOrNull } from '@/server/supabase/admin';
import { decryptSecret, encryptSecret, encryptionAvailable, isMaskedSecret } from '@/server/security/security.js';
import { ALLOWED_PROVIDERS, maskKey } from '@/server/settings/settings-shared';
import {
  DEFAULT_AI_ROUTING_RULES,
  DEFAULT_OCR_ENDPOINTS,
  DEFAULT_OCR_MODELS,
  DEFAULT_OCR_THRESHOLDS,
} from '@/server/admin/config.js';
import {
  OCR_ADMIN_CONFIG_MESSAGE,
  OCR_ADMIN_KEY_MESSAGE,
  OCR_NOT_CONFIGURED_CODE,
} from '@/shared/lib/ocr-messages.js';

// -----------------------------------------------------------------------------
// Capa de acceso a la configuración OCR GLOBAL.
//
// Regla de oro: esta configuración sólo se lee/escribe desde el servidor con
// service_role. Ningún registro por usuario (user_settings) participa aquí y
// ninguna API Key en claro sale de este módulo.
// -----------------------------------------------------------------------------

const GLOBAL_ROW_ID = 'global';
const KEY_PROVIDERS = ['openai', 'gemini', 'ocrspace'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AnyRecord = Record<string, any>;

export type GlobalOcrConfig = {
  configured: boolean;
  provider: string | null;
  keys: Record<string, string>;
  hasKeys: Record<string, boolean>;
  maskedKeys: Record<string, string>;
  endpoints: AnyRecord;
  models: AnyRecord;
  thresholds: AnyRecord;
  confidenceMin: number;
  routingRules: AnyRecord;
  autoAssignEnabled: boolean;
  updatedAt: string | null;
};

/** DTO seguro: nunca incluye credenciales, sólo banderas y máscaras. */
export type GlobalOcrDto = Omit<GlobalOcrConfig, 'keys'> & {
  hasAiKey: boolean;
  aiApiKeyMasked: string;
  hasOcrSpaceKey: boolean;
  ocrSpaceKeyMasked: string;
};

export type SaveGlobalOcrInput = {
  aiProvider?: unknown;
  ocrKeys?: unknown;
  aiApiKey?: unknown;
  ocrSpaceApiKey?: unknown;
  ocrEndpoints?: unknown;
  ocrModels?: unknown;
  ocrThresholds?: unknown;
  ocrConfidenceMin?: unknown;
  aiRoutingRules?: unknown;
  aiAutoAssignEnabled?: unknown;
};

export class OcrNotConfiguredError extends Error {
  readonly code = OCR_NOT_CONFIGURED_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'OcrNotConfiguredError';
  }
}

function asObject(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function normalizedProvider(value: unknown): string | null {
  const provider = String(value ?? '').trim().toLowerCase();
  return ALLOWED_PROVIDERS.includes(provider) ? provider : null;
}

function numericInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

async function readRawGlobalOcrConfig(): Promise<AdminOcrSettingRow | null> {
  const admin = getSupabaseAdminClientOrNull();
  if (!admin) return null;

  const { data, error } = await admin
    .from('admin_ocr_settings')
    .select('*')
    .eq('id', GLOBAL_ROW_ID)
    .limit(1);

  if (error) {
    // Un error de esquema/red no debe convertirse en una configuración válida.
    console.error('[global-ocr-config] No se pudo leer la configuración OCR global:', error.message);
    return null;
  }
  return (data?.[0] as AdminOcrSettingRow | undefined) ?? null;
}

export async function readGlobalOcrConfig(): Promise<GlobalOcrConfig | null> {
  const row = await readRawGlobalOcrConfig();
  if (!row) return null;

  const storedKeys = asObject(row.ocr_api_keys);
  const keys: Record<string, string> = {
    openai: decryptSecret(storedKeys.openai) || '',
    gemini: decryptSecret(storedKeys.gemini) || '',
    ocrspace: decryptSecret(storedKeys.ocrspace) || '',
    tesseract: '',
  };

  const provider = normalizedProvider(row.ai_provider);
  const hasKeys: Record<string, boolean> = {};
  const maskedKeys: Record<string, string> = {};
  for (const name of Object.keys(keys)) {
    hasKeys[name] = Boolean(keys[name]);
    maskedKeys[name] = maskKey(keys[name]);
  }

  return {
    configured: Boolean(provider),
    provider,
    keys,
    hasKeys,
    maskedKeys,
    endpoints: { ...DEFAULT_OCR_ENDPOINTS, ...asObject(row.ocr_endpoints) },
    models: { ...DEFAULT_OCR_MODELS, ...asObject(row.ocr_models) },
    thresholds: { ...DEFAULT_OCR_THRESHOLDS, ...asObject(row.ocr_thresholds) },
    confidenceMin: numericInRange(row.ocr_confidence_min, DEFAULT_OCR_THRESHOLDS.ocrConfidenceMin, 0, 1),
    routingRules: { ...DEFAULT_AI_ROUTING_RULES, ...asObject(row.ai_routing_rules) },
    autoAssignEnabled: row.ai_auto_assign_enabled !== false,
    updatedAt: row.updated_at ?? null,
  };
}

export async function readGlobalOcrConfigDto(): Promise<GlobalOcrDto | null> {
  const config = await readGlobalOcrConfig();
  if (!config) return null;

  return {
    configured: config.configured,
    provider: config.provider,
    hasKeys: config.hasKeys,
    maskedKeys: config.maskedKeys,
    endpoints: config.endpoints,
    models: config.models,
    thresholds: config.thresholds,
    confidenceMin: config.confidenceMin,
    routingRules: config.routingRules,
    autoAssignEnabled: config.autoAssignEnabled,
    updatedAt: config.updatedAt,
    hasAiKey: Boolean(config.hasKeys.openai || config.hasKeys.gemini),
    aiApiKeyMasked: config.maskedKeys.openai || config.maskedKeys.gemini || '',
    hasOcrSpaceKey: Boolean(config.hasKeys.ocrspace),
    ocrSpaceKeyMasked: config.maskedKeys.ocrspace || '',
  };
}

/**
 * Guarda la configuración global. Los valores entrantes siguen la semántica:
 * - ausente  => conservar la credencial actual
 * - enmascarado => conservar la credencial actual
 * - ''       => borrar explícitamente la credencial
 * - texto    => reemplazar la credencial
 */
export async function saveGlobalOcrConfig(input: SaveGlobalOcrInput, adminUserId?: string | null): Promise<GlobalOcrDto | null> {
  const admin = getSupabaseAdminClientOrNull();
  if (!admin) {
    throw new Error('Supabase admin no configurado: se requiere service_role para guardar la configuración OCR global.');
  }

  const existing = await readGlobalOcrConfig();
  const nextKeys: Record<string, string> = {
    openai: existing?.keys.openai || '',
    gemini: existing?.keys.gemini || '',
    ocrspace: existing?.keys.ocrspace || '',
    tesseract: '',
  };

  const incoming = asObject(input.ocrKeys);
  for (const provider of KEY_PROVIDERS) {
    if (!Object.prototype.hasOwnProperty.call(incoming, provider)) continue;
    const raw = String(incoming[provider] ?? '').trim();
    if (raw === '') nextKeys[provider] = '';
    else if (isMaskedSecret(raw)) nextKeys[provider] = existing?.keys[provider] || '';
    else nextKeys[provider] = raw;
  }

  const requestedProvider = normalizedProvider(input.aiProvider);
  if (input.aiApiKey !== undefined && String(input.aiApiKey).trim()) {
    const legacyProvider = requestedProvider || (String(input.aiProvider).trim().toLowerCase() as string);
    if (legacyProvider === 'openai' || legacyProvider === 'gemini') {
      nextKeys[legacyProvider] = String(input.aiApiKey).trim();
    }
  }
  if (input.ocrSpaceApiKey !== undefined && String(input.ocrSpaceApiKey).trim() && requestedProvider === 'ocrspace') {
    nextKeys.ocrspace = String(input.ocrSpaceApiKey).trim();
  }

  const storesSecrets = KEY_PROVIDERS.some((provider) => Boolean(nextKeys[provider]));
  if (storesSecrets && !encryptionAvailable()) {
    throw new Error('No se pueden guardar API Keys sin SETTINGS_ENCRYPTION_KEY. Configura la clave de cifrado del servidor e inténtalo de nuevo.');
  }

  let provider = existing?.provider ?? null;
  if (input.aiProvider !== undefined) {
    const parsed = normalizedProvider(input.aiProvider);
    if (!parsed) throw new Error('Proveedor OCR no válido.');
    provider = parsed;
  }

  const previousEndpoints = existing?.endpoints || {};
  const previousModels = existing?.models || {};
  const previousThresholds = existing?.thresholds || {};
  const previousRouting = existing?.routingRules || {};

  const endpoints = { ...DEFAULT_OCR_ENDPOINTS, ...previousEndpoints, ...asObject(input.ocrEndpoints) };
  const models = { ...DEFAULT_OCR_MODELS, ...previousModels, ...asObject(input.ocrModels) };
  const thresholds = { ...DEFAULT_OCR_THRESHOLDS, ...previousThresholds, ...asObject(input.ocrThresholds) };
  const confidenceMin = input.ocrConfidenceMin === undefined
    ? (existing?.confidenceMin ?? DEFAULT_OCR_THRESHOLDS.ocrConfidenceMin)
    : numericInRange(input.ocrConfidenceMin, DEFAULT_OCR_THRESHOLDS.ocrConfidenceMin, 0, 1);
  const routingRules = { ...DEFAULT_AI_ROUTING_RULES, ...previousRouting, ...asObject(input.aiRoutingRules) };
  const autoAssignEnabled = input.aiAutoAssignEnabled === undefined
    ? (existing?.autoAssignEnabled ?? true)
    : Boolean(input.aiAutoAssignEnabled);

  thresholds.ocrConfidenceMin = confidenceMin;

  const encryptedKeys: AnyRecord = { tesseract: '' };
  for (const providerName of KEY_PROVIDERS) {
    encryptedKeys[providerName] = encryptSecret(nextKeys[providerName]);
  }

  const row = {
    id: GLOBAL_ROW_ID,
    ai_provider: provider,
    ocr_api_keys: encryptedKeys as Json,
    ocr_endpoints: endpoints as Json,
    ocr_models: models as Json,
    ocr_thresholds: thresholds as Json,
    ocr_confidence_min: confidenceMin,
    ai_routing_rules: routingRules as Json,
    ai_auto_assign_enabled: autoAssignEnabled,
    updated_by: adminUserId && UUID_RE.test(adminUserId) ? adminUserId : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from('admin_ocr_settings').upsert(row, { onConflict: 'id' });
  if (error) {
    throw new Error(`No se pudo guardar la configuración OCR global: ${error.message}`);
  }
  return readGlobalOcrConfigDto();
}

/**
 * Configuración lista para ejecutar OCR. Falla de forma explícita cuando no
 * existe proveedor o cuando el proveedor activo no tiene credencial.
 */
export async function resolveOcrRuntimeConfig() {
  const config = await readGlobalOcrConfig().catch(() => null);

  if (!config?.configured || !config.provider) {
    throw new OcrNotConfiguredError(OCR_ADMIN_CONFIG_MESSAGE);
  }

  const provider = config.provider;
  const key = provider === 'ocrspace' ? config.keys.ocrspace : config.keys[provider] || '';

  if (provider !== 'tesseract' && !key) {
    throw new OcrNotConfiguredError(OCR_ADMIN_KEY_MESSAGE);
  }

  return {
    provider,
    apiKey: provider === 'ocrspace' ? '' : key,
    ocrSpaceApiKey: provider === 'ocrspace' ? key || null : config.keys.ocrspace || null,
    endpoint: config.endpoints[provider] || undefined,
    model: config.models[provider] || undefined,
    confidenceThreshold: config.confidenceMin,
  };
}
