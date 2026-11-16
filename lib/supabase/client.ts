'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';
import { assertSupabaseEnv } from './env';

type BrowserClient = ReturnType<typeof createBrowserClient<Database>>;

let browserClient: BrowserClient | null = null;

export function createSupabaseBrowserClient(): BrowserClient {
  if (browserClient) return browserClient;
  const { url, anonKey } = assertSupabaseEnv();
  browserClient = createBrowserClient<Database>(url, anonKey);
  return browserClient;
}
