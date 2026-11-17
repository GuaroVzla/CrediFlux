# Despliegue en Vercel

> Estado: **funcionando** desde 2026-11-17.
> Producción: <https://proyectoricardo.vercel.app>
> `GET /api/health` → `ok: true`, `supabaseConfigured: true`, `mode: supabase`.

## 1. Cuál es el proyecto real

| Dato | Valor |
| --- | --- |
| Proyecto Vercel | `proyectoricardo` (`prj_K5WNYSZxl1QyQMSixyyFZ7lp5qXs`) |
| Equipo | `team_NlYqkM8RwRbvARZwnCN1Nr5l` |
| Repo | `github:GuaroVzla/CrediFlux`, rama de producción `main` |
| Dominio asignado | `proyectoricardo.vercel.app` |
| Node | `22.x` (estaba en `26.x`) |
| Región | `iad1` (vía `vercel.json`) |

### Qué pasaba con `crediflux.vercel.app`

Ese dominio **no pertenece a este proyecto ni a esta cuenta**. Devuelve
`500 FUNCTION_INVOCATION_FAILED` porque es un proyecto distinto (de otra cuenta)
cuyo runtime revienta al inicializar. Ningún cambio en este repo podía
arreglarlo.

Por eso el proyecto real sí desplegaba (`READY`) pero se validaba contra un
dominio ajeno.

### Por qué la app desplegada no usaba Supabase

El proyecto no tenía **ninguna** variable de entorno: `/api/health` respondía
`supabaseConfigured: false` y `mode: "json-file"`, es decir, la app corría en
modo legado sin persistencia (serverless + sin escritura local).

## 2. Diagnóstico y reparación

```powershell
$env:VERCEL_TOKEN = "..."          # token de cuenta o de equipo (vcp_...)
node scripts/vercel-setup.mjs                     # diagnóstico (solo lectura)
node scripts/vercel-setup.mjs --project=proyectoricardo --apply
```

El script tolera tokens de equipo (no llaman a `/v2/user`), lista los proyectos
visibles si no encuentra el objetivo, muestra framework, Node, repo vinculado,
variables y últimos deployments (con log del build si falló), y con `--apply`:

1. Fija `framework = nextjs`, `nodeVersion = 22.x`, comandos de build/install.
2. Sube las variables de `.env.local` a production, preview y development.
3. Redespliega el último deployment a producción.

## 3. Variables en Vercel

| Variable | Origen | Ámbito |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vcsfrmmntmljeikidbkh.supabase.co` | cliente + servidor |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_...` | cliente |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_...` | **solo servidor** |
| `SETTINGS_ENCRYPTION_KEY` | 64 hex de `.env.local` | servidor |
| `BLOB_READ_WRITE_TOKEN` | opcional (comprobantes) | servidor |

> Las claves JWT legacy del proyecto **no funcionan** (`401 Invalid API key`).
> Usar `sb_publishable_*` / `sb_secret_*`.

> `crediflux.vercel.app` es de otra cuenta. No sirve como URL de producción en el
> esquema actual.

## 4. Verificación (2026-11-17)

| Prueba | Resultado |
| --- | --- |
| `GET https://proyectoricardo.vercel.app/` | `200` HTML |
| `GET /api/health` | `200`, `mode: supabase`, `encryptionAtRest: true` |
| `POST /api/auth` (`admin`) | `200`, `success: true`, cookie de sesión creada |
| `GET /api/products` con sesión | `200` |
| `GET /api/clients` con sesión | `200` (lista negra del admin visible) |

## 5. Pendientes

1. Decidir URL definitiva. Opciones:
   - quedarse con `proyectoricardo.vercel.app`;
   - renombrar este proyecto a `crediflux` **solo si** antes se renombra o
     elimina el proyecto antiguo de la otra cuenta que ocupa ese dominio;
   - asignar un dominio propio (`crediflux.com` u otro) en *Project → Domains*.
2. `BLOB_READ_WRITE_TOKEN` si se van a subir comprobantes en producción.
3. Rotar contraseñas de los usuarios importados y el token de Vercel usado aquí.
