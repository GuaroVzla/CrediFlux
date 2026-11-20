import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ExchangeSource, P2PSide, P2PStatus } from '@/shared/types/database';

type Client = SupabaseClient<Database>;

export interface CreateRateInput {
  source: ExchangeSource;
  rate: number;
  buyRate?: number | null;
  sellRate?: number | null;
  baseCurrency?: string;
  quoteCurrency?: string;
  isManual?: boolean;
  fetchedAt?: string;
  raw?: Record<string, unknown>;
}

export interface CreateP2PInput {
  side: P2PSide;
  amountUsdt: number;
  amountVes: number;
  rate: number;
  counterparty?: string;
  bank?: string;
  reference?: string;
  status?: P2PStatus;
  occurredAt?: string;
  notes?: string;
}

function assertPositive(value: number, field: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} debe ser un número mayor que cero`);
  }
}

export async function listExchangeRates(supabase: Client, userId: string, limit = 100) {
  const { data, error } = await supabase
    .from('exchange_rates')
    .select('*')
    .eq('user_id', userId)
    .order('fetched_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createExchangeRate(supabase: Client, userId: string, input: CreateRateInput) {
  assertPositive(Number(input.rate), 'rate');
  if (input.buyRate != null) assertPositive(Number(input.buyRate), 'buyRate');
  if (input.sellRate != null) assertPositive(Number(input.sellRate), 'sellRate');

  const { data, error } = await supabase
    .from('exchange_rates')
    .insert({
      user_id: userId,
      source: input.source,
      base_currency: input.baseCurrency || 'VES',
      quote_currency: input.quoteCurrency || 'USD',
      rate: Number(input.rate),
      buy_rate: input.buyRate == null ? null : Number(input.buyRate),
      sell_rate: input.sellRate == null ? null : Number(input.sellRate),
      is_manual: Boolean(input.isManual),
      fetched_at: input.fetchedAt || new Date().toISOString(),
      raw: (input.raw || {}) as any,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listP2PTransactions(supabase: Client, userId: string, limit = 100) {
  const { data, error } = await supabase
    .from('p2p_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createP2PTransaction(supabase: Client, userId: string, input: CreateP2PInput) {
  assertPositive(Number(input.amountUsdt), 'amountUsdt');
  assertPositive(Number(input.amountVes), 'amountVes');
  assertPositive(Number(input.rate), 'rate');

  const { data, error } = await supabase
    .from('p2p_transactions')
    .insert({
      user_id: userId,
      side: input.side,
      amount_usdt: Number(input.amountUsdt),
      amount_ves: Number(input.amountVes),
      rate: Number(input.rate),
      counterparty: input.counterparty || null,
      bank: input.bank || null,
      reference: input.reference || null,
      status: input.status || 'completed',
      occurred_at: input.occurredAt || new Date().toISOString(),
      notes: input.notes || null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}
