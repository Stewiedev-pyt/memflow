import { Bot } from "grammy";
import { actionTrackWallet, actionUntrackWallet, actionTrackedWallets } from "../../agent/actions.js";

export function registerTrackCommand(bot: Bot) {
  bot.command("track", async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) {
      return ctx.reply(
        "Usage:\n" +
        "/track <wallet> — start tracking\n" +
        "/track <wallet> <label> — track with label\n" +
        "/untrack <wallet> — stop tracking\n" +
        "/tracklist — show all tracked wallets"
      );
    }
    const parts = args.split(/\s+/);
    const wallet = parts[0];
    const label = parts.slice(1).join(" ") || undefined;

    if (!/^[\w]{32,44}$/.test(wallet)) {
      return ctx.reply("❌ Invalid Solana wallet address");
    }

    const result = await actionTrackWallet(wallet, label);
    if (!result.success) return ctx.reply(`❌ ${result.error}`);
    await ctx.reply(
      `✅ Now tracking: <b>${result.data.label}</b>\n` +
      `<code>${result.data.wallet}</code>\n` +
      `Total tracked: ${result.data.totalTracked}`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("untrack", async (ctx) => {
    const wallet = ctx.match?.trim();
    if (!wallet) return ctx.reply("Usage: /untrack <wallet>");
    const result = await actionUntrackWallet(wallet);
    await ctx.reply(result.success ? `✅ Untracked ${wallet}` : "❌ Wallet not found");
  });

  bot.command("tracklist", async (ctx) => {
    const result = await actionTrackedWallets();
    if (result.data.total === 0) return ctx.reply("📋 No wallets tracked. Use /track <wallet> to start.");
    const lines = [`📋 <b>TRACKED WALLETS (${result.data.total})</b>\n`];
    for (const w of result.data.wallets) {
      lines.push(`• <b>${w.label}</b> — <code>${w.wallet}</code>\n  Added: ${w.addedAt}`);
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });
}
