import { Bot, Context } from "grammy";
import { searchPairs, sortPairsByLiquidity } from "../../sources/dexscreener.js";
import { setPending } from "../pending.js";
import { esc, fmtUsd } from "../format.js";

export async function handleTickerCheck(ctx: Context, ticker: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(`🔎 checking ticker *$${esc(ticker)}* for copycats…`, { parse_mode: "Markdown" });
  try {
    const pairs = sortPairsByLiquidity(await searchPairs(ticker));
    const matches = pairs.filter(
      (p) => p.baseToken.symbol.toLowerCase() === ticker.toLowerCase()
    );

    if (matches.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No tokens found with ticker "$${ticker}".`);
      return;
    }

    const lines: string[] = [
      `🏷 *TICKER CHECK — $${esc(ticker)}*`,
      `*${matches.length}* token${matches.length > 1 ? "s" : ""} found with this ticker:`,
      "",
    ];

    for (const p of matches.slice(0, 10)) {
      const age = p.pairCreatedAt
        ? `${((Date.now() - p.pairCreatedAt) / 86_400_000).toFixed(0)}d`
        : "?";
      const mc = fmtUsd(p.marketCap);
      const liq = fmtUsd(p.liquidity?.usd);
      const vol = fmtUsd(p.volume?.h24);
      lines.push(
        `• *${esc(p.baseToken.symbol)}* (${p.chainId}) — age ${age}`,
        `  MC ${mc} · liq ${liq} · vol ${vol}`,
        `  \`${p.pairAddress.slice(0, 12)}…\``,
        ""
      );
    }

    if (matches.length > 1) {
      lines.push("⚠️ *Multiple tokens with same ticker — verify CA before buying!*");
    }

    const card = lines.join("\n").slice(0, 4000);
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, { parse_mode: "Markdown" });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ ticker check failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ ticker check failed: ${(err as Error).message}`);
    }
  }
}

export function registerTickerCheckCommand(bot: Bot): void {
  bot.command("tc", async (ctx) => {
    if (!ctx.chat) return;
    const ticker = ctx.match?.trim().replace(/^\$/, "").toUpperCase();
    if (!ticker) {
      setPending(ctx.chat.id, "tc");
      await ctx.reply("🏷 Send a *ticker* to check for copycats.", { parse_mode: "Markdown" });
      return;
    }
    await handleTickerCheck(ctx, ticker);
  });
}
