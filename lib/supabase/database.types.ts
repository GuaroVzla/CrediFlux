// Tipos generados a partir de supabase/schema.sql.
// Regenerar con: npx supabase gen types typescript --project-id <ref> --schema public > lib/supabase/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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

export type ProfileRow = {
  id: string;
  username: string;
  full_name: string;
  company_name: string | null;
  email: string | null;
  address: string | null;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  license_key: string | null;
  license_status: LicenseStatus;
  license_assigned_at: string | null;
  license_expires_at: string | null;
  license_duration_months: number;
  monthly_capitals: Json;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type UserSettingRow = {
  id: string;
  user_id: string;
  company_name: string;
  currency: string;
  timezone: string;
  ecommerce_capital: number;
  ai_provider: 'openai' | 'gemini' | 'ocrspace' | 'tesseract';
  ai_auto_assign_enabled: boolean;
  ai_routing_rules: Json;
  ocr_confidence_min: number;
  ocr_api_keys: Json;
  provider_config: Json;
  feature_flags: Json;
  system_license_key: string | null;
  data: Json;
  created_at: string;
  updated_at: string;
};

export type TrustLevelConfigRow = {
  id: string;
  user_id: string;
  tier: TrustTier;
  label: string;
  description: string | null;
  criteria: Json;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ClientRow = {
  id: string;
  user_id: string;
  name: string;
  dni: string;
  dni_normalized: string;
  phone: string | null;
  address: string | null;
  trust_level: 'alto' | 'medio' | 'riesgoso';
  credit_limit: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type BlacklistEntryRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  name: string;
  dni: string;
  dni_normalized: string;
  phone: string | null;
  address: string | null;
  reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductRow = {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  cost_price: number;
  sale_price: number;
  profit_margin_percent: number;
  manual_sale_price: boolean;
  stock: number;
  sku: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type LoanRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  client_name: string;
  type: LoanType;
  product_id: string | null;
  product_name: string | null;
  principal: number;
  down_payment: number;
  financed_amount: number;
  interest_rate: number;
  total_amount: number;
  installment_count: number;
  installment_amount: number;
  frequency: LoanFrequency;
  start_date: string;
  notes: string | null;
  status: LoanStatus;
  archived: boolean;
  archived_at: string | null;
  archive_reason: string | null;
  final_status: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type LoanInstallmentRow = {
  id: string;
  user_id: string;
  loan_id: string;
  installment_number: number;
  due_date: string;
  amount: number;
  paid: boolean;
  paid_date: string | null;
  receipt_ref: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type PaymentRow = {
  id: string;
  user_id: string;
  loan_id: string | null;
  client_id: string | null;
  installment_id: string | null;
  installment_number: number | null;
  amount: number;
  payment_date: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type EcommerceTransactionRow = {
  id: string;
  user_id: string;
  type: EcommerceType;
  title: string | null;
  amount_bs: number;
  amount_usd: number;
  bcv_rate: number;
  bank_origin: string | null;
  bank_destination: string | null;
  reference: string | null;
  transaction_date: string;
  receipt_url: string | null;
  ocr_provider: string | null;
  raw_ocr: Json | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type ExchangeRateRow = {
  id: string;
  user_id: string;
  source: ExchangeSource;
  base_currency: string;
  quote_currency: string;
  rate: number;
  buy_rate: number | null;
  sell_rate: number | null;
  is_manual: boolean;
  fetched_at: string;
  raw: Json;
  created_at: string;
  updated_at: string;
};

export type P2PTransactionRow = {
  id: string;
  user_id: string;
  side: P2PSide;
  amount_usdt: number;
  amount_ves: number;
  rate: number;
  counterparty: string | null;
  bank: string | null;
  reference: string | null;
  status: P2PStatus;
  occurred_at: string;
  notes: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type ReceiptPatternRow = {
  id: string;
  user_id: string;
  bank_name: string;
  keywords: Json;
  reference_format: string | null;
  reference_regex: string | null;
  notes: string | null;
  image_key: string | null;
  image_url: string | null;
  image_mime: string | null;
  is_active: boolean;
  version: number;
  created_by: string | null;
  extra: Json;
  created_at: string;
  updated_at: string;
};

export type AuditLogRow = {
  id: string;
  user_id: string;
  actor_id: string | null;
  entity: string;
  entity_id: string | null;
  action: AuditAction;
  before: Json | null;
  after: Json | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

// Insert/Update se dejan permisivos porque las mutaciones pasan por los
// servicios tipados (lib/services/*) y por el adaptador server-side, donde los
// inputs se validan y mapean explícitamente antes de llegar a Supabase.
type TableDef<Row> = {
  Row: Row;
  Insert: any;
  Update: any;
  Relationships: [];
};

export interface Database {
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
      profiles: TableDef<ProfileRow>;
      user_settings: TableDef<UserSettingRow>;
      trust_level_configs: TableDef<TrustLevelConfigRow>;
      clients: TableDef<ClientRow>;
      blacklist_entries: TableDef<BlacklistEntryRow>;
      products: TableDef<ProductRow>;
      loans: TableDef<LoanRow>;
      loan_installments: TableDef<LoanInstallmentRow>;
      payments: TableDef<PaymentRow>;
      ecommerce_transactions: TableDef<EcommerceTransactionRow>;
      exchange_rates: TableDef<ExchangeRateRow>;
      p2p_transactions: TableDef<P2PTransactionRow>;
      receipt_patterns: TableDef<ReceiptPatternRow>;
      audit_logs: TableDef<AuditLogRow>;
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
