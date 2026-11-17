// -----------------------------------------------------------------------------
// Tipos de la base de datos Supabase (generados por la CLI).
// Regenerar con:
//   npm run db:types
// No editar a mano: cualquier ajuste debe ir en supabase/migrations/*.
// -----------------------------------------------------------------------------

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          ip_address: unknown
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      blacklist_entries: {
        Row: {
          address: string | null
          client_id: string | null
          created_at: string
          dni: string
          dni_normalized: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          client_id?: string | null
          created_at?: string
          dni: string
          dni_normalized?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          client_id?: string | null
          created_at?: string
          dni?: string
          dni_normalized?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      capital_movements: {
        Row: {
          amount_usd: number
          created_at: string
          currency_origin: string
          exchange_rate: number | null
          id: string
          metadata: Json
          notes: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          currency_origin?: string
          exchange_rate?: number | null
          id?: string
          metadata?: Json
          notes?: string | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          currency_origin?: string
          exchange_rate?: number | null
          id?: string
          metadata?: Json
          notes?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          address: string | null
          created_at: string
          credit_limit: number
          dni: string
          dni_normalized: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          trust_level: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          credit_limit?: number
          dni: string
          dni_normalized?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          trust_level?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          credit_limit?: number
          dni?: string
          dni_normalized?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          trust_level?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ecommerce_transactions: {
        Row: {
          amount_bs: number
          amount_usd: number
          bank_destination: string | null
          bank_origin: string | null
          bcv_rate: number
          created_at: string
          id: string
          metadata: Json
          ocr_provider: string | null
          raw_ocr: Json | null
          receipt_url: string | null
          reference: string | null
          title: string | null
          transaction_date: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_bs?: number
          amount_usd?: number
          bank_destination?: string | null
          bank_origin?: string | null
          bcv_rate?: number
          created_at?: string
          id?: string
          metadata?: Json
          ocr_provider?: string | null
          raw_ocr?: Json | null
          receipt_url?: string | null
          reference?: string | null
          title?: string | null
          transaction_date?: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_bs?: number
          amount_usd?: number
          bank_destination?: string | null
          bank_origin?: string | null
          bcv_rate?: number
          created_at?: string
          id?: string
          metadata?: Json
          ocr_provider?: string | null
          raw_ocr?: Json | null
          receipt_url?: string | null
          reference?: string | null
          title?: string | null
          transaction_date?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exchange_rates: {
        Row: {
          base_currency: string
          buy_rate: number | null
          created_at: string
          fetched_at: string
          id: string
          is_manual: boolean
          quote_currency: string
          rate: number
          raw: Json
          sell_rate: number | null
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_currency?: string
          buy_rate?: number | null
          created_at?: string
          fetched_at?: string
          id?: string
          is_manual?: boolean
          quote_currency?: string
          rate: number
          raw?: Json
          sell_rate?: number | null
          source: string
          updated_at?: string
          user_id: string
        }
        Update: {
          base_currency?: string
          buy_rate?: number | null
          created_at?: string
          fetched_at?: string
          id?: string
          is_manual?: boolean
          quote_currency?: string
          rate?: number
          raw?: Json
          sell_rate?: number | null
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      loan_installments: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          id: string
          installment_number: number
          loan_id: string
          metadata: Json
          paid: boolean
          paid_date: string | null
          receipt_ref: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          due_date: string
          id?: string
          installment_number: number
          loan_id: string
          metadata?: Json
          paid?: boolean
          paid_date?: string | null
          receipt_ref?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          installment_number?: number
          loan_id?: string
          metadata?: Json
          paid?: boolean
          paid_date?: string | null
          receipt_ref?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_installments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          archive_reason: string | null
          archived: boolean
          archived_at: string | null
          client_id: string | null
          client_name: string
          created_at: string
          down_payment: number
          final_status: string | null
          financed_amount: number
          frequency: string
          id: string
          installment_amount: number
          installment_count: number
          interest_rate: number
          metadata: Json
          notes: string | null
          principal: number
          product_id: string | null
          product_name: string | null
          start_date: string
          status: string
          total_amount: number
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archive_reason?: string | null
          archived?: boolean
          archived_at?: string | null
          client_id?: string | null
          client_name?: string
          created_at?: string
          down_payment?: number
          final_status?: string | null
          financed_amount?: number
          frequency?: string
          id?: string
          installment_amount?: number
          installment_count?: number
          interest_rate?: number
          metadata?: Json
          notes?: string | null
          principal?: number
          product_id?: string | null
          product_name?: string | null
          start_date?: string
          status?: string
          total_amount?: number
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archive_reason?: string | null
          archived?: boolean
          archived_at?: string | null
          client_id?: string | null
          client_name?: string
          created_at?: string
          down_payment?: number
          final_status?: string | null
          financed_amount?: number
          frequency?: string
          id?: string
          installment_amount?: number
          installment_count?: number
          interest_rate?: number
          metadata?: Json
          notes?: string | null
          principal?: number
          product_id?: string | null
          product_name?: string | null
          start_date?: string
          status?: string
          total_amount?: number
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      p2p_transactions: {
        Row: {
          amount_usdt: number
          amount_ves: number
          bank: string | null
          counterparty: string | null
          created_at: string
          id: string
          metadata: Json
          notes: string | null
          occurred_at: string
          rate: number
          reference: string | null
          side: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_usdt: number
          amount_ves: number
          bank?: string | null
          counterparty?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          notes?: string | null
          occurred_at?: string
          rate: number
          reference?: string | null
          side: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_usdt?: number
          amount_ves?: number
          bank?: string | null
          counterparty?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          notes?: string | null
          occurred_at?: string
          rate?: number
          reference?: string | null
          side?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          client_id: string | null
          created_at: string
          id: string
          installment_id: string | null
          installment_number: number | null
          loan_id: string | null
          metadata: Json
          method: string | null
          notes: string | null
          payment_date: string
          reference: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          client_id?: string | null
          created_at?: string
          id?: string
          installment_id?: string | null
          installment_number?: number | null
          loan_id?: string | null
          metadata?: Json
          method?: string | null
          notes?: string | null
          payment_date?: string
          reference?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          client_id?: string | null
          created_at?: string
          id?: string
          installment_id?: string | null
          installment_number?: number | null
          loan_id?: string | null
          metadata?: Json
          method?: string | null
          notes?: string | null
          payment_date?: string
          reference?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "loan_installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          cost_price: number
          created_at: string
          id: string
          manual_sale_price: boolean
          metadata: Json
          name: string
          profit_margin_percent: number
          sale_price: number
          sku: string | null
          stock: number
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          manual_sale_price?: boolean
          metadata?: Json
          name: string
          profit_margin_percent?: number
          sale_price?: number
          sku?: string | null
          stock?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          manual_sale_price?: boolean
          metadata?: Json
          name?: string
          profit_margin_percent?: number
          sale_price?: number
          sku?: string | null
          stock?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          company_name: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          license_assigned_at: string | null
          license_duration_months: number
          license_expires_at: string | null
          license_key: string | null
          license_status: string
          metadata: Json
          monthly_capitals: Json
          phone: string | null
          role: string
          updated_at: string
          username: string
        }
        Insert: {
          address?: string | null
          company_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          is_active?: boolean
          license_assigned_at?: string | null
          license_duration_months?: number
          license_expires_at?: string | null
          license_key?: string | null
          license_status?: string
          metadata?: Json
          monthly_capitals?: Json
          phone?: string | null
          role?: string
          updated_at?: string
          username: string
        }
        Update: {
          address?: string | null
          company_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          license_assigned_at?: string | null
          license_duration_months?: number
          license_expires_at?: string | null
          license_key?: string | null
          license_status?: string
          metadata?: Json
          monthly_capitals?: Json
          phone?: string | null
          role?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      receipt_patterns: {
        Row: {
          bank_name: string
          created_at: string
          created_by: string | null
          extra: Json
          id: string
          image_key: string | null
          image_mime: string | null
          image_url: string | null
          is_active: boolean
          keywords: Json
          notes: string | null
          reference_format: string | null
          reference_regex: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          bank_name: string
          created_at?: string
          created_by?: string | null
          extra?: Json
          id?: string
          image_key?: string | null
          image_mime?: string | null
          image_url?: string | null
          is_active?: boolean
          keywords?: Json
          notes?: string | null
          reference_format?: string | null
          reference_regex?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          bank_name?: string
          created_at?: string
          created_by?: string | null
          extra?: Json
          id?: string
          image_key?: string | null
          image_mime?: string | null
          image_url?: string | null
          is_active?: boolean
          keywords?: Json
          notes?: string | null
          reference_format?: string | null
          reference_regex?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      trust_level_configs: {
        Row: {
          created_at: string
          criteria: Json
          description: string | null
          id: string
          is_active: boolean
          label: string
          sort_order: number
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          criteria?: Json
          description?: string | null
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          tier: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          criteria?: Json
          description?: string | null
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          ai_auto_assign_enabled: boolean
          ai_provider: string
          ai_routing_rules: Json
          company_name: string
          created_at: string
          currency: string
          data: Json
          ecommerce_capital: number
          feature_flags: Json
          id: string
          ocr_api_keys: Json
          ocr_confidence_min: number
          provider_config: Json
          system_license_key: string | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_auto_assign_enabled?: boolean
          ai_provider?: string
          ai_routing_rules?: Json
          company_name?: string
          created_at?: string
          currency?: string
          data?: Json
          ecommerce_capital?: number
          feature_flags?: Json
          id?: string
          ocr_api_keys?: Json
          ocr_confidence_min?: number
          provider_config?: Json
          system_license_key?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_auto_assign_enabled?: boolean
          ai_provider?: string
          ai_routing_rules?: Json
          company_name?: string
          created_at?: string
          currency?: string
          data?: Json
          ecommerce_capital?: number
          feature_flags?: Json
          id?: string
          ocr_api_keys?: Json
          ocr_confidence_min?: number
          provider_config?: Json
          system_license_key?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
      normalize_dni: { Args: { value: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

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
