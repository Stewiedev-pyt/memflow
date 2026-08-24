import { Bot, Context } from "grammy";

interface Runner {
  chainId: string;
  pairAddress: string;
  symbol: string;
  name: string;
  mcap: number;
  liquidityUsd: number;
  volH24: number;
  priceChange24h: number;
  ageHours: number;
}

async function findRunners(): Promise<Runner[]> {
  const chains = ["solana", "ethereum", "base", "bsc"];
  const results: Runner[] = [];

  for (const chain of chains) {
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/pairs/${chain}?sort=pairCreatedAt&order=desc`,
        { signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { pairs?: Array<{
        chainId: string;
        pairAddress: string;
        baseToken: { address: string; name: string; symbol: string };
        marketCap?: number;
        liquidity?: { usd?: number };
        volume?: { h24?: number };
        priceChange?: { h24?: number };
        pairCreatedAt?: number;
      }> };
      for (const p of data.pairs ?? []) {
        const mc = p.marketCap ?? 0;
        const ageMs = p.pairCreatedAt ? Date.now() - p.pairCreatedAt : Infinity;
        const ageHours = ageMs / 3_600_000;
        if (mc >= 100_000 && mc <= 5_000_000 && ageHours <= 48) {
          results.push({
            chainId: p.chainId,
            pairAddress: p.pairAddress,
            symbol: p.baseToken.symbol,
            name: p.baseToken.name,
            mcap: mc,
            liquidityUsd: p.liquidity?.usd ?? 0,
            volH24: p.volume?.h24 ?? 0,
            priceChange24h: p.priceChange?.h24 ?? 0,
            ageHours,
          });
        }
      }
    } catch {
      continue;
    }
  }

  return results.sort((a, b) => b.mcap - a.mcap).slice(0, 20);
}

export async function handleRunners(ctx: Context): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply("🏃 scanning for runners across chains…");
  try {
    const runners = await findRunners();
    if (runners.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "No notable runners found in the last 48h.");
      return;
    }

    const fmt = (n: number) => {
      if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
      if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
      return `$${n.toFixed(0)}`;
    };

    const lines: string[] = [
      "🏃 *RUNNERS — tokens that crossed $100K MC*",
      `*${runners.length}* tokens found (last 48h):`,
      "",
    ];

    for (const r of runners.slice(0, 15)) {
      const arrow = r.priceChange24h > 0 ? "🟢" : "🔴";
      const pct = r.priceChange24h > 0 ? `+${r.priceChange24h.toFixed(0)}%` : `${r.priceChange24h.toFixed(0)}%`;
      const age = r.ageHours < 1 ? `${(r.ageHours * 60).toFixed(0)}m` : `${r.ageHours.toFixed(0)}h`;
      lines.push(
        `${arrow} *$${esc(r.symbol)}* (${r.chainId}) — ${age} old`,
        `  MC ${fmt(r.mcap)} · liq ${fmt(r.liquidityUsd)} · vol ${fmt(r.volH24)} · ${pct}`,
        ""
      );
    }

    const card = lines.join("\n").slice(0, 4000);
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, { parse_mode: "Markdown" });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ runners scan failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ runners scan failed: ${(err as Error).message}`);
    }
  }
}

function esc(s: string): string {
  return s.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

export function registerRunnersCommand(bot: Bot): void {
  bot.command("runners", async (ctx) => {
    if (!ctx.chat) return;
    await handleRunners(ctx);
  });
}
