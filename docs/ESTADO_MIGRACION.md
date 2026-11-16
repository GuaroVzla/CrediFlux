# Estado de la migración a Supabase

> Punto de guardado para retomar el trabajo. Última actualización: 2026-11-16.
> Repo: `https://github.com/GuaroVzla/CrediFlux` — rama `main`.

## 1. Dónde quedamos

| Ítem | Estado |
| --- | --- |
| Código de la migración a Supabase | ✅ implementado y en `main` |
| Tipos TypeScript | ✅ `lib/supabase/database.types.ts` (generados a mano desde el esquema; **pendiente regenerar** con la CLI) |
| `tsc --noEmit` | ✅ sin errores |
| `npm run build` | ✅ sin advertencias |
| `next start` (prod local) | ✅ `/` → 200, `/api/health` → 200 |
| CI en GitHub Actions | ✅ [`run 43904730389`](https://github.com/GuaroVzla/CrediFlux/actions/runs/43904730389) |
| Esquema aplicado en Supabase | ❌ **no aplicado** (faltan credenciales) |
| RLS verificado en Supabase | ❌ pendiente |
| `.env.local` | ❌ no existe |
| Variables en Vercel | ❌ no configuradas |
| Deploy de Vercel | ❌ `crediflux.vercel.app` responde 500 `FUNCTION_INVOCATION_FAILED` en **todas** las rutas, incluidos estáticos |

Último commit: `fc7e3 fix(build): declarar server-only y actualizar acciones de CI`

## 2. Bloqueos conocidos

1. **Supabase CLI sin sesión.**
   `npx supabase projects list` devuelve `AccessTokenRequiredError`.
   No existe `%USERPROFILE%\.supabase\access-token`.

2. **Sin credenciales del proyecto Supabase** (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).

3. **Vercel no parece enlazado a este repo.**
   La API de GitHub no registra *deployments* ni *check-runs* de Vercel para
   ninguno de los commits recientes. El 500 aparece incluso en archivos
   estáticos (`/uploads/sample-voucher.svg`), lo que descarta un fallo de
   código: es un deployment/proyecto roto o desvinculado.

## 3. Qué falta y en qué orden

### A. Aplicar el esquema en Supabase

```powershell
cd C:\Proyectos\CrediFlux
npx supabase login
npx supabase projects list                 # confirmar PROJECT_REF
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push                       # aplica supabase/migrations/*
```

Verificación (SQL Editor de Supabase):

```sql
-- Copiar y ejecutar supabase/verify_rls.sql
-- Comprobar: rls_enabled = true en las 14 tablas y 4 políticas por tabla de negocio
```

### B. Regenerar los tipos reales

```powershell
npx supabase gen types typescript --linked --schema public > lib/supabase/database.types.ts
npx tsc --noEmit     # tras regenerar, revisar si hay que ajustar los Row
```

### C. Variables de entorno

1. `Copy-Item .env.example .env.local` y completar:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SETTINGS_ENCRYPTION_KEY` (obligatoria en producción)
2. En Vercel → *Project Settings → Environment Variables*, para
   **Production, Preview y Development**.

### D. Importar los datos legados

```powershell
node --env-file=.env.local scripts/migrate-json-to-supabase.mjs
```

- Lee `data/crediflux-store.json` (o `ricardo-store.json` / `db.json`).
- Crea los usuarios en Supabase Auth con email sintético
  `usuario@crediflux.local`.
- Usa `BOOTSTRAP_ADMIN_PASSWORD` / `BOOTSTRAP_USER_PASSWORD`; si no están
  definidas genera una temporal y la imprime.
- Convierte ids legados (`cli_...`, `ln_...`) a UUID v5 deterministas.
- **Las contraseñas legadas (`scrypt`) no se migran**: hay que resetearlas.

### E. Reparar / reconectar Vercel

1. Vercel → *Project Settings → Git* → vincular `GuaroVzla/CrediFlux`
   (rama de producción: `main`).
2. *General*: Framework = Next.js, Root Directory = `.`, Node = **22.x**
   (`package.json` ya exige `>=20.9.0`).
3. Revisar el build más reciente y sus logs; el código compila en CI, por lo que
   cualquier fallo restante será de configuración del proyecto.
4. Tras el deploy, validar:
   - `https://<dominio>/api/health` → `{ ok: true, supabaseConfigured: true }`
   - Login real y CRUD con dos usuarios (aislamiento RLS).

## 4. Arquitectura implementada (referencia)

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

## 5. Decisiones tomadas

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

## 6. Comandos de comprobación rápida

```powershell
npx tsc --noEmit
npm run build
git log --oneline -6
git status --short
```

## 7. Precisión financiera (ya en el esquema)

- `numeric(18,2)` → montos, cuotas, capital, precios.
- `numeric(18,8)` → tasas de cambio (BCV / Binance P2P).
- `numeric(9,4)` → tasa de interés porcentual.
- `numeric(18,6)` → USDT.
- `numeric(5,4)` → confianza OCR (0–1).
