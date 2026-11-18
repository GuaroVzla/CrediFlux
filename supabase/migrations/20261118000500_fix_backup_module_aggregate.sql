-- Corrige el resumen por módulos del respaldo: se precalcula recordCount por
-- módulo antes de la agregación JSON (evita agregados anidados).
-- No cambia el formato del archivo (formatVersion 1).

create or replace function public.admin_export_system_backup()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tables text[];
  v_table text;
  v_order_by text;
  v_rows jsonb;
  v_data jsonb := '{}'::jsonb;
  v_module_stats jsonb := '[]'::jsonb;
  v_modules jsonb := '{}'::jsonb;
  v_summary jsonb := '{}'::jsonb;
  v_schema_version text := '0';
  v_schema_digest text;
  v_module text;
  v_count integer;
begin
  if not public.admin_system_backup_role_ok() then
    raise exception 'No autorizado para exportar el respaldo del sistema' using errcode = '42501';
  end if;

  select coalesce(array_agg(c.relname order by c.relname), '{}'::text[])
    into v_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and c.relname not like '\_%' escape '\';

  select md5(coalesce(string_agg(t || '(' || cols || ')', '|' order by t), ''))
    into v_schema_digest
    from (
      select c.relname as t,
             coalesce(
               string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum),
               ''
             ) as cols
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       where n.nspname = 'public'
         and c.relkind in ('r', 'p')
         and c.relname not like '\_%' escape '\'
       group by c.relname
    ) s;

  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select coalesce(max(version), ''0'')::text from supabase_migrations.schema_migrations'
      into v_schema_version;
  else
    v_schema_version := v_schema_digest;
  end if;

  foreach v_table in array v_tables loop
    select string_agg(format('t.%I', a.attname), ', ' order by k.ord)
      into v_order_by
      from (
        select u.attnum, u.ord
          from pg_index i
          cross join lateral unnest(i.indkey) with ordinality as u(attnum, ord)
         where i.indrelid = to_regclass(format('public.%I', v_table))
           and i.indisprimary
      ) k
      join pg_attribute a
        on a.attrelid = to_regclass(format('public.%I', v_table))
       and a.attnum = k.attnum;

    execute format(
      'select coalesce(jsonb_agg(row_to_json(t) order by %s), ''[]''::jsonb) from public.%I t',
      coalesce(v_order_by, 't.ctid'),
      v_table
    ) into v_rows;

    v_data := v_data || jsonb_build_object(v_table, v_rows);
    v_count := jsonb_array_length(v_rows);
    v_summary := v_summary || jsonb_build_object(v_table, v_count);

    v_module := lower(split_part(v_table, '_', 1));
    v_module_stats := v_module_stats || jsonb_build_array(jsonb_build_object(
      'module', v_module,
      'table', v_table,
      'count', v_count
    ));
  end loop;

  select coalesce(
    jsonb_object_agg(
      s.module,
      jsonb_build_object(
        'tables', (
          select coalesce(jsonb_agg(x ->> 'table' order by x ->> 'table'), '[]'::jsonb)
            from jsonb_array_elements(v_module_stats) x
           where x ->> 'module' = s.module
        ),
        'counts', (
          select coalesce(jsonb_object_agg(x ->> 'table', (x ->> 'count')::integer), '{}'::jsonb)
            from jsonb_array_elements(v_module_stats) x
           where x ->> 'module' = s.module
        ),
        'recordCount', s.record_count
      )
    ),
    '{}'::jsonb
  )
    into v_modules
    from (
      select stat ->> 'module' as module,
             sum((stat ->> 'count')::integer) as record_count
        from jsonb_array_elements(v_module_stats) stat
       group by stat ->> 'module'
    ) s;

  return jsonb_build_object(
    'format', 'crediflux.system-backup',
    'formatVersion', 1,
    'schemaVersion', v_schema_version,
    'schemaDigest', v_schema_digest,
    'exportedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'tableCount', cardinality(v_tables),
    'recordCount', (select coalesce(sum(value::integer), 0) from jsonb_each_text(v_summary)),
    'modules', v_modules,
    'summary', v_summary,
    'tables', v_data
  );
end;
$$;

revoke all on function public.admin_export_system_backup() from public;
grant execute on function public.admin_export_system_backup() to service_role, authenticated;
