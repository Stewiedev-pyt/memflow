import { Bot, Context } from "grammy";

interface Gem {
  symbol: string;
  name: string;
  chainId: string;
  pairAddress: string;
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

async function scanGems(): Promise<Gem[]> {
  const chains = ["solana", "ethereum", "base", "bsc"];
  const allGems: Gem[] = [];

  for (const chain of chains) {
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/pairs/${chain}`,
        { signal: AbortSignal.timeout(20_000) }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { pairs?: Array<any> };
      const pairs = data.pairs ?? [];

      for (const p of pairs) {
        const mc = p.marketCap ?? 0;
        const liq = p.liquidity?.usd ?? 0;
        const vol = p.volume?.h24 ?? 0;
        const ageMs = p.pairCreatedAt ? Date.now() - p.pairCreatedAt : Infinity;
        const ageHours = ageMs / 3_600_000;

        // Filter: low MC, decent liquidity, not too new, not too old
        if (mc < 5_000 || mc > 500_000) continue;
        if (liq < 1_000) continue;
        if (ageHours < 0.5 || ageHours > 720) continue;

        const buys = p.txns?.h24?.buys ?? 0;
        const sells = p.txns?.h24?.sells ?? 0;
        const buyPressure = buys + sells > 0 ? buys / (buys + sells) : 0.5;
        const liqMcRatio = mc > 0 ? liq / mc : 0;
        const volLiqRatio = liq > 0 ? vol / liq : 0;

        // Score the gem
        let score = 0;
        const riskFlags: string[] = [];

        // Liquidity health (most important)
        if (liqMcRatio > 0.15) score += 30;
        else if (liqMcRatio > 0.08) score += 20;
        else if (liqMcRatio > 0.03) score += 10;
        else {
          riskFlags.push("low liq");
          score -= 10;
        }

        // Volume activity
        if (vol > 0 && liq > 0) {
          if (volLiqRatio > 0.5 && volLiqRatio < 3) {
            score += 20; // healthy volume
          } else if (volLiqRatio >= 3) {
            score += 10;
            riskFlags.push("high vol/liq");
          }
        }

        // Buy pressure
        if (buyPressure > 0.6) score += 15;
        else if (buyPressure > 0.5) score += 5;
        else {
          riskFlags.push("selling pressure");
          score -= 5;
        }

        // MC sweet spot (higher = better for gems)
        if (mc > 50_000) score += 15;
        else if (mc > 20_000) score += 10;
        else if (mc > 10_000) score += 5;

        // Age penalty (too new = risky)
        if (ageHours < 2) {
          score -= 5;
          riskFlags.push("very new");
        } else if (ageHours > 48) {
          score += 10; // survived initial dump
        }

        // Price action
        const change24h = p.priceChange?.h24 ?? 0;
        if (change24h > 20) score += 10;
        else if (change24h < -30) {
          riskFlags.push("dumping");
          score -= 10;
        }

        if (score >= 20) {
          allGems.push({
            symbol: p.baseToken.symbol,
            name: p.baseToken.name,
            chainId: p.chainId,
            pairAddress: p.pairAddress,
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
  const thinking = await ctx.reply("💎 scanning for low MC gems across chains…");
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
      `💎 *LOW MC GEMS* — filtered from ${["solana", "ethereum", "base", "bsc"].join(", ")}`,
      `*${gems.length}* candidates · MC $5K–$500K · liq > $1K`,
      "",
    ];

    for (const g of gems.slice(0, 10)) {
      const arrow = g.priceChange24h > 0 ? "🟢" : "🔴";
      const pct = g.priceChange24h > 0 ? `+${g.priceChange24h.toFixed(0)}%` : `${g.priceChange24h.toFixed(0)}%`;
      const age = g.ageHours < 1 ? `${(g.ageHours * 60).toFixed(0)}m` : g.ageHours < 24 ? `${g.ageHours.toFixed(0)}h` : `${(g.ageHours / 24).toFixed(1)}d`;
      const flags = g.riskFlags.length > 0 ? ` ⚠️ ${g.riskFlags.join(", ")}` : "";

      lines.push(
        `${arrow} *${esc(g.symbol)}* (${g.chainId}) — score *${g.score}*`,
        `  MC ${fmt(g.mcap)} · liq ${fmt(g.liquidityUsd)} · vol ${fmt(g.volH24)}`,
        `  liq/mc ${(g.liqMcRatio * 100).toFixed(1)}% · buys ${(g.buyPressure * 100).toFixed(0)}% · age ${age} · ${pct}`,
        flags ? `  ${flags}` : "",
        ""
      );
    }

    lines.push(
      "",
      "⚠️ *DYOR — low MC = high risk. Check /audit before buying.*"
    );

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
