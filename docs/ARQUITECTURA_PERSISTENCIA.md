# Arquitectura de persistencia - Ajustes de Administrador (CrediFlux)

## Objetivo
Garantizar que la configuración del Administrador Maestro (usuarios/licencias, parámetros generales y motor IA/OCR, niveles de confianza y patrones de comprobantes) sea **persistente en Vercel**, **versionada en Git a nivel de esquema** y **sin exponer secretos**.

> **Estado actual (2026-11-20):** la fuente de verdad en producción es `supabase/schema.sql` con `supabase/migrations/*`. Prisma se conserva únicamente como capa legacy opcional (`npm run build` ejecuta `prisma generate` por compatibilidad). Las secciones que describen `AppState`/`DATABASE_URL` son históricas; el runtime activo usa `server/persistence/supabase-store.ts`.

## Componentes implementados

### 1) Esquema versionado (Git)
- `prisma/schema.prisma`: modelo legacy opcional (no es la fuente de verdad en producción; ver nota arriba).
  - Normalizado: `Tenant`, `User`, `License`, `AdminSetting`, `TrustLevelConfig`, `ReceiptPattern`, `SettingAuditLog`.
  - Compatibilidad/persistencia integral: `AppState` (almacena el estado JSON completo en Postgres para que los módulos existentes sigan funcionando en Vercel sin pérdida de datos).
- `prisma/seed.mjs`: seed idempotente de defaults (tenant, `AdminSetting`, niveles de confianza Alta/Media/Riesgosa). No contiene secretos.
- `scripts/migrate-json-to-postgres.mjs`: importa `data/crediflux-store.json` (o legados `ricardo-store.json`/`db.json`) a Postgres (`AppState` + tablas normalizadas).

### 2) Capa de persistencia en runtime
- `server/persistence/persistence.js`
  - Si `DATABASE_URL` está configurado: lee/escribe en Postgres (`AppState`) → **persistente en Vercel**.
  - Si no: fallback a JSON local (`data/crediflux-store.json`, con lectura de legados `ricardo-store.json`/`db.json`) → **solo desarrollo local**.
  - Descifra secretos en memoria al leer y cifra claves de proveedores en reposo al guardar cuando `SETTINGS_ENCRYPTION_KEY` está configurada.
- `server/security/security.js`: utilidades de hardening (hash `scrypt`/verificación y migración de contraseñas legadas; cifrado AES-256-GCM para secretos en reposo).
- `server/admin/config.js`: sincroniza/normaliza el dominio admin hacia tablas Prisma y registra auditoría (`SettingAuditLog`) cuando hay DB.
- `server/persistence/prisma.js`: singleton de `PrismaClient` (seguro para serverless; legacy).

### 3) Almacenamiento de archivos (patrones/imágenes)
- `server/services/uploads.js`
  - Si `BLOB_READ_WRITE_TOKEN` existe: sube a **Vercel Blob** (persistente).
  - Si no: guarda en `public/uploads` (solo local/dev). En Vercel **debe** usarse Blob/almacenamiento externo.

### 4) APIs refactorizadas
- `app/api/settings-handler/route.ts`: parámetros generales, asignación de proveedor IA/OCR, claves por proveedor, niveles de confianza, gestión admin de usuarios/licencias/capital. Persiste vía capa async y sincroniza modelo normalizado.
- `app/api/receipt-patterns/route.js`: CRUD de patrones bancarios con subida persistente de imagen y sincronización normalizada.

## Variables de entorno

Definir en Vercel (Project Settings → Environment Variables) y en `.env.local` para desarrollo con DB. Ver `.env.example`.

- `DATABASE_URL` (requerida en producción/Vercel): cadena de conexión PostgreSQL.
- `DIRECT_URL` (recomendada): conexión directa para `prisma migrate deploy` cuando `DATABASE_URL` usa pooler.
- `BLOB_READ_WRITE_TOKEN` (requerida en producción si se suben patrones/imágenes): token de Vercel Blob.
- `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OCRSPACE_API_KEY`: secretos de proveedores (no commitear).
- `SETTINGS_ENCRYPTION_KEY`: **obligatoria en producción** para cifrado en reposo (AES-256-GCM) de claves de proveedores IA/OCR. Sin esta clave no se garantiza el cifrado en reposo.
- `DEFAULT_TENANT_ID`: tenant por defecto (default: `default`).

**Regla:** los valores reales nunca se commitean; el repo solo incluye `.env.example`.

## Despliegue en Vercel (pasos)

1. Provisionar PostgreSQL administrado (Vercel Postgres / Neon / Supabase) y configurar `DATABASE_URL` (+ `DIRECT_URL`).
2. Provisionar Vercel Blob y configurar `BLOB_READ_WRITE_TOKEN`.
3. Configurar secretos de IA/OCR en Environment Variables.
4. Build: el proyecto ejecuta `prisma generate` en `postinstall/build` y compila Next.js (`npm run build`).
5. Aplicar migraciones en el entorno de base de datos:
   - Crear migración en desarrollo: `npm run db:migrate` (genera `prisma/migrations/*`, versionar en Git).
   - Aplicar en producción/CI: `npm run db:deploy`.
6. (Opcional) Seed de defaults: `npm run db:seed`.
7. (Opcional) Migrar datos JSON existentes: `npm run db:migrate-json`.

> Nota: un redeploy no borra la DB ni el Blob; por eso los ajustes del admin persisten.

## Versionado en Git y seguridad

- **Versionar:** `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/seed.mjs`, código, `.env.example`, esta documentación.
- **No versionar:** `.env*` reales, `data/*.json` runtime, `uploads/`, dumps con datos sensibles (cubierto por `.gitignore`).
- **Protección:** no guardar API keys en Git; en DB persistir solo referencias/estado o valores cifrados; auditar cambios admin en `SettingAuditLog`.

## Dominio cubierto (Ajustes de Administrador)

- **Usuarios y licencias:** `User` + `License` (y campos legacy en estado para compatibilidad UI/API actual).
- **Parámetros generales y motor IA/OCR:** `AdminSetting` (`aiProvider`, `ocrApiKeys`, `aiRoutingRules`, flags, etc.).
- **Niveles de confianza (Alta/Media/Riesgosa):** `TrustLevelConfig` (etiquetas, criterios/umbrales configurables).
- **Patrones de comprobantes bancarios:** `ReceiptPattern` (banco, keywords, formato/regex, imagen en storage, activo).

## Hardening aplicado (estado actual)

- **Contraseñas hasheadas + migración de legado:** las contraseñas nuevas/cambiadas se guardan como hash (`scrypt`); los usuarios/administradores con contraseña en texto plano legado se migran automáticamente a hash en el primer inicio de sesión exitoso o al actualizar la clave. Las APIs de administración ya no exponen contraseñas en claro.
- **Cifrado en reposo de claves de proveedores (IA/OCR):** con `SETTINGS_ENCRYPTION_KEY` configurada, `ocrApiKeys`/`aiApiKey`/`ocrSpaceApiKey` se cifran al persistir (DB/estado) y se descifran en memoria al leer para su uso funcional. En respuestas administrativas se mantienen accesibles para operación/autocompletado, pero el almacenamiento en reposo queda cifrado.
- **Vista previa de claves (Admin):** las credenciales de Supabase Auth y los hash `scrypt` son unidireccionales, por lo que **no es posible recuperar claves preexistentes**. Para claves creadas o reemplazadas desde esta versión se guarda, además del hash, una copia cifrada con AES-256-GCM (`SETTINGS_ENCRYPTION_KEY`) en `profiles.metadata.passwordPreview` (o `passwordEncrypted` en modo legado). `GET /api/settings` nunca incluye esa copia; `POST /api/admin/reveal-password` la desciftra bajo demanda solo para una sesión Admin activa y responde con `Cache-Control: no-store`. El botón de la tabla revela la clave con un clic y la oculta con otro clic (o automáticamente a los 15 segundos); no cancela la petición para evitar `ECONNRESET` en Next 16. Las cuentas con clave solo hasheada responden `available: false / reason: "hash"` hasta que se les cambie la clave.
- **Gestión unificada de claves (Admin):** no existe una clave maestra/de respaldo separada. La contraseña del administrador se cambia únicamente desde **Usuarios del sistema → Editar clave** (`POST /api/settings` con `updateUserAction: 'edit'`) o, para el usuario final, desde **Cambiar Mi Clave** (`POST /api/auth` con `action: 'change_password'`). Ambos flujos actualizan Supabase Auth y la vista previa cifrada; el antiguo campo de Parámetros Generales `adminPassword` fue eliminado para evitar desincronización del espejo `settings.adminPasswordHash`.
- **Base de patrones de comprobantes:** las imágenes nuevas se guardan en el bucket privado `receipts` (`supabase://receipts/{userId}/uploads/patterns/...`) y `GET /api/settings` las convierte en URLs firmadas antes de enviarlas a la UI. Las filas legadas con `/uploads/patterns/*.png` inexistentes se repararon apuntando a los JPEG disponibles en `public/`. El cliente aplica un fallback visual (`/uploads/sample-voucher.svg`) si una URL falla o expira. El CRUD expone `GET/POST/PATCH(PUT)/DELETE`, valida MIME PNG/JPEG/WebP y 10 MB, y solo los patrones con `isActive !== false` intervienen en el OCR. Cada patrón guarda en `extra.visualSignature` un `dHash 9x8` calculado en el navegador a partir de su imagen; al analizar un comprobante se calcula la misma firma y **la comparación visual se ejecuta antes que el OCR de texto**: si hay una coincidencia única suficiente, su `bankName` fija el `bancoOrigen` aunque el texto mencione otro banco. Si no hay coincidencia o hay empate, se mantiene la validación cruzada textual previa.
- **Tesseract.js en Vercel:** los modelos `eng.traineddata`/`spa.traineddata` se versionan en `public/tessdata/`, se sirven como `/tessdata/*` y se incluyen en el bundle de las rutas OCR. El worker usa el core embebido `.wasm.js` y `maxDuration = 300`. Detalle completo en `docs/TESSERACT_VERCEL.md`.
- **Importante:** definir `SETTINGS_ENCRYPTION_KEY` en todos los entornos persistentes antes de operar en producción; rotación de clave requiere proceso de re-cifrado controlado.

> Nota (2026-11-20): el store activo en producción es **Supabase** (`server/persistence/supabase-store.ts`). Prisma queda como capa opcional/legacy y sus migraciones sólo deben aplicarse cuando exista un `DATABASE_URL` apuntando a una base con el esquema `prisma/schema.prisma`. La migración de índices `20261120000000_perf_indexes` se retiró porque sus tablas (`ReceiptPattern`, `SettingAuditLog`) no existen en la base Supabase; los índices de las consultas reales están en `supabase/migrations/20261120000100_perf_indexes.sql`.

## Evolución recomendada

- Completar migración total de rutas restantes para usar tablas normalizadas en lugar de `AppState`.
- Endurecer autenticación/autorización server-side (sesiones/tokens firmados, no confiar en `x-user-id` sin verificación) y añadir pruebas de integración.
- Extender cifrado/hashing a campos sensibles adicionales y políticas de rotación de secretos.
