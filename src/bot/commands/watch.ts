import { Bot } from "grammy";
import { searchPairs, sortPairsByLiquidity } from "../../sources/dexscreener.js";
import { addWatched, removeWatched, listWatched } from "../../storage/db.js";
import { registerAlertChat } from "../../watch/engine.js";

export function registerWatchCommands(bot: Bot): void {
  bot.command("watch", async (ctx) => {
    registerAlertChat(ctx.chat.id);
    const query = ctx.match?.trim();
    if (!query) {
      await ctx.reply("Usage: `/watch <token name or pair address>`", { parse_mode: "Markdown" });
      return;
    }
    const thinking = await ctx.reply(`📡 setting up watch on *${query}*...`, { parse_mode: "Markdown" });
    try {
      let pair = null;
      if (/^0x[a-fA-F0-9]{40}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query)) {
        const byAddr = await searchPairs(query);
        pair = sortPairsByLiquidity(byAddr)[0] ?? null;
      }
      if (!pair) {
        const results = sortPairsByLiquidity(await searchPairs(query));
        pair = results[0] ?? null;
      }
      if (!pair) {
        await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `Nothing found for "${query}".`);
        return;
      }
      addWatched({ pairAddress: pair.pairAddress, chainId: pair.chainId, symbol: pair.baseToken.symbol });
      await ctx.api.editMessageText(
        ctx.chat.id,
        thinking.message_id,
        [
          `📡 *watching ${pair.baseToken.symbol}* on ${pair.chainId}`,
          `liq: $${(pair.liquidity?.usd ?? 0).toFixed(0)} · mcap: $${(pair.marketCap ?? 0).toFixed(0)}`,
          "",
          "Polling every 60s. You'll get alerts here on: 🟢 HOP · 🟡 TRAP · 🔴 EXIT NOW · 🚨 RUG ALERT",
          "_Baseline needs ~5 minutes of history to calibrate._",
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ failed: ${(err as Error).message}`);
    }
  });

  bot.command("unwatch", async (ctx) => {
    const q = ctx.match?.trim().toLowerCase();
    const all = listWatched();
    if (all.length === 0) {
      await ctx.reply("Not watching anything yet. Try `/watch <token>`");
      return;
    }
    if (!q) {
      await ctx.reply(all.map((w) => `• ${w.symbol} — \`${w.pairAddress.slice(0, 10)}…\``).join("\n") + "\n\n`/unwatch <prefix>` to remove", { parse_mode: "Markdown" });
      return;
    }
    const target = all.find((w) => w.pairAddress.toLowerCase().startsWith(q) || w.symbol.toLowerCase() === q);
    if (!target) {
      await ctx.reply("No watched token matches that.");
      return;
    }
    removeWatched(target.pairAddress);
    await ctx.reply(`🛑 stopped watching ${target.symbol}`);
  });

  bot.command("watchlist", async (ctx) => {
    registerAlertChat(ctx.chat.id);
    const all = listWatched();
    if (all.length === 0) {
      await ctx.reply("📭 watchlist empty. Add one: `/watch pepe`");
      return;
    }
    const lines = all.map((w) => `• *${w.symbol}* (${w.chainId}) \`${w.pairAddress.slice(0, 10)}…\``);
    await ctx.reply(`📡 *Watchlist (${all.length}):*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
  });
}
