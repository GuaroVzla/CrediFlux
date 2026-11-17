import './globals.css';

export const metadata = {
  title: 'CrediFlux | Gesti��n Financiera, PrǸstamos y E-Commerce Inteligente',
  description: 'Plataforma SaaS financiera de alta gama para la administraci��n de crǸditos, financiamientos, prǸstamos personales y control de transacciones con OCR IA multimodal.',
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