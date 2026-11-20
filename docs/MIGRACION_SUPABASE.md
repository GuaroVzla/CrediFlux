# Migración de CrediFlux a Supabase

> Estado actual, bloqueos y pasos pendientes: [`docs/ESTADO_MIGRACION.md`](./ESTADO_MIGRACION.md).

Esta guía describe la migración completa desde el almacén JSON/`AppState` de Prisma
hacia **Supabase (PostgreSQL + Auth + RLS)**.

## 1. Arquitectura resultante

| Capa | Ubicación | Responsabilidad |
| --- | --- | --- |
| Esquema relacional | `supabase/schema.sql` y `supabase/migrations/` | Tablas, constraints, índices, RLS, triggers y bucket de comprobantes |
| Cliente navegador | `server/supabase/client.ts` | `createBrowserClient` con la anon key |
| Cliente servidor | `server/supabase/server.ts` | `createServerClient` + cookies de Next.js |
| Cliente admin | `server/supabase/admin.ts` | `service_role`; solo servidor |
| Proxy (Next 16) | `proxy.ts` + `server/supabase/middleware.ts` | Refresco de sesión y bloqueo de `/api/*` sin sesión |
| Auth de request | `server/auth/request-auth.ts` | Resuelve `auth.uid()` + perfil y lo expone a las rutas |
| Adaptador relacional | `server/persistence/supabase-store.ts` | Lee/escribe el dominio por tablas, siempre con `user_id` |
| Servicios tipados | `server/services/rates.ts` | Tasas BCV/Binance P2P e historial P2P |
| Tipos | `shared/types/database.ts` | Tipos generados desde el esquema |
| Migración de datos | `scripts/migrate-json-to-supabase.mjs` | Importa el JSON legado y crea usuarios de Auth |

## 2. Aplicar el esquema

Con Supabase CLI autenticada y el proyecto vinculado:

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```

Alternativa: copiar `supabase/schema.sql` en el **SQL Editor** de Supabase.

Verificación:

```sql
-- Ejecutar supabase/verify_rls.sql
-- Todas las tablas de public deben tener rls_enabled = true
```

## 3. Variables de entorno

Copia `.env.example` a `.env.local` y completa:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
SETTINGS_ENCRYPTION_KEY=<64 caracteres hex>
```

> El proyecto Supabase rechaza las claves JWT legacy (`anon` / `service_role`)
> con `401 Invalid API key`. Usa las claves nuevas `sb_publishable_*` y
> `sb_secret_*` (Settings → API Keys).

En Vercel: **Project Settings → Environment Variables**, para Production, Preview
y Development. La `service_role` nunca debe llevar prefijo `NEXT_PUBLIC_`.

## 4. Autenticación

- El login sigue siendo por **usuario y contraseña** en la UI. Internamente se usa
  el email sintético `usuario@crediflux.local` contra Supabase Auth.
- El registro de operadores lo ejecuta un administrador y crea el usuario en
  `auth.users` con `service_role`; el trigger `handle_new_user` crea el perfil,
  la configuración y los niveles de confianza.
- La sesión viaja en cookies httpOnly gestionadas por `@supabase/ssr`; el
  `proxy.ts` (convención que reemplaza a `middleware.ts` en Next 16) refresca el
  token y devuelve `401` en APIs sin sesión.
- Los roles viven en `public.profiles.role` (`admin`, `operator`, `user`).
- Un trigger impide que un usuario no-admin se auto-asigne rol, licencia o estado.

## 5. RLS y aislamiento

Todas las tablas de negocio tienen `user_id uuid references auth.users(id)` y
cuatro políticas (select/insert/update/delete) con `user_id = auth.uid()`.

- **Admin**: puede leer/editar todos los `profiles` y `audit_logs`, y gestionar
  usuarios. Los datos financieros siguen aislados por usuario.
- **Operador/usuario**: solo ve y modifica sus propios registros.
- **Storage**: bucket privado `receipts`, con rutas `receipts/<auth.uid()>/...`.

## 6. Migrar datos existentes

```bash
node --env-file=.env.local scripts/migrate-json-to-supabase.mjs
```

El script:
1. Lee `data/crediflux-store.json` (o `ricardo-store.json`/`db.json`).
2. Crea los usuarios en Supabase Auth con `BOOTSTRAP_ADMIN_PASSWORD` y
   `BOOTSTRAP_USER_PASSWORD` (o una clave temporal aleatoria).
3. Importa perfiles, clientes, productos, préstamos, cuotas, pagos, e-commerce,
   lista negra y patrones de comprobantes.
4. Convierte ids legados (`cli_...`, `ln_...`) a UUID v5 deterministas para no
   romper relaciones.
5. Cifra las claves de proveedores si `SETTINGS_ENCRYPTION_KEY` está definida.

> Las contraseñas legadas usan `scrypt` y **no** se pueden trasladar a Supabase
> Auth. El admin debe resetear las claves de los operadores tras la importación.

## 7. Precisión financiera

Todos los importes usan `NUMERIC`:

- `numeric(18,2)`: montos, cuotas, capital, precios.
- `numeric(18,8)`: tasas de cambio.
- `numeric(9,4)`: interés porcentual.
- `numeric(18,6)`: USDT.
- `numeric(5,4)`: confianza OCR (0–1).

Las tasas BCV y Binance P2P se guardan como histórico en `exchange_rates`
(insertadas desde el frontend autenticado) y las operaciones VES-USDT en
`p2p_transactions` mediante `/api/p2p-transactions`.

## 8. Despliegue

- **Producción:** <https://crediflux-app.vercel.app> (proyecto Vercel
  `crediflux-app`, rama `main`).
- Variables cargadas en Production, Preview y Development.
- `crediflux.vercel.app` está retenido por otra cuenta de Vercel; ver
  `docs/DESPLIEGUE_VERCEL.md` §2.

```bash
npm run build
npx tsc --noEmit
git add -A
git commit -m "feat: migrar persistencia a Supabase con RLS y auth"
git push origin main
```

Vercel reconstruye automáticamente en cada push a `main`. Para diagnosticar o
reparar la configuración del proyecto:

```powershell
$env:VERCEL_TOKEN = "..."
node scripts/vercel-setup.mjs --project=crediflux-app
node scripts/vercel-setup.mjs --project=crediflux-app --apply
```
