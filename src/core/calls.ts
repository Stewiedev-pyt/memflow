export interface CallSignal {
  symbol: string;
  name: string;
  chainId: string;
  pairAddress: string;
  tokenAddress: string;
  priceUsd: number;
  mcap: number;
  liquidityUsd: number;
  volH24: number;
  volH1: number;
  buysH24: number;
  sellsH24: number;
  buyPressure: number;
  liqMcRatio: number;
  volLiqRatio: number;
  priceChange24h: number;
  priceChange1h: number;
  ageHours: number;
  score: number;
  entryPrice: number;
  target1: number;
  target2: number;
  stopLoss: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
}

const SEARCH_POOL = [
  // Solana tokens (search by address to force SOL chain)
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // PEPE on SOL
  "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82", // BONK on SOL
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", // WIF on SOL
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", // POPCAT
  "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump", // FARTCOIN
  "HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC", // AI16Z
  "2zMMhcVQ6D1EJ45C15cGEM8wHzutUIxNOskDozRMry9F", // MYRO
  "7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3", // RETARDIO
  "A8C3xuqscfmyLrte3VVY7nREpozD7dJoS7PfC6LQ7U9P", // ANDY
  "3yFwqXBfZY6jC7Yv795225pVqqkB2JWSo5FgC68o69m4", // CHAD
  // Ethereum tokens
  "0x6982508145454Ce325dDbE47a25d4ec3d2311933", // PEPE on ETH
  "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4c", // SHIB on ETH
  "0x12970E6868f88f6557B76120662c1B3E50A646bf", // MOG on ETH
  "0x6B3595068618968D7a50D88F90ed87fabE78C00D", // SNT
  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", // UNI
  "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", // AAVE
  "0xD533a949740bb3306d119CC777fa900bA034cd52", // CRV
  "0x514910771AF9Ca656af840dff83E8264eCf986CA", // LINK
  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // WBTC
  // BSC tokens
  "0xcBF94bC6b2e3158b2bA52CDa73b3F5E8e5A3B9e2", // BABYDOGE on BSC
  "0x3EE2200Efb3400fAbB6A48b27633fA839B2B4F47", // ADA on BSC
  "0x7083609fCE4D1d8Dc0C979AAbb8cF8a83787d119", // LINK on BSC
  "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", // CAKE
  "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
  // Base tokens
  "0x4200000000000000000000000000000000000006", // WETH on Base
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
  // Generic searches (catch-all)
  "solana", "ethereum", "bsc",
];

async function fetchSearch(q: string): Promise<any[]> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(12_000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { pairs?: any[] };
    return data.pairs ?? [];
  } catch {
    return [];
  }
}

function scoreToken(p: any): CallSignal | null {
  const price = p.priceUsd ? Number(p.priceUsd) : 0;
  if (price <= 0) return null;

  const mc = p.marketCap ?? 0;
  const liq = p.liquidity?.usd ?? 0;
  const vol24 = p.volume?.h24 ?? 0;
  const vol1 = p.volume?.h1 ?? 0;
  const buys = p.txns?.h24?.buys ?? 0;
  const sells = p.txns?.h24?.sells ?? 0;
  const change24h = p.priceChange?.h24 ?? 0;
  const change1h = p.priceChange?.h1 ?? 0;
  const ageMs = p.pairCreatedAt ? Date.now() - p.pairCreatedAt : Infinity;
  const ageHours = ageMs / 3_600_000;

  // Hard filters
  if (mc < 10_000 || mc > 2_000_000) return null;
  if (liq < 5_000) return null;
  if (vol24 < 5_000) return null;
  if (ageHours < 1 || ageHours > 168) return null;

  const buyPressure = buys + sells > 0 ? buys / (buys + sells) : 0.5;
  const liqMcRatio = mc > 0 ? liq / mc : 0;
  const volLiqRatio = liq > 0 ? vol24 / liq : 0;

  let score = 0;
  const reasons: string[] = [];

  if (liqMcRatio > 0.15) { score += 25; reasons.push("strong liq floor"); }
  else if (liqMcRatio > 0.08) { score += 18; reasons.push("healthy liq"); }
  else if (liqMcRatio > 0.03) { score += 8; }
  else { score -= 10; }

  if (volLiqRatio > 0.5 && volLiqRatio < 3) { score += 25; reasons.push("organic volume"); }
  else if (volLiqRatio >= 3 && volLiqRatio < 5) { score += 15; reasons.push("high volume"); }
  else if (volLiqRatio >= 5) { score += 5; reasons.push("wash vol?"); }

  if (buyPressure > 0.7) { score += 20; reasons.push("strong buying"); }
  else if (buyPressure > 0.55) { score += 10; reasons.push("buyers ahead"); }
  else { score -= 5; reasons.push("selling pressure"); }

  if (change1h > 10) { score += 15; reasons.push("1h momentum +"); }
  else if (change1h > 0) { score += 8; }
  else if (change1h < -10) { score -= 5; }

  if (mc > 100_000) { score += 10; reasons.push("established MC"); }
  else if (mc > 50_000) { score += 5; }
  else if (mc > 20_000) { score += 3; }

  if (ageHours > 12) { score += 5; reasons.push("survived"); }

  if (score < 30) return null;

  const entryPrice = price;
  const target1 = price * 1.3;
  const target2 = price * 2.0;
  const stopLoss = price * 0.8;

  const riskLevel: CallSignal["riskLevel"] =
    score >= 60 ? "LOW" : score >= 45 ? "MEDIUM" : "HIGH";

  return {
    symbol: p.baseToken.symbol,
    name: p.baseToken.name,
    chainId: p.chainId,
    pairAddress: p.pairAddress,
    tokenAddress: p.baseToken.address,
    priceUsd: price,
    mcap: mc,
    liquidityUsd: liq,
    volH24: vol24,
    volH1: vol1,
    buysH24: buys,
    sellsH24: sells,
    buyPressure,
    liqMcRatio,
    volLiqRatio,
    priceChange24h: change24h,
    priceChange1h: change1h,
    ageHours,
    score,
    entryPrice,
    target1,
    target2,
    stopLoss,
    riskLevel,
    reasons,
  };
}

export async function scanForCalls(): Promise<CallSignal[]> {
  const seen = new Set<string>();
  const all: CallSignal[] = [];

  // Batch searches to avoid hammering the API
  const batchSize = 5;
  for (let i = 0; i < SEARCH_POOL.length; i += batchSize) {
    const batch = SEARCH_POOL.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map((q) => fetchSearch(q)));
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const p of r.value) {
        if (seen.has(p.pairAddress)) continue;
        seen.add(p.pairAddress);
        const call = scoreToken(p);
        if (call) all.push(call);
      }
    }
    // Small delay between batches
    if (i + batchSize < SEARCH_POOL.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return all.sort((a, b) => b.score - a.score).slice(0, 10);
}
