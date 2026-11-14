// Re-exporta la lógica compartida ubicada en la raíz del proyecto.
// Las rutas API relativas (../../lib/trust.js) resuelven dentro de app/lib,
// mientras que el alias @/lib resuelve la raíz. Este puente mantiene una sola fuente.
export * from '../../lib/trust.js';
