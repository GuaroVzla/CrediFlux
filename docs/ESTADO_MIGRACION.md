# Estado de la migración a Supabase

> Punto de guardado para retomar el trabajo. Última actualización: 2026-11-18.
> Repo: `https://github.com/GuaroVzla/CrediFlux` — rama `main`.
> Proyecto Supabase: `vcsfrmmntmljeikidbkh` (región `us-east-1`).

## 1. Dónde quedamos

| Ítem | Estado |
| --- | --- |
| Código de la migración a Supabase | ✅ implementado y en `main` |
| Esquema aplicado en Supabase | ✅ 2026-11-17 (migración `20261116000100` registrada en `supabase_migrations`) |
| RLS verificado en Supabase | ✅ 14/14 tablas con RLS, 0 tablas sin RLS, políticas activas |
| Aislamiento entre usuarios probado | ✅ ver §10 |
| Tipos TypeScript | ✅ regenerados con la CLI desde el esquema real |
| `tsc --noEmit` | ✅ sin errores |
| `npm run build` | ✅ sin advertencias |
| `next start` (prod local) | ✅ `/api/health` → `mode: supabase`, `encryptionAtRest: true` |
| Login real vía `/api/auth` | ✅ `admin` autenticado contra Supabase Auth |
| Datos legados importados | ✅ 2 usuarios, 1 producto, 1 lista negra, 6 patrones (0 clientes/préstamos/pagos) |
| `.env.local` | ✅ creado (ignorado por git) |
| Variables en Vercel | ✅ cargadas en `crediflux-app` (production, preview, development) |
| Deploy de Vercel | ✅ `https://crediflux-app.vercel.app` operativo con Supabase |

Último commit: `10102 docs: guardar estado y pasos pendientes de la migracion`

## 2. Correcciones de esquema aplicadas hoy

Dos defectos del SQL impedían aplicar la migración (nunca se había ejecutado
contra una base real):

1. **`public.is_admin()` se creaba antes de `public.profiles`.** Con
   `check_function_bodies = on`, Postgres valida el cuerpo de la función y falla
   con `relation "public.profiles" does not exist`. Se movió la función justo
   después de crear la tabla y sus índices.
2. **Colisión de nombre de constraint en `loans`.** La columna
   `down_payment ... check (down_payment >= 0)` genera automáticamente
   `loans_down_payment_check`, que chocaba con la restricción explícita del mismo
   nombre. Se renombró a `loans_down_payment_lte_principal`.

Ambos arreglos están en `supabase/schema.sql` y en la migración (son idénticos).

> Nota: `supabase db push` falla al dividir sentencias dentro de cuerpos `$$`.
> El esquema se aplicó enviando el archivo completo a la Management API
> (`POST /v1/projects/{ref}/database/query`), que lo ejecuta en una sola
> transacción. La migración quedó registrada en
> `supabase_migrations.schema_migrations` y `migration list` muestra
> local = remoto.

## 3. Claves de API

El proyecto **no acepta las claves JWT legacy** (`anon` / `service_role`):
devuelven `401 Invalid API key`. Hay que usar las claves nuevas:

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_...` |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_...` |

`@supabase/supabase-js` 2.119 y `@supabase/ssr` 0.12.7 las soportan sin cambios
de código. En Vercel hay que copiar exactamente esas claves.

## 4. Cuál era el problema de Vercel (resuelto)

El proyecto real es **`crediflux-app`** (antes `proyectoricardo`), vinculado a
`GuaroVzla/CrediFlux` y desplegando `main` correctamente. Dos cosas estaban mal:

1. **`crediflux.vercel.app` lo retiene otro proyecto de otra cuenta de Vercel**
   (`409 owned-on-other-team`). Ese proyecto ajeno es el que devuelve 500 en
   todas las rutas (incluso estáticos); ningún cambio en este repo podía
   arreglarlo. Se estaba validando contra un dominio que no era nuestro.
2. **El proyecto no tenía variables de entorno.** `/api/health` respondía
   `supabaseConfigured: false` y `mode: "json-file"`: la app desplegada corría
   en modo legado sin persistencia (serverless, sin escritura local).

Corregido: variables cargadas en production/preview/development, Node fijado a
`22.x` (estaba en `26.x`), proyecto renombrado, dominio
`crediflux-app.vercel.app` asignado y verificación real.

- Producción: <https://crediflux-app.vercel.app> (alias: `proyectoricardo.vercel.app`)
- `/api/health` → `ok: true`, `mode: supabase`, `encryptionAtRest: true`
- Login `admin` vía `/api/auth` → `200`, cookie de sesión, lecturas con RLS.

Detalle completo en `docs/DESPLIEGUE_VERCEL.md`.

## 5. Qué falta y en qué orden

### A. `crediflux.vercel.app`

Bloqueado por otra cuenta (`owned-on-other-team`); solo lo libera su dueño o el
soporte de Vercel. Texto de reclamación en `docs/DESPLIEGUE_VERCEL.md` §2.
Mientras tanto la URL operativa es `crediflux-app.vercel.app`.

### B. Mantenimiento del deploy

```powershell
$env:VERCEL_TOKEN = "..."
node scripts/vercel-setup.mjs --project=crediflux-app          # diagnóstico
node scripts/vercel-setup.mjs --project=crediflux-app --apply  # config + env + redeploy
```

### C. Pendientes menores

- Cambiar la contraseña del admin (`Lago123*`) y la del operador `RICARDO`
  (temporal: `8d98100d-6e5`); rotar el token de Vercel usado en esta sesión.
- Valorar `BLOB_READ_WRITE_TOKEN` para comprobantes en producción
  (hoy `blobConfigured: false`).
- `data/*.json` ya no es la fuente de verdad: Supabase manda.

## 6. Arquitectura implementada (referencia)

| Capa | Archivo |
| --- | --- |
| Esquema canónico | `supabase/schema.sql` |
| Migración CLI | `supabase/migrations/20261116000100_crediflux_initial_schema.sql` |
| Verificación RLS | `supabase/verify_rls.sql` |
| Cliente navegador | `server/supabase/client.ts` |
| Cliente servidor (cookies) | `server/supabase/server.ts` (`createSupabaseServerClient`, `createSupabaseRouteClient`) |
| Cliente admin (`service_role`) | `server/supabase/admin.ts` |
| Proxy de sesión (Next 16) | `proxy.ts` + `server/supabase/middleware.ts` |
| Resolución de identidad | `server/auth/request-auth.ts` |
| Adaptador relacional | `server/persistence/supabase-store.ts` |
| Servicios tipados | `server/services/rates.ts` |
| Tipos | `shared/types/database.ts` |
| Migración de datos | `scripts/migrate-json-to-supabase.mjs` |
| Diagnóstico | `app/api/health/route.ts` |
| Guía operativa | `docs/MIGRACION_SUPABASE.md` |
| Despliegue Vercel | `docs/DESPLIEGUE_VERCEL.md` + `vercel.json` + `scripts/vercel-setup.mjs` |

## 7. Decisiones tomadas

- Login por usuario/contraseña usando email sintético `usuario@crediflux.local`.
- `getStateForRequest` / `saveStateForRequest` mantienen el *shape* legado del
  estado para no reescribir toda la lógica de negocio.
- Administradores pueden leer/editar todos los `profiles` y `audit_logs`; los
  datos financieros quedan estrictamente aislados por `user_id`.
- El espejo Prisma se desactiva cuando `NEXT_PUBLIC_SUPABASE_URL` está presente
  (`server/admin/config.js`).
- Sin variables de Supabase la app funciona en modo legado (JSON/Prisma) y
  `/api/auth` responde 503, sin cerrar la sesión del usuario.
- El proxy nunca rompe la request: si el refresco de sesión falla, continúa.

## 8. Comandos de comprobación rápida

```powershell
npx tsc --noEmit
npm run build
npx supabase migration list --linked
git log --oneline -6
git status --short
```

## 9. Precisión financiera (ya en el esquema)

- `numeric(18,2)` → montos, cuotas, capital, precios.
- `numeric(18,8)` → tasas de cambio (BCV / Binance P2P).
- `numeric(9,4)` → tasa de interés porcentual.
- `numeric(18,6)` → USDT.
- `numeric(5,4)` → confianza OCR (0–1).

## 10. Verificación de aislamiento (2026-11-17)

Ejecutada contra la API REST con el JWT de cada usuario:

| Prueba | Resultado |
| --- | --- |
| `admin` `GET /profiles` | 2 filas (admin + RICARDO, permitido por su rol) |
| `RICARDO` `GET /profiles` | 1 fila (solo la propia) |
| `admin` `GET /products` | 0 filas (datos financieros aislados por `user_id`) |
| `RICARDO` `GET /products` | 1 fila (el producto importado) |
| `RICARDO` inserta cliente con `user_id` del admin | `403` `new row violates row-level security policy` |
| `RICARDO` lee el perfil del admin por `id` | 0 filas |

## 11. Módulo de Gestión de Capital (Aportes y Retiros) - 2026-11-17

### Modelo de Datos
- Tabla `capital_movements` con campos: `id`, `user_id` (aislamiento estricto), `type` (`APORTE_CAPITAL` | `RETIRO_CAPITAL`), `amount_usd` decimal, `currency_origin` (`USD` | `USDT` | `VES`), `exchange_rate` opcional, `notes`, `created_at`.
- tipos `CapitalMovementType` y `CapitalCurrency` añadidos a los alias en `shared/types/database.ts`.

### Reglas de Cálculo y Aislamiento Contable (Crucial)
- Los movimientos `APORTE_CAPITAL` y `RETIRO_CAPITAL` **NO** se registran como transacciones comerciales ni alteran `Ganancias Netas`.
- `Capital Invertido Neto` = SUM(`APORTE_CAPITAL`) - SUM(`RETIRO_CAPITAL`).
- `Liquidez Disponible` = `Capital Invertido Neto` + `Ganancias Netas` - `Capital Comprometido` (préstamos activos + inventario USDT).
- `Ganancias Netas` permanece intacta ($0 de alteración por aportes o retiros de capital).

### KPIs en el Dashboard
- **Capital Invertido Neto**: tarjeta visual SUM(APORTE) - SUM(RETIRO).
- **Liquidez Disponible**: tarjeta visual `Capital Neto + Ganancias Netas - Capital Comprometido`.
- **ROI Global**: tarjeta visual `(Ganancias Netas / Capital Invertido Neto) × 100`, División por 0 manejada.

### UI / UX
- Botón/modal rápido "Gestionar Capital" con selector de moneda (USD/USDT/VES), cálculo automático de tasa si es VES, y soporte dark/light mode coherente.
- Tabla/historial resumido de los movimientos de capital recientes dentro del panel del Dashboard.
- Aislamiento RLS verificado: cada usuario solo ve y modifica sus propios movimientos.

### Backend API
- `GET /api/capital-movements` - lista movimientos y resumen.
- `POST /api/capital-movements` - registra aporte o retiro (valida tipo, amount > 0, currencyOrigin, rate obligatorio si VES, verifica fondos suficientes para retiros).
- `DELETE /api/capital-movements?id=<id>` - elimina un movimiento (con permiso).

### Scripts y Migración
- Migración `supabase/migrations/20261117000100_capital_movements.sql` aplicada vía Management API.
- `scripts/generate-supabase-types.mjs` regenera tipos de forma reproducible.
- `package.json` → `"db:types": "node scripts/generate-supabase-types.mjs"`.

### Estado por Defecto
- `server/persistence/persistence.js` → `buildDefaultState` incluye `capitalMovements: []`.
- `server/persistence/supabase-store.ts` sincroniza `capital_movements` entre JSON legacy y Supabase.

| Prueba | Resultado |
| --- | --- |
| `admin` → `GET /profiles` | 2 filas (admin + RICARDO, permitido por su rol) |
| `RICARDO` → `GET /profiles` | 1 fila (solo la propia) |
| `admin` → `GET /products` | 0 filas (datos financieros aislados por `user_id`) |
| `RICARDO` → `GET /products` | 1 fila (el producto importado) |
| `RICARDO` inserta cliente con `user_id` del admin | `403` `new row violates row-level security policy` |
| `RICARDO` lee el perfil del admin por `id` | 0 filas |

---

## 18. Almacenamiento de imágenes en Supabase Storage (2026-11-18)

Las imágenes de comprobantes y patrones OCR **ya no dependen de Vercel Blob**
(`BLOB_READ_WRITE_TOKEN` no es necesario). Se guardan en el bucket privado
`receipts` de Supabase Storage (10 MB por archivo, ya creado por la migración
`20261116000100`).

### Diseño

- `server/services/uploads.js` usa `@supabase/supabase-js` con
  `SUPABASE_SERVICE_ROLE_KEY` y sube a `receipts/{userId}/{folder}/{filename}`.
  El primer segmento coincide con `auth.uid()`, tal como exigen las políticas
  RLS del bucket.
- En BD (`ecommerce_transactions.receipt_url`, `receipt_patterns.image_url`) se
  guarda una referencia `supabase://receipts/{path}`, **no** una URL pública.
- Las rutas API convierten esa referencia en **URL firmada** (7 días) antes de
  responder: `resolveUploadUrl()` / `resolveUploadUrls()` (esta última agrupa
  por bucket en una sola llamada `createSignedUrls`).
- Proveedores de respaldo: Vercel Blob y, solo en desarrollo, FS local.
- `persistenceInfo()` reporta `storageProvider: 'supabase-storage'` y
  `storageConfigured: true`.

### Rutas afectadas

- `app/api/ecommerce-handler/route.ts` (GET y POST): pasa `userId` a `saveUpload`
  y resuelve `receiptUrl`.
- `app/api/receipt-patterns/route.js` (GET y POST): ídem para `imageUrl`; DELETE
  usa `deleteUpload`, que ahora borra también en Supabase Storage.

### Validación local (next start :3101, sesión admin)

| Prueba | Resultado |
| --- | --- |
| Upload + OCR + transacción | ✅ 200, `receiptUrl` firmado |
| Descarga de la URL firmada | ✅ 200, 67.796 bytes (idénticos al original) |
| `GET /api/ecommerce` | ✅ devuelve URL firmada vigente |
| Objeto en `storage.buckets` / `storage.objects` | ✅ `receipts/{userId}/uploads/...` |
| Limpieza del objeto de prueba | ✅ eliminado |
| `npm run build` | ✅ sin errores |
