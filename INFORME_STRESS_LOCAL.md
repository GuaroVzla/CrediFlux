# Informe de prueba de estrés funcional — Staging local (CrediFlux)

**Fecha:** 2026-11-20 · **Rol:** QA / Rendimiento / Arquitectura de datos
**Objetivo seleccionado:** `Local JSON + uploads` (aislado). **No se escribió en Supabase ni en Vercel.**

---

## 1. Alcance y seguridad

| Ítem | Valor |
|---|---|
| Store de escritura | `data/crediflux-store.json` (gitignoreado: `/data/*.json`) |
| Imágenes | `public/uploads/` — **solo lectura**, no se generaron archivos |
| Backup previo | `reports/backups/before-run-qa20261120-1795199704027.json` |
| Modo por defecto | `--dry-run` (requiere `--run` para escribir) |
| Prefijo de registros | `stress_qa20261120_` → eliminables con `--cleanup` |
| Secretos | No se leyó `.env.local`; el reporte no contiene claves ni hashes reales |
| Guardas | Rechaza entornos serverless, ruta distinta al store local y `STRESS_TARGET=supabase` |

El script entregable es `scripts/seed-stress-controlled.mjs` y expone `npm run stress:dry`, `stress:run`, `stress:cleanup`.

---

## 2. Ejecución del seeding

**12,000 registros sintéticos** distribuidos en los 11 módulos del sistema:

| Módulo | Registros | Módulo | Registros |
|---|---:|---|---:|
| users | 240 | blacklist | 360 |
| clients | 2,160 | capitalMovements | 960 |
| products | 960 | exchangeRates | 840 |
| loans | 1,440 | p2pTransactions | 960 |
| payments | 1,920 | **Total** | **12,000** |
| ecommerce | 1,680 | | |
| receiptPatterns | 480 | | |

Los financiamientos generan cuotas reales y los pagos se derivan de esas cuotas (mismo monto y referencia), por lo que no hay saldos ni pagos huérfanos. Los movimientos de capital se generan con saldo neto no negativo por usuario. Los datos son deterministas (PRNG con semilla fija) y los correos/teléfonos/referencias usan dominios y prefijos de prueba.

**Integridad de la corrida final:** 0 problemas en los datos sintéticos; 3 problemas preexistentes (ver §5).

---

## 3. Control estricto de cuota

Parámetros de la corrida: techo `--max-mb 16` MiB, ratio `0.70`.

| Concepto | Bytes | MiB |
|---|---:|---:|
| Techo configurado | 16,777,216 | 16.00 |
| Objetivo (70%) | 11,744,051 | 11.20 |
| Store antes | 19,319 | 0.02 |
| Uploads | 689,409 | 0.66 |
| Presupuesto para datos nuevos | 11,035,323 | 10.52 |
| Store después | 8,800,603 | 8.39 |
| **Total usado después** | **9,490,012** | **9.05 (56.56%)** |

El algoritmo mide el JSON real serializado (no estima a ojo): calcula el delta exacto, y si supera el presupuesto reescala las cantidades y regenera hasta cumplir el 70%.

**Verificación del limitador:** prueba con `--target-records 40000 --max-mb 8` → recortado a **6,831 registros**, total proyectado 5.43 MiB = **67.84%** del techo (`stopReason: quota_clamp_70pct`). Nunca se superó el límite.

Espacio libre real del filesystem: ~41.9 GB (`statfs`), por lo que el techo de 16 MiB es una cuota operativa deliberadamente restrictiva para forzar la prueba de control.

---

## 4. Rendimiento observado

| Métrica | Corrida inicial | Corrida final (corregida) |
|---|---:|---:|
| Registros escritos | 12,000 | 12,000 |
| Lotes (reescrituras del JSON) | 24 | 12 |
| Tiempo total | 1,008.28 ms | **448.73 ms** |
| Promedio por lote | 14.71 ms | 12.08 ms |
| Peak de escritura | 34.41 ms | **27.72 ms** |
| Timeouts / reintentos / errores de escritura | 0 | 0 |
| Advertencias `SLOW_WRITE` (>2 s) | 0 | 0 |
| Lectura inicial del store | 0.76 ms | <1 ms |

No se detectaron timeouts ni fallos de integridad bajo carga. La latencia de escritura crece con el tamaño del archivo porque el store JSON se reescribe por completo en cada lote (comportamiento O(n²)); con lotes adaptativos se redujo a la mitad el número de reescrituras.

---

## 5. Errores encontrados y corregidos

| ID | Severidad | Hallazgo | Evidencia | Acción | Estado |
|---|---|---|---|---|---|
| E-1 | **P2** | Integridad preexistente: `bl_1794622908840` referencia al cliente `cli_1794622620399` y a los préstamos `ln_1794622849120`, `ln_1794622691911`, que no existen en el store | 3 issues `ORPHAN_*` reportados antes y después del seed | Corregido con `npm run stress:repair`: se eliminan las 3 referencias huérfanas y se conserva la entrada como registro histórico (`repair.at`). Backup en `reports/backups/before-repair-*` | **Corregido** (integridad 3→0) |
| E-2 | **P1** | Defecto del script de optimización: al ampliar el lote dinámicamente, el incremento del índice usaba el tamaño nuevo y omitía registros | 1ª corrida optimizada escribió **11,000** de 12,000 (faltaron 800 loans y 200 payments) | Reescrito como `while` que avanza por `batch.length` real + aserción `RECORD_COUNT_MISMATCH` que falla el proceso si los conteos no coinciden | **Corregido y verificado** (12,000/12,000) |
| E-3 | **P2** | Cuello de botella por reescritura completa del JSON (latencia 4.18→34.41 ms) | Curva de latencia por lote | Lotes adaptativos (500→1,500→2,500 según tamaño de archivo), escrituras atómicas con reintentos y backup | **Mitigado** (24→12 lotes, -55% tiempo total) |
| E-4 | — | No hubo errores de serialización, timeouts, reintentos ni fallos de integridad en la corrida final | `errors: []`, `warnings: []`, `postSynthetic: 0` | Sin acción | Sin incidencias |

**Nota sobre cobertura:** la medición cubre la capa de persistencia (lectura, serialización y escritura) y la integridad referencial. No se levantó un servidor HTTP con sesión autenticada, por lo que no se midió el renderizado de pantallas; para esa prueba se requiere un cookieset firmado de staging. Esto se declara explícitamente para no sobreclaimar cobertura.

---

## 6. Capacidad y retención de imágenes

### 6.1 Medición actual (`public/uploads`)

| Métrica | Valor |
|---|---:|
| Archivos | 15 |
| Bytes totales | 689,409 (0.66 MiB) |
| Peso promedio | **45,961 B = 44.88 KiB** |
| Mediana | 43,781 B |
| Mínimo / Máximo | 2,563 B / 67,796 B |

### 6.2 Capacidad según cuota asignada

Se asume una cuota operativa de **1,000 MiB** (`--image-quota-mb 1000`, configurable). Queda **999.34 MiB**.

| Cuota total | Libre | Imágenes al promedio | Imágenes al peor caso (máx. observado) |
|---:|---:|---:|---:|
| 50 MiB | 49.34 MiB | 1,125 | 763 |
| 100 MiB | 99.34 MiB | 2,266 | 1,536 |
| 250 MiB | 249.34 MiB | 5,688 | 3,856 |
| 500 MiB | 499.34 MiB | 11,392 | 7,723 |
| **1,000 MiB** | **999.34 MiB** | **22,799** | **15,456** |

### 6.3 Retención proyectada (cuota 1,000 MiB, promedio 44.88 KiB)

| Imágenes/día | Imágenes/mes | Días de retención | Meses |
|---:|---:|---:|---:|
| 1 | 30 | 22,799 | 760.0 |
| 5 | 150 | 4,559 | 152.0 |
| 10 | 300 | 2,279 | 76.0 |
| 25 | 750 | 911 | 30.4 |
| 50 | 1,500 | 455 | 15.2 |
| 100 | 3,000 | 227 | 7.6 |
| 250 | 7,500 | 91 | 3.0 |

**Fórmula:** `días = floor(libre / peso_promedio / imágenes_por_día)`.
Con el peso máximo observado (67,796 B) la retención se reduce ~33%; úsalo como escenario conservador para SLA de almacenamiento.

---

## 7. Comandos reproducibles

```bash
npm run stress:dry   -- --target-records 12000
npm run stress:run   -- --target-records 12000 --run-id qa20261120
npm run stress:run   -- --target-records 40000 --max-mb 8 --run-id clampcheck   # prueba de recorte
npm run stress:cleanup -- --run-id qa20261120
npm run stress:repair                                   # corrige E-1 (referencias huérfanas)
```

El store local **queda sembrado** con los 12,000 registros para permitir inspección; `stress:cleanup` lo devuelve a su estado original (con backup adicional). El directorio `reports/` está gitignoreado porque contiene backups del store.

---

## 8. Gates after-change

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | OK |
| `npm test` | 74/74 (10 archivos) |
| `npm run build` | OK (17 páginas estáticas, rutas dinámicas compiladas) |
| `git diff --check` | Sin errores (solo avisos LF→CRLF en `.gitignore`/`package.json`) |

**Conclusión:** el seeding controlado cumplió el objetivo con 12,000 registros, sin exceder el 70% de la cuota, sin timeouts ni fallos de integridad sintética. Los hallazgos fueron una condición preexistente de integridad en la lista negra (corregida con `stress:repair`, integridad 3→0) y un cuello de botella de reescritura O(n²) mitigado en el propio script.
