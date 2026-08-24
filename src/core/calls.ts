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
  // memes
  "pepe", "doge", "shib", "bonk", "wif", "mog", "brett", "tremp", "giga",
  "floki", "ai16z", "fartcoin", "trump", "mew", "myro", "punk", "toshi",
  "bome", "popcat", "neiro", "coq", "babydoge", "maga", "retardio",
  // mid-caps
  "jup", "ray", "jto", "ondo", "ena", "ethfi", "strk", "sei", "sui", "apt",
  "arb", "op", "matic", "dot", "atom", "link", "uni", "aave", "comp",
  "mkr", "snx", "crv", "pendle", "dydx", "gmx", "render", "ar", "fet",
  "near", "icp", "fil", "theta", "eos", "algo", "vet", "hbar", "xrp",
  "sol", "eth", "bnb", "avax", "ftm",
  // pump.fun style
  "pump", "meme", "cat", "dog", "frog", "ape", "moon", "inu", "kitty",
  "wojak", "chad", "gigachad", "degen", "hippo", "seal", "otter", "quack",
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
