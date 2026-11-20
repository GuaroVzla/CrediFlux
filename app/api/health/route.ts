import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/server/supabase/env';
import { persistenceInfo } from '@/server/persistence/supabase-store';

export const dynamic = 'force-dynamic';

/**
 * Diagnóstico público sin secretos: permite verificar que el deploy está vivo
 * y si las variables de Supabase llegaron al runtime de Vercel.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'crediflux',
    timestamp: new Date().toISOString(),
    supabaseConfigured: isSupabaseConfigured(),
    persistence: persistenceInfo(),
  });
}
