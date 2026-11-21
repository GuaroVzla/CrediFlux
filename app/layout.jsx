import './globals.css';

// Next 16: `colorScheme` va en `viewport`, no en `metadata`.
// Declara al UA (Chrome/Samsung/Edge Android) que la app soporta ambos esquemas;
// el CSS decide cuál aplica según `.dark` y el login fuerza `only dark`.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark light',
};

export const metadata = {
  metadataBase: new URL('https://crediflux-app.vercel.app'),
  applicationName: 'CrediFlux',
  title: {
    default: 'CrediFlux | Gestión Financiera, Préstamos y E-Commerce Inteligente',
    template: '%s | CrediFlux',
  },
  description: 'Plataforma SaaS financiera de alta gama para la administración de créditos, financiamientos, préstamos personales y control de transacciones con OCR IA multimodal.',
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: 'CrediFlux | Gestión Financiera y Préstamos',
    description: 'Plataforma SaaS financiera para la administración de créditos, financiamientos y control de transacciones con OCR IA.',
    url: 'https://crediflux-app.vercel.app',
    siteName: 'CrediFlux',
    locale: 'es_VE',
    type: 'website',
  },
};

// Estilo para anular propiedades CSS obsoletas y evitar warnings en consola.
// No forzamos antialiasing: en fondos oscuros adelgaza la letra y dificulta la lectura.
const fontSmoothingStyle = `
  @font-face {
    font-family: 'Segoe UI';
    -moz-osx-font-smoothing: auto;
  }
`;

export default function RootLayout({ children }) {
  return (
    <html lang="es" className="dark">
      <head>
        <style>{fontSmoothingStyle}</style>
      </head>
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)] selection:bg-emerald-200 selection:text-emerald-950">
        {children}
      </body>
    </html>
  );
}
