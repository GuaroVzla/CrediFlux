import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BINANCE_P2P_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutos de caché en memoria

type P2PSide = {
  price: number;
  count: number;
  volume: number;
};

type P2PPayload = {
  success: true;
  asset: string;
  fiat: string;
  buy: P2PSide | null;
  sell: P2PSide | null;
  average: number | null;
  updatedAt: string;
};

let cache: { payload: P2PPayload; timestamp: number } | null = null;

const round = (value: number, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Promedio ponderado por volumen disponible (USDT) de las ofertas P2P.
 * Se descartan valores atípicos (±30% de la mediana) para evitar anuncios
 * con precios irreales que distorsionen la tasa.
 */
function computeWeightedSide(ads: any[]): P2PSide | null {
  const rows = ads
    .map((ad: any) => {
      const price = Number(ad?.adv?.price);
      const volume = Number(
        ad?.adv?.surplusAmount
        ?? ad?.adv?.tradableQuantity
        ?? ad?.adv?.maxSingleTransAmount
      );
      return {
        price,
        volume: Number.isFinite(volume) && volume > 0 ? volume : 0
      };
    })
    .filter((row) => Number.isFinite(row.price) && row.price > 0);

  if (rows.length === 0) return null;

  const sortedPrices = rows.map((row) => row.price).sort((a, b) => a - b);
  const median = sortedPrices[Math.floor(sortedPrices.length / 2)];
  const filtered = rows.filter((row) => row.price >= median * 0.7 && row.price <= median * 1.3);
  const sample = filtered.length > 0 ? filtered : rows;

  const totalVolume = sample.reduce((sum, row) => sum + row.volume, 0);
  const weightedPrice = totalVolume > 0
    ? sample.reduce((sum, row) => sum + row.price * row.volume, 0) / totalVolume
    : sample.reduce((sum, row) => sum + row.price, 0) / sample.length;

  return {
    price: round(weightedPrice),
    count: sample.length,
    volume: round(totalVolume)
  };
}

async function fetchAds(tradeType: 'BUY' | 'SELL'): Promise<any[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(BINANCE_P2P_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      },
      body: JSON.stringify({
        fiat: 'VES',
        page: 1,
        rows: 20,
        tradeType,
        asset: 'USDT',
        payTypes: [],
        countries: []
      }),
      cache: 'no-store',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Binance P2P respondió con estado ${response.status}`);
    }

    const json: any = await response.json();
    return Array.isArray(json?.data) ? json.data : [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get('force') === '1';
  const now = Date.now();

  if (!force && cache && now - cache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ ...cache.payload, cached: true });
  }

  try {
    const [buyAds, sellAds] = await Promise.all([fetchAds('BUY'), fetchAds('SELL')]);
    const buy = computeWeightedSide(buyAds);
    const sell = computeWeightedSide(sellAds);

    if (!buy && !sell) {
      throw new Error('Binance P2P no devolvió ofertas para el par VES/USDT');
    }

    const average = buy && sell
      ? round((buy.price + sell.price) / 2)
      : (buy?.price ?? sell?.price ?? null);

    const payload: P2PPayload = {
      success: true,
      asset: 'USDT',
      fiat: 'VES',
      buy,
      sell,
      average,
      updatedAt: new Date().toISOString()
    };

    cache = { payload, timestamp: now };
    return NextResponse.json({ ...payload, cached: false });
  } catch (error: any) {
    if (cache) {
      return NextResponse.json({
        ...cache.payload,
        cached: true,
        stale: true,
        warning: 'No se pudo actualizar la tasa P2P; se muestra el último valor disponible.'
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: error?.name === 'AbortError'
          ? 'Tiempo de espera agotado al consultar Binance P2P'
          : (error?.message || 'No se pudo consultar Binance P2P')
      },
      { status: 502 }
    );
  }
}
