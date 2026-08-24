import { Bot, Context } from "grammy";

interface Gem {
  symbol: string;
  name: string;
  chainId: string;
  pairAddress: string;
  tokenAddress: string;
  mcap: number;
  liquidityUsd: number;
  volH24: number;
  priceChange24h: number;
  buyPressure: number;
  ageHours: number;
  liqMcRatio: number;
  score: number;
  riskFlags: string[];
}

const SEARCH_TERMS = [
  "pepe", "doge", "shib", "bonk", "wif", "mog", "brett", "tremp", "giga",
  "floki", "ai16z", "fartcoin", "trump", "mew", "myro", "punk", "-andy",
  "toshi", "bome", "jup", "ray", "w", "jto", "ondo", "ena", "ethfi",
  "strk", "mina", "sei", "sui", "apt", "arb", "op", "base", "matic",
  "dot", "atom", "link", "uni", "aave", "comp", "mkr", "snx", "crv",
  "lido", "rocket", "pendle", "blur", "dydx", "gmx", "solv", "jupiter",
  "pump", "meme", "cat", "dog", "frog", "ape", "chimp", "monkey",
  "rocket", "moon", "safe", "inu", "kitty", "shiba", "wojak", "coq",
  "tat", "pepe2", "baby", "wife", "chad", "virgin", "gigachad",
];

async function scanGems(): Promise<Gem[]> {
  const seen = new Set<string>();
  const allGems: Gem[] = [];

  for (const term of SEARCH_TERMS) {
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(term)}`,
        { signal: AbortSignal.timeout(12_000) }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { pairs?: Array<any> };
      const pairs = data.pairs ?? [];

      for (const p of pairs) {
        if (seen.has(p.pairAddress)) continue;
        seen.add(p.pairAddress);

        const mc = p.marketCap ?? 0;
        const liq = p.liquidity?.usd ?? 0;
        const vol = p.volume?.h24 ?? 0;
        const ageMs = p.pairCreatedAt ? Date.now() - p.pairCreatedAt : Infinity;
        const ageHours = ageMs / 3_600_000;

        // Low MC filter: $2K - $300K
        if (mc < 2_000 || mc > 300_000) continue;
        // Min liquidity
        if (liq < 500) continue;
        // Age filter: 10 min to 30 days
        if (ageHours < 0.17 || ageHours > 720) continue;
        // Must have some volume
        if (vol < 100) continue;

        const buys = p.txns?.h24?.buys ?? 0;
        const sells = p.txns?.h24?.sells ?? 0;
        const buyPressure = buys + sells > 0 ? buys / (buys + sells) : 0.5;
        const liqMcRatio = mc > 0 ? liq / mc : 0;

        let score = 0;
        const riskFlags: string[] = [];

        // Liquidity health
        if (liqMcRatio > 0.15) score += 30;
        else if (liqMcRatio > 0.08) score += 20;
        else if (liqMcRatio > 0.03) score += 10;
        else { riskFlags.push("thin liq"); score -= 5; }

        // Volume
        const volLiqRatio = liq > 0 ? vol / liq : 0;
        if (volLiqRatio > 0.5 && volLiqRatio < 3) score += 20;
        else if (volLiqRatio >= 3) { score += 10; riskFlags.push("wash vol?"); }

        // Buy pressure
        if (buyPressure > 0.65) score += 15;
        else if (buyPressure > 0.5) score += 5;
        else { riskFlags.push("selling"); score -= 5; }

        // MC sweet spot
        if (mc > 50_000) score += 15;
        else if (mc > 20_000) score += 10;
        else if (mc > 10_000) score += 5;

        // Age
        if (ageHours < 1) { score -= 5; riskFlags.push("brand new"); }
        else if (ageHours > 48) score += 10;

        // Price action
        const change24h = p.priceChange?.h24 ?? 0;
        if (change24h > 20) score += 10;
        else if (change24h < -30) { riskFlags.push("dumping"); score -= 10; }

        if (score >= 15) {
          allGems.push({
            symbol: p.baseToken.symbol,
            name: p.baseToken.name,
            chainId: p.chainId,
            pairAddress: p.pairAddress,
            tokenAddress: p.baseToken.address,
            mcap: mc,
            liquidityUsd: liq,
            volH24: vol,
            priceChange24h: change24h,
            buyPressure,
            ageHours,
            liqMcRatio,
            score,
            riskFlags,
          });
        }
      }
    } catch {
      continue;
    }
  }

  return allGems.sort((a, b) => b.score - a.score).slice(0, 15);
}

export async function handleGems(ctx: Context): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply("💎 scanning for legit low MC gems…");
  try {
    const gems = await scanGems();
    if (gems.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "No gems found right now. Try again later.");
      return;
    }

    const fmt = (n: number) => {
      if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
      if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
      return `$${n.toFixed(0)}`;
    };

    const lines: string[] = [
      `💎 *LOW MC GEMS — legit background, low rug risk*`,
      `*${gems.length}* candidates · MC $2K–$300K · liq > $500`,
      "",
    ];

    for (const g of gems.slice(0, 10)) {
      const arrow = g.priceChange24h > 0 ? "🟢" : "🔴";
      const pct = g.priceChange24h > 0 ? `+${g.priceChange24h.toFixed(0)}%` : `${g.priceChange24h.toFixed(0)}%`;
      const age = g.ageHours < 1 ? `${(g.ageHours * 60).toFixed(0)}m` : g.ageHours < 24 ? `${g.ageHours.toFixed(0)}h` : `${(g.ageHours / 24).toFixed(1)}d`;
      const flags = g.riskFlags.length > 0 ? ` ⚠️ ${g.riskFlags.join(", ")}` : " ✅";

      lines.push(
        `${arrow} *${esc(g.symbol)}* (${g.chainId}) — score *${g.score}*`,
        `  MC ${fmt(g.mcap)} · liq ${fmt(g.liquidityUsd)} · vol ${fmt(g.volH24)}`,
        `  liq/mc ${(g.liqMcRatio * 100).toFixed(1)}% · buys ${(g.buyPressure * 100).toFixed(0)}% · age ${age} · ${pct}`,
        `  CA: \`${g.tokenAddress}\``,
        flags,
        ""
      );
    }

    lines.push("⚠️ *DYOR — low MC = high risk. Use /audit before buying.*");

    const card = lines.join("\n").slice(0, 4000);
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, { parse_mode: "Markdown" });
  } catch (err) {
    const msg = (err as Error).message;
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ gems scan failed: ${msg}`);
    } catch {
      await ctx.reply(`⚠️ gems scan failed: ${msg}`);
    }
  }
}

function esc(s: string): string {
  return s.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

export function registerGemsCommand(bot: Bot): void {
  bot.command("gems", async (ctx) => {
    if (!ctx.chat) return;
    await handleGems(ctx);
  });
}
