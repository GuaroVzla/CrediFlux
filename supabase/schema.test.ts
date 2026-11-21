import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url))
let sql = ''

describe('M-008: supabase/schema.sql — RLS, políticas y bucket de comprobantes', () => {
  beforeAll(() => {
    sql = fs.readFileSync(schemaPath, 'utf8')
  })

  it('habilita row level security en al menos 10 tablas críticas', () => {
    const rlsTables = Array.from(
      sql.matchAll(/alter table\s+public\.([a-z_]+)\s+enable row level security;/gi),
      (match) => match[1],
    )

    expect(rlsTables.length).toBeGreaterThanOrEqual(10)
    for (const table of [
      'profiles',
      'clients',
      'loans',
      'loan_installments',
      'payments',
      'ecommerce_transactions',
      'receipt_patterns',
      'audit_logs',
    ]) {
      expect(rlsTables).toContain(table)
    }
  })

  it('define políticas explícitas de acceso y políticas CRUD por usuario', () => {
    const policies = sql.match(/create policy\s+"[^"]+"/g) ?? []
    expect(policies.length).toBeGreaterThanOrEqual(10)
    expect(sql).toContain('create policy "profiles_select_own_or_admin"')
    expect(sql).toContain('create policy "user_settings_own"')
    expect(sql).toContain('create policy "audit_logs_select_own_or_admin"')
    expect(sql).toContain("'create policy %I on public.%I for select to authenticated")
    expect(sql).toContain("'_select_own'")
    expect(sql).toContain("'_insert_own'")
    expect(sql).toContain("'_update_own'")
    expect(sql).toContain("'_delete_own'")
  })

  it('aísla la configuración OCR global: singleton, RLS y sin políticas para usuarios', () => {
    expect(sql).toContain('create table if not exists public.admin_ocr_settings')
    expect(sql).toContain("check (id = 'global')")
    expect(sql).toMatch(/alter table\s+public\.admin_ocr_settings\s+enable row level security;/)
    expect(sql).toContain('revoke all on public.admin_ocr_settings from anon, authenticated')
    expect(sql).not.toMatch(/create policy\s+"[^"]+"\s+on public\.admin_ocr_settings/)
  })

  it('mantiene RLS de patrones por usuario: la lectura global es sólo service_role', () => {
    expect(sql).toContain("'exchange_rates', 'p2p_transactions', 'receipt_patterns',")
    expect(sql).toContain("using (user_id = (select auth.uid()))")
    expect(sql).not.toMatch(/create policy\s+"receipt_patterns_[^"]*admin/)
    expect(sql).not.toMatch(/create policy\s+"receipt_patterns_select_all/)
  })

  it('configura el bucket privado receipts con políticas sobre storage.objects', () => {
    expect(sql).toMatch(/insert into storage\.buckets[\s\S]*?'receipts'[\s\S]*?false[\s\S]*?on conflict \(id\) do nothing/)

    for (const action of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toContain(`create policy "receipts_${action}_own"`)
      expect(sql).toMatch(new RegExp(`on storage\\.objects for ${action} to authenticated`))
    }
    expect(sql).toContain("bucket_id = 'receipts'")
    expect(sql).toContain("(storage.foldername(name))[1] = (select auth.uid())::text")
  })

  it('incluye la RPC atómica para editar condiciones de pago', () => {
    expect(sql).toContain('create or replace function public.update_loan_plan(')
    expect(sql).toContain('for update')
    expect(sql).toContain('from public.payments')
    expect(sql).toContain('no puede ser menor al monto ya abonado')
    expect(sql).toContain('grant execute on function public.update_loan_plan to authenticated, service_role')
  })

  it('incluye la RPC atómica que descuenta pagos y abonos del cronograma', () => {
    expect(sql).toContain('create or replace function public.register_loan_abono(')
    expect(sql).toContain('for update')
    expect(sql).toContain('insert into public.payments')
    expect(sql).toContain('supera el saldo pendiente')
    expect(sql).toContain("'settled', v_after <= 0")
    expect(sql).toContain("'partial', v_after > 0 and v_take > 0")
    expect(sql).toContain("'kind', case when p_method = 'Pago de cuota' then 'cuota' else 'abono' end")
    expect(sql).toContain("'{progress}', v_progress_meta")
    expect(sql).toContain('grant execute on function public.register_loan_abono to authenticated, service_role')
  })

  it('la RPC no expone parámetros de inventario ni de datos congelados', () => {
    const start = sql.indexOf('create or replace function public.update_loan_plan(')
    const nextFunction = sql.indexOf('create or replace function public.', start + 1)
    const rpc = sql.slice(start, nextFunction === -1 ? undefined : nextFunction)
    for (const forbidden of [
      'p_stock_deltas', 'p_client_id', 'p_product_id', 'p_principal', 'p_down_payment',
      'update public.products', 'update public.clients', 'insert into public.payments',
    ]) {
      expect(rpc).not.toContain(forbidden)
    }
  })
})
