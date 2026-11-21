# Auditoría QA Final — CrediFlux

- **Fecha:** 2026-11-20
- **Rama:** `main` (alineada con `origin/main` antes de los cambios)
- **Alcance:** UI (`app/page.jsx`), 21 rutas API, autenticación/Supabase, cálculos contables, filtros/tablas, compilación y pruebas.
- **Exclusiones:** ejecución contra Supabase hosted, flujo E2E autenticado, pruebas de carga, Lighthouse/axe en navegador. No se leyó `.env.local` ni `supabase/.temp/*`.
- **Entorno:** Next.js 16.4.6 (Turbopack), React 19.3.1, TypeScript, Vitest 5.1.1, Playwright, Testing Library/jsdom.

## Estado: APROBADO PARA DESPLIEGUE (P0 cerrado)

El bloque P0 quedó resuelto y verificado. Quedan riesgos P1/P2 documentados que no bloquean el despliegue pero requieren seguimiento. **Condición de despliegue:** Supabase configurado y `SESSION_SIGNING_SECRET` o `SETTINGS_ENCRYPTION_KEY` presente en el servidor; de lo contrario el sistema falla cerrado (401 en `/api/*`, 503 en acciones legadas).

## Correcciones aplicadas

### Bloque P0

| ID | Archivos | Corrección |
|----|----------|------------|
| P0-1 | `lib/supabase/env.ts`, `lib/db.js`, `lib/server/request-auth.ts`, `proxy.ts`, `lib/supabase/middleware.ts`, `app/api/auth/route.js` | Modo legacy limitado a dev/test mediante `isLegacyAuthAllowed()`. `x-user-id` se ignora en producción; `checkWritePermission` y `resolveRequestAuth` fallan cerrado. `proxy.ts` y `middleware.ts` devuelven 401 en `/api/*` ante errores o Supabase no configurado. `change_password`, `activate_license`, `register` y `generate_license` exigen usuario/autorización; el login legacy se bloquea en producción. |
| P0-2 | `lib/supabase/middleware.ts`, `.env.example`, `scripts/vercel-setup.mjs` | HMAC con secreto de servidor (`SESSION_SIGNING_SECRET` → `SETTINGS_ENCRYPTION_KEY`), sin anon key ni literal en producción. Firma con contexto por cookie, comparación en tiempo constante, rechazo de timestamps futuros y rotación forzada de cookies `cf_*`. |
| P0-3 | 10 archivos `*.test.ts` | Sustituidos 45 tests tautológicos por **74 tests reales** que importan y ejercen el código, con cobertura específica de los controles P0. |

### Defectos confirmados corregidos durante la auditoría

| ID | Archivo | Problema → corrección |
|----|---------|----------------------|
| FIX-01 | `app/api/capital-movements/route.js`, `lib/server/dashboard-builders.ts` | `summarize()`/`scopeRecords()` usados sin importar → `ReferenceError` en POST/DELETE. Se exportó `summarize` y se añadieron los imports. |
| FIX-02 | `app/api/payments/route.js` | Montos negativos, cuotas ya pagadas y pagos totales parciales marcaban cuotas como pagadas. Validación `>0`, coincidencia ±0.01 y estado `paid` → 400/409. |
| FIX-03 | `app/page.jsx` | Página interna obsoleta tras borrados: se sincroniza `page` con `safePage` durante el render. |
| FIX-04 | `lib/supabase/middleware.ts` | Cookies sin firma y timestamps futuros extendían la sesión: firma obligatoria, formato `\d+`, rechazo de `> now + 60s`. |
| FIX-05 | `app/api/auth/route.js`, `app/page.jsx` | Logout falso: se verifica el error de `signOut()`, se expiran cookies `cf_*` en servidor y el frontend refleja el resultado real. |
| FIX-06 | `lib/ocrEngine.js` | `parseVenezuelanNumber(-5)` devolvía `-5` mientras `'-5'` devolvía `0`. Se unificó la validación de rango/positividad. |

## Hallazgos pendientes (P1/P2, no bloqueantes)

- **P1:** falta validación `zod` centralizada en las rutas API; el resultado de `saveStateForRequest` se ignora en varios handlers; mensajes de error con detalle interno en algunas rutas; sin rate limiting ni validación de Origin/CSRF.
- **P1:** formularios CRUD de cliente/préstamo/producto sin `try/catch` ni estado `saving` en `app/page.jsx`.
- **P2:** endpoints duplicados por rewrites (`/api/products`, `/api/ecommerce`, `/api/settings`); búsquedas sin normalizar acentos; empty states y leyendas de orden inconsistentes; `tsconfig.json` con `strict: false`.
- **NO VERIFICADO:** políticas RLS realmente desplegadas en Supabase hosted (ejecutar `supabase/verify_rls.sql`); valores efectivos de variables de entorno en producción.

## Auditoría de cálculos (resumen)

| Métrica | Resultado |
|---------|-----------|
| Préstamo `total = base + base·tasa/100 − inicial` | Consistente UI/API; el interés se calcula sobre `base` completo (regla de negocio actual). |
| Ganancia financiera `Σ pago·(projected/total)` | Consistente entre dashboard y cartera, con guardia `total>0`. |
| Ganancia e-commerce `ventas − compras` | Consistente; el capital se trata como patrimonio, no como gasto. |
| Capital `aportes − retiros`, retiro > neto → 409 | Correcto tras FIX-01. |
| Cuotas `round(total/count, 2)` | Pueden no sumar exactamente `totalAmount` (p. ej. 33.33×3). Riesgo menor documentado. |
| Divisiones por cero / NaN / Infinity | Sin casos sin guardia en las 12 fórmulas revisadas. |

## Checklist final de compilación

| Gate | Comando | Resultado |
|------|---------|-----------|
| Tipado | `npx tsc --noEmit` | ✅ 0 errores |
| Tests unitarios/integración | `npm test` | ✅ 24 archivos, 153/153 |
| Tests E2E smoke | `npm run test:e2e` | ✅ 1 archivo, 2/2 (Chromium + `next start`) |
| Build | `npm run build` | ✅ Compilado sin errores |
| Whitespace | `git diff --check` | ✅ Sin errores (sólo aviso LF→CRLF en `app/page.jsx`) |
| Lint | — | No configurado (sin script ESLint/Biome) |

## Ampliación de cobertura (2026-11-20)

Se ejecutó el skill `multi-module-testing` y se aplicaron sus próximos pasos:

| Paso | Acción | Resultado |
|------|--------|-----------|
| P1 | Specs nuevos para `api-clients`, `api-products`, `api-capital` y `api-dashboard` | ✅ 24 tests nuevos, mocks locales, sin BD/API de producción |
| P2 | Playwright + smoke público (`landing` y `/api/health`) | ✅ 2 tests E2E en Chromium contra `next start` local |
| P3 | Testing Library/jsdom para `LoanCreateModal`, `LoanEditModal`, `usePaginationController` y `useDebouncedValue` | ✅ 16 tests nuevos |
| P4 | CI con gate E2E opcional (`vars.RUN_E2E` o `workflow_dispatch`) | ✅ `.github/workflows/ci.yml` actualizado |
| P5 | Consolidación en esta auditoría | ✅ 153/153 unitarios + 2/2 E2E |

### Módulos que pasaron de `SKIP` a `PASS`

- `api-clients`: alta/edición, validación de campos obligatorios, borrado con archivado de financiamientos y 401.
- `api-products`: cálculo por margen y por precio manual, validación de nombre, borrado y 401.
- `api-capital`: aporte USD, validación de tasa VES, retiro sobre capital neto, tipos inválidos y borrado.
- `api-dashboard`: respuesta de los siete bloques, firma de URLs en un lote, modo dinámico y 401.
- `componentes UI`: render, callbacks, estado `saving`, bloqueo de tasa sugerida y envío de formularios.
- `hooks`: paginación con clamp/reset y debounce con timers falsos.

### Pendiente

- E2E autenticado (login → crear financiamiento → abono → cronograma) requiere un entorno de test con datos semilla y credenciales aisladas; no se ejecuta contra producción.
- La skill `web-qa-final-audit` no está disponible en esta sesión; esta auditoría sirve como registro consolidado.
