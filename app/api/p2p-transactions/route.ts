import { NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/server/auth/request-auth';
import { createP2PTransaction, listP2PTransactions } from '@/server/services/rates';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await resolveRequestAuth(request);
  if (!auth.userId || !auth.supabase) {
    return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
  }
  try {
    const limit = Number(new URL(request.url).searchParams.get('limit')) || 100;
    const transactions = await listP2PTransactions(auth.supabase, auth.userId, limit);
    return NextResponse.json({ success: true, transactions });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'Error al listar operaciones P2P' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await resolveRequestAuth(request);
  if (!auth.userId || !auth.supabase) {
    return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const transaction = await createP2PTransaction(auth.supabase, auth.userId, {
      side: body.side === 'buy' ? 'buy' : 'sell',
      amountUsdt: Number(body.amountUsdt),
      amountVes: Number(body.amountVes),
      rate: Number(body.rate),
      counterparty: body.counterparty,
      bank: body.bank,
      reference: body.reference,
      status: body.status,
      occurredAt: body.occurredAt,
      notes: body.notes,
    });
    return NextResponse.json({ success: true, transaction });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'Error al guardar la operación P2P' }, { status: 400 });
  }
}
