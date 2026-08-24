import { Bot, Context } from "grammy";
import { getGlobalMarket } from "../../sources/market.js";

export async function handleMarketOverview(ctx: Context): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply("📊 fetching market overview…");
  try {
    const data = await getGlobalMarket();
    if (!data) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "⚠️ Could not fetch market data. Try again later.");
      return;
    }

    const fmtBig = (n: number) => {
      if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
      if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
      if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
      return `$${n.toFixed(0)}`;
    };

    const lines: string[] = [
      "📊 *GLOBAL MARKET OVERVIEW*",
      "",
      `*Total Market Cap:* ${fmtBig(data.totalMarketCapUsd)}`,
      `*24h Volume:* ${fmtBig(data.totalVolumeUsd)}`,
      `*BTC Dominance:* ${data.btcDominance.toFixed(1)}%`,
      `*ETH Dominance:* ${data.ethDominance.toFixed(1)}%`,
      `*Active Coins:* ${data.activeCryptos.toLocaleString()}`,
      "",
      "*Top 10:*",
    ];

    for (const c of data.topCoins) {
      const arrow = c.priceChange24h > 0 ? "🟢" : c.priceChange24h < 0 ? "🔴" : "⚪";
      const pct = c.priceChange24h > 0 ? `+${c.priceChange24h.toFixed(1)}%` : `${c.priceChange24h.toFixed(1)}%`;
      lines.push(`${arrow} *#${c.marketCapRank} ${c.symbol}* — $${c.priceUsd.toLocaleString(undefined, { maximumFractionDigits: c.priceUsd < 1 ? 6 : 2 })} (${pct})`);
    }

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ market overview failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ market overview failed: ${(err as Error).message}`);
    }
  }
}

export function registerMarketCommand(bot: Bot): void {
  bot.command("i", async (ctx) => {
    if (!ctx.chat) return;
    await handleMarketOverview(ctx);
  });
}
