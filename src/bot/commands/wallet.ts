import { Bot } from "grammy";
import { actionWalletAnalyzer } from "../../agent/actions.js";
import { esc, fmtUsd } from "../format.js";

export function registerWalletCommand(bot: Bot) {
  bot.command("wallet", async (ctx) => {
    const address = ctx.match?.trim();
    if (!address) {
      return ctx.reply("Usage: /wallet <solana_address>\nExample: /wallet 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    }
    if (!/^[\w]{32,44}$/.test(address)) {
      return ctx.reply("❌ Invalid Solana wallet address (32-44 chars)");
    }
    await ctx.reply("⏳ Analyzing wallet...");
    const result = await actionWalletAnalyzer(address);
    if (!result.success) return ctx.reply(`❌ ${result.error}`);
    await ctx.reply(formatWallet(result.data), { parse_mode: "HTML" });
  });
}

function formatWallet(d: any): string {
  const lines = [
    `🔍 <b>WALLET ANALYZER</b>`,
    `<code>${d.wallet}</code>\n`,
    `💰 <b>SOL Balance:</b> ${d.solBalance.toFixed(4)} SOL`,
    `💎 <b>Total Value:</b> $${fmtUsd(d.totalValueUsd)}`,
    `🪙 <b>Holdings:</b> ${d.holdingsCount} tokens\n`,
  ];

  if (d.holdings.length > 0) {
    lines.push(`<b>Top Holdings:</b>`);
    for (const h of d.holdings.slice(0, 10)) {
      const change = h.change24h > 0 ? `+${h.change24h.toFixed(1)}%` : `${h.change24h.toFixed(1)}%`;
      const emoji = h.change24h > 0 ? "🟢" : "🔴";
      lines.push(
        `${emoji} <b>${esc(h.symbol)}</b> — $${fmtUsd(h.value)} (${h.balance.toFixed(2)}) | 24h ${change}`
      );
    }
  }

  lines.push(
    `\n📊 <b>Stats:</b>`,
    `Age: ${d.stats.ageDays} days | TXs: ${d.stats.totalTransactions} | Freq: ${d.stats.txFrequency}/day`
  );

  if (d.recentActivity.length > 0) {
    lines.push(`\n🕐 <b>Recent Activity:</b>`);
    for (const tx of d.recentActivity.slice(0, 5)) {
      const status = tx.success ? "✅" : "❌";
      const time = tx.time ? new Date(tx.time).toLocaleString() : "unknown";
      lines.push(`${status} ${time}`);
    }
  }

  return lines.join("\n");
}
