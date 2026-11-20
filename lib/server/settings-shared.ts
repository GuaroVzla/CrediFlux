// -----------------------------------------------------------------------------
// Helpers compartidos entre /api/settings y /api/dashboard.
// Al vivir fuera de la ruta, ambos devuelven exactamente el mismo shape sin
// duplicar reglas de enmascarado ni de proveedores permitidos.
// -----------------------------------------------------------------------------

import { INTERNAL_OCR_CONFIG } from '../ocrEngine.js';

export const ALLOWED_PROVIDERS = ['openai', 'gemini', 'ocrspace', 'tesseract'];

export function maskKey(key: string | undefined | null) {
  if (!key) return '';
  const value = String(key);
  if (!value) return '';
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function getStoredOcrKeys(db: any) {
  const s = db?.settings || {};
  const map = (s.ocrApiKeys && typeof s.ocrApiKeys === 'object') ? s.ocrApiKeys : {};
  const legacyAi = typeof s.aiApiKey === 'string' ? s.aiApiKey : '';
  const legacyOcr = typeof s.ocrSpaceApiKey === 'string' ? s.ocrSpaceApiKey : '';
  return {
    openai: typeof map.openai === 'string' && map.openai ? map.openai : legacyAi,
    gemini: typeof map.gemini === 'string' && map.gemini ? map.gemini : legacyAi,
    ocrspace: typeof map.ocrspace === 'string' && map.ocrspace ? map.ocrspace : legacyOcr,
    tesseract: ''
  } as Record<string, string>;
}

export function getInternalLicenseStatus(provider: string) {
  const cfg: any = (INTERNAL_OCR_CONFIG as any)?.[provider];
  if (provider === 'tesseract') {
    return {
      active: true,
      loaded: true,
      label: cfg?.licenseLabel || 'Licencia interna: No requerida (motor local integrado, sin límites de API)',
      providerName: cfg?.name || 'Tesseract.js (Motor Local)'
    };
  }
  return null;
}
