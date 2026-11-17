# Despliegue en Vercel

> Estado: **roto**. `https://crediflux.vercel.app` devuelve
> `500 FUNCTION_INVOCATION_FAILED` en **todas** las rutas, incluidos
> `/favicon.ico` y archivos estáticos.
> Última comprobación: 2026-11-17 (`x-vercel-id: iad1::...`).

## 1. Diagnóstico rápido

```powershell
$env:VERCEL_TOKEN = "..."        # https://vercel.com/account/tokens
node scripts/vercel-setup.mjs    # solo lectura
```

El script imprime:

- cuenta de Vercel autenticada;
- si existe un proyecto `crediflux` en esa cuenta;
- framework, versión de Node, root directory, comandos y **repo vinculado**;
- qué variables de entorno faltan;
- los últimos 5 deployments con su estado;
- si el último falló, el final de los logs del build.

### Interpretación

| Síntoma en el diagnóstico | Causa probable | Acción |
| --- | --- | --- |
| `No hay ningún proyecto "crediflux"` | el dominio pertenece a otra cuenta/proyecto | entrar con la cuenta correcta o crear proyecto nuevo |
| `repo: SIN VINCULAR` | proyecto desvinculado de GitHub | `--apply` o vincular a mano |
| `framework: other/null` | preset incorrecto (no Next.js) | `--apply` |
| `nodeVersion` distinto de `22.x` | runtime antiguo | `--apply` |
| Faltan variables | runtime sin Supabase → modo legado o error de init | `--apply` |
| Último deployment `ERROR` con logs de build | fallo real de compilación | leer logs |

> Nota: el código compila en CI (`tsc` + `next build` verificados en local el
> 2026-11-17), así que el fallo del deploy es de **configuración del proyecto**,
> no de compilación. El 500 uniforme en estáticos apunta a un deployment
> servido con preset/root/output incorrectos o a un runtime que revienta al
> inicializar.

## 2. Reparación automática

```powershell
$env:VERCEL_TOKEN = "..."
node scripts/vercel-setup.mjs --apply
```

`--apply` hace:

1. `framework = nextjs`, `nodeVersion = 22.x`, `rootDirectory = "."`,
   `buildCommand = npm run build`, `installCommand = npm install`.
2. Sube a **production, preview y development**:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SETTINGS_ENCRYPTION_KEY` (tomadas de `.env.local`).
3. Redespliega el último deployment a producción.

## 3. Variables necesarias

| Variable | Origen | Ámbito |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vcsfrmmntmljeikidbkh.supabase.co` | cliente + servidor |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_...` | cliente |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_...` | **solo servidor** |
| `SETTINGS_ENCRYPTION_KEY` | 64 hex de `.env.local` | servidor |
| `BLOB_READ_WRITE_TOKEN` | opcional (comprobantes) | servidor |

> Las claves JWT legacy del proyecto **no funcionan** (`401 Invalid API key`).
> Usa las claves nuevas `sb_publishable_*` / `sb_secret_*`.

## 4. Checklist de verificación tras el deploy

1. `https://<dominio>/api/health` →
   `{ ok: true, supabaseConfigured: true, persistence: { mode: "supabase", encryptionAtRest: true } }`
2. `/` responde 200 (sin 500 en estáticos).
3. Login con `admin` funciona y se crea cookie de sesión.
4. Alta de cliente + recarga: el registro aparece y persiste.
5. Login con el segundo usuario: no ve datos del admin (RLS).
6. Logs de funciones en Vercel sin `[proxy]` ni `[supabase-store]` en error.

## 5. Notas de configuración

- `vercel.json` fija `framework`, comandos y región `iad1` (misma que el
  proyecto Supabase `us-east-1`).
- `npm run build` ejecuta `prisma generate` antes de `next build`. La CLI
  `prisma` está en `devDependencies`: Vercel las instala en build por defecto,
  pero si el proyecto las omite (`NODE_ENV=production` o `--omit=dev`) el build
  fallará en `prisma generate`.
- Tesseract usa `serverExternalPackages`; las rutas OCR pueden necesitar más
  tiempo de ejecución del que da el plan actual.
