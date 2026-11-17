# Despliegue en Vercel

> Estado: **funcionando** desde 2026-11-17.
> Producción activa: <https://proyectoricardo.vercel.app>
> `GET /api/health` → `ok: true`, `supabaseConfigured: true`, `mode: supabase`.

## 1. Cuál es el proyecto real

| Dato | Valor |
| --- | --- |
| Proyecto Vercel | `crediflux` (antes `proyectoricardo`) — `prj_K5WNYSZxl1QyQMSixyyFZ7lp5qXs` |
| Equipo | `oswaldo-serrano` (`team_NlYqkM8RwRbvARZwnCN1Nr5l`) |
| Repo | `github:GuaroVzla/CrediFlux`, rama de producción `main` |
| Dominios del proyecto | `proyectoricardo.vercel.app` |
| Dominio deseado | `crediflux.vercel.app` → **bloqueado por otro equipo** |
| Node | `22.x` (estaba en `26.x`) |
| Región | `iad1` (vía `vercel.json`) |

### Por qué `crediflux.vercel.app` da 500

Ese dominio está asignado a **otro proyecto de otro equipo** de Vercel
(`owned-on-other-team`). Ese proyecto ajeno es el que revienta al inicializar y
devuelve `500 FUNCTION_INVOCATION_FAILED` en todas las rutas, incluidos
estáticos. Ningún cambio en este repo puede arreglarlo.

### Por qué la app desplegada no usaba Supabase

El proyecto no tenía **ninguna** variable de entorno: `/api/health` respondía
`supabaseConfigured: false` y `mode: "json-file"`, es decir, la app corría en
modo legado sin persistencia (serverless + sin escritura local). Corregido.

## 2. Diagnóstico y reparación

```powershell
$env:VERCEL_TOKEN = "..."          # token de cuenta o de equipo (vcp_...)
node scripts/vercel-setup.mjs                     # diagnóstico (solo lectura)
node scripts/vercel-setup.mjs --project=crediflux --apply
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

## 4. Verificación (2026-11-17)

| Prueba | Resultado |
| --- | --- |
| `GET https://proyectoricardo.vercel.app/` | `200` HTML |
| `GET /api/health` | `200`, `mode: supabase`, `encryptionAtRest: true` |
| `POST /api/auth` (`admin`) | `200`, `success: true`, cookie de sesión creada |
| `GET /api/products` con sesión | `200` |
| `GET /api/clients` con sesión | `200` (lista negra del admin visible) |

## 5. Cómo liberar `crediflux.vercel.app`

Pasos manuales (requieren entrar con la **otra** cuenta de Vercel, la que creó
ese proyecto):

1. Inicia sesión en Vercel con la cuenta/equipo dueño de
   `crediflux.vercel.app` (no es el team `oswaldo-serrano`).
2. Localiza el proyecto llamado `crediflux` (es el que responde 500).
3. Renómbralo (p. ej. `crediflux-legacy`) o elimínalo. Eso libera el dominio.
4. Avisa y se ejecuta:

   ```powershell
   $env:VERCEL_TOKEN = "..."
   node scripts/vercel-setup.mjs --project=crediflux --apply
   # o solo el dominio:
   # POST https://api.vercel.com/v9/projects/<id>/domains { "name": "crediflux.vercel.app" }
   ```

5. Validar `https://crediflux.vercel.app/api/health`.

Alternativa: asignar un dominio propio (`crediflux.com`, etc.) en
*Project → Domains*, que no depende de nombres de proyecto.

## 6. Pendientes

1. Liberar el dominio (§5) o usar dominio propio.
2. `BLOB_READ_WRITE_TOKEN` si se subirán comprobantes en producción.
3. Rotar contraseñas de usuarios importados y el token de Vercel usado aquí.
