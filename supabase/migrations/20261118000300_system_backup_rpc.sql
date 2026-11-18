-- =============================================================================
-- CrediFlux - Respaldo y migración dinámica del sistema (Admin)
-- Versión: 2026-11-18
--
-- No hay listas hardcodeadas de tablas: se consulta el catálogo de PostgreSQL
-- (pg_class / information_schema / pg_constraint) en cada llamada. Las tablas
-- nuevas quedan incluidas automáticamente; las obsoletas se ignoran con aviso.
--
-- Una llamada RPC = UNA transacción. Si cualquier INSERT falla, PostgreSQL
-- hace ROLLBACK de todos los DELETE/INSERT anteriores.
-- =============================================================================

create or replace function public.admin_system_backup_role_ok()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_role text := coalesce(
    v_claims ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt', true), '')::jsonb ->> 'role'
  );
begin
  if coalesce(v_role, '') in ('service_role', 'admin') then
    return true;
  end if;
  return public.is_admin();
end;
$$;

revoke all on function public.admin_system_backup_role_ok() from public;
grant execute on function public.admin_system_backup_role_ok() to service_role, authenticated;

-- -----------------------------------------------------------------------------
-- EXPORTACIÓN: serializa TODAS las tablas base del schema public.
-- -----------------------------------------------------------------------------
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
    -- Orden estable por PRIMARY KEY cuando existe; ctid como respaldo genérico.
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

    -- El módulo se deriva del nombre de la tabla, no de una lista fija.
    v_module := lower(split_part(v_table, '_', 1));
    v_modules := jsonb_set(
      v_modules,
      array[v_module, 'tables'],
      coalesce(v_modules -> v_module -> 'tables', '[]'::jsonb) || to_jsonb(v_table),
      true
    );
    v_modules := jsonb_set(
      v_modules,
      array[v_module, 'counts', v_table],
      to_jsonb(v_count),
      true
    );
    v_modules := jsonb_set(
      v_modules,
      array[v_module, 'recordCount'],
      to_jsonb(coalesce((v_modules -> v_module ->> 'recordCount')::integer, 0) + v_count),
      true
    );
  end loop;

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

-- -----------------------------------------------------------------------------
-- IMPORTACIÓN: valida, ordena por dependencias FK y restaura de forma atómica.
-- p_dry_run = true calcula el plan sin escribir (útil para verificación).
-- -----------------------------------------------------------------------------
create or replace function public.admin_import_system_backup(
  p_payload jsonb,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_format_version integer;
  v_tables jsonb;
  v_table text;
  v_rows jsonb;
  v_all_tables text[];
  v_present text[];
  v_deps jsonb := '{}'::jsonb;
  v_pending text[];
  v_ready text[];
  v_order text[] := '{}'::text[];
  v_cols text[];
  v_payload_cols text[];
  v_col_list text;
  v_select_list text;
  v_auth_cols text[];
  v_auth_col text;
  v_idx integer;
  v_original_count integer;
  v_affected integer;
  v_skipped_total integer := 0;
  v_counts jsonb := '{}'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
begin
  if not public.admin_system_backup_role_ok() then
    raise exception 'No autorizado para restaurar el respaldo del sistema' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Archivo de respaldo inválido: la raíz debe ser un objeto JSON' using errcode = '22023';
  end if;
  if p_payload ? 'format' and p_payload ->> 'format' <> 'crediflux.system-backup' then
    raise exception 'Formato de respaldo no soportado' using errcode = '22023';
  end if;

  v_format_version := coalesce((p_payload ->> 'formatVersion')::integer, 1);
  if v_format_version > 1 then
    raise exception 'Versión de respaldo no soportada: %', v_format_version using errcode = '22023';
  end if;

  v_tables := p_payload -> 'tables';
  if jsonb_typeof(v_tables) <> 'object' then
    raise exception 'Archivo de respaldo inválido: falta el bloque "tables"' using errcode = '22023';
  end if;

  for v_table, v_rows in select key, value from jsonb_each(v_tables) loop
    if jsonb_typeof(v_rows) <> 'array' then
      raise exception 'Bloque inválido en "%": se esperaba un arreglo', v_table using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(v_rows) x where jsonb_typeof(x) <> 'object') then
      raise exception 'Bloque inválido en "%": cada registro debe ser un objeto', v_table using errcode = '22023';
    end if;
  end loop;

  select coalesce(array_agg(c.relname order by c.relname), '{}'::text[])
    into v_all_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and c.relname not like '\_%' escape '\';

  select coalesce(array_agg(key order by key), '{}'::text[])
    into v_present
    from jsonb_each(v_tables)
   where key = any(v_all_tables);

  select v_warnings || coalesce(
    jsonb_agg(jsonb_build_object(
      'table', key,
      'reason', 'tabla obsoleta: no existe en el esquema actual; se ignoró'
    )),
    '[]'::jsonb
  )
    into v_warnings
    from jsonb_each(v_tables)
   where not (key = any(v_all_tables));

  -- Grafo de dependencias directo (hijo -> padres), calculado desde pg_constraint.
  select coalesce(jsonb_object_agg(child, parents), '{}'::jsonb)
    into v_deps
    from (
      select cl.relname as child,
             coalesce(
               jsonb_agg(distinct cf.relname) filter (
                 where cf.relname is not null and cf.relname <> cl.relname
               ),
               '[]'::jsonb
             ) as parents
        from pg_constraint con
        join pg_class cl on cl.oid = con.conrelid
        join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
        left join pg_class cf on cf.oid = con.confrelid
       where con.contype = 'f'
         and cl.relname = any(v_present)
       group by cl.relname
    ) d;

  -- Orden topológico (Kahn): padres primero al insertar, hijos primero al borrar.
  v_pending := v_present;
  while cardinality(v_pending) > 0 loop
    select coalesce(array_agg(t order by t), '{}'::text[])
      into v_ready
      from unnest(v_pending) t
     where not exists (
       select 1
         from jsonb_array_elements_text(coalesce(v_deps -> t, '[]'::jsonb)) p
        where p = any(v_pending)
          and p <> t
     );

    if cardinality(v_ready) = 0 then
      v_warnings := v_warnings || jsonb_build_array(
        jsonb_build_object('reason', 'ciclo de foreign keys: se resolvió por orden alfabético')
      );
      v_order := v_order || v_pending;
      exit;
    end if;

    v_order := v_order || v_ready;
    select coalesce(array_agg(x order by x), '{}'::text[])
      into v_pending
      from unnest(v_pending) x
     where not (x = any(v_ready));
  end loop;

  if not p_dry_run and cardinality(v_order) > 0 then
    -- DELETE (nunca TRUNCATE) en orden inverso: hijos antes que padres.
    for v_idx in reverse cardinality(v_order)..1 loop
      v_table := v_order[v_idx];
      -- safeupdate de Supabase exige un WHERE explícito incluso en SECURITY DEFINER.
      execute format('delete from public.%I where true', v_table);
      get diagnostics v_affected = row_count;
      v_counts := jsonb_set(
        v_counts,
        array[v_table, 'deleted'],
        to_jsonb(v_affected),
        true
      );
    end loop;
  end if;

  foreach v_table in array v_order loop
    v_rows := v_tables -> v_table;
    v_original_count := jsonb_array_length(v_rows);

    -- Compatibilidad: si el respaldo viene de un esquema anterior, se omiten
    -- columnas nuevas; los valores por defecto de la BD quedan intactos.
    select coalesce(array_agg(distinct k order by k), '{}'::text[])
      into v_payload_cols
      from jsonb_array_elements(v_rows) x
      cross join lateral jsonb_object_keys(x) k;

    select coalesce(array_agg(c order by c), '{}'::text[])
      into v_cols
      from unnest(v_payload_cols) c
     where exists (
       select 1 from information_schema.columns ic
        where ic.table_schema = 'public'
          and ic.table_name = v_table
          and ic.column_name = c
          and coalesce(ic.is_generated, 'NEVER') = 'NEVER'
          and coalesce(ic.is_identity, 'NO') = 'NO'
     );

    -- Las FK a auth.users no se pueden recrear: se ignoran filas huérfanas.
    if to_regclass('auth.users') is not null then
      select coalesce(array_agg(a.attname order by a.attnum), '{}'::text[])
        into v_auth_cols
        from pg_constraint con
        join pg_class cl on cl.oid = con.conrelid and cl.relname = v_table
        join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
        join pg_attribute a on a.attrelid = cl.oid and a.attnum = any(con.conkey)
        join pg_class cf on cf.oid = con.confrelid
        join pg_namespace nf on nf.oid = cf.relnamespace and nf.nspname = 'auth'
       where con.contype = 'f';

      foreach v_auth_col in array v_auth_cols loop
        execute format(
          'select coalesce(jsonb_agg(x), ''[]''::jsonb)
             from jsonb_array_elements($1) x
            where x->%1$L is null
               or coalesce(x->>%1$L, '''') = ''''
               or (x->>%1$L)::uuid in (select id from auth.users)',
          v_auth_col
        ) using v_rows into v_rows;
      end loop;
    end if;

    v_original_count := v_original_count - jsonb_array_length(v_rows);
    if v_original_count > 0 then
      v_skipped_total := v_skipped_total + v_original_count;
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'table', v_table,
        'skippedRows', v_original_count,
        'reason', 'referencia inexistente en auth.users; se conservaron los valores por defecto'
      ));
    end if;

    if v_original_count > 0 or cardinality(v_cols) = 0 then
      if cardinality(v_cols) = 0 and jsonb_array_length(v_rows) > 0 then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'table', v_table,
          'reason', 'sin columnas insertables en el esquema actual; se omitió'
        ));
      end if;
    end if;

    if not p_dry_run and jsonb_array_length(v_rows) > 0 and cardinality(v_cols) > 0 then
      select string_agg(format('%I', c), ', '),
             string_agg(format('(s.r).%I', c), ', ')
        into v_col_list, v_select_list
        from unnest(v_cols) c;

      execute format(
        'insert into public.%I (%s)
         select %s
           from (
             select jsonb_populate_record(null::public.%I, x) as r
               from jsonb_array_elements($1) x
           ) s',
        v_table, v_col_list, v_select_list, v_table
      ) using v_rows;
      get diagnostics v_affected = row_count;
    else
      v_affected := jsonb_array_length(v_rows);
    end if;

    v_counts := jsonb_set(
      v_counts,
      array[v_table, 'inserted'],
      to_jsonb(v_affected),
      true
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'dryRun', p_dry_run,
    'appliedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'sourceSchemaVersion', coalesce(p_payload ->> 'schemaVersion', ''),
    'tableCount', cardinality(v_order),
    'skippedRows', v_skipped_total,
    'counts', v_counts,
    'warnings', v_warnings,
    'order', v_order
  );
end;
$$;

revoke all on function public.admin_import_system_backup(jsonb, boolean) from public;
grant execute on function public.admin_import_system_backup(jsonb, boolean) to service_role, authenticated;

comment on function public.admin_export_system_backup() is
  'Respaldo dinámico y versionado de todas las tablas públicas del sistema.';
comment on function public.admin_import_system_backup(jsonb, boolean) is
  'Restauración atómica, ordenada por FK y tolerante a cambios de esquema.';
