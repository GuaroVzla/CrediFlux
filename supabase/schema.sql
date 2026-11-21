-- =============================================================================
-- CrediFlux - Esquema relacional Supabase / PostgreSQL
-- Versión: 2026-11-16
--
-- Principios:
--  * Multi-usuario estricto: todas las tablas de negocio tienen user_id y RLS.
--  * Importes financieros en NUMERIC (nunca float) con precisión explícita.
--  * Perfiles enlazados 1:1 con auth.users (Supabase Auth).
--  * Timestamps de auditoría (created_at / updated_at) en todas las tablas.
--
-- Ejecutar en el SQL Editor de Supabase o con `supabase db push`.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- 1. FUNCIONES UTILITARIAS
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Nota: public.is_admin() se define más abajo, después de crear public.profiles,
-- porque Postgres valida el cuerpo de las funciones SQL al crearlas
-- (check_function_bodies = on) y la tabla debe existir primero.

-- Normaliza una cédula/DNI: "V-18.452.910" -> "v18452910".
create or replace function public.normalize_dni(value text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(value, ''), '[^0-9a-zA-Z]', '', 'g'));
$$;

-- =============================================================================
-- 2. PERFILES Y CONFIGURACIÓN
-- =============================================================================

create table if not exists public.profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,
  username                text not null,
  full_name               text not null default '',
  company_name            text,
  email                   text,
  address                 text,
  phone                   text,
  role                    text not null default 'user' check (role in ('admin', 'operator', 'user')),
  is_active               boolean not null default true,
  license_key             text,
  license_status          text not null default 'active' check (license_status in ('active', 'expired', 'suspended', 'revoked')),
  license_assigned_at     timestamptz,
  license_expires_at      timestamptz,
  license_duration_months integer not null default 1 check (license_duration_months > 0),
  monthly_capitals        jsonb not null default '{}'::jsonb,
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-zA-Z0-9._-]{3,64}$')
);

create unique index if not exists profiles_username_key on public.profiles (lower(username));
create index if not exists profiles_role_idx on public.profiles (role) where is_active = true;

-- Devuelve true si el usuario autenticado tiene rol administrador.
-- SECURITY DEFINER evita recursión de RLS al consultar profiles.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active = true
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

comment on table public.profiles is 'Perfil de aplicación enlazado 1:1 con auth.users.';

create table if not exists public.user_settings (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null unique references auth.users (id) on delete cascade,
  company_name              text not null default 'CrediFlux',
  currency                  text not null default '$',
  timezone                  text not null default 'America/Caracas',
  ecommerce_capital         numeric(18, 2) not null default 5000 check (ecommerce_capital >= 0),
  ai_provider               text not null default 'ocrspace' check (ai_provider in ('openai', 'gemini', 'ocrspace', 'tesseract')),
  ai_auto_assign_enabled    boolean not null default true,
  ai_routing_rules          jsonb not null default '{}'::jsonb,
  ocr_confidence_min        numeric(5, 4) not null default 0.8 check (ocr_confidence_min between 0 and 1),
  ocr_api_keys              jsonb not null default '{}'::jsonb,
  provider_config           jsonb not null default '{}'::jsonb,
  feature_flags             jsonb not null default '{}'::jsonb,
  system_license_key        text,
  data                      jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on column public.user_settings.ocr_api_keys is 'Columna legada en desuso: la configuración OCR se lee de public.admin_ocr_settings.';

-- Configuración OCR global (singleton). Sin user_id y sin políticas RLS para
-- authenticated: únicamente service_role puede acceder desde el servidor.
create table if not exists public.admin_ocr_settings (
  id                      text primary key default 'global' check (id = 'global'),
  ai_provider             text check (ai_provider in ('openai', 'gemini', 'ocrspace', 'tesseract')),
  ocr_api_keys            jsonb not null default '{}'::jsonb,
  ocr_endpoints           jsonb not null default '{}'::jsonb,
  ocr_models              jsonb not null default '{}'::jsonb,
  ocr_thresholds          jsonb not null default '{}'::jsonb,
  ocr_confidence_min      numeric(5, 4) not null default 0.8 check (ocr_confidence_min between 0 and 1),
  ai_routing_rules        jsonb not null default '{}'::jsonb,
  ai_auto_assign_enabled  boolean not null default true,
  updated_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.admin_ocr_settings is 'Configuración global del motor OCR; credenciales cifradas en reposo por la capa de aplicación.';
comment on column public.admin_ocr_settings.ocr_api_keys is 'API Keys cifradas con AES-256-GCM. Nunca se exponen al cliente.';

create table if not exists public.trust_level_configs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  tier        text not null check (tier in ('alto', 'medio', 'riesgoso')),
  label       text not null,
  description text,
  criteria    jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, tier)
);

-- =============================================================================
-- 3. CLIENTES Y LISTA NEGRA
-- =============================================================================

create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  dni             text not null check (length(trim(dni)) > 0),
  dni_normalized  text generated always as (public.normalize_dni(dni)) stored,
  phone           text,
  address         text,
  trust_level     text not null default 'medio' check (lower(trust_level) in ('alto', 'medio', 'riesgoso')),
  credit_limit    numeric(18, 2) not null default 500 check (credit_limit >= 0),
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists clients_user_dni_key
  on public.clients (user_id, dni_normalized)
  where is_active = true;
create index if not exists clients_user_idx on public.clients (user_id, created_at desc);

create table if not exists public.blacklist_entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  client_id       uuid,
  name            text not null,
  dni             text not null,
  dni_normalized  text generated always as (public.normalize_dni(dni)) stored,
  phone           text,
  address         text,
  reason          text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, dni_normalized)
);

create index if not exists blacklist_entries_user_idx on public.blacklist_entries (user_id, created_at desc);

-- =============================================================================
-- 4. CATÁLOGO DE PRODUCTOS / EQUIPOS
-- =============================================================================

create table if not exists public.products (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  name                  text not null check (length(trim(name)) > 0),
  category              text,
  cost_price            numeric(18, 2) not null default 0 check (cost_price >= 0),
  sale_price            numeric(18, 2) not null default 0 check (sale_price >= 0),
  profit_margin_percent numeric(9, 2) not null default 0,
  manual_sale_price     boolean not null default false,
  stock                 integer not null default 0 check (stock >= 0),
  sku                   text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists products_user_idx on public.products (user_id, created_at desc);
create index if not exists products_category_idx on public.products (user_id, category);

-- =============================================================================
-- 5. PRÉSTAMOS / FINANCIAMIENTOS
-- =============================================================================

create table if not exists public.loans (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  client_id          uuid references public.clients (id) on delete set null,
  client_name        text not null default '',
  type               text not null default 'dinero' check (type in ('dinero', 'producto', 'cash', 'equipment')),
  product_id         uuid references public.products (id) on delete set null,
  product_name       text,
  principal          numeric(18, 2) not null default 0 check (principal >= 0),
  down_payment       numeric(18, 2) not null default 0 check (down_payment >= 0),
  financed_amount    numeric(18, 2) not null default 0 check (financed_amount >= 0),
  interest_rate      numeric(9, 4) not null default 0 check (interest_rate >= 0),
  total_amount       numeric(18, 2) not null default 0 check (total_amount >= 0),
  installment_count  integer not null default 1 check (installment_count > 0),
  installment_amount numeric(18, 2) not null default 0 check (installment_amount >= 0),
  frequency          text not null default 'mensual' check (frequency in ('diario', 'semanal', 'quincenal', 'mensual')),
  start_date         date not null default current_date,
  notes              text,
  status             text not null default 'al_dia' check (status in ('al_dia', 'proximo', 'moroso', 'completado', 'archivado')),
  archived           boolean not null default false,
  archived_at        timestamptz,
  archive_reason     text,
  final_status       text,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint loans_down_payment_lte_principal check (down_payment <= principal)
);

create index if not exists loans_user_idx on public.loans (user_id, created_at desc);
create index if not exists loans_client_idx on public.loans (user_id, client_id);
create index if not exists loans_status_idx on public.loans (user_id, status) where archived = false;

create table if not exists public.loan_installments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  loan_id            uuid not null references public.loans (id) on delete cascade,
  installment_number integer not null check (installment_number > 0),
  due_date           date not null,
  amount             numeric(18, 2) not null default 0 check (amount >= 0),
  paid               boolean not null default false,
  paid_date          date,
  receipt_ref        text,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (loan_id, installment_number)
);

create index if not exists loan_installments_user_idx on public.loan_installments (user_id, due_date);
create index if not exists loan_installments_pending_idx on public.loan_installments (user_id, due_date) where paid = false;

create table if not exists public.payments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  loan_id            uuid references public.loans (id) on delete cascade,
  client_id          uuid references public.clients (id) on delete set null,
  installment_id     uuid references public.loan_installments (id) on delete set null,
  installment_number integer,
  amount             numeric(18, 2) not null check (amount > 0),
  payment_date       date not null default current_date,
  method             text,
  reference          text,
  notes              text,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists payments_user_idx on public.payments (user_id, payment_date desc);
create index if not exists payments_loan_idx on public.payments (user_id, loan_id);

-- =============================================================================
-- 6. E-COMMERCE Y P2P VES/USDT
-- =============================================================================

create table if not exists public.ecommerce_transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  type             text not null default 'venta' check (type in ('compra', 'venta')),
  title            text,
  amount_bs        numeric(18, 2) not null default 0 check (amount_bs >= 0),
  amount_usd       numeric(18, 2) not null default 0 check (amount_usd >= 0),
  bcv_rate         numeric(18, 8) not null default 0 check (bcv_rate >= 0),
  bank_origin      text,
  bank_destination text,
  reference        text,
  transaction_date date not null default current_date,
  receipt_url      text,
  ocr_provider     text,
  raw_ocr          jsonb,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists ecommerce_user_idx on public.ecommerce_transactions (user_id, transaction_date desc);

create table if not exists public.exchange_rates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  source        text not null check (source in ('bcv', 'binance_p2p', 'manual')),
  base_currency text not null default 'VES',
  quote_currency text not null default 'USD',
  rate          numeric(18, 8) not null check (rate > 0),
  buy_rate      numeric(18, 8) check (buy_rate > 0),
  sell_rate     numeric(18, 8) check (sell_rate > 0),
  is_manual     boolean not null default false,
  fetched_at    timestamptz not null default now(),
  raw           jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists exchange_rates_user_idx on public.exchange_rates (user_id, source, fetched_at desc);

create table if not exists public.p2p_transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  side          text not null check (side in ('buy', 'sell')),
  amount_usdt   numeric(18, 6) not null check (amount_usdt > 0),
  amount_ves    numeric(18, 2) not null check (amount_ves > 0),
  rate          numeric(18, 8) not null check (rate > 0),
  counterparty  text,
  bank          text,
  reference     text,
  status        text not null default 'completed' check (status in ('pending', 'completed', 'cancelled')),
  occurred_at   timestamptz not null default now(),
  notes         text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint p2p_rate_consistency check (abs(amount_ves - (amount_usdt * rate)) <= greatest(1, amount_ves * 0.01))
);

create index if not exists p2p_user_idx on public.p2p_transactions (user_id, occurred_at desc);

-- =============================================================================
-- 6.1 CAPITAL: APORTES Y RETIROS
-- Movimientos de capital del inversionista. Deliberadamente separados de
-- ecommerce_transactions y p2p_transactions: NO son operaciones comerciales y
-- NO alteran el cálculo de Ganancias Netas.
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

create index if not exists capital_movements_user_idx on public.capital_movements (user_id, created_at desc);
create index if not exists capital_movements_type_idx on public.capital_movements (user_id, type);

drop trigger if exists capital_movements_set_updated_at on public.capital_movements;
create trigger capital_movements_set_updated_at
  before update on public.capital_movements
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 7. PATRONES DE COMPROBANTES Y AUDITORÍA
-- =============================================================================

create table if not exists public.receipt_patterns (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  bank_name        text not null,
  keywords         jsonb not null default '[]'::jsonb,
  reference_format text,
  reference_regex  text,
  notes            text,
  image_key        text,
  image_url        text,
  image_mime       text,
  is_active        boolean not null default true,
  version          integer not null default 1 check (version > 0),
  created_by       uuid references auth.users (id) on delete set null,
  extra            jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists receipt_patterns_user_idx on public.receipt_patterns (user_id, bank_name);

create table if not exists public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  actor_id   uuid references auth.users (id) on delete set null,
  entity     text not null,
  entity_id  text,
  action     text not null check (action in ('CREATE', 'UPDATE', 'DELETE', 'IMPORT', 'LOGIN', 'LOGOUT')),
  before     jsonb,
  after      jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_user_idx on public.audit_logs (user_id, created_at desc);

-- =============================================================================
-- 8. TRIGGERS DE TIMESTAMPS
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_settings', 'trust_level_configs', 'clients',
    'blacklist_entries', 'products', 'loans', 'loan_installments',
    'payments', 'ecommerce_transactions', 'exchange_rates',
    'p2p_transactions', 'receipt_patterns'
  ]
  loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t, t
    );
  end loop;
end;
$$;

-- =============================================================================
-- 9. ALTA AUTOMÁTICA DE PERFIL + CONFIGURACIÓN AL REGISTRARSE
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_full_name text;
begin
  -- Derivar username del metadata o del email sintético usuario@crediflux.local.
  v_username := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );
  if v_username is null or v_username = '' then
    v_username := 'user_' || substr(new.id::text, 1, 8);
  end if;

  v_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    v_username
  );

  insert into public.profiles (id, username, full_name, email, role, is_active)
  values (new.id, v_username, v_full_name, new.email, 'user', true)
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.trust_level_configs (user_id, tier, label, description, sort_order)
  values
    (new.id, 'alto', 'Alta', 'Pagos al día o cumpliendo estrictamente el cronograma.', 1),
    (new.id, 'medio', 'Media', 'Retrasos menores dentro de la tolerancia configurada.', 2),
    (new.id, 'riesgoso', 'Riesgosa', 'Retrasos superiores al límite o cuotas vencidas.', 3)
  on conflict (user_id, tier) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Protección de campos sensibles: solo un admin (o service_role) puede cambiar
-- rol, licencia o estado. Un usuario normal solo edita sus datos personales.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.license_key := old.license_key;
    new.license_status := old.license_status;
    new.license_assigned_at := old.license_assigned_at;
    new.license_expires_at := old.license_expires_at;
    new.license_duration_months := old.license_duration_months;
    new.is_active := old.is_active;
    new.monthly_capitals := old.monthly_capitals;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- =============================================================================
-- 10. ROW LEVEL SECURITY (aislamiento estricto por usuario)
-- =============================================================================

alter table public.profiles              enable row level security;
alter table public.user_settings         enable row level security;
alter table public.admin_ocr_settings    enable row level security;
alter table public.trust_level_configs   enable row level security;
alter table public.clients               enable row level security;
alter table public.blacklist_entries     enable row level security;
alter table public.products              enable row level security;
alter table public.loans                 enable row level security;
alter table public.loan_installments     enable row level security;
alter table public.payments              enable row level security;
alter table public.ecommerce_transactions enable row level security;
alter table public.exchange_rates        enable row level security;
alter table public.p2p_transactions      enable row level security;
alter table public.capital_movements     enable row level security;
alter table public.receipt_patterns      enable row level security;
alter table public.audit_logs            enable row level security;

-- --------------------------- profiles --------------------------------------
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin"
  on public.profiles for delete to authenticated
  using (public.is_admin());

-- --------------------------- user_settings ---------------------------------
drop policy if exists "user_settings_own" on public.user_settings;
create policy "user_settings_own"
  on public.user_settings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --------------------------- tablas de negocio -----------------------------
-- Se genera una política por operación para cada tabla con user_id.
do $$
declare
  t text;
begin
  foreach t in array array[
    'trust_level_configs', 'clients', 'blacklist_entries', 'products',
    'loans', 'loan_installments', 'payments', 'ecommerce_transactions',
    'exchange_rates', 'p2p_transactions', 'receipt_patterns',
    'capital_movements'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select to authenticated
       using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
       with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
       using (user_id = (select auth.uid()))
       with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
       using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
end;
$$;

-- --------------------------- audit_logs ------------------------------------
drop policy if exists "audit_logs_select_own_or_admin" on public.audit_logs;
create policy "audit_logs_select_own_or_admin"
  on public.audit_logs for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "audit_logs_insert_own" on public.audit_logs;
create policy "audit_logs_insert_own"
  on public.audit_logs for insert to authenticated
  with check (user_id = (select auth.uid()));

-- =============================================================================
-- 11. GRANTS
-- =============================================================================

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- El grant amplio de arriba no debe alcanzar la configuración OCR global.
revoke all on public.admin_ocr_settings from anon, authenticated;
grant all privileges on all tables in schema public to service_role;

-- =============================================================================
-- 12. STORAGE DE COMPROBANTES (bucket privado por usuario)
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "receipts_select_own" on storage.objects;
create policy "receipts_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "receipts_insert_own" on storage.objects;
create policy "receipts_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "receipts_update_own" on storage.objects;
create policy "receipts_update_own"
  on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "receipts_delete_own" on storage.objects;
create policy "receipts_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- =============================================================================
-- 13. COMENTARIOS FINALES
-- =============================================================================

comment on table public.loans is 'Préstamos personales en efectivo y financiamiento de equipos.';
comment on table public.loan_installments is 'Cronograma de cuotas por préstamo.';
comment on table public.exchange_rates is 'Histórico de tasas BCV / Binance P2P por usuario.';
comment on table public.p2p_transactions is 'Historial de operaciones P2P VES-USDT.';
comment on table public.blacklist_entries is 'Lista negra de clientes por incumplimiento.';

-- =============================================================================
-- 14. ÍNDICES DE RENDIMIENTO (auditoría 2026-11-20)
-- Cubren los ORDER BY / filtros reales usados por lib/server/supabase-store.ts
-- y por las rutas de API. Todos son IF NOT EXISTS: seguros de reejecutar.
-- =============================================================================

create index if not exists loan_installments_user_number_idx
  on public.loan_installments (user_id, installment_number);

create index if not exists exchange_rates_user_fetched_idx
  on public.exchange_rates (user_id, fetched_at desc);

create index if not exists receipt_patterns_user_created_idx
  on public.receipt_patterns (user_id, created_at desc);

create index if not exists profiles_created_at_idx
  on public.profiles (created_at);

create index if not exists loans_user_archived_created_idx
  on public.loans (user_id, archived, created_at desc);

create index if not exists payments_user_client_idx
  on public.payments (user_id, client_id);

create index if not exists payments_user_installment_idx
  on public.payments (user_id, installment_id);

create index if not exists ecommerce_user_type_date_idx
  on public.ecommerce_transactions (user_id, type, transaction_date desc);

create index if not exists p2p_user_status_date_idx
  on public.p2p_transactions (user_id, status, occurred_at desc);

create index if not exists audit_logs_user_entity_created_idx
  on public.audit_logs (user_id, entity, created_at desc);

create index if not exists trust_level_configs_user_sort_idx
  on public.trust_level_configs (user_id, sort_order);

create index if not exists blacklist_entries_user_client_idx
  on public.blacklist_entries (user_id, client_id);

-- =============================================================================
-- EdiciÃ³n atÃ³mica de financiamientos
-- -----------------------------------------------------------------------------
-- Un Ãºnico CALL:
--   1. bloquea el prÃ©stamo y los productos afectados (SELECT ... FOR UPDATE)
--   2. valida propiedad, montos y stock disponible
--   3. ajusta stock (devuelve lo que se quita, descuenta lo que se agrega)
--   4. actualiza el prÃ©stamo y regenera el cronograma
-- La tabla payments NO se modifica: los abonos previos y sus comprobantes se
-- conservan. Las cuotas pagadas se actualizan con los mismos valores.
-- =============================================================================
-- Edición de condiciones de pago de financiamientos
-- -----------------------------------------------------------------------------
-- Un único CALL:
--   1. bloquea la fila del préstamo (SELECT ... FOR UPDATE)
--   2. valida propiedad, montos y que el nuevo total cubra lo ya abonado
--   3. actualiza SÓLO interés, cuotas, frecuencia, fecha de inicio y estado
--   4. regenera únicamente las cuotas pendientes
--
-- La RPC no acepta productos, stock, cliente, monto base ni enganche: esos
-- datos quedan congelados. `payments` y las cuotas pagadas nunca se modifican.
-- =============================================================================

create or replace function public.update_loan_plan(
  p_loan_id uuid,
  p_user_id uuid,
  p_interest_rate numeric,
  p_interest_mode text,
  p_interest_amount numeric,
  p_total_amount numeric,
  p_installment_count integer,
  p_installment_amount numeric,
  p_frequency text,
  p_start_date date,
  p_status text,
  p_installments jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans%rowtype;
  v_inst jsonb;
  v_paid_count integer;
  v_paid_total numeric;
begin
  -- La sesión del usuario debe coincidir con el propietario. service_role
  -- puede invocarla (lo usa el servidor cuando no hay token de usuario).
  if auth.uid() is distinct from p_user_id
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'No autorizado para editar este financiamiento';
  end if;

  if p_interest_rate < 0 or p_interest_amount < 0 or p_total_amount < 0
     or p_installment_amount < 0 then
    raise exception 'Los montos no pueden ser negativos';
  end if;
  if p_interest_mode not in ('percent', 'fixed') then
    raise exception 'Modalidad de interés no válida';
  end if;
  if p_installment_count is null or p_installment_count < 1 or p_installment_count > 360 then
    raise exception 'La cantidad de cuotas debe estar entre 1 y 360';
  end if;
  if p_frequency not in ('diario', 'semanal', 'quincenal', 'mensual') then
    raise exception 'Frecuencia de pago no válida';
  end if;
  if p_status not in ('al_dia', 'proximo', 'moroso', 'completado', 'archivado') then
    raise exception 'Estado de financiamiento no válido';
  end if;

  select * into v_loan
  from public.loans
  where id = p_loan_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Financiamiento no encontrado';
  end if;
  if v_loan.archived then
    raise exception 'El financiamiento está dado de baja y no admite cambios';
  end if;

  -- No se pueden eliminar cuotas ya liquidadas.
  select count(*) into v_paid_count
  from public.loan_installments
  where loan_id = p_loan_id and coalesce(paid, false) = true;

  if v_paid_count > p_installment_count then
    raise exception 'La cantidad de cuotas no puede ser menor a las ya pagadas';
  end if;

  -- Los abonos confirmados son la fuente de verdad contable.
  select coalesce(sum(amount), 0) into v_paid_total
  from public.payments
  where loan_id = p_loan_id and user_id = p_user_id;

  if p_total_amount + 0.001 < v_paid_total then
    raise exception 'El nuevo total ($%) no puede ser menor al monto ya abonado ($%)',
      p_total_amount, v_paid_total;
  end if;

  update public.loans
  set interest_rate      = p_interest_rate,
      total_amount       = p_total_amount,
      installment_count  = p_installment_count,
      installment_amount = p_installment_amount,
      frequency          = p_frequency,
      start_date         = p_start_date,
      status             = p_status,
      metadata           = jsonb_set(
                             jsonb_set(coalesce(metadata, '{}'::jsonb), '{interestMode}', to_jsonb(p_interest_mode)),
                             '{interestAmount}', to_jsonb(p_interest_amount)
                           )
  where id = p_loan_id and user_id = p_user_id;

  -- Sólo se regeneran cuotas pendientes. Las pagadas se dejan intactas, con
  -- su paid_date, receipt_ref y el vínculo desde `payments`.
  delete from public.loan_installments
  where loan_id = p_loan_id and coalesce(paid, false) = false;

  for v_inst in select value from jsonb_array_elements(coalesce(p_installments, '[]'::jsonb)) loop
    if coalesce((v_inst ->> 'paid')::boolean, false) then
      continue;
    end if;

    insert into public.loan_installments (
      id, user_id, loan_id, installment_number, due_date,
      amount, paid, paid_date, receipt_ref
    ) values (
      (v_inst ->> 'id')::uuid,
      p_user_id,
      p_loan_id,
      (v_inst ->> 'number')::integer,
      (v_inst ->> 'dueDate')::date,
      (v_inst ->> 'amount')::numeric,
      false,
      null,
      null
    );
  end loop;
end;
$$;

revoke all on function public.update_loan_plan from public, anon;
grant execute on function public.update_loan_plan to authenticated, service_role;


-- =============================================================================
-- Registro atÃ³mico de abonos sobre el saldo de un financiamiento
-- -----------------------------------------------------------------------------
-- Un Ãºnico CALL:
--   1. bloquea la fila del prÃ©stamo (SELECT ... FOR UPDATE) para serializar
--      abonos concurrentes y ediciones de condiciones de pago
--   2. recalcula el saldo desde las cuotas pendientes y los pagos confirmados
--   3. valida propiedad, estado y monto (nunca deja saldo negativo)
--   4. redistribuye el saldo restante con ajuste centenario en la Ãºltima cuota
--      o liquida todas las pendientes si el abono cubre el saldo
--   5. inserta el movimiento en `payments` y actualiza el prÃ©stamo
-- =============================================================================

create or replace function public.register_loan_abono(
  p_loan_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_method text,
  p_reference text,
  p_notes text,
  p_amount_bs numeric,
  p_bcv_rate numeric,
  p_installments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans%rowtype;
  v_pending_count integer;
  v_last_number integer;
  v_balance_installments numeric;
  v_balance_payments numeric;
  v_balance numeric;
  v_applied numeric;
  v_new_balance numeric;
  v_base numeric;
  v_inst jsonb;
  v_status text;
  v_settled boolean := false;
  v_payment_id uuid;
  v_previous jsonb;
  v_distribution jsonb;
  v_pending_numbers integer[];
  v_sent_numbers integer[];
begin
  -- La sesiÃ³n del usuario debe coincidir con el propietario. service_role
  -- puede invocarla (lo usa el servidor cuando no hay token de usuario).
  if auth.uid() is distinct from p_user_id
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'No autorizado para registrar este abono';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'El abono debe ser mayor que cero';
  end if;

  select * into v_loan
  from public.loans
  where id = p_loan_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Financiamiento no encontrado';
  end if;
  if v_loan.archived then
    raise exception 'Este financiamiento fue dado de baja y no admite abonos';
  end if;

  select count(*), coalesce(sum(amount), 0), max(installment_number)
    into v_pending_count, v_balance_installments, v_last_number
    from public.loan_installments
    where loan_id = p_loan_id and user_id = p_user_id
      and coalesce(paid, false) = false;

  if v_pending_count = 0 then
    raise exception 'El financiamiento no tiene cuotas pendientes';
  end if;

  -- Los abonos confirmados son la fuente de verdad contable. Se usa el menor
  -- entre el cronograma y total abonado para absorber descuadres histÃ³ricos
  -- sin permitir nunca un saldo negativo.
  select coalesce(sum(amount), 0) into v_balance_payments
  from public.payments
  where loan_id = p_loan_id and user_id = p_user_id;

  v_balance := least(
    round(v_balance_installments, 2),
    round(greatest(v_loan.total_amount - v_balance_payments, 0), 2)
  );

  if v_balance <= 0 then
    raise exception 'El financiamiento no tiene saldo pendiente';
  end if;
  if p_amount > v_balance + 0.01 then
    raise exception 'El abono ($%) supera el saldo pendiente ($%)', round(p_amount, 2), v_balance;
  end if;

  v_applied := least(round(p_amount, 2), v_balance);
  v_new_balance := round(v_balance - v_applied, 2);

  -- Si el residuo no alcanza un centavo por cuota, se liquida el contrato.
  if v_new_balance <= 0 or v_new_balance < v_pending_count * 0.01 - 0.001 then
    v_settled := true;
    v_applied := v_balance;
    v_new_balance := 0;
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('number', installment_number, 'amount', amount)
              order by installment_number),
    '[]'::jsonb
  ) into v_previous
  from public.loan_installments
  where loan_id = p_loan_id and user_id = p_user_id
    and coalesce(paid, false) = false;

  if v_settled then
    update public.loan_installments
       set paid = true,
           paid_date = p_payment_date,
           receipt_ref = p_reference,
           updated_at = now()
     where loan_id = p_loan_id and user_id = p_user_id
       and coalesce(paid, false) = false;

    v_distribution := v_previous;
    v_status := 'completado';
  else
    -- El cronograma enviado debe coincidir exactamente con las pendientes.
    select array_agg(installment_number order by installment_number) into v_pending_numbers
    from public.loan_installments
    where loan_id = p_loan_id and user_id = p_user_id
      and coalesce(paid, false) = false;

    select array_agg((value ->> 'number')::integer order by (value ->> 'number')::integer)
      into v_sent_numbers
    from jsonb_array_elements(coalesce(p_installments, '[]'::jsonb));

    if v_sent_numbers is distinct from v_pending_numbers then
      raise exception 'El cronograma enviado no coincide con las cuotas pendientes';
    end if;

    v_base := round(v_new_balance / v_pending_count, 2);

    for v_inst in select value from jsonb_array_elements(coalesce(p_installments, '[]'::jsonb)) loop
      update public.loan_installments
         set amount = case
                        when installment_number = v_last_number
                          then round(v_new_balance - v_base * (v_pending_count - 1), 2)
                        else v_base
                      end,
             updated_at = now()
       where loan_id = p_loan_id and user_id = p_user_id
         and installment_number = (v_inst ->> 'number')::integer
         and coalesce(paid, false) = false;

      if not found then
        raise exception 'El cronograma enviado no coincide con las cuotas pendientes';
      end if;
    end loop;

    select coalesce(
      jsonb_agg(jsonb_build_object('number', installment_number, 'amount', amount)
                order by installment_number),
      '[]'::jsonb
    ) into v_distribution
    from public.loan_installments
    where loan_id = p_loan_id and user_id = p_user_id
      and coalesce(paid, false) = false;

    select coalesce(
      case
        when bool_or(due_date < current_date) then 'moroso'
        when bool_or(due_date <= current_date + 3) then 'proximo'
        else 'al_dia'
      end,
      'al_dia'
    ) into v_status
    from public.loan_installments
    where loan_id = p_loan_id and user_id = p_user_id
      and coalesce(paid, false) = false;
  end if;

  update public.loans
     set status = v_status,
         installment_amount = case when v_settled then 0 else v_base end,
         final_status = case when v_settled then 'completado' else final_status end,
         metadata = case
           when v_settled then jsonb_set(
             jsonb_set(coalesce(metadata, '{}'::jsonb), '{completedAt}', to_jsonb(p_payment_date::text)),
             '{finalStatus}', '"completado"'::jsonb
           )
           else metadata
         end,
         updated_at = now()
   where id = p_loan_id and user_id = p_user_id;

  v_payment_id := gen_random_uuid();
  insert into public.payments (
    id, user_id, loan_id, client_id, installment_number, amount,
    payment_date, method, reference, notes, metadata
  ) values (
    v_payment_id, p_user_id, p_loan_id, v_loan.client_id, null, v_applied,
    p_payment_date, p_method, p_reference, p_notes,
    jsonb_build_object(
      'kind', 'abono',
      'clientName', v_loan.client_name,
      'balanceBefore', v_balance,
      'balanceAfter', v_new_balance,
      'appliedAmount', v_applied,
      'previousInstallments', v_previous,
      'nextInstallments', v_distribution,
      'amountBs', p_amount_bs,
      'bcvRate', p_bcv_rate,
      'settled', v_settled
    )
  );

  return jsonb_build_object(
    'paymentId', v_payment_id,
    'appliedAmount', v_applied,
    'currentBalance', v_balance,
    'newBalance', v_new_balance,
    'remainingInstallments', case when v_settled then 0 else v_pending_count end,
    'installmentAmount', case when v_settled then 0 else v_base end,
    'settled', v_settled,
    'status', v_status
  );
end;
$$;

revoke all on function public.register_loan_abono from public, anon;
grant execute on function public.register_loan_abono to authenticated, service_role;


-- =============================================================================
-- Pagos y abonos: cronograma, contador de cuotas y progreso
-- -----------------------------------------------------------------------------
-- Reemplaza register_loan_abono para que TODO pago (cuota o abono) descuente
-- del cronograma:
--   1. bloquea la fila del prÃ©stamo (SELECT ... FOR UPDATE)
--   2. valida propiedad, estado y monto contra el saldo pendiente
--   3. aplica el dinero en orden a las cuotas pendientes: marca como pagadas
--      las que cubre y reduce el saldo de la cuota parcial
--   4. actualiza saldo, cuotas restantes, progreso y estado del prÃ©stamo
--   5. inserta el movimiento en `payments` en un Ãºnico CALL
-- El nÃºmero total de cuotas nunca se modifica.
-- =============================================================================

create or replace function public.register_loan_abono(
  p_loan_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_method text,
  p_reference text,
  p_notes text,
  p_amount_bs numeric,
  p_bcv_rate numeric,
  p_installments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans%rowtype;
  v_row record;
  v_pending_count integer;
  v_total_count integer;
  v_balance_installments numeric;
  v_balance_payments numeric;
  v_balance numeric;
  v_applied numeric;
  v_new_balance numeric;
  v_remaining numeric;
  v_before numeric;
  v_take numeric;
  v_after numeric;
  v_next_amount numeric;
  v_status text;
  v_settled boolean := false;
  v_settled_count integer := 0;
  v_partial_number integer;
  v_partial_remaining numeric;
  v_payment_id uuid;
  v_previous jsonb;
  v_distribution jsonb := '[]'::jsonb;
  v_next_installments jsonb;
  v_original_total numeric;
  v_collected numeric;
  v_progress numeric;
  v_covered numeric;
  v_remaining_eq numeric;
  v_progress_meta jsonb;
begin
  if auth.uid() is distinct from p_user_id
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'No autorizado para registrar este pago';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'El abono debe ser mayor que cero';
  end if;

  select * into v_loan
  from public.loans
  where id = p_loan_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Financiamiento no encontrado';
  end if;
  if v_loan.archived then
    raise exception 'Este financiamiento fue dado de baja y no admite pagos';
  end if;

  select count(*), coalesce(sum(amount), 0)
    into v_pending_count, v_balance_installments
    from public.loan_installments
    where loan_id = p_loan_id and user_id = p_user_id
      and coalesce(paid, false) = false;

  if v_pending_count = 0 then
    raise exception 'El financiamiento no tiene cuotas pendientes';
  end if;

  select coalesce(sum(amount), 0) into v_balance_payments
  from public.payments
  where loan_id = p_loan_id and user_id = p_user_id;

  -- Tope contable: los pagos confirmados nunca pueden superar el total pactado.
  v_balance := round(least(v_balance_installments, greatest(v_loan.total_amount - v_balance_payments, 0)), 2);

  if v_balance <= 0 then
    raise exception 'El financiamiento no tiene saldo pendiente';
  end if;
  if p_amount > v_balance + 0.01 then
    raise exception 'El abono ($%) supera el saldo pendiente ($%)', round(p_amount, 2), v_balance;
  end if;

  v_applied := least(round(p_amount, 2), v_balance);
  v_new_balance := round(v_balance_installments - v_applied, 2);

  if v_new_balance <= 0 or v_new_balance < v_pending_count * 0.01 - 0.001 then
    v_settled := true;
    v_applied := v_balance_installments;
    v_new_balance := 0;
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('number', installment_number, 'amount', amount)
              order by installment_number),
    '[]'::jsonb
  ) into v_previous
  from public.loan_installments
  where loan_id = p_loan_id and user_id = p_user_id
    and coalesce(paid, false) = false;

  -- AplicaciÃ³n secuencial: liquidar cuotas completas y reducir la parcial.
  v_remaining := v_applied;
  for v_row in
    select id, installment_number, amount
    from public.loan_installments
    where loan_id = p_loan_id and user_id = p_user_id
      and coalesce(paid, false) = false
    order by installment_number
    for update
  loop
    exit when v_remaining <= 0;

    v_before := round(v_row.amount, 2);
    v_take := least(v_before, v_remaining);
    v_after := round(v_before - v_take, 2);

    v_distribution := v_distribution || jsonb_build_array(jsonb_build_object(
      'number', v_row.installment_number,
      'before', v_before,
      'after', v_after,
      'applied', v_take,
      'settled', v_after <= 0,
      'partial', v_after > 0 and v_take > 0
    ));

    if v_after <= 0 then
      update public.loan_installments
         set paid = true,
             paid_date = p_payment_date,
             receipt_ref = p_reference,
             updated_at = now()
       where id = v_row.id;

      v_settled_count := v_settled_count + 1;
    else
      update public.loan_installments
         set amount = v_after,
             updated_at = now()
       where id = v_row.id;

      v_partial_number := v_row.installment_number;
      v_partial_remaining := v_after;
    end if;

    v_remaining := round(v_remaining - v_take, 2);
  end loop;

  -- Estado real tras aplicar el movimiento.
  select count(*), coalesce(sum(amount), 0)
    into v_pending_count, v_new_balance
    from public.loan_installments
    where loan_id = p_loan_id and user_id = p_user_id
      and coalesce(paid, false) = false;

  select count(*) into v_total_count
  from public.loan_installments
  where loan_id = p_loan_id and user_id = p_user_id;

  select amount into v_next_amount
  from public.loan_installments
  where loan_id = p_loan_id and user_id = p_user_id
    and coalesce(paid, false) = false
  order by installment_number
  limit 1;

  v_settled := v_new_balance <= 0;
  v_next_amount := coalesce(v_next_amount, 0);
  v_partial_remaining := coalesce(v_partial_remaining, 0);

  if v_settled then
    v_status := 'completado';
  else
    select coalesce(
      case
        when bool_or(due_date < current_date) then 'moroso'
        when bool_or(due_date <= current_date + 3) then 'proximo'
        else 'al_dia'
      end,
      'al_dia'
    ) into v_status
    from public.loan_installments
    where loan_id = p_loan_id and user_id = p_user_id
      and coalesce(paid, false) = false;
  end if;

  -- Progreso monetario real: total pactado menos saldo pendiente. El total de
  -- cuotas pactado (v_total_count) jamÃ¡s se reduce.
  v_original_total := round(v_loan.total_amount, 2);
  if v_original_total <= 0 then
    select coalesce(sum(amount), 0) into v_original_total
    from public.loan_installments
    where loan_id = p_loan_id and user_id = p_user_id;
  end if;

  v_collected := round(least(greatest(v_original_total - v_new_balance, 0), v_original_total), 2);

  if v_original_total > 0 then
    v_progress := least(round(v_collected / v_original_total * 100), 100);
    v_covered := least(round(v_collected * v_total_count / v_original_total, 2), v_total_count);
  else
    v_progress := case when v_settled then 100 else 0 end;
    v_covered := v_total_count - v_pending_count;
  end if;
  v_remaining_eq := round(greatest(v_total_count - v_covered, 0), 2);

  v_progress_meta := jsonb_build_object(
    'progressPercent', v_progress,
    'coveredInstallments', v_covered,
    'remainingEquivalent', v_remaining_eq,
    'collectedAmount', v_collected,
    'pendingAmount', v_new_balance,
    'totalAmount', v_original_total,
    'totalInstallments', v_total_count,
    'updatedAt', now()
  );

  update public.loans
     set status = v_status,
         installment_amount = case when v_settled then 0 else v_next_amount end,
         final_status = case when v_settled then 'completado' else final_status end,
         metadata = case
           when v_settled then jsonb_set(
             jsonb_set(
               jsonb_set(coalesce(metadata, '{}'::jsonb), '{progress}', v_progress_meta),
               '{completedAt}', to_jsonb(p_payment_date::text)),
             '{finalStatus}', '"completado"'::jsonb)
           else jsonb_set(coalesce(metadata, '{}'::jsonb), '{progress}', v_progress_meta)
         end,
         updated_at = now()
   where id = p_loan_id and user_id = p_user_id;

  select coalesce(
    jsonb_agg(jsonb_build_object('number', installment_number, 'amount', amount)
              order by installment_number),
    '[]'::jsonb
  ) into v_next_installments
  from public.loan_installments
  where loan_id = p_loan_id and user_id = p_user_id
    and coalesce(paid, false) = false;

  v_payment_id := gen_random_uuid();
  insert into public.payments (
    id, user_id, loan_id, client_id, installment_number, amount,
    payment_date, method, reference, notes, metadata
  ) values (
    v_payment_id, p_user_id, p_loan_id, v_loan.client_id, null, v_applied,
    p_payment_date, p_method, p_reference, p_notes,
    jsonb_build_object(
      'clientName', v_loan.client_name,
      'kind', case when p_method = 'Pago de cuota' then 'cuota' else 'abono' end,
      'previousInstallmentAmount', v_loan.installment_amount,
      'balanceBefore', v_balance_installments,
      'balanceAfter', v_new_balance,
      'appliedAmount', v_applied,
      'settledInstallments', v_settled_count,
      'partialInstallment', case
        when v_partial_number is null then 'null'::jsonb
        else jsonb_build_object('number', v_partial_number, 'remaining', v_partial_remaining)
      end,
      'previousInstallments', v_previous,
      'appliedToInstallments', v_distribution,
      'nextInstallments', v_next_installments,
      'progress', v_progress_meta,
      'amountBs', p_amount_bs,
      'bcvRate', p_bcv_rate,
      'settled', v_settled
    )
  );

  return jsonb_build_object(
    'paymentId', v_payment_id,
    'appliedAmount', v_applied,
    'currentBalance', v_balance_installments,
    'newBalance', v_new_balance,
    'remainingInstallments', v_pending_count,
    'settledInstallments', v_settled_count,
    'partialInstallment', case
      when v_partial_number is null then 'null'::jsonb
      else jsonb_build_object('number', v_partial_number, 'remaining', v_partial_remaining)
    end,
    'installmentAmount', v_next_amount,
    'settled', v_settled,
    'status', v_status,
    'totalAmount', v_original_total,
    'totalInstallments', v_total_count,
    'coveredInstallments', v_covered,
    'remainingEquivalent', v_remaining_eq,
    'collectedAmount', v_collected,
    'pendingAmount', v_new_balance,
    'progressPercent', v_progress
  );
end;
$$;

revoke all on function public.register_loan_abono from public, anon;
grant execute on function public.register_loan_abono to authenticated, service_role;
