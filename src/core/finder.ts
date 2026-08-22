import { searchCoins } from "../sources/coingecko.js";
import { searchPairs, sortPairsByLiquidity, DexPair } from "../sources/dexscreener.js";

export interface Candidate {
  key: string;
  symbol: string;
  name: string;
  address: string;
  chains: string[];
  bestLiqUsd: number;
  mcap?: number;
  ageDays?: number;
  hasTwitter: boolean;
  socialCount: number;
  cgRank: number | null;
  legitPoints: number;
  verdict: string;
}

export interface FindResult {
  query: string;
  candidates: Candidate[];
}

export async function findRealToken(symbol: string): Promise<FindResult> {
  const [pairs, coins] = await Promise.all([
    searchPairs(symbol),
    searchCoins(symbol),
  ]);

  const relevant = pairs.filter(
    (p) => p.baseToken.symbol.toLowerCase() === symbol.toLowerCase().replace(/^\$/, "")
  );
  const pool = (relevant.length > 0 ? relevant : pairs).filter(
    (p) => (p.liquidity?.usd ?? 0) > 100
  );

  const byKey = new Map<string, DexPair[]>();
  for (const p of pool) {
    const key = `${p.chainId}:${p.baseToken.address}`;
    const arr = byKey.get(key) ?? [];
    arr.push(p);
    byKey.set(key, arr);
  }

  const topLiq = Math.max(...pool.map((p) => p.liquidity?.usd ?? 1), 1);

  const candidates: Candidate[] = [];
  for (const [key, ps] of byKey) {
    const sorted = sortPairsByLiquidity(ps);
    const best = sorted[0];
    const ages = ps.filter((p) => p.pairCreatedAt).map((p) => p.pairCreatedAt as number);
    const oldest = ages.length ? Math.min(...ages) : undefined;
    const ageDays = oldest !== undefined ? (Date.now() - oldest) / 86_400_000 : undefined;
    const info = best.info;
    const socials = info?.socials ?? [];
    const hasTwitter = socials.some((s) => s.type === "twitter" || /twitter\.com|x\.com/i.test(s.url));
    const socialCount = socials.length + (info?.websites?.length ?? 0);

    const match = coins.find((c) => c.symbol.toLowerCase() === best.baseToken.symbol.toLowerCase());
    const cgRank = match?.market_cap_rank ?? null;

    let pts = 0;
    if (match) {
      pts += 25;
      if (cgRank && cgRank <= 100) pts += 10;
      else if (cgRank && cgRank <= 500) pts += 5;
    }
    if (hasTwitter) pts += 15;
    else if (socialCount > 0) pts += 8;
    if (ageDays !== undefined) {
      if (ageDays > 180) pts += 15;
      else if (ageDays > 30) pts += 10;
      else if (ageDays > 7) pts += 4;
    }
    if (new Set(ps.map((p) => p.chainId)).size >= 2) pts += 5;

    candidates.push({
      key,
      symbol: best.baseToken.symbol,
      name: best.baseToken.name,
      address: best.baseToken.address,
      chains: [...new Set(ps.map((p) => p.chainId))],
      bestLiqUsd: best.liquidity?.usd ?? 0,
      mcap: best.marketCap,
      ageDays,
      hasTwitter,
      socialCount,
      cgRank,
      legitPoints: pts,
      verdict: "",
    });
  }

  candidates.sort((a, b) => {
    const aScore = a.legitPoints * 2 + Math.log10(1 + a.bestLiqUsd);
    const bScore = b.legitPoints * 2 + Math.log10(1 + b.bestLiqUsd);
    return bScore - aScore;
  });

  candidates.forEach((c, i) => {
    if (i === 0 && (c.bestLiqUsd > topLiq * 0.5 || c.cgRank)) c.verdict = "🥇 likely REAL";
    else if (c.bestLiqUsd < topLiq * 0.02) c.verdict = "⚠️ clone/imposter?";
    else c.verdict = `${i + 1}️⃣`;
  });

  return { query: symbol, candidates: candidates.slice(0, 5) };
}
