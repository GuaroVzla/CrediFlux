-- Purga granular por usuario para el modal "Vaciar datos del sistema" (Admin).
-- Todas las sentencias viven en UNA función: una sola llamada = una sola
-- transacción de PostgreSQL (no puede quedar un estado parcial).
-- Cada DELETE lleva user_id = p_target_user_id: jamás toca otros usuarios.

create or replace function public.admin_purge_user_system_data(
  p_target_user_id uuid,
  p_payment_ids uuid[] default array[]::uuid[],
  p_loan_ids uuid[] default array[]::uuid[],
  p_client_ids uuid[] default array[]::uuid[],
  p_product_ids uuid[] default array[]::uuid[],
  p_ecommerce_ids uuid[] default array[]::uuid[],
  p_capital_ids uuid[] default array[]::uuid[],
  p_reset_capital boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payments  integer := 0;
  v_loans     integer := 0;
  v_clients   integer := 0;
  v_products  integer := 0;
  v_ecommerce integer := 0;
  v_capital   integer := 0;
begin
  if p_target_user_id is null then
    raise exception 'Usuario destino requerido';
  end if;

  -- La ruta ya valida rol admin; aquí se refuerza la defensa en profundidad.
  if coalesce(current_setting('request.jwt.claim.role', true), '') not in ('service_role', 'admin')
     and not public.is_admin() then
    raise exception 'No autorizado para purgar datos del sistema';
  end if;

  -- Serializa purgas concurrentes sobre el mismo usuario.
  perform 1 from public.profiles where id = p_target_user_id for update;

  p_payment_ids  := coalesce(p_payment_ids, array[]::uuid[]);
  p_loan_ids     := coalesce(p_loan_ids, array[]::uuid[]);
  p_client_ids   := coalesce(p_client_ids, array[]::uuid[]);
  p_product_ids  := coalesce(p_product_ids, array[]::uuid[]);
  p_ecommerce_ids := coalesce(p_ecommerce_ids, array[]::uuid[]);
  p_capital_ids  := coalesce(p_capital_ids, array[]::uuid[]);

  -- Revertir cuotas de los pagos eliminados en financiamientos que se conservan.
  if array_length(p_payment_ids, 1) > 0 then
    update public.loan_installments i
       set paid = false, paid_date = null, receipt_ref = null, updated_at = now()
      from public.payments p
     where p.user_id = p_target_user_id
       and p.id = any(p_payment_ids)
       and not coalesce(p.loan_id = any(p_loan_ids), false)
       and i.user_id = p_target_user_id
       and i.loan_id = p.loan_id
       and (
         i.id = p.installment_id
         or (p.installment_number is not null and i.installment_number = p.installment_number)
         or (p.reference is not null and i.receipt_ref = p.reference)
       );

    update public.loans l
       set status = case
             when not exists (
               select 1 from public.loan_installments x
                where x.loan_id = l.id and not x.paid
             ) then 'completado'
             when exists (
               select 1 from public.loan_installments x
                where x.loan_id = l.id and not x.paid and x.due_date < current_date
             ) then 'moroso'
             when exists (
               select 1 from public.loan_installments x
                where x.loan_id = l.id and not x.paid
                  and x.due_date <= current_date + interval '3 days'
             ) then 'proximo'
             else 'al_dia'
           end,
           final_status = null,
           updated_at = now()
     where l.user_id = p_target_user_id
       and not l.archived
       and not coalesce(l.id = any(p_loan_ids), false)
       and l.id in (
         select distinct p2.loan_id from public.payments p2
          where p2.user_id = p_target_user_id
            and p2.id = any(p_payment_ids)
            and p2.loan_id is not null
       );
  end if;

  if array_length(p_payment_ids, 1) > 0 then
    delete from public.payments
     where user_id = p_target_user_id and id = any(p_payment_ids);
    get diagnostics v_payments = row_count;
  end if;

  if array_length(p_loan_ids, 1) > 0 then
    delete from public.loans
     where user_id = p_target_user_id and id = any(p_loan_ids);
    get diagnostics v_loans = row_count;
  end if;

  if array_length(p_client_ids, 1) > 0 then
    delete from public.clients
     where user_id = p_target_user_id and id = any(p_client_ids);
    get diagnostics v_clients = row_count;
  end if;

  if array_length(p_product_ids, 1) > 0 then
    delete from public.products
     where user_id = p_target_user_id and id = any(p_product_ids);
    get diagnostics v_products = row_count;
  end if;

  if array_length(p_ecommerce_ids, 1) > 0 then
    delete from public.ecommerce_transactions
     where user_id = p_target_user_id and id = any(p_ecommerce_ids);
    get diagnostics v_ecommerce = row_count;
  end if;

  if array_length(p_capital_ids, 1) > 0 then
    delete from public.capital_movements
     where user_id = p_target_user_id and id = any(p_capital_ids);
    get diagnostics v_capital = row_count;
  end if;

  -- Montos de capital operativo del usuario destino (además del historial).
  if p_reset_capital then
    update public.user_settings
       set ecommerce_capital = 0, updated_at = now()
     where user_id = p_target_user_id;

    update public.profiles
       set monthly_capitals = '{}'::jsonb
     where id = p_target_user_id;
  end if;

  return jsonb_build_object(
    'payments', v_payments,
    'loans', v_loans,
    'clients', v_clients,
    'products', v_products,
    'ecommerce', v_ecommerce,
    'capital', v_capital
  );
end;
$$;

revoke all on function public.admin_purge_user_system_data(
  uuid, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], boolean
) from public;

grant execute on function public.admin_purge_user_system_data(
  uuid, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], boolean
) to service_role, authenticated;

comment on function public.admin_purge_user_system_data(
  uuid, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], boolean
) is 'Purga atómica y aislada por usuario de datos del sistema (incluye capital operativo).';
