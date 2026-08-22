import { Candle } from "../core/indicators.js";

const NETWORK_MAP: Record<string, string> = {
  ethereum: "eth",
  eth: "eth",
  bsc: "bsc",
  base: "base",
  solana: "solana",
};

export function toGeckoNetwork(chainId: string): string | null {
  return NETWORK_MAP[chainId.toLowerCase()] ?? null;
}

export async function getOhlcv(
  network: string,
  poolAddress: string,
  timeframe: "day" | "hour" | "15m" = "hour",
  limit = 72
): Promise<Candle[]> {
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=1&limit=${limit}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: { attributes?: { ohlcv_list?: Array<[number, number, number, number, number, number]> } };
    };
    const raw = data.data?.attributes?.ohlcv_list ?? [];
    return raw
      .map((row) => ({ ts: row[0] * 1000, o: row[1], h: row[2], l: row[3], c: row[4], v: row[5] }))
      .sort((a, b) => a.ts - b.ts);
  } catch {
    return [];
  }
}
