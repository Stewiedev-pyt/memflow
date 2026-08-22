export interface CgCoin {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank: number | null;
}

export async function searchCoins(query: string): Promise<CgCoin[]> {
  const key = process.env.COINGECKO_API_KEY ?? "";
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}&x_cg_demo_api_key=${key}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { coins?: CgCoin[] };
    return data.coins ?? [];
  } catch {
    return [];
  }
}
