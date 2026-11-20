-- =============================================================================
-- Índices de rendimiento — auditoría 2026-11-20
--
-- Cubren los ORDER BY y filtros que la aplicación ejecuta realmente:
--   * lib/server/supabase-store.ts -> getScopedState()
--   * lib/services/rates.ts        -> listExchangeRates()
--   * app/api/*                    -> filtros por cliente / estado / tipo
--
-- No alteran datos, RLS ni contratos de respuesta. Todos son IF NOT EXISTS,
-- por lo que la migración es idempotente y segura de reejecutar.
-- =============================================================================

-- getScopedState ordena las cuotas por installment_number filtrando por user_id.
create index if not exists loan_installments_user_number_idx
  on public.loan_installments (user_id, installment_number);

-- listExchangeRates y getScopedState ordenan por fetched_at sin filtrar source;
-- el índice previo (user_id, source, fetched_at) no puede satisfacer ese ORDER BY.
create index if not exists exchange_rates_user_fetched_idx
  on public.exchange_rates (user_id, fetched_at desc);

-- getScopedState ordena patrones por created_at (índice previo: user_id, bank_name).
create index if not exists receipt_patterns_user_created_idx
  on public.receipt_patterns (user_id, created_at desc);

-- getScopedState lee todos los perfiles ordenados por created_at en cada request.
create index if not exists profiles_created_at_idx
  on public.profiles (created_at);

-- Historial de préstamos archivados / activos.
create index if not exists loans_user_archived_created_idx
  on public.loans (user_id, archived, created_at desc);

-- Filtros por cliente y joins del RPC de purga.
create index if not exists payments_user_client_idx
  on public.payments (user_id, client_id);

create index if not exists payments_user_installment_idx
  on public.payments (user_id, installment_id);

-- Agregados de compras/ventas del dashboard.
create index if not exists ecommerce_user_type_date_idx
  on public.ecommerce_transactions (user_id, type, transaction_date desc);

-- Filtros por estado en transacciones P2P.
create index if not exists p2p_user_status_date_idx
  on public.p2p_transactions (user_id, status, occurred_at desc);

-- Auditoría por entidad (equivalente al índice que ya tiene Prisma).
create index if not exists audit_logs_user_entity_created_idx
  on public.audit_logs (user_id, entity, created_at desc);

-- getScopedState ordena niveles de confianza por sort_order.
create index if not exists trust_level_configs_user_sort_idx
  on public.trust_level_configs (user_id, sort_order);

-- client_id de la lista negra no tenía índice (ni FK); acelera búsquedas por cliente.
create index if not exists blacklist_entries_user_client_idx
  on public.blacklist_entries (user_id, client_id);

analyze public.loan_installments;
analyze public.exchange_rates;
analyze public.receipt_patterns;
analyze public.profiles;
