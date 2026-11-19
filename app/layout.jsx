import './globals.css';

export const metadata = {
  applicationName: 'CrediFlux',
  title: {
    default: 'CrediFlux | Gestión Financiera, Préstamos y E-Commerce Inteligente',
    template: '%s | CrediFlux',
  },
  description: 'Plataforma SaaS financiera de alta gama para la administración de créditos, financiamientos, préstamos personales y control de transacciones con OCR IA multimodal.',
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
