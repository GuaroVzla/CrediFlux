import './globals.css';

export const metadata = {
  title: 'CrediFlux | Gestión Financiera, Préstamos y E-Commerce Inteligente',
  description: 'Plataforma SaaS financiera de alta gama para la administración de créditos, financiamientos, préstamos personales y control de transacciones con OCR IA multimodal.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-[#0b1120] text-slate-100 antialiased selection:bg-emerald-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}

