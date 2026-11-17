# Despliegue en Vercel

> Estado: **funcionando** desde 2026-11-17.
> Producción: **<https://crediflux-app.vercel.app>**
> `GET /api/health` → `ok: true`, `supabaseConfigured: true`, `mode: supabase`.

## 1. Proyecto y dominios

| Dato | Valor |
| --- | --- |
| Proyecto Vercel | `crediflux-app` (`prj_K5WNYSZxl1QyQMSixyyFZ7lp5qXs`) |
| Equipo | `oswaldo-serrano` (`team_NlYqkM8RwRbvARZwnCN1Nr5l`) |
| Repo | `github:GuaroVzla/CrediFlux`, rama de producción `main` |
| Dominio principal | `crediflux-app.vercel.app` |
| Dominio secundario | `proyectoricardo.vercel.app` (sigue activo) |
| Node | `22.x` (estaba en `26.x`) |
| Región | `iad1` (vía `vercel.json`) |

## 2. `crediflux.vercel.app` (bloqueado)

Ese subdominio **no se puede usar**: pertenece a otro proyecto de otra cuenta de
Vercel. Evidencia recogida el 2026-11-17:

| Prueba | Resultado |
| --- | --- |
| `GET https://crediflux.vercel.app/` | `500 FUNCTION_INVOCATION_FAILED` (existe un deployment allí) |
| `POST /v9/projects/<id>/domains` con ese nombre | `409 owned-on-other-team` |
| `GET /v5/domains/crediflux.vercel.app` | `403 You don't have access` |
| Proyectos visibles en el team | solo el nuestro |

Los subdominios `*.vercel.app` no se pueden reclamar por DNS ni con
verificación TXT: solo se liberan si el **dueño** renombra/elimina su proyecto, o
si **Vercel Support** interviene.

### Reclamación al soporte (<https://vercel.com/help>)

> Soy el propietario del proyecto `crediflux-app` (team `oswaldo-serrano`,
> `prj_K5WNYSZxl1QyQMSixyyFZ7lp5qXs`), desplegado desde
> `github.com/GuaroVzla/CrediFlux`.
>
> El subdominio `crediflux.vercel.app` está asignado a otro proyecto/team
> (`owned-on-other-team`), pero ese deployment devuelve
> `500 FUNCTION_INVOCATION_FAILED` en todas las rutas y no aparece en ninguna
> cuenta a la que tenga acceso (mi login solo muestra el team
> `oswaldo-serrano`).
>
> Solicito: (a) confirmar a qué cuenta pertenece ese proyecto o (b) liberar
> `crediflux.vercel.app` para asignarlo a mi proyecto. Es la marca del producto
> (CrediFlux) y el proyecto que lo retiene está roto.

Si se libera, asignarlo es un solo paso:

```powershell
$env:VERCEL_TOKEN = "..."
# o con la API:
# POST https://api.vercel.com/v9/projects/prj_K5WNYSZxl1QyQMSixyyFZ7lp5qXs/domains
#      { "name": "crediflux.vercel.app" }
```

Alternativa sin depender de Vercel: dominio propio en *Project → Domains*.

## 3. Diagnóstico y reparación

```powershell
$env:VERCEL_TOKEN = "..."          # token de cuenta o de equipo (vcp_...)
node scripts/vercel-setup.mjs                          # diagnóstico (solo lectura)
node scripts/vercel-setup.mjs --project=crediflux-app --apply
```

El script tolera tokens de equipo (no llaman a `/v2/user`), lista los proyectos
visibles si no encuentra el objetivo, muestra framework, Node, repo vinculado,
variables y últimos deployments (con log del build si falló), y con `--apply`:

1. Fija `framework = nextjs`, `nodeVersion = 22.x`, comandos de build/install.
2. Sube las variables de `.env.local` a production, preview y development.
3. Redespliega el último deployment a producción.

## 4. Variables en Vercel

| Variable | Origen | Ámbito |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vcsfrmmntmljeikidbkh.supabase.co` | cliente + servidor |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_...` | cliente |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_...` | **solo servidor** |
| `SETTINGS_ENCRYPTION_KEY` | 64 hex de `.env.local` | servidor |
| `BLOB_READ_WRITE_TOKEN` | opcional (comprobantes) | servidor |

> Las claves JWT legacy del proyecto **no funcionan** (`401 Invalid API key`).
> Usar `sb_publishable_*` / `sb_secret_*`.

## 5. Verificación (2026-11-17)

| Prueba | Resultado |
| --- | --- |
| `GET https://crediflux-app.vercel.app/` | `200` HTML |
| `GET /api/health` | `200`, `mode: supabase`, `encryptionAtRest: true` |
| `POST /api/auth` (`admin`) | `200`, `success: true`, cookie de sesión creada |
| `GET /api/clients` con sesión | `200` (lista negra del admin visible) |
| `https://proyectoricardo.vercel.app/api/health` | `200` (alias secundario) |

## 6. Pendientes

1. Reclamar `crediflux.vercel.app` al soporte (§2) o usar dominio propio.
2. `BLOB_READ_WRITE_TOKEN` si se subirán comprobantes en producción.
3. Rotar contraseñas de usuarios importados y los tokens de Vercel usados aquí.
