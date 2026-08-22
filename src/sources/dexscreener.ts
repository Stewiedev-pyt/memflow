export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { symbol: string };
  priceNative: string;
  priceUsd?: string;
  txns: Record<string, { buys: number; sells: number }>;
  volume: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

const BASE = "https://api.dexscreener.com/latest/dex";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`DexScreener ${res.status} on ${url}`);
  }
  return (await res.json()) as T;
}

export async function searchPairs(query: string): Promise<DexPair[]> {
  const data = await getJson<{ pairs: DexPair[] | null }>(
    `${BASE}/search?q=${encodeURIComponent(query)}`
  );
  return data.pairs ?? [];
}

export function sortPairsByLiquidity(pairs: DexPair[]): DexPair[] {
  return [...pairs].sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
  );
}
