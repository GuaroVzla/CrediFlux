-- =============================================================================
-- CrediFlux - Capital: aportes y retiros del inversionista
-- Versión: 2026-11-17
--
-- Aislamiento contable:
--   * NO son operaciones comerciales (no van a ecommerce_transactions).
--   * NO son operaciones P2P (no van a p2p_transactions).
--   * NO alteran Ganancias Netas.
--   * Capital Invertido Neto = SUM(APORTE_CAPITAL) - SUM(RETIRO_CAPITAL).
-- =============================================================================

create table if not exists public.capital_movements (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  type            text not null check (type in ('APORTE_CAPITAL', 'RETIRO_CAPITAL')),
  amount_usd      numeric(18, 2) not null check (amount_usd > 0),
  currency_origin text not null default 'USD' check (currency_origin in ('USD', 'USDT', 'VES')),
  exchange_rate   numeric(18, 8) check (exchange_rate is null or exchange_rate > 0),
  notes           text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists capital_movements_user_idx
  on public.capital_movements (user_id, created_at desc);
create index if not exists capital_movements_type_idx
  on public.capital_movements (user_id, type);

drop trigger if exists capital_movements_set_updated_at on public.capital_movements;
create trigger capital_movements_set_updated_at
  before update on public.capital_movements
  for each row execute function public.set_updated_at();

alter table public.capital_movements enable row level security;

drop policy if exists "capital_movements_select_own" on public.capital_movements;
create policy "capital_movements_select_own"
  on public.capital_movements for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "capital_movements_insert_own" on public.capital_movements;
create policy "capital_movements_insert_own"
  on public.capital_movements for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "capital_movements_update_own" on public.capital_movements;
create policy "capital_movements_update_own"
  on public.capital_movements for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "capital_movements_delete_own" on public.capital_movements;
create policy "capital_movements_delete_own"
  on public.capital_movements for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.capital_movements to authenticated;
grant all privileges on public.capital_movements to service_role;
