import { Bot, Context } from "grammy";
import { actionTopTokens } from "../../agent/actions.js";
import { fmtMcap, fmtUsd } from "../format.js";
import { esc } from "../format.js";

export function registerTopCoinsCommand(bot: Bot) {
  bot.command("topcoins", async (ctx) => {
    const args = ctx.match?.trim();
    const chain = args?.toLowerCase();
    if (chain && !["solana", "ethereum", "bsc", "base"].includes(chain)) {
      return ctx.reply("❌ Supported chains: solana, ethereum, bsc, base");
    }
    await ctx.reply("⏳ Loading top tokens...");
    const result = await actionTopTokens(chain);
    if (!result.success) {
      return ctx.reply(`❌ ${result.error}`);
    }
    await ctx.reply(formatTopCoins(result.data), { parse_mode: "HTML" });
  });
}

function formatTopCoins(d: any): string {
  if (!d || !d.tokens || d.tokens.length === 0) return "❌ No tokens found";
  const lines = [`🏆 <b>TOP TOKENS — ${d.chain.toUpperCase()}</b> (${d.total} found)\n`];
  for (const t of d.tokens.slice(0, 15)) {
    const change = t.priceChange24h > 0 ? `+${t.priceChange24h.toFixed(1)}%` : `${t.priceChange24h.toFixed(1)}%`;
    const emoji = t.priceChange24h > 0 ? "🟢" : "🔴";
    lines.push(
      `${emoji} <b>${esc(t.symbol)}</b> (${esc(t.chain)}) — $${fmtMcap(t.mcap)}`
    );
    lines.push(
      `   Liq $${fmtUsd(t.liquidity)} | Vol $${fmtUsd(t.volume24h)} | 24h ${change}`
    );
  }
  return lines.join("\n");
}
