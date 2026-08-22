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

export async function getPairsByAddresses(addresses: string[]): Promise<DexPair[]> {
  if (addresses.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += 30) {
    chunks.push(addresses.slice(i, i + 30));
  }
  const results: DexPair[] = [];
  for (const chunk of chunks) {
    const data = await getJson<{ pairs: DexPair[] | null }>(
      `${BASE}/pairs/${chunk.join("/")}`
    );
    results.push(...(data.pairs ?? []));
  }
  return results;
}

export function toSnapshot(p: DexPair): import("../core/types.js").PairSnapshot {
  return {
    pairAddress: p.pairAddress,
    chainId: p.chainId,
    symbol: p.baseToken.symbol,
    priceUsd: p.priceUsd ? Number(p.priceUsd) : undefined,
    liquidityUsd: p.liquidity?.usd,
    volM5: p.volume?.m5,
    volH1: p.volume?.h1,
    volH24: p.volume?.h24,
    buysM5: p.txns?.m5?.buys,
    sellsM5: p.txns?.m5?.sells,
    mcap: p.marketCap,
    ts: Date.now(),
  };
}

export function sortPairsByLiquidity(pairs: DexPair[]): DexPair[] {
  return [...pairs].sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
  );
}
