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
  info?: {
    imageUrl?: string;
    websites?: Array<{ label?: string; url: string }>;
    socials?: Array<{ type?: string; url: string }>;
  };
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
    baseAddress: p.baseToken.address?.toLowerCase(),
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

const CHAIN_PRIORITY: Record<string, number> = {
  solana: 0,
  ethereum: 1,
  bsc: 2,
  base: 3,
  polygon: 4,
  arbitrum: 5,
};

export function sortPairsByLiquidity(pairs: DexPair[]): DexPair[] {
  return [...pairs].sort((a, b) => {
    const aChain = CHAIN_PRIORITY[a.chainId] ?? 99;
    const bChain = CHAIN_PRIORITY[b.chainId] ?? 99;
    if (aChain !== bChain) return aChain - bChain;
    return (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0);
  });
}

export async function getTokenProfile(address: string): Promise<DexPair | null> {
  try {
    const data = await getJson<{ pairs: DexPair[] | null }>(
      `${BASE}/tokens/${address}`
    );
    return data.pairs?.[0] ?? null;
  } catch {
    return null;
  }
}

export interface NewPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  marketCap?: number;
  liquidity?: { usd?: number };
  volume?: { h1?: number; h6?: number; h24?: number };
  priceChange?: Record<string, number>;
  pairCreatedAt?: number;
}

export async function getNewPairs(chainId: string): Promise<NewPair[]> {
  try {
    const res = await fetch(
      `${BASE}/pairs/${chainId}?sort=pairCreatedAt&order=desc`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { pairs?: NewPair[] };
    return (data.pairs ?? []).slice(0, 30);
  } catch {
    return [];
  }
}
