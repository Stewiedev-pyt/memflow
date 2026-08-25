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

// ─── WALLET ANALYZER ──────────────────────────────────────
export async function actionWalletAnalyzer(wallet: string): Promise<ActionResult> {
  try {
    const { getWalletTokenAccounts, getSolBalance, getSignatures } = await import("../sources/wallet.js");

    const [solBalance, tokenAccounts, signatures] = await Promise.all([
      getSolBalance(wallet),
      getWalletTokenAccounts(wallet),
      getSignatures(wallet, 50),
    ]);

    const mints = tokenAccounts.map((t) => t.mint).join(",");
    let prices: Record<string, { price: number; mcap: number; change24h: number; symbol: string; name: string }> = {};

    if (mints) {
      try {
        const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mints}`, {
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          const data = (await res.json()) as any[];
          for (const p of data) {
            prices[p.baseToken.address] = {
              price: Number(p.priceUsd) || 0,
              mcap: p.marketCap ?? 0,
              change24h: p.priceChange?.h24 ?? 0,
              symbol: p.baseToken.symbol,
              name: p.baseToken.name,
            };
          }
        }
      } catch { /* continue */ }
    }

    let totalValue = solBalance * 140;
    let totalPnl = 0;
    const holdings: any[] = [];

    for (const t of tokenAccounts) {
      const info = prices[t.mint] ?? { price: 0, mcap: 0, change24h: 0, symbol: t.mint.slice(0, 6), name: "Unknown" };
      const value = t.uiAmount * info.price;
      totalValue += value;
      holdings.push({
        symbol: info.symbol,
        name: info.name,
        mint: t.mint,
        balance: t.uiAmount,
        price: info.price,
        value,
        change24h: info.change24h,
        mcap: info.mcap,
      });
    }

    holdings.sort((a, b) => b.value - a.value);

    const recentSigs = signatures.slice(0, 10);
    const firstTx = signatures[signatures.length - 1];
    const lastTx = signatures[0];
    const ageDays = firstTx?.blockTime ? (Date.now() / 1000 - firstTx.blockTime) / 86400 : 0;
    const txFrequency = ageDays > 0 ? signatures.length / ageDays : 0;

    return {
      success: true,
      data: {
        wallet,
        solBalance,
        totalValueUsd: totalValue,
        holdingsCount: holdings.length,
        holdings,
        stats: {
          ageDays: Math.round(ageDays),
          totalTransactions: signatures.length,
          txFrequency: txFrequency.toFixed(2),
          firstTx: firstTx?.blockTime ? new Date(firstTx.blockTime * 1000).toISOString() : null,
          lastTx: lastTx?.blockTime ? new Date(lastTx.blockTime * 1000).toISOString() : null,
        },
        recentActivity: recentSigs.map((s) => ({
          signature: s.signature,
          time: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null,
          success: !s.err,
        })),
      },
    };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

// ─── WALLET TRACKER ──────────────────────────────────────
const trackedWallets = new Map<string, { label: string; addedAt: number }>();

export async function actionTrackWallet(wallet: string, label?: string): Promise<ActionResult> {
  try {
    if (!/^[\w]{32,44}$/.test(wallet)) {
      return { success: false, data: null, error: "Invalid Solana wallet address" };
    }
    const entry = { label: label ?? wallet.slice(0, 8), addedAt: Date.now() };
    trackedWallets.set(wallet, entry);
    return {
      success: true,
      data: {
        wallet,
        label: entry.label,
        message: `Now tracking ${entry.label}`,
        totalTracked: trackedWallets.size,
      },
    };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

export async function actionUntrackWallet(wallet: string): Promise<ActionResult> {
  const removed = trackedWallets.delete(wallet);
  return {
    success: removed,
    data: { wallet, message: removed ? "Untracked" : "Not found" },
  };
}

export async function actionTrackedWallets(): Promise<ActionResult> {
  const list = Array.from(trackedWallets.entries()).map(([addr, info]) => ({
    wallet: addr,
    label: info.label,
    addedAt: new Date(info.addedAt).toISOString(),
  }));
  return {
    success: true,
    data: { total: list.length, wallets: list },
  };
}

// ─── TRENCHES (NEW TOKEN DISCOVERY) ──────────────────────
export async function actionTrenches(): Promise<ActionResult> {
  try {
    const [pumpFun, dexNew] = await Promise.all([
      fetchNewPumpFun(),
      fetchNewDexScreener(),
    ]);

    const seen = new Set<string>();
    const tokens: any[] = [];

    for (const t of [...pumpFun, ...dexNew]) {
      if (seen.has(t.address)) continue;
      seen.add(t.address);
      tokens.push(t);
    }

    const sorted = tokens
      .sort((a, b) => {
        const scoreA = (a.liq / (a.mcap || 1)) * 0.3 + a.buyPressure * 0.3 + (a.volume / (a.mcap || 1)) * 0.4;
        const scoreB = (b.liq / (b.mcap || 1)) * 0.3 + b.buyPressure * 0.3 + (b.volume / (b.mcap || 1)) * 0.4;
        return scoreB - scoreA;
      })
      .slice(0, 20);

    return {
      success: true,
      data: { total: sorted.length, tokens: sorted },
    };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

async function fetchNewPumpFun(): Promise<any[]> {
  try {
    const res = await fetch("https://frontend-api-v3.pump.fun/coins?limit=30&sort=created_timestamp&order=DESC&includeNsfw=false", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any[];
    return data.map((c: any) => ({
      symbol: c.symbol,
      name: c.name,
      address: c.mint,
      chain: "solana",
      source: "pump.fun",
      mcap: c.usd_market_cap ?? 0,
      liq: 0,
      volume: 0,
      price: c.virtual_sol_reserves ? String(c.virtual_sol_reserves / c.virtual_token_reserves * 140) : "0",
      buyPressure: 0.5,
      ageMinutes: c.created_timestamp ? (Date.now() - c.created_timestamp) / 60000 : 0,
      creator: c.creator ?? null,
    }));
  } catch {
    return [];
  }
}

async function fetchNewDexScreener(): Promise<any[]> {
  try {
    const res = await fetch("https://api.dexscreener.com/latest/dex/search?q=sol", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { pairs?: any[] };
    return (data.pairs ?? [])
      .filter((p) => p.chainId === "solana" && p.marketCap && p.marketCap < 500_000 && p.marketCap > 5_000)
      .map((p) => {
        const buys = p.txns?.h1?.buys ?? 0;
        const sells = p.txns?.h1?.sells ?? 0;
        return {
          symbol: p.baseToken.symbol,
          name: p.baseToken.name,
          address: p.baseToken.address,
          chain: "solana",
          source: "dexscreener",
          mcap: p.marketCap ?? 0,
          liq: p.liquidity?.usd ?? 0,
          volume: p.volume?.h24 ?? 0,
          price: p.priceUsd,
          buyPressure: buys + sells > 0 ? buys / (buys + sells) : 0.5,
          ageHours: p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 3_600_000 : null,
          creator: null,
        };
      });
  } catch {
    return [];
  }
}

// ─── PORTFOLIO / PNL TRACKING ──────────────────────────────
const portfolios = new Map<string, Map<string, { symbol: string; entryPrice: number; amount: number; entryTime: number }>>();

export async function actionPortfolioAdd(
  chatId: string,
  symbol: string,
  entryPrice: number,
  amount: number
): Promise<ActionResult> {
  try {
    if (!portfolios.has(chatId)) portfolios.set(chatId, new Map());
    const portfolio = portfolios.get(chatId)!;

    if (portfolio.has(symbol.toUpperCase())) {
      const existing = portfolio.get(symbol.toUpperCase())!;
      const avgPrice = (existing.entryPrice * existing.amount + entryPrice * amount) / (existing.amount + amount);
      existing.entryPrice = avgPrice;
      existing.amount += amount;
      existing.symbol = symbol.toUpperCase();
      return {
        success: true,
        data: { symbol: symbol.toUpperCase(), avgPrice: existing.entryPrice, totalAmount: existing.amount },
      };
    }

    portfolio.set(symbol.toUpperCase(), {
      symbol: symbol.toUpperCase(),
      entryPrice,
      amount,
      entryTime: Date.now(),
    });

    return {
      success: true,
      data: { symbol: symbol.toUpperCase(), entryPrice, amount, totalPositions: portfolio.size },
    };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

export async function actionPortfolioRemove(chatId: string, symbol: string): Promise<ActionResult> {
  const portfolio = portfolios.get(chatId);
  if (!portfolio || !portfolio.has(symbol.toUpperCase())) {
    return { success: false, data: null, error: `No position for ${symbol.toUpperCase()}` };
  }
  portfolio.delete(symbol.toUpperCase());
  return { success: true, data: { symbol: symbol.toUpperCase(), message: "Position removed" } };
}

export async function actionPortfolioView(chatId: string): Promise<ActionResult> {
  const portfolio = portfolios.get(chatId);
  if (!portfolio || portfolio.size === 0) {
    return { success: true, data: { positions: [], message: "No positions tracked" } };
  }

  const symbols = Array.from(portfolio.keys());
  let prices: Record<string, { price: number; symbol: string }> = {};

  try {
    const searchQuery = symbols.slice(0, 5).join("|");
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(searchQuery)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { pairs?: any[] };
      for (const p of data.pairs ?? []) {
        const sym = p.baseToken.symbol.toUpperCase();
        if (!prices[sym] && symbols.includes(sym)) {
          prices[sym] = { price: Number(p.priceUsd) || 0, symbol: sym };
        }
      }
    }
  } catch { /* continue */ }

  const positions: any[] = [];
  let totalInvested = 0;
  let totalCurrent = 0;

  for (const [sym, pos] of portfolio) {
    const currentPrice = prices[sym]?.price ?? 0;
    const invested = pos.entryPrice * pos.amount;
    const current = currentPrice * pos.amount;
    const pnl = current - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

    totalInvested += invested;
    totalCurrent += current;

    positions.push({
      symbol: sym,
      entryPrice: pos.entryPrice,
      currentPrice,
      amount: pos.amount,
      invested,
      current,
      pnl,
      pnlPct,
      holdDays: Math.round((Date.now() - pos.entryTime) / 86400000),
    });
  }

  const totalPnl = totalCurrent - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  const winners = positions.filter((p) => p.pnl > 0);
  const losers = positions.filter((p) => p.pnl < 0);
  const breakeven = positions.filter((p) => p.pnl === 0);
  const winRate = positions.length > 0 ? (winners.length / positions.length) * 100 : 0;
  const avgWin = winners.length > 0 ? winners.reduce((a, b) => a + b.pnlPct, 0) / winners.length : 0;
  const avgLoss = losers.length > 0 ? losers.reduce((a, b) => a + b.pnlPct, 0) / losers.length : 0;

  return {
    success: true,
    data: {
      totalInvested,
      totalCurrent,
      totalPnl,
      totalPnlPct,
      winRate,
      winners: winners.length,
      losers: losers.length,
      breakeven: breakeven.length,
      avgWin,
      avgLoss,
      positions,
    },
  };
}
