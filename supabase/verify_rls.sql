-- =============================================================================
-- Verificación de esquema y RLS en Supabase
-- Ejecutar en el SQL Editor después de aplicar supabase/schema.sql
-- =============================================================================

-- 1) Tablas creadas y estado de RLS
select
  n.nspname as schema,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;

-- 2) Políticas por tabla
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 3) Triggers de updated_at y alta de perfiles
select
  event_object_schema as schema,
  event_object_table as table_name,
  trigger_name,
  event_manipulation,
  action_timing
from information_schema.triggers
where event_object_schema in ('public', 'auth')
order by table_name, trigger_name;

-- 4) Verificar que no existan tablas públicas sin RLS
select c.relname as table_without_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity = false;

-- 5) Conteo de políticas por tabla (debe haber 4 en tablas de negocio)
select tablename, count(*) as policy_count
from pg_policies
where schemaname = 'public'
group by tablename
order by tablename;

-- 6) Simulación de aislamiento (ajusta los UUID según tu proyecto)
--    Reemplaza <AUTH_UID_USUARIO> por el id de auth.users de un operador.
--
-- begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', '<AUTH_UID_USUARIO>', 'role', 'authenticated')::text, true);
--   set local role authenticated;
--
--   -- Debe devolver solo los registros del usuario autenticado
--   select count(*) from public.clients;
--   select count(*) from public.loans;
--   select count(*) from public.payments;
--
--   -- Debe fallar por RLS si intenta escribir para otro user_id
--   -- insert into public.clients (user_id, name, dni) values ('<OTRO_UID>', 'X', 'V-0');
-- rollback;
