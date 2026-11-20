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

  it('configura el bucket privado receipts con políticas sobre storage.objects', () => {
    expect(sql).toMatch(/insert into storage\.buckets[\s\S]*?'receipts'[\s\S]*?false[\s\S]*?on conflict \(id\) do nothing/)

    for (const action of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toContain(`create policy "receipts_${action}_own"`)
      expect(sql).toMatch(new RegExp(`on storage\\.objects for ${action} to authenticated`))
    }
    expect(sql).toContain("bucket_id = 'receipts'")
    expect(sql).toContain("(storage.foldername(name))[1] = (select auth.uid())::text")
  })
})
