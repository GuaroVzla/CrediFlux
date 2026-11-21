---
name: Multi Module Testing
description: Ejecutar batería completa de pruebas por módulos en proyectos Next.js/TypeScript cuando se pida probar todos los módulos, correr batería completa, auditar cobertura o ejecutar pruebas E2E/unitarias/integración en múltiples carpetas.
---

# multi-module-testing

## Description

Disparador preciso para activar la skill cuando se pida "probar todos los módulos", "correr batería completa", "auditar cobertura" o "ejecutar pruebas E2E/unitarias/integración en múltiples carpetas". Esta skill está diseñada para proyectos full-stack Next.js/TypeScript que carecen de configuración de testing preexistente y requiere Discovery Phase previo para identificar los módulos reales y sus frameworks disponibles.

---

## Fase 1: Descubrimiento Dinámico de Módulos (Zero-Assumptions)

**Objetivo:** Identificar todos los módulos/dominios del proyecto antes de ejecutar cualquier prueba, sin asumir rutas hardcodeadas.

### Instrucciones:

1. **Escanear el árbol de directorios** del proyecto raíz en el siguiente orden:
   - `app/` (rutas y pages de Next.js App Router)
   - `app/api/` (endpoints de API / routes handlers)
   - `components/` (componentes de React)
   - `lib/` (servicios, utilidades, lógica de negocio)
   - `prisma/` (esquemas y client)
   - `supabase/` (funciones y RLS policies)
   - `scripts/` (scripts de utilidad/ migración)

2. **Listar los módulos/dominios reales detectados** y categorizarlos por tipo:
   - `api-routes`: Endpoints handlers (Next.js serverless functions)
   - `client-components`: Componentes UI con estado local
   - `services`: Lógica de servicio (servicios OCR, calculadoras, API clients)
   - `db-models`: Modelos de base de datos (Prisma schemas)
   - `auth`: Flujo de autenticación y autorización
   - `utils`: Funciones auxiliares y helpers

3. **Verificar qué runner o framework de tests está configurado** revisando:
   - `package.json` scripts field (buscar: `test`, `test:e2e`, `vitest`, `jest`, `playwright`, `cypress`)
   - Archivos de configuración: `vitest.config.*`, `jest.config.*`, `playwright.config.*`, `cypress/`
   - Dependencias en `devDependencies`: `vitest`, `jest`, `@playwright/test`, `cypress`
   - Si **no hay framework instalado**, documentarlo y proponer la instalación del mismo

4. **Para cada módulo detectado, anotar:**
   - Ruta archivo principal
   - Tipo de módulo
   - Framework de tests compatible (o "NONE - requiere setup")
   - Scripts de test disponibles (vacío si ninguno)

**Prohibido:** Asumir rutas hardcodeadas. Todo debe derivar del escaneo real del repositorio.

---

## Fase 2: Ejecución Modular por Etapas (Control de Contexto)

**Objetivo:** Ejecutar pruebas existentes y/o generar pruebas faltantes cubriendo happy path, edge cases, validaciones de esquema y manejo de errores, en módulos aislados.

### Flujo secuencial:

1. **Procesar un módulo a la vez** en orden aleatorio o por prioridad (crítico → cosmético).
2. **Para cada módulo:**
   - Ejecutar el comando de test del framework detectado (o indicar que requiere setup).
   - **Si el módulo tiene tests existentes:**
     - Ejecutar `npm run test` o equivalente del framework.
     - Capturar el stack trace exacto de cualquier fallo (archivo:línea).
     - Anotar `PASS`, `FAIL`, o `SKIP` con justificación.
   - **Si el módulo NO tiene tests:**
     - Proponer la creación de un spec mínimo que cubra: happy path + 1 edge case + validación de esquema (si aplica).
     - **NUNCA** crear tests que dependan de datos de producción.
     - Usar datos mockeados o fixtures locales.

3. **Control de contexto:**
   - **Si un módulo falla:** Capturar el stack trace exacto (nombre archivo, número de línea, mensaje de error) y **detener ese módulo** antes de pasar al siguiente.
   - **No saturar la ventana de contexto** con logs irrelevantes. Solo reportar el error técnico conciso.
   - **Avanzar al siguiente módulo** después de haber registrado el fallo del anterior.

4. **Orden de ejecución sugerido:**
   - Módulos críticos (autenticación, flujo de pago/CRUD principal) primero.
   - Módulos de servicio/auxiliares después.
   - Cosméticos y vacíos al final.

---

## Fase 3: Reglas Estrictas y Guardrails (NUNCA)

### Prohibiciones absolutas (sin aprobación explícita del usuario):

| # | Regla | Justificación |
|---|-------|---------------|
| **1** | **NUNCA** modificar código de producción (`src/`, lógica de negocio, migraciones o esquemas de DB) para forzar que una prueba pase. | Rompe el principio de que las pruebas deben validar el comportamiento existente, no invertirlo. |
| **2** | **NUNCA** ejecutar pruebas de escritura/borrado contra bases de datos o APIs de producción. | Exigir entornos mockeados, locales o de test exclusivamente. Usar `--env-file .env.test` o variables de entorno aisladas. |
| **3** | **NUNCA** silenciar, comentar (`skip`) ni eliminar aserciones existentes para obtener un resultado en verde. | Las aserciones validan el contrato; removérlas es ocultar defects. |
| **4** | **NUNCA** omitir un módulo descubierto sin justificarlo en el reporte final. | El descubrimiento es intencional; omitirlo sin razón es un defecto del proceso. |

---

## Fase 4: Reporte Consolidado Final

**Formato de salida estandarizado:**

### Tabla resumen por módulo

| Módulo | Estado [PASS/FAIL/SKIP] | Tests Pasados | Tests Fallidos |
|--------|------------------------|---------------|----------------|
| `auth` | `PASS` | 12 | 0 |
| `api-payments` | `FAIL` | 3 | 1 (timeout en proveedor OCR) |
| `ui-components` | `SKIP` | 0 | 0 (no tiene framework instalado) |
| `products` | `PASS` | 8 | 0 |

### Diagnóstico técnico conciso de cada fallo

**Formato por fallo:**

```
- Módulo: api-payments
- Archivo: server/services/ocr.js:427
- Causa raíz: Timeout de 75s en AbortController al comunicarse con proveedor OpenAI Vision; el worker de Tesseract.js no termina y Vercel corta la función (error 504).
- Evidencia: `npm run test` mostró `AbortError: Tesseract.js excedió el tiempo máximo de espera en 75 s`
- Acción: Configurar timeout menor o cambiar proveedor a Tesseract.js local para recepciones pequeñas.
```

### Lista priorizada de próximos pasos o correcciones sugeridas

1. **P0 (Bloqueante):** Corregir timeout en `ocrEngine.ts` - cambiar a Tesseract.js local para archivos < 1MB.
2. **P1 (Importante):** Instalar framework de tests (Vitest o Jest) y configurar `npm run test`.
3. **P2 (Mejoras):** Añadir tests de integración para flujos de autenticación de extremo a extremo.
4. **P3 (Cosmético):** Agregar tests de borde para validaciones de formato de fechas en módulo `clients`.

---

## Fase 5: Post-Skill - Próximos pasos fuera del scope

1. **Si no había framework instalado:** Ejecutar `npm install -D vitest @types/node` o `npm install -D jest` y reestimar.
2. **Si hay tests FAIL:** Aplicar fixes por P0 antes de considerar el proyecto con calidad de test.
3. **Si todos PASS:** Considerar agregar `npm run test` al `package.json` scripts para CI/CD.
4. **Reportar:** Actualizar la skill `web-qa-final-audit` con los nuevos hallazgos de cobertura.

---

## Comandos de ejecución rápidos (adaptables)

```bash
# Verificar qué framework está disponible (o ninguno)
cat package.json | grep -E '"test"|"vitest"|"jest"|"playwright"'

# Si NO hay framework,propuesta de instalación:
npm install -D vitest @types/node --workdir=.

# Scripts sugeridos para package.json (después de instalar):
# "test": "vitest run",
# "test:unit": "vitest run --dir lib/",
# "test:e2e": "playwright test",

# Ejecutar tests por módulo (un solo módulo a la vez):
# vitest run app/api/auth/route.ts
# vitest run components/Navbar.jsx
```