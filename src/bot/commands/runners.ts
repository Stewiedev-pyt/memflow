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

const SEARCH_QUERIES = ["pepe", "doge", "shib", "bonk", "wif", "mog", "brett", "tremp", "giga", "floki", "ai16z", "fartcoin", "trump"];

async function findRunners(): Promise<Runner[]> {
  const seen = new Set<string>();
  const results: Runner[] = [];

  for (const q of SEARCH_QUERIES) {
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
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
        if (seen.has(p.pairAddress)) continue;
        seen.add(p.pairAddress);
        const mc = p.marketCap ?? 0;
        const liq = p.liquidity?.usd ?? 0;
        const vol = p.volume?.h24 ?? 0;
        const ageMs = p.pairCreatedAt ? Date.now() - p.pairCreatedAt : Infinity;
        const ageHours = ageMs / 3_600_000;
        if (liq <= 0 && vol <= 0) continue;
        // Only show recent or high-volume pairs
        if (ageHours > 720 && vol < 100_000) continue;
        results.push({
          chainId: p.chainId,
          pairAddress: p.pairAddress,
          symbol: p.baseToken.symbol,
          name: p.baseToken.name,
          mcap: mc,
          liquidityUsd: liq,
          volH24: vol,
          priceChange24h: p.priceChange?.h24 ?? 0,
          ageHours,
        });
      }
    } catch {
      continue;
    }
  }

  return results.sort((a, b) => b.volH24 - a.volH24).slice(0, 30);
}

export async function handleRunners(ctx: Context): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply("🏃 scanning trending tokens across all chains…");
  try {
    const runners = await findRunners();
    if (runners.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "No active pairs found. Try again in a minute.");
      return;
    }

    const fmt = (n: number) => {
      if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
      if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
      return `$${n.toFixed(0)}`;
    };

    const lines: string[] = [
      `🏃 *TRENDING TOKENS — all chains*`,
      `*${runners.length}* active pairs · sorted by volume`,
      "",
    ];

    const byChain = new Map<string, Runner[]>();
    for (const r of runners) {
      const arr = byChain.get(r.chainId) ?? [];
      arr.push(r);
      byChain.set(r.chainId, arr);
    }

    for (const [chain, pairs] of byChain) {
      lines.push(`*${chain.toUpperCase()}*`);
      for (const r of pairs.slice(0, 6)) {
        const arrow = r.priceChange24h > 0 ? "🟢" : r.priceChange24h < 0 ? "🔴" : "⚪";
        const pct = r.priceChange24h > 0 ? `+${r.priceChange24h.toFixed(0)}%` : `${r.priceChange24h.toFixed(0)}%`;
        const age = r.ageHours < 1 ? `${(r.ageHours * 60).toFixed(0)}m` : r.ageHours < 24 ? `${r.ageHours.toFixed(0)}h` : `${(r.ageHours / 24).toFixed(1)}d`;
        const mcStr = r.mcap > 0 ? ` · mc ${fmt(r.mcap)}` : "";
        lines.push(`${arrow} *${r.symbol}* — vol ${fmt(r.volH24)} · liq ${fmt(r.liquidityUsd)}${mcStr} · ${pct} · ${age}`);
      }
      lines.push("");
    }

    const card = lines.join("\n").slice(0, 4000);
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, { parse_mode: "Markdown" });
  } catch (err) {
    const msg = (err as Error).message;
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ runners failed: ${msg}`);
    } catch {
      await ctx.reply(`⚠️ runners failed: ${msg}`);
    }
  }
}

export function registerRunnersCommand(bot: Bot): void {
  bot.command("runners", async (ctx) => {
    if (!ctx.chat) return;
    await handleRunners(ctx);
  });
}
