import './globals.css';

export const metadata = {
  applicationName: 'CrediFlux',
  title: {
    default: 'CrediFlux | Gestión Financiera, Préstamos y E-Commerce Inteligente',
    template: '%s | CrediFlux',
  },
  description: 'Plataforma SaaS financiera de alta gama para la administración de créditos, financiamientos, préstamos personales y control de transacciones con OCR IA multimodal.',
};

// Style para anular propiedades CSS de Firefox obsoletas y evitar warnings en consola
const fontSmoothingStyle = `
  @font-face {
    font-family: 'Segoe UI';
    -moz-osx-font-smoothing: auto;
    -webkit-font-smoothing: antialiased;
    font-smoothing: antialiased;
  }
`;

export default function RootLayout({ children }) {
  return (
    <html lang="es" className="dark">
      <head>
        <style>{fontSmoothingStyle}</style>
      </head>
      <body className="min-h-screen bg-[#0b1120] text-slate-100 antialiased selection:bg-emerald-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
