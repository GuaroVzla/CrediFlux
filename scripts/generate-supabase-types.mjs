#!/usr/bin/env node
/**
 * Regenera lib/supabase/database.types.ts desde el proyecto Supabase enlazado
 * y le añade los alias de conveniencia que usa la aplicación.
 *
 * Uso:
 *   npm run db:types
 *
 * Requiere SUPABASE_ACCESS_TOKEN o un proyecto enlazado (`supabase link`).
 * No editar database.types.ts a mano: los cambios de esquema van en
 * supabase/migrations/*.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUTPUT = 'lib/supabase/database.types.ts';

const header = `// -----------------------------------------------------------------------------
// Tipos de la base de datos Supabase (generados por la CLI).
// Regenerar con:
//   npm run db:types
// No editar a mano: cualquier ajuste debe ir en supabase/migrations/*.
// -----------------------------------------------------------------------------

`;

const aliases = `
// -----------------------------------------------------------------------------
// Alias de conveniencia usados por la aplicación.
// Se derivan del esquema real para no duplicar definiciones a mano.
// -----------------------------------------------------------------------------

export type UserRole = 'admin' | 'operator' | 'user';
export type LicenseStatus = 'active' | 'expired' | 'suspended' | 'revoked';
export type TrustTier = 'alto' | 'medio' | 'riesgoso';
export type LoanType = 'dinero' | 'producto' | 'cash' | 'equipment';
export type LoanFrequency = 'diario' | 'semanal' | 'quincenal' | 'mensual';
export type LoanStatus = 'al_dia' | 'proximo' | 'moroso' | 'completado' | 'archivado';
export type EcommerceType = 'compra' | 'venta';
export type ExchangeSource = 'bcv' | 'binance_p2p' | 'manual';
export type P2PSide = 'buy' | 'sell';
export type P2PStatus = 'pending' | 'completed' | 'cancelled';
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT' | 'LOGIN' | 'LOGOUT';
export type CapitalMovementType = 'APORTE_CAPITAL' | 'RETIRO_CAPITAL';
export type CapitalCurrency = 'USD' | 'USDT' | 'VES';

type RowOf<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export type ProfileRow = RowOf<'profiles'>;
export type UserSettingRow = RowOf<'user_settings'>;
export type TrustLevelConfigRow = RowOf<'trust_level_configs'>;
export type ClientRow = RowOf<'clients'>;
export type BlacklistEntryRow = RowOf<'blacklist_entries'>;
export type ProductRow = RowOf<'products'>;
export type LoanRow = RowOf<'loans'>;
export type LoanInstallmentRow = RowOf<'loan_installments'>;
export type PaymentRow = RowOf<'payments'>;
export type EcommerceTransactionRow = RowOf<'ecommerce_transactions'>;
export type ExchangeRateRow = RowOf<'exchange_rates'>;
export type P2PTransactionRow = RowOf<'p2p_transactions'>;
export type ReceiptPatternRow = RowOf<'receipt_patterns'>;
export type AuditLogRow = RowOf<'audit_logs'>;
export type CapitalMovementRow = RowOf<'capital_movements'>;
`;

const generated = execFileSync(
  'npx',
  ['supabase', 'gen', 'types', 'typescript', '--linked', '--schema', 'public'],
  { encoding: 'utf8', shell: process.platform === 'win32' }
);

if (!generated.includes('export type Database')) {
  console.error('La CLI no devolvió tipos válidos. ¿Está el proyecto enlazado?');
  process.exit(1);
}

fs.writeFileSync(OUTPUT, header + generated.trimEnd() + '\n' + aliases, 'utf8');
console.log(`Tipos generados en ${OUTPUT}`);
