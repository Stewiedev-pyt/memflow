import { searchPairs, sortPairsByLiquidity } from "../sources/dexscreener.js";
import { getPoolTrades, toGeckoNetwork } from "../sources/geckoterminal.js";
import { getTokenLargestAccounts } from "../sources/helius.js";
import { analyzeCandles } from "../core/indicators.js";
import { recordTrades, analyzeTopTraders } from "../core/toptraders.js";
import { scanForCalls } from "../core/calls.js";
import { auditEvmViaHoneypot } from "../sources/honeypot.js";
import { auditSolanaViaRugcheck } from "../sources/rugcheck.js";
import { getNews } from "../sources/cryptopanic.js";
import { getGlobalMarket, getFearGreedIndex } from "../sources/market.js";

export interface ActionResult {
  success: boolean;
  data: any;
  error?: string;
}

// ─── SCAN ──────────────────────────────────────────────
export async function actionScan(query: string): Promise<ActionResult> {
  try {
    const allPairs = sortPairsByLiquidity(await searchPairs(query));
    const best = allPairs.find(
      (p) => p.baseToken.symbol.toLowerCase() === query.toLowerCase()
    ) ?? allPairs[0];
    if (!best) return { success: false, data: null, error: `No token found for "${query}"` };

    const network = toGeckoNetwork(best.chainId);
    const candles = network ? await getOhlcvSafe(network, best.pairAddress) : [];
    const tech = analyzeCandles(candles);

    return {
      success: true,
      data: {
        symbol: best.baseToken.symbol,
        name: best.baseToken.name,
        chain: best.chainId,
        dex: best.dexId,
        pairAddress: best.pairAddress,
        tokenAddress: best.baseToken.address,
        price: best.priceUsd,
        mcap: best.marketCap,
        liquidity: best.liquidity?.usd,
        volume24h: best.volume?.h24,
        priceChange24h: best.priceChange?.h24,
        priceChange1h: best.priceChange?.h1,
        buys24h: best.txns?.h24?.buys,
        sells24h: best.txns?.h24?.sells,
        ageHours: best.pairCreatedAt ? (Date.now() - best.pairCreatedAt) / 3_600_000 : null,
        tech,
        allPairs: allPairs.slice(0, 5).map((p) => ({
          symbol: p.baseToken.symbol,
          chain: p.chainId,
          dex: p.dexId,
          pairAddress: p.pairAddress,
          price: p.priceUsd,
          mcap: p.marketCap,
          liquidity: p.liquidity?.usd,
        })),
      },
    };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

// ─── AUDIT ──────────────────────────────────────────────
export async function actionAudit(query: string): Promise<ActionResult> {
  try {
    const allPairs = sortPairsByLiquidity(await searchPairs(query));
    const best = allPairs.find(
      (p) => p.baseToken.symbol.toLowerCase() === query.toLowerCase()
    ) ?? allPairs[0];
    if (!best) return { success: false, data: null, error: `No token found for "${query}"` };

    const tokenAddr = best.baseToken.address;
    const [hpResult, rcResult] = await Promise.allSettled([
      best.chainId !== "solana" ? auditEvmViaHoneypot(tokenAddr) : Promise.resolve(null),
      best.chainId === "solana" ? auditSolanaViaRugcheck(tokenAddr) : Promise.resolve(null),
    ]);

    const hp = hpResult.status === "fulfilled" ? hpResult.value : null;
    const rc = rcResult.status === "fulfilled" ? rcResult.value : null;

    return {
      success: true,
      data: {
        symbol: best.baseToken.symbol,
        chain: best.chainId,
        tokenAddress: tokenAddr,
        honeypot: hp,
        rugcheck: rc,
        riskScore: calculateRisk(hp, rc),
      },
    };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

// ─── CALLS ──────────────────────────────────────────────
export async function actionCalls(): Promise<ActionResult> {
  try {
    const calls = await scanForCalls();
    return { success: true, data: calls };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

// ─── HOLDERS ──────────────────────────────────────────────
export async function actionHolders(query: string): Promise<ActionResult> {
  try {
    const allPairs = sortPairsByLiquidity(await searchPairs(query));
    const best = allPairs.find(
      (p) => p.baseToken.symbol.toLowerCase() === query.toLowerCase()
    ) ?? allPairs[0];
    if (!best) return { success: false, data: null, error: `No token found for "${query}"` };

    let holders: Array<{ address: string; balance: number }> = [];
    if (best.chainId === "solana") {
      const h = await getTokenLargestAccounts(best.baseToken.address);
      holders = h.map((x) => ({ address: x.address, balance: x.uiAmount }));
    }

    const total = holders.reduce((s, h) => s + h.balance, 0);
    const categorized = {
      whales: holders.filter((h) => total > 0 && (h.balance / total) * 100 >= 5),
      sharks: holders.filter((h) => { const pct = total > 0 ? (h.balance / total) * 100 : 0; return pct >= 1 && pct < 5; }),
      fish: holders.filter((h) => { const pct = total > 0 ? (h.balance / total) * 100 : 0; return pct >= 0.1 && pct < 1; }),
      small: holders.filter((h) => total > 0 && (h.balance / total) * 100 < 0.1),
    };

    return {
      success: true,
      data: {
        symbol: best.baseToken.symbol,
        chain: best.chainId,
        totalHolders: holders.length,
        categories: {
          whales: { count: categorized.whales.length, pct: categorized.whales.reduce((s, h) => s + (total > 0 ? (h.balance / total) * 100 : 0), 0) },
          sharks: { count: categorized.sharks.length, pct: categorized.sharks.reduce((s, h) => s + (total > 0 ? (h.balance / total) * 100 : 0), 0) },
          fish: { count: categorized.fish.length, pct: categorized.fish.reduce((s, h) => s + (total > 0 ? (h.balance / total) * 100 : 0), 0) },
          small: { count: categorized.small.length, pct: categorized.small.reduce((s, h) => s + (total > 0 ? (h.balance / total) * 100 : 0), 0) },
        },
      },
    };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

// ─── TOP TRADERS ──────────────────────────────────────────────
export async function actionTopTraders(query: string): Promise<ActionResult> {
  try {
    const allPairs = sortPairsByLiquidity(await searchPairs(query));
    const best = allPairs.find(
      (p) => p.baseToken.symbol.toLowerCase() === query.toLowerCase()
    ) ?? allPairs[0];
    if (!best) return { success: false, data: null, error: `No token found for "${query}"` };

    const network = toGeckoNetwork(best.chainId);
    if (!network || network === "solana") {
      return { success: true, data: { symbol: best.baseToken.symbol, chain: best.chainId, traders: [], note: "Top traders only available on EVM chains" } };
    }

    const trades = await getPoolTrades(network, best.pairAddress);
    const filtered = trades.filter((t) => t.usd >= 800 && t.usd < 5_000_000);
    recordTrades(best.pairAddress, filtered);
    const consensus = analyzeTopTraders(best.pairAddress);

    return {
      success: true,
      data: {
        symbol: best.baseToken.symbol,
        chain: best.chainId,
        consensus,
      },
    };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

// ─── GEMS ──────────────────────────────────────────────
export async function actionGems(): Promise<ActionResult> {
  const seen = new Set<string>();
  const gems: any[] = [];
  const terms = ["pepe", "doge", "bonk", "wif", "ai16z", "fartcoin", "trump", "jup", "sui", "apt", "arb", "render", "near"];

  for (const term of terms) {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(term)}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const data = (await res.json()) as { pairs?: any[] };
      for (const p of data.pairs ?? []) {
        if (seen.has(p.pairAddress)) continue;
        seen.add(p.pairAddress);
        const mc = p.marketCap ?? 0;
        const liq = p.liquidity?.usd ?? 0;
        const vol = p.volume?.h24 ?? 0;
        if (mc < 2_000 || mc > 300_000 || liq < 500 || vol < 100) continue;
        gems.push({
          symbol: p.baseToken.symbol,
          chain: p.chainId,
          tokenAddress: p.baseToken.address,
          pairAddress: p.pairAddress,
          mcap: mc,
          liquidity: liq,
          volume: vol,
          priceChange24h: p.priceChange?.h24 ?? 0,
          buyPressure: (p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0) > 0 ? (p.txns?.h24?.buys ?? 0) / ((p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0)) : 0.5,
        });
      }
    } catch { continue; }
  }

  return {
    success: true,
    data: gems.sort((a, b) => b.mcap - a.mcap).slice(0, 15),
  };
}

// ─── MARKET ──────────────────────────────────────────────
export async function actionMarket(): Promise<ActionResult> {
  try {
    const [market, fear] = await Promise.allSettled([getGlobalMarket(), getFearGreedIndex()]);
    return {
      success: true,
      data: {
        market: market.status === "fulfilled" ? market.value : null,
        fearGreed: fear.status === "fulfilled" ? fear.value : null,
      },
    };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

// ─── NEWS ──────────────────────────────────────────────
export async function actionNews(query: string): Promise<ActionResult> {
  try {
    const news = await getNews(query);
    return { success: true, data: { ticker: query, articles: news } };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

// ─── TOP TOKENS BY CHAIN ──────────────────────────────────
const CHAIN_SEARCH_TERMS: Record<string, string[]> = {
  solana: ["bonk", "wif", "pepe", "fartcoin", "trump", "jup", "ray", "jto", "w", "tnsr", "myro", "bome", "bookofmeme", "popcat", "mew", "brett", "andrew", "giga", "turf", " bos"],
  ethereum: ["pepe", "shib", "floki", "meme", "lady", "coq", "brett", "bald", "pear", "toshi", "spore", "maga", "ethfi", "ena", "ondo", "pendle"],
  bsc: ["cake", "safemoon", "babydoge", "floki", "meme", "baby", "raca", "xvs", "belt", "alpaca", "nft", "hero", "sfp"],
  base: ["brett", "toshi", "meme", "degen", "higher", "bald", "burb", "tad", "normie", "friend", "alex"],
};

export async function actionTopTokens(chain?: string): Promise<ActionResult> {
  try {
    const chains = chain ? [chain.toLowerCase()] : ["solana", "ethereum", "bsc", "base"];
    const allTokens: any[] = [];
    const seen = new Set<string>();

    for (const c of chains) {
      const terms = CHAIN_SEARCH_TERMS[c] ?? [];
      for (const term of terms) {
        try {
          const res = await fetch(
            `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(term)}`,
            { signal: AbortSignal.timeout(10_000) }
          );
          if (!res.ok) continue;
          const data = (await res.json()) as { pairs?: any[] };
          for (const p of data.pairs ?? []) {
            if (p.chainId !== c) continue;
            if (seen.has(p.baseToken.address)) continue;
            seen.add(p.baseToken.address);
            const mc = p.marketCap ?? 0;
            const liq = p.liquidity?.usd ?? 0;
            const vol = p.volume?.h24 ?? 0;
            const buys = p.txns?.h24?.buys ?? 0;
            const sells = p.txns?.h24?.sells ?? 0;
            if (mc < 1_000_000) continue;
            if (liq < 100_000) continue;
            allTokens.push({
              symbol: p.baseToken.symbol,
              name: p.baseToken.name,
              chain: p.chainId,
              dex: p.dexId,
              tokenAddress: p.baseToken.address,
              pairAddress: p.pairAddress,
              price: p.priceUsd,
              mcap: mc,
              liquidity: liq,
              volume24h: vol,
              priceChange24h: p.priceChange?.h24 ?? 0,
              priceChange1h: p.priceChange?.h1 ?? 0,
              buys24h: buys,
              sells24h: sells,
              buyPressure: buys + sells > 0 ? buys / (buys + sells) : 0.5,
              ageHours: p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 3_600_000 : null,
            });
          }
        } catch {
          continue;
        }
      }
    }

    const sorted = allTokens
      .sort((a, b) => b.mcap - a.mcap)
      .slice(0, 20);

    return {
      success: true,
      data: {
        chain: chain ?? "all",
        total: sorted.length,
        tokens: sorted,
      },
    };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

// ─── LOW CAP GEMS ──────────────────────────────────────────
export async function actionLowCapGems(chain?: string): Promise<ActionResult> {
  try {
    const chains = chain ? [chain.toLowerCase()] : ["solana", "ethereum", "bsc", "base"];
    const gems: any[] = [];
    const seen = new Set<string>();
    const terms = ["pepe", "doge", "bonk", "wif", "ai16z", "fartcoin", "trump", "jup", "sui", "apt", "arb", "render", "near", "meme", "shib", "floki", "brett", "toshi", "degen"];

    for (const term of terms) {
      try {
        const res = await fetch(
          `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(term)}`,
          { signal: AbortSignal.timeout(10_000) }
        );
        if (!res.ok) continue;
        const data = (await res.json()) as { pairs?: any[] };
        for (const p of data.pairs ?? []) {
          if (!chains.includes(p.chainId)) continue;
          if (seen.has(p.baseToken.address)) continue;
          seen.add(p.baseToken.address);
          const mc = p.marketCap ?? 0;
          const liq = p.liquidity?.usd ?? 0;
          const vol = p.volume?.h24 ?? 0;
          const buys = p.txns?.h24?.buys ?? 0;
          const sells = p.txns?.h24?.sells ?? 0;
          if (mc < 50_000 || mc > 500_000) continue;
          if (liq < 5_000) continue;
          if (vol < 100) continue;
          gems.push({
            symbol: p.baseToken.symbol,
            name: p.baseToken.name,
            chain: p.chainId,
            tokenAddress: p.baseToken.address,
            pairAddress: p.pairAddress,
            price: p.priceUsd,
            mcap: mc,
            liquidity: liq,
            volume24h: vol,
            priceChange24h: p.priceChange?.h24 ?? 0,
            buys24h: buys,
            sells24h: sells,
            buyPressure: buys + sells > 0 ? buys / (buys + sells) : 0.5,
            liqMcRatio: mc > 0 ? liq / mc : 0,
            ageHours: p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 3_600_000 : null,
          });
        }
      } catch {
        continue;
      }
    }

    const sorted = gems
      .sort((a, b) => {
        const scoreA = a.liqMcRatio * 0.4 + a.buyPressure * 0.3 + (a.volume24h / a.mcap) * 0.3;
        const scoreB = b.liqMcRatio * 0.4 + b.buyPressure * 0.3 + (b.volume24h / b.mcap) * 0.3;
        return scoreB - scoreA;
      })
      .slice(0, 15);

    return {
      success: true,
      data: {
        chain: chain ?? "all",
        total: sorted.length,
        gems: sorted,
      },
    };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

// ─── HELPERS ──────────────────────────────────────────────
async function getOhlcvSafe(network: string, pairAddress: string) {
  try {
    const { getOhlcv } = await import("../sources/geckoterminal.js");
    return await getOhlcv(network, pairAddress, "hour", 72);
  } catch {
    return [];
  }
}

function calculateRisk(hp: any, rc: any): string {
  let score = 0;
  if (hp) {
    if (hp.isHoneypot) score += 50;
    if (hp.simulationSuccess === false) score += 20;
    if (hp.buyTax && hp.buyTax > 10) score += 15;
    if (hp.sellTax && hp.sellTax > 10) score += 15;
  }
  if (rc) {
    if (rc.score && rc.score < 300) score += 20;
    if (rc.risks) score += rc.risks.length * 5;
  }
  if (score >= 50) return "DANGER";
  if (score >= 25) return "HIGH";
  if (score >= 10) return "MEDIUM";
  return "LOW";
}
