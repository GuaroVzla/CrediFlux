import './globals.css';

export const metadata = {
  title: 'Sistema Ricardo | Gestión Financiera, Préstamos y E-Commerce',
  description: 'Plataforma privada y profesional para la administración de financiamientos de equipos, préstamos personales y control de transacciones con OCR IA.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-emerald-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}

