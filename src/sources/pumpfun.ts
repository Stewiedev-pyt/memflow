import { config } from "../config.js";

const RPC_URL = () => `https://mainnet.helius-rpc.com/?api-key=${config.heliusKey}`;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`helius rpc ${res.status}`);
  const data = (await res.json()) as { error?: { message?: string }; result?: T };
  if (data.error) throw new Error(`helius rpc error: ${data.error.message ?? "unknown"}`);
  return data.result as T;
}

export interface TokenMeta {
  creator: string;
  mintAuthority: string | null;
  supply: string;
  decimals: number;
}

export async function getCreator(mint: string): Promise<string | null> {
  try {
    const info = await rpc<{ value?: { data?: { parsed?: { info?: { mintAuthority?: string } } } } }>(
      "getAccountInfo",
      [mint, { encoding: "jsonParsed" }]
    );
    return info.value?.data?.parsed?.info?.mintAuthority ?? null;
  } catch {
    return null;
  }
}

export async function getTokenCreator(mint: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.helius.xyz/v0/token-metadata?api-key=${config.heliusKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mintAccounts: [mint] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ creator?: string; authority?: string }>;
    return data[0]?.creator ?? data[0]?.authority ?? null;
  } catch {
    return null;
  }
}

export interface DeployerToken {
  mint: string;
  name: string;
  symbol: string;
  pairAddress: string | null;
  chainId: string;
  priceUsd: number | null;
  mcap: number | null;
  liquidityUsd: number | null;
  volH24: number | null;
  createdAt: number;
}

export async function getDeployerTokens(deployer: string): Promise<DeployerToken[]> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${deployer}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { pairs?: Array<{
      baseToken: { address: string; name: string; symbol: string };
      pairAddress: string;
      chainId: string;
      priceUsd?: string;
      marketCap?: number;
      liquidity?: { usd?: number };
      volume?: { h24?: number };
      pairCreatedAt?: number;
    }> };
    const pairs = data.pairs ?? [];
    const byMint = new Map<string, DeployerToken>();
    for (const p of pairs) {
      if (byMint.has(p.baseToken.address)) continue;
      byMint.set(p.baseToken.address, {
        mint: p.baseToken.address,
        name: p.baseToken.name,
        symbol: p.baseToken.symbol,
        pairAddress: p.pairAddress,
        chainId: p.chainId,
        priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
        mcap: p.marketCap ?? null,
        liquidityUsd: p.liquidity?.usd ?? null,
        volH24: p.volume?.h24 ?? null,
        createdAt: p.pairCreatedAt ?? 0,
      });
    }
    return [...byMint.values()].sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}
