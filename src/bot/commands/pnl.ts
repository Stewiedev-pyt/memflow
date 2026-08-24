import { Bot, Context } from "grammy";
import { searchPairs, sortPairsByLiquidity } from "../../sources/dexscreener.js";
import { esc, fmtUsd } from "../format.js";

export async function handlePnl(ctx: Context, query: string): Promise<void> {
  if (!ctx.chat) return;
  let thinking;
  try {
    thinking = await ctx.reply(`📊 generating PNL card for *$${esc(query)}*…`, { parse_mode: "Markdown" });
  } catch {
    thinking = await ctx.reply(`📊 generating PNL card for $${query}…`);
  }
  try {
    const allPairs = sortPairsByLiquidity(await searchPairs(query));
    const best = allPairs.find(
      (p) => p.baseToken.symbol.toLowerCase() === query.toLowerCase()
    ) ?? allPairs[0];
    if (!best) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No token found for "$${query}".`);
      return;
    }

    const price = best.priceUsd ? Number(best.priceUsd) : 0;
    const mc = best.marketCap ?? 0;
    const liq = best.liquidity?.usd ?? 0;
    const vol = best.volume?.h24 ?? 0;
    const change1h = best.priceChange?.h1;
    const change24h = best.priceChange?.h24;
    const buys = best.txns?.h24?.buys ?? 0;
    const sells = best.txns?.h24?.sells ?? 0;

    const age = best.pairCreatedAt
      ? `${((Date.now() - best.pairCreatedAt) / 86_400_000).toFixed(1)}d`
      : "?";

    const liqMcRatio = mc > 0 && liq > 0 ? ((liq / mc) * 100).toFixed(1) : "?";
    const buyPressure = buys + sells > 0 ? ((buys / (buys + sells)) * 100).toFixed(0) : "?";

    const lines: string[] = [
      `📊 *PNL CARD — ${esc(best.baseToken.symbol)}* (${best.chainId})`,
      "",
      `*Price:* $${price.toFixed(price < 0.001 ? 10 : price < 1 ? 6 : 4)}`,
      `*MC:* ${fmtUsd(mc)}`,
      `*Liq:* ${fmtUsd(liq)}`,
      `*Vol 24h:* ${fmtUsd(vol)}`,
      "",
      `*1h:* ${change1h !== undefined ? (change1h > 0 ? "+" : "") + change1h.toFixed(1) + "%" : "?"}`,
      `*24h:* ${change24h !== undefined ? (change24h > 0 ? "+" : "") + change24h.toFixed(1) + "%" : "?"}`,
      "",
      `*Buys/Sells:* ${buys}/${sells} (${buyPressure}% buy)`,
      `*Liq/MC:* ${liqMcRatio}%`,
      `*Age:* ${age}`,
    ];

    if (change24h !== undefined) {
      if (change24h > 100) lines.push("", "🚀 *MOONING*");
      else if (change24h > 20) lines.push("", "📈 *Strong momentum*");
      else if (change24h > -20) lines.push("", "➡️ *Consolidating*");
      else if (change24h > -50) lines.push("", "📉 *Dropping*");
      else lines.push("", "💀 *Dumping*");
    }

    if (liq > 0 && mc > 0) {
      const ratio = liq / mc;
      if (ratio < 0.01) lines.push("⚠️ *Very low liquidity*");
      else if (ratio > 0.1) lines.push("✅ *Healthy liquidity*");
    }

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    const msg = (err as Error).message;
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ PNL card failed: ${msg}`);
    } catch {
      await ctx.reply(`⚠️ PNL card failed: ${msg}`);
    }
  }
}

export function registerPnlCommand(bot: Bot): void {
  bot.command("pnl", async (ctx) => {
    if (!ctx.chat) return;
    const query = ctx.match?.trim().replace(/^\$/, "");
    if (!query) {
      await ctx.reply("📊 Send a token name to generate a PNL card.\nExample: /pnl pepe");
      return;
    }
    await handlePnl(ctx, query);
  });
}
