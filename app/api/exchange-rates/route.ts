import { NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/server/auth/request-auth';
import { createExchangeRate, listExchangeRates } from '@/server/services/rates';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await resolveRequestAuth(request);
  if (!auth.userId || !auth.supabase) {
    return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
  }
  try {
    const limit = Number(new URL(request.url).searchParams.get('limit')) || 100;
    const rates = await listExchangeRates(auth.supabase, auth.userId, limit);
    return NextResponse.json({ success: true, rates });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'Error al listar tasas' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await resolveRequestAuth(request);
  if (!auth.userId || !auth.supabase) {
    return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const rate = await createExchangeRate(auth.supabase, auth.userId, {
      source: body.source === 'binance_p2p' ? 'binance_p2p' : body.source === 'manual' ? 'manual' : 'bcv',
      rate: Number(body.rate),
      buyRate: body.buyRate == null ? null : Number(body.buyRate),
      sellRate: body.sellRate == null ? null : Number(body.sellRate),
      baseCurrency: body.baseCurrency,
      quoteCurrency: body.quoteCurrency,
      isManual: Boolean(body.isManual),
      fetchedAt: body.fetchedAt,
      raw: body.raw && typeof body.raw === 'object' ? body.raw : {},
    });
    return NextResponse.json({ success: true, rate });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'Error al guardar la tasa' }, { status: 400 });
  }
}
