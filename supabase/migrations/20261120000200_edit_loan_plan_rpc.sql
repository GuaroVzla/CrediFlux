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
