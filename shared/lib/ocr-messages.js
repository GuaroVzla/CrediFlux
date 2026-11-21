// Mensajes centralizados de configuración OCR. Se comparten entre el motor,
// la capa de acceso a datos y las API routes para que el fallback sea idéntico
// en cualquier punto del sistema.

export const OCR_NOT_CONFIGURED_CODE = 'OCR_NOT_CONFIGURED';

export const OCR_ADMIN_CONFIG_MESSAGE =
  'El administrador debe configurar el servicio OCR en Ajustes Admin antes de procesar comprobantes.';

export const OCR_ADMIN_KEY_MESSAGE =
  'El administrador debe configurar la API Key del proveedor OCR en Ajustes Admin antes de procesar comprobantes.';
