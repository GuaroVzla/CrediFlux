# CrediFlux | Plataforma SaaS de Financiamiento, E-Commerce & IA

Plataforma SaaS financiera de alta gama, moderna y privada diseñada para la administración integral de préstamos de capital, financiamiento de equipos (smartphones, computación, movilidad), control de cartera de cobranza y registro financiero de compras/ventas con procesamiento inteligente de comprobantes mediante OCR e Inteligencia Artificial Multimodal.

---

## 🚀 Tecnologías Utilizadas

- **Framework:** [Next.js](https://nextjs.org/) (App Router, Server-side API Routes y Server Actions)
- **Frontend / SPA:** [React](https://react.dev/) + [Tailwind CSS](https://tailwindcss.com/)
- **Iconografía:** [Lucide React](https://lucide.dev/)
- **Persistencia de Datos:** Supabase (PostgreSQL) con Row Level Security, Supabase Auth y aislamiento estricto por `auth.uid()`. Ver `docs/MIGRACION_SUPABASE.md`.
- **OCR & Visión por Computadora:** Módulo multimodal con soporte para OpenAI, Google Gemini y OCR.space con validación cruzada y extracción de tasas BCV / Binance P2P.

---

## 🌐 Producción

| Recurso | URL |
| --- | --- |
| Aplicación | <https://crediflux-app.vercel.app> |
| Health check | <https://crediflux-app.vercel.app/api/health> → `{ ok: true, mode: "supabase" }` |

- Proyecto Vercel: `crediflux-app` (team `oswaldo-serrano`), rama `main`.
- Base de datos: Supabase (`vcsfrmmntmljeikidbkh`) con RLS y Auth.
- Alias secundario: `proyectoricardo.vercel.app`.
- Guía de despliegue y diagnóstico: [`docs/DESPLIEGUE_VERCEL.md`](docs/DESPLIEGUE_VERCEL.md).

---

## 🔐 1. Seguridad y Acceso Privado

- **Licencia Privada de Uso:** Acceso protegido mediante clave de licencia (`CREDIFLUX-FINTECH-2026`) o credenciales de administrador.
- **Sesión Persistente:** Cookies httpOnly gestionadas por `@supabase/ssr` y refrescadas en `proxy.ts`.
- **Gestión de Acceso:** Cambio de contraseña en caliente y administración centralizada de operadores.
- **Credenciales Iniciales:**
  - **Licencia:** `CREDIFLUX-FINTECH-2026`
  - **Usuario:** `admin`
  - **Contraseña:** `admin123`

---

## 📊 2. Módulos y Características

### 1. Dashboard & KPIs Generales
- **Capital Prestado Activo:** Monto total colocado en el mercado en tiempo real.
- **Ganancias Proyectadas y Cobradas:** Visualización del margen de interés generado y cobrado.
- **Deudores Activos y Morosos:** Conteo de clientes en cobro y en mora.
- **Alertas Visuales:** Notificación destacada de cuotas próximas a vencer (< 72 horas) y cuotas vencidas.
- **Transacciones de E-Commerce:** Métrica global de operaciones registradas.

### 2. Gestión de Clientes
- Registro con Nombre, Cédula / DNI, Teléfono móvil, Dirección y Nivel de Confianza (*Alto / VIP*, *Medio*, *Riesgoso*).
- **Límite de Crédito:** Configuración personalizada de monto máximo de financiamiento por cliente.
- **Récord Crediticio:** Historial interactivo de préstamos, cuotas pagadas y cumplimiento.

### 3. Catálogo de Equipos / Costos
- Registro de productos a financiar (Smartphones, Laptops, Motos, etc.).
- Cálculo automático del margen de ganancia en monto (`$`) y en porcentaje (`% ROI`).
- Control de inventario y stock disponible.

### 4. Administración de Financiamientos & Préstamos
- Creación de créditos asociando clientes a equipos del catálogo o dinero en efectivo/transferencia.
- Definición de enganche/inicial, cuotas, periodicidad (*semanal*, *quincenal*, *mensual*), tasa de interés (%) y fecha de inicio.
- **Generador de Cronograma:** Cálculo automático de fechas de vencimiento y amortización.
- **Control de Riesgo:** Advertencia visual si el financiamiento excede el límite asignado al cliente.

### 5. Control de Deudores & Barras de Estado
- **Semáforo Visual en Tiempo Real:**
  - 🟢 **Verde (Al día):** Todas las cuotas pagadas a la fecha.
  - 🟡 **Amarillo (Próximo a vencer):** Cuota por vencer en menos de 72 horas.
  - 🔴 **Rojo (Moroso / Atrasado):** Cuota con fecha de vencimiento superada.
  - 🔵 **Azul (Completado):** Préstamo 100% amortizado.
- **Barra de Progreso:** Visualización del porcentaje de cuotas pagadas vs. pendientes.
- **Botón de Abono Rápido:** Permite registrar cobros de cuotas al instante con método de pago (Pago Móvil, Zelle, Efectivo, Transferencia) y número de referencia.

### 6. Comercio Electrónico & OCR Inteligente
- Input de tipo archivo (`<input type="file" />`) con drag-and-drop y previsualización.
- Envío automático a la API de backend (`/api/ecommerce`).
- **Análisis con Visión IA:** Extrae automáticamente monto, fecha, referencia bancaria y banco emisor.
- Almacenamiento seguro del archivo en `public/uploads/`.
- **Cálculo de Rentabilidad Financiera:**
  - Capital Asignado (editable desde Ajustes).
  - Total Compras (egresos por adquisición de mercancía).
  - Total Ventas (ingresos por ventas y cobros).
  - Ganancia neta calculada (`Total Ventas - Total Compras`).
  - Margen de Retorno sobre Capital (`% ROI`).

---

## 🛠️ Puesta en Marcha (Instalación Local o Servidor)

### Requisitos Previos
- **Node.js** v18 o superior instalado en el equipo.

### Paso 1: Clonar o Situarse en la Carpeta
```bash
cd "<ruta-del-proyecto>/CrediFlux"
```

### Paso 2: Instalar Dependencias (si es una nueva instalación)
```bash
npm install
```

### Paso 2.1: Configurar Supabase
```bash
cp .env.example .env.local
# completa NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
# opcional: importar datos existentes
node --env-file=.env.local scripts/migrate-json-to-supabase.mjs
```

### Paso 3: Modo Desarrollo
Para ejecutar la aplicación con recarga en caliente:
```bash
npm run dev
```
Abre tu navegador en: **`http://localhost:3000`**

### Paso 4: Modo Producción (Recomendado para uso diario)
Para compilar y correr el servidor optimizado:
```bash
npm run build
npm run start
```

---

## 📁 Estructura del Proyecto

```
CrediFlux/
├── app/
│   ├── api/
│   │   ├── auth/          # Login, sesión y registro
│   │   ├── clients/       # CRUD de clientes y récord crediticio
│   │   ├── ecommerce/     # Upload de captures, OCR y balance
│   │   ├── loans/         # Financiamientos, cuotas y límites
│   │   ├── payments/      # Registro rápido de abonos
│   │   ├── products/      # Catálogo y cálculo de margen
│   │   └── settings/      # Configuración de empresa, capital y claves
│   ├── globals.css        # Estilos globales y Tailwind CSS
│   ├── layout.jsx         # Layout principal con tema oscuro/claro
│   └── page.jsx           # SPA interactiva completa de alta fidelidad
├── lib/
│   ├── supabase/          # Clientes browser/server/admin, middleware y database.types.ts
│   ├── server/            # supabase-store.ts, request-auth.ts, seguridad y persistencia legada
│   ├── services/          # Servicios tipados (tasas BCV/P2P)
│   ├── db.js              # Reglas de negocio y semáforo de deudores
│   └── ocr.js             # Motor de visión multimodal (OpenAI / Gemini / OCR.space / Heurístico)
├── supabase/
│   ├── schema.sql         # Esquema relacional + RLS + triggers
│   ├── migrations/        # Migraciones aplicables con Supabase CLI
│   └── verify_rls.sql     # Consultas de verificación de RLS
├── scripts/
│   └── migrate-json-to-supabase.mjs # Importación de datos legados
├── public/
│   └── uploads/           # Comprobantes en desarrollo (producción: Vercel Blob/Storage)
├── tailwind.config.js     # Configuración visual Fintech
├── package.json
└── README.md
```

