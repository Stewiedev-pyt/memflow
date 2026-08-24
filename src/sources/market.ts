const CG_KEY = () => process.env.COINGECKO_API_KEY ?? "";

export interface GlobalMarketData {
  activeCryptos: number;
  totalMarketCapUsd: number;
  totalVolumeUsd: number;
  btcDominance: number;
  ethDominance: number;
  topCoins: Array<{
    name: string;
    symbol: string;
    marketCapRank: number;
    priceUsd: number;
    priceChange24h: number;
    marketCap: number;
    volume24h: number;
  }>;
}

export async function getGlobalMarket(): Promise<GlobalMarketData | null> {
  try {
    const key = CG_KEY();
    const url = `https://api.coingecko.com/api/v3/global?x_cg_demo_api_key=${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: {
        active_cryptocurrencies?: number;
        total_market_cap?: { usd?: number };
        total_volume?: { usd?: number };
        market_cap_percentage?: { btc?: number; eth?: number };
      };
    };
    const g = data.data;
    if (!g) return null;

    const coinsRes = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h&x_cg_demo_api_key=${key}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    const coins = coinsRes.ok
      ? ((await coinsRes.json()) as Array<{
          name: string;
          symbol: string;
          market_cap_rank: number;
          current_price: number;
          price_change_percentage_24h: number;
          market_cap: number;
          total_volume: number;
        }>)
      : [];

    return {
      activeCryptos: g.active_cryptocurrencies ?? 0,
      totalMarketCapUsd: g.total_market_cap?.usd ?? 0,
      totalVolumeUsd: g.total_volume?.usd ?? 0,
      btcDominance: g.market_cap_percentage?.btc ?? 0,
      ethDominance: g.market_cap_percentage?.eth ?? 0,
      topCoins: coins.map((c) => ({
        name: c.name,
        symbol: c.symbol.toUpperCase(),
        marketCapRank: c.market_cap_rank ?? 0,
        priceUsd: c.current_price,
        priceChange24h: c.price_change_percentage_24h ?? 0,
        marketCap: c.market_cap,
        volume24h: c.total_volume,
      })),
    };
  } catch {
    return null;
  }
}

export interface FearGreedIndex {
  value: number;
  classification: string;
  history: Array<{
    value: number;
    classification: string;
    timestamp: string;
  }>;
}

export async function getFearGreedIndex(): Promise<FearGreedIndex | null> {
  try {
    const res = await fetch(
      "https://api.alternative.me/fng/?limit=7&format=json",
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Array<{ value: string; value_classification: string; timestamp: string }>;
    };
    const d = data.data;
    if (!d || d.length === 0) return null;
    return {
      value: Number(d[0].value),
      classification: d[0].value_classification,
      history: d.map((h) => ({
        value: Number(h.value),
        classification: h.value_classification,
        timestamp: h.timestamp,
      })),
    };
  } catch {
    return null;
  }
}

export interface TrendingCoin {
  name: string;
  symbol: string;
  marketCapRank: number | null;
  priceBtc: string;
}

export async function getTrendingCoins(): Promise<TrendingCoin[]> {
  try {
    const key = CG_KEY();
    const res = await fetch(
      `https://api.coingecko.com/api/v3/search/trending?x_cg_demo_api_key=${key}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      coins?: Array<{
        item: {
          name: string;
          symbol: string;
          market_cap_rank: number | null;
          data?: { price_btc?: string };
        };
      }>;
    };
    return (data.coins ?? []).map((c) => ({
      name: c.item.name,
      symbol: c.item.symbol,
      marketCapRank: c.item.market_cap_rank,
      priceBtc: c.item.data?.price_btc ?? "",
    }));
  } catch {
    return [];
  }
}
