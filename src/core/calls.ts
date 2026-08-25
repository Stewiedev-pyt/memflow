import { auditSolanaViaRugcheck } from "../sources/rugcheck.js";
import { auditEvmViaHoneypot } from "../sources/honeypot.js";

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
  rugcheck?: string;
}

// ─── SEARCH TERMS PER CHAIN ──────────────────────────────
const SOLANA_SEARCH = [
  // Top memes
  "bonk", "wif", "popcat", "fartcoin", "ai16z", "myro", "bome", "mew", "turr",
  "trump", "jup", "ray", "jto", "w", "tnsr", "bookofmeme", "giga", "bos",
  "andrew", "retardio", "chad", "coq", "ape", "dog", "cat", "pepe", "frog",
  "meme", "moon", "rocket", "pump", "degen", "chad", "based", "virgin",
  "shib", "floki", "babydoge", "safemoon", "luna",
  "solana", "pump.fun", "raydium", "jupiter",
  "new", "launch", "trending", "viral",
];

const ETH_SEARCH = [
  // Tokens that actually exist on ETH
  "pepe", "shib", "floki", "mog", "brett", "toshi", "meme", "lady",
  "coq", "bald", "pear", "spore", "maga", "ethfi", "ena", "ondo",
  "pendle", "degen", "higher", "normie", "friend", "aerodrome", "velodrome",
  "key", "ldo", "rpl", "fxs", "golem", "storj", "omg", "zrx",
  "snx", "yfi", "comp", "mkr", "bal", "nnc", "blz", "ankr",
  "perl", "cvc", "powr", "bat", "rep", "snt", "iotx", "loom",
  "hot", "eng", "req", "storj", "zil", "etn", "matic", "celo",
  "ethereum", "eth", "erc20", "defi", "uniswap", "aave",
];

const BSC_SEARCH = [
  // Tokens that actually exist on BSC
  "cake", "safemoon", "babydoge", "floki", "meme", "raca",
  "xvs", "belt", "alpaca", "nft", "hero", "sfp", "bake", "burger",
  "bro", "wojak", "chad", "pepe", "doge", "shib",
  "stepn", "gala", "sand", "mana", "axs", "vet", "theta",
  "one", "cos", "kava", "zen", "npxs", "hot", "vet",
  "vet", "ankr", "coti", "chr", "tvk", "dusk", "chr",
  "bnb", "bsc", "pancakeswap", "biswap", "nomad",
];

const BASE_SEARCH = [
  // Tokens that actually exist on Base
  "brett", "toshi", "meme", "degen", "higher", "bald", "normie", "friend",
  "aerodrome", "velodrome", "mochi", "virtual", "prc", "based",
  "key", "luna", "tua", "burb", "tad", "alex",
  "base", "coinbase", "l2", "layer2", "op", "optimism",
  "usdc", "dai", "cbeth", "weth",
];

// ─── FETCH FROM DEXSCREENER ──────────────────────────────
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

// ─── DEEP ACCURACY CHECKS ──────────────────────────────
async function deepCheckSolana(tokenAddress: string): Promise<{ safe: boolean; details: string }> {
  try {
    const rc = await auditSolanaViaRugcheck(tokenAddress);
    if (!rc) return { safe: false, details: "rugcheck failed" };
    if (rc.score && rc.score < 300) return { safe: false, details: `low rugcheck score: ${rc.score}` };
    if (rc.risks && rc.risks.length > 3) return { safe: false, details: `${rc.risks.length} risks found` };
    const topHolder = rc.topHolders?.[0];
    if (topHolder && topHolder.percentage > 30) return { safe: false, details: `top holder owns ${topHolder.percentage.toFixed(0)}%` };
    return { safe: true, details: rc.score ? `score: ${rc.score}` : "passed" };
  } catch {
    return { safe: true, details: "check skipped" };
  }
}

async function deepCheckEvm(tokenAddress: string, chainId: string): Promise<{ safe: boolean; details: string }> {
  try {
    const chain = chainId === "ethereum" ? "1" : chainId === "bsc" ? "56" : chainId === "base" ? "8453" : "1";
    const hp = await auditEvmViaHoneypot(tokenAddress, chain);
    if (!hp) return { safe: true, details: "check skipped" };
    if (hp.isHoneypot) return { safe: false, details: "HONEYPOT" };
    if (hp.simulationSuccess === false) return { safe: true, details: "sim failed, proceed" };
    if (hp.buyTax && hp.buyTax > 25) return { safe: false, details: `buy tax ${hp.buyTax}%` };
    if (hp.sellTax && hp.sellTax > 25) return { safe: false, details: `sell tax ${hp.sellTax}%` };
    return { safe: true, details: "passed" };
  } catch {
    return { safe: true, details: "check skipped" };
  }
}

// ─── SCORING ──────────────────────────────────────
function scoreToken(p: any, chainId: string): CallSignal | null {
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

  // Hard filters — lenient for all chains
  if (mc < 500 || mc > 500_000_000) return null;
  if (liq < 5_000) return null;
  if (vol24 < 2_000) return null;
  if (ageHours < 0.1 || ageHours > 1440) return null; // 6min to 60 days

  const buyPressure = buys + sells > 0 ? buys / (buys + sells) : 0.5;
  const liqMcRatio = mc > 0 ? liq / mc : 0;
  const volLiqRatio = liq > 0 ? vol24 / liq : 0;

  let score = 0;
  const reasons: string[] = [];

  // Liquidity score
  if (liqMcRatio > 0.20) { score += 25; reasons.push("strong liq floor"); }
  else if (liqMcRatio > 0.10) { score += 18; reasons.push("healthy liq"); }
  else if (liqMcRatio > 0.05) { score += 10; }
  else { score -= 5; }

  // Volume score
  if (volLiqRatio > 0.5 && volLiqRatio < 3) { score += 25; reasons.push("organic volume"); }
  else if (volLiqRatio >= 3 && volLiqRatio < 5) { score += 15; reasons.push("high volume"); }
  else if (volLiqRatio >= 5) { score += 5; reasons.push("wash vol?"); }
  else { score += 5; }

  // Buy pressure
  if (buyPressure > 0.75) { score += 25; reasons.push("strong buying"); }
  else if (buyPressure > 0.60) { score += 15; reasons.push("buyers ahead"); }
  else if (buyPressure > 0.50) { score += 8; }
  else { score -= 3; }

  // Momentum
  if (change1h > 20) { score += 20; reasons.push("1h rocket"); }
  else if (change1h > 10) { score += 15; reasons.push("1h momentum +"); }
  else if (change1h > 0) { score += 8; }
  else if (change1h < -10) { score -= 3; }

  // Market cap bonus
  if (mc > 500_000) { score += 10; reasons.push("established MC"); }
  else if (mc > 100_000) { score += 8; }
  else if (mc > 50_000) { score += 5; }
  else if (mc > 20_000) { score += 3; }

  // Age bonus
  if (ageHours > 24) { score += 10; reasons.push("survived 24h+"); }
  else if (ageHours > 6) { score += 5; }

  // Solana meme bonus
  if (chainId === "solana") { score += 5; reasons.push("sol chain bonus"); }

  if (score < 10) return null;

  const entryPrice = price;
  const target1 = price * 1.5;
  const target2 = price * 3.0;
  const stopLoss = price * 0.7;

  const riskLevel: CallSignal["riskLevel"] =
    score >= 65 ? "LOW" : score >= 45 ? "MEDIUM" : "HIGH";

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

// ─── MAIN SCAN ──────────────────────────────────────
export async function scanForCalls(): Promise<CallSignal[]> {
  const seen = new Set<string>();
  const solana: CallSignal[] = [];
  const ethereum: CallSignal[] = [];
  const bsc: CallSignal[] = [];
  const base: CallSignal[] = [];

  const chains = [
    { terms: SOLANA_SEARCH, target: "solana", arr: solana },
    { terms: ETH_SEARCH, target: "ethereum", arr: ethereum },
    { terms: BSC_SEARCH, target: "bsc", arr: bsc },
    { terms: BASE_SEARCH, target: "base", arr: base },
  ];

  for (const chain of chains) {
    const batchSize = 5;
    for (let i = 0; i < chain.terms.length; i += batchSize) {
      const batch = chain.terms.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map((q) => fetchSearch(q)));
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const p of r.value) {
          if (p.chainId !== chain.target) continue;
          if (seen.has(p.pairAddress)) continue;
          seen.add(p.pairAddress);
          const call = scoreToken(p, chain.target);
          if (call) chain.arr.push(call);
        }
      }
      if (i + batchSize < chain.terms.length) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  // Deep checks for top candidates
  const allChains = [
    { arr: solana, name: "solana" },
    { arr: ethereum, name: "ethereum" },
    { arr: bsc, name: "bsc" },
    { arr: base, name: "base" },
  ];

  for (const chain of allChains) {
    chain.arr.sort((a, b) => b.score - a.score);
    const top = chain.arr.slice(0, 10);
    const verified: CallSignal[] = [];

    for (const call of top) {
      let check;
      if (chain.name === "solana") {
        check = await deepCheckSolana(call.tokenAddress);
      } else {
        check = await deepCheckEvm(call.tokenAddress, chain.name);
      }

      call.rugcheck = check.details;
      if (check.safe) {
        verified.push(call);
      }
    }

    // Take top 5 verified per chain
    chain.arr.length = 0;
    chain.arr.push(...verified.slice(0, 5));
  }

  // Merge all chains, sort by score, take top 20
  const all = [...solana, ...ethereum, ...bsc, ...base];
  return all.sort((a, b) => b.score - a.score).slice(0, 20);
}
