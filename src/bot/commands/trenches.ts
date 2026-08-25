import { Bot } from "grammy";
import { actionTrenches } from "../../agent/actions.js";
import { esc, fmtUsd, fmtMcap } from "../format.js";

export function registerTrenchesCommand(bot: Bot) {
  bot.command("trenches", async (ctx) => {
    await ctx.reply("🔍 Scanning trenches for new launches...");
    const result = await actionTrenches();
    if (!result.success) return ctx.reply(`❌ ${result.error}`);
    await ctx.reply(formatTrenches(result.data), { parse_mode: "HTML" });
  });
}

function formatTrenches(d: any): string {
  if (!d.tokens || d.tokens.length === 0) return "❌ No new tokens found";
  const lines = [`🚨 <b>TRENCHES — NEW TOKEN DISCOVERY</b> (${d.total} found)\n`];
  for (const t of d.tokens.slice(0, 15)) {
    const age = t.ageMinutes
      ? t.ageMinutes < 60 ? `${Math.round(t.ageMinutes)}m old` : `${(t.ageMinutes / 60).toFixed(1)}h old`
      : t.ageHours
      ? `${t.ageHours.toFixed(1)}h old`
      : "unknown";
    const liqStr = t.liq > 0 ? `Liq $${fmtUsd(t.liq)}` : "No liquidity";
    const mcStr = t.mcap > 0 ? `$${fmtMcap(t.mcap)}` : "No MC";
    const source = t.source === "pump.fun" ? "🚀 PF" : "📊 DS";
    const change = t.buyPressure > 0.6 ? "🟢" : t.buyPressure < 0.4 ? "🔴" : "⚪";

    lines.push(`${source} <b>${esc(t.symbol)}</b> (${esc(t.name)})`);
    lines.push(`   MC: ${mcStr} | ${liqStr} | Age: ${age} ${change}`);
    lines.push(`   <code>${t.address}</code>\n`);
  }
  return lines.join("\n");
}
