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

export interface PoolTrade {
  wallet: string;
  side: "buy" | "sell";
  usd: number;
  ts: number;
}

export async function getPoolTrades(
  network: string,
  poolAddress: string,
  minUsd = 500
): Promise<PoolTrade[]> {
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress}/trades?trade_volume_in_usd_greater_than=${minUsd}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: Array<{ attributes?: Record<string, unknown> }>;
    };
    const poolLower = poolAddress.toLowerCase();
    const out: PoolTrade[] = [];
    for (const t of data.data ?? []) {
      const a = t.attributes ?? {};
      const side = a.kind === "buy" || a.kind === "sell" ? a.kind : null;
      const usd = Number(a.volume_in_usd);
      const from = typeof a.tx_from === "string" ? a.tx_from : "";
      const to = typeof a.tx_to === "string" ? a.tx_to : "";
      const ts = Date.parse(String(a.block_timestamp ?? "")) || 0;
      if (!side || !Number.isFinite(usd) || usd <= 0) continue;
      const wallet = from && from.toLowerCase() !== poolLower ? from : to;
      if (!wallet || wallet.toLowerCase() === poolLower) continue;
      out.push({ wallet, side, usd, ts });
    }
    return out;
  } catch {
    return [];
  }
}

export async function getPoolBaseToken(network: string, poolAddress: string): Promise<string | null> {
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress}?include=base_token`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: { relationships?: { base_token?: { data?: { id?: string } } } };
    };
    const id = data.data?.relationships?.base_token?.data?.id;
    if (!id) return null;
    return id.split("_").slice(1).join("_").toLowerCase();
  } catch {
    return null;
  }
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
