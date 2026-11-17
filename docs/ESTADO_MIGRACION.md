# Estado de la migración a Supabase

> Punto de guardado para retomar el trabajo. Última actualización: 2026-11-17.
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
| Variables en Vercel | ❌ no configuradas |
| Deploy de Vercel | ❌ `crediflux.vercel.app` responde 500 `FUNCTION_INVOCATION_FAILED` en **todas** las rutas, incluidos estáticos |

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

## 4. Bloqueos conocidos

Solo queda Vercel:

1. **Vercel no parece enlazado a este repo.**
   La API de GitHub no registra *deployments* ni *check-runs* de Vercel para
   ninguno de los commits recientes. El 500 aparece incluso en archivos
   estáticos (`/uploads/sample-voucher.svg`), lo que descarta un fallo de
   código: es un deployment/proyecto roto o desvinculado.

## 5. Qué falta y en qué orden

### A. Configurar variables en Vercel

En *Project Settings → Environment Variables*, para **Production, Preview y
Development**:

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vcsfrmmntmljeikidbkh.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_...` |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_...` |
| `SETTINGS_ENCRYPTION_KEY` | 64 caracteres hex (la de `.env.local`) |

### B. Reparar / reconectar Vercel

1. Vercel → *Project Settings → Git* → vincular `GuaroVzla/CrediFlux`
   (rama de producción: `main`).
2. *General*: Framework = Next.js, Root Directory = `.`, Node = **22.x**
   (`package.json` ya exige `>=20.9.0`).
3. Revisar el build más reciente y sus logs; el código compila en CI, por lo que
   cualquier fallo restante será de configuración del proyecto.
4. Tras el deploy, validar:
   - `https://<dominio>/api/health` → `{ ok: true, supabaseConfigured: true }`
   - Login real y CRUD con dos usuarios (aislamiento RLS).

### C. Pendientes menores

- Cambiar la contraseña del admin (`Lago123*`) y la del operador `RICARDO`
  (temporal: `8d98100d-6e5`).
- Valorar `BLOB_READ_WRITE_TOKEN` para comprobantes en producción
  (hoy `blobConfigured: false`).
- `data/*.json` ya no es la fuente de verdad: Supabase manda.

## 6. Arquitectura implementada (referencia)

| Capa | Archivo |
| --- | --- |
| Esquema canónico | `supabase/schema.sql` |
| Migración CLI | `supabase/migrations/20261116000100_crediflux_initial_schema.sql` |
| Verificación RLS | `supabase/verify_rls.sql` |
| Cliente navegador | `lib/supabase/client.ts` |
| Cliente servidor (cookies) | `lib/supabase/server.ts` (`createSupabaseServerClient`, `createSupabaseRouteClient`) |
| Cliente admin (`service_role`) | `lib/supabase/admin.ts` |
| Proxy de sesión (Next 16) | `proxy.ts` + `lib/supabase/middleware.ts` |
| Resolución de identidad | `lib/server/request-auth.ts` |
| Adaptador relacional | `lib/server/supabase-store.ts` |
| Servicios tipados | `lib/services/rates.ts` |
| Tipos | `lib/supabase/database.types.ts` |
| Migración de datos | `scripts/migrate-json-to-supabase.mjs` |
| Diagnóstico | `app/api/health/route.ts` |
| Guía operativa | `docs/MIGRACION_SUPABASE.md` |

## 7. Decisiones tomadas

- Login por usuario/contraseña usando email sintético `usuario@crediflux.local`.
- `getStateForRequest` / `saveStateForRequest` mantienen el *shape* legado del
  estado para no reescribir toda la lógica de negocio.
- Administradores pueden leer/editar todos los `profiles` y `audit_logs`; los
  datos financieros quedan estrictamente aislados por `user_id`.
- El espejo Prisma se desactiva cuando `NEXT_PUBLIC_SUPABASE_URL` está presente
  (`lib/server/admin-config.js`).
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
| `admin` → `GET /profiles` | 2 filas (admin + RICARDO, permitido por su rol) |
| `RICARDO` → `GET /profiles` | 1 fila (solo la propia) |
| `admin` → `GET /products` | 0 filas (datos financieros aislados por `user_id`) |
| `RICARDO` → `GET /products` | 1 fila (el producto importado) |
| `RICARDO` inserta cliente con `user_id` del admin | `403` `new row violates row-level security policy` |
| `RICARDO` lee el perfil del admin por `id` | 0 filas |
