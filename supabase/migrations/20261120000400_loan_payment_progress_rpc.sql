-- =============================================================================
-- Pagos y abonos: cronograma, contador de cuotas y progreso
-- -----------------------------------------------------------------------------
-- Reemplaza register_loan_abono para que TODO pago (cuota o abono) descuente
-- del cronograma:
--   1. bloquea la fila del préstamo (SELECT ... FOR UPDATE)
--   2. valida propiedad, estado y monto contra el saldo pendiente
--   3. aplica el dinero en orden a las cuotas pendientes: marca como pagadas
--      las que cubre y reduce el saldo de la cuota parcial
--   4. actualiza saldo, cuotas restantes, progreso y estado del préstamo
--   5. inserta el movimiento en `payments` en un único CALL
-- El número total de cuotas nunca se modifica.
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

  -- Aplicación secuencial: liquidar cuotas completas y reducir la parcial.
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
  -- cuotas pactado (v_total_count) jamás se reduce.
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
