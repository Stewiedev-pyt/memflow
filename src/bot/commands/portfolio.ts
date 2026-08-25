import { Bot } from "grammy";
import { actionPortfolioAdd, actionPortfolioRemove, actionPortfolioView } from "../../agent/actions.js";
import { esc, fmtUsd } from "../format.js";

export function registerPortfolioCommand(bot: Bot) {
  bot.command("portfolio", async (ctx) => {
    const args = ctx.match?.trim();
    const chatId = String(ctx.chat?.id ?? "");

    if (!args || args === "") {
      return ctx.reply(
        "Usage:\n" +
        "/portfolio — view all positions\n" +
        "/portfolio add <SYMBOL> <price> <amount> — add position\n" +
        "/portfolio remove <SYMBOL> — remove position"
      );
    }

    const parts = args.split(/\s+/);
    const action = parts[0].toLowerCase();

    if (action === "add") {
      const symbol = parts[1]?.toUpperCase();
      const price = parseFloat(parts[2]);
      const amount = parseFloat(parts[3]);
      if (!symbol || isNaN(price) || isNaN(amount)) {
        return ctx.reply("Usage: /portfolio add <SYMBOL> <entry_price> <amount>");
      }
      const result = await actionPortfolioAdd(chatId, symbol, price, amount);
      if (!result.success) return ctx.reply(`❌ ${result.error}`);
      return ctx.reply(
        `✅ Added <b>${result.data.symbol}</b>\n` +
        `Entry: $${result.data.entryPrice} | Amount: ${result.data.totalAmount ?? result.data.amount}` +
        (result.data.totalPositions ? `\nTotal positions: ${result.data.totalPositions}` : ""),
        { parse_mode: "HTML" }
      );
    }

    if (action === "remove") {
      const symbol = parts[1]?.toUpperCase();
      if (!symbol) return ctx.reply("Usage: /portfolio remove <SYMBOL>");
      const result = await actionPortfolioRemove(chatId, symbol);
      return ctx.reply(result.success ? `✅ Removed ${symbol}` : `❌ ${result.data?.message}`);
    }

    await ctx.reply("⏳ Loading portfolio...");
    const result = await actionPortfolioView(chatId);
    if (!result.success) return ctx.reply(`❌ ${result.error}`);
    await ctx.reply(formatPortfolio(result.data), { parse_mode: "HTML" });
  });
}

function formatPortfolio(d: any): string {
  if (!d.positions || d.positions.length === 0) {
    return "📊 No positions tracked.\nUse /portfolio add <SYMBOL> <price> <amount>";
  }

  const lines = [
    `📊 <b>PORTFOLIO</b>\n`,
    `💰 Invested: $${fmtUsd(d.totalInvested)}`,
    `💎 Current: $${fmtUsd(d.totalCurrent)}`,
    `📈 PnL: $${fmtUsd(d.totalPnl)} (${d.totalPnlPct > 0 ? "+" : ""}${d.totalPnlPct.toFixed(2)}%)\n`,
  ];

  for (const p of d.positions) {
    const emoji = p.pnl >= 0 ? "🟢" : "🔴";
    const pnlSign = p.pnl >= 0 ? "+" : "";
    lines.push(
      `${emoji} <b>${esc(p.symbol)}</b>`,
      `   Entry: $${p.entryPrice.toFixed(6)} → Now: $${p.currentPrice.toFixed(6)}`,
      `   PnL: ${pnlSign}$${fmtUsd(Math.abs(p.pnl))} (${pnlSign}${p.pnlPct.toFixed(2)}%) | Hold: ${p.holdDays}d`
    );
  }

  return lines.join("\n");
}
