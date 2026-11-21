-- =============================================================================
-- Registro atómico de abonos sobre el saldo de un financiamiento
-- -----------------------------------------------------------------------------
-- Un único CALL:
--   1. bloquea la fila del préstamo (SELECT ... FOR UPDATE) para serializar
--      abonos concurrentes y ediciones de condiciones de pago
--   2. recalcula el saldo desde las cuotas pendientes y los pagos confirmados
--   3. valida propiedad, estado y monto (nunca deja saldo negativo)
--   4. redistribuye el saldo restante con ajuste centenario en la última cuota
--      o liquida todas las pendientes si el abono cubre el saldo
--   5. inserta el movimiento en `payments` y actualiza el préstamo
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
  -- La sesión del usuario debe coincidir con el propietario. service_role
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
  -- entre el cronograma y total abonado para absorber descuadres históricos
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
