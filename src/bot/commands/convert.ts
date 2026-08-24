import { Bot, Context } from "grammy";
import { searchPairs, sortPairsByLiquidity } from "../../sources/dexscreener.js";
import { esc } from "../format.js";

export async function handleConvert(ctx: Context, amount: number, ticker: string): Promise<void> {
  if (!ctx.chat) return;
  try {
    const allPairs = sortPairsByLiquidity(await searchPairs(ticker));
    const best = allPairs.find(
      (p) => p.baseToken.symbol.toLowerCase() === ticker.toLowerCase()
    ) ?? allPairs[0];
    if (!best || !best.priceUsd) {
      await ctx.reply(`Could not find price for "$${ticker}".`);
      return;
    }

    const priceUsd = Number(best.priceUsd);
    const valueUsd = amount * priceUsd;

    await ctx.reply(
      `💰 *${esc(ticker)} value:*\n\n*${amount.toLocaleString()}* ${esc(ticker)} = *$${valueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}*\n\n_price: $${priceUsd}_`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    await ctx.reply(`⚠️ conversion failed: ${(err as Error).message}`);
  }
}

export function registerConvertCommand(bot: Bot): void {
  bot.command("v", async (ctx) => {
    if (!ctx.chat) return;
    const input = ctx.match?.trim().replace(/^\$/, "");
    if (!input) {
      await ctx.reply("💰 Convert token amounts to USD.\nUsage: `/v 1000 pepe`", { parse_mode: "Markdown" });
      return;
    }
    const parts = input.split(/\s+/);
    const amount = parseFloat(parts[0]);
    const ticker = parts.slice(1).join(" ");
    if (isNaN(amount) || !ticker) {
      await ctx.reply("Usage: `/v <amount> <ticker>`\nExample: `/v 1000 pepe`", { parse_mode: "Markdown" });
      return;
    }
    await handleConvert(ctx, amount, ticker);
  });
}
