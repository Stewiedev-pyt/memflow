import { Bot, Context } from "grammy";
import { scanForCalls, CallSignal } from "../../core/calls.js";

function fmt(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(10)}`;
}

function fmtPrice(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(10)}`;
}

function formatCall(c: CallSignal, idx: number): string {
  const riskEmoji = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🟠" };
  const arrow = c.priceChange24h > 0 ? "📈" : "📉";
  const pct = c.priceChange24h > 0 ? `+${c.priceChange24h.toFixed(0)}%` : `${c.priceChange24h.toFixed(0)}%`;
  const h1 = c.priceChange1h > 0 ? `+${c.priceChange1h.toFixed(0)}%` : `${c.priceChange1h.toFixed(0)}%`;
  const age = c.ageHours < 1 ? `${(c.ageHours * 60).toFixed(0)}m` : c.ageHours < 24 ? `${c.ageHours.toFixed(0)}h` : `${(c.ageHours / 24).toFixed(1)}d`;

  return [
    `${riskEmoji[c.riskLevel]} *CALL #${idx + 1} — ${c.symbol}* (${c.chainId})`,
    ``,
    `${arrow} *${c.name}*`,
    `score: *${c.score}/100* · ${pct} 24h · ${h1} 1h · age ${age}`,
    ``,
    `*Entry:* ${fmtPrice(c.entryPrice)}`,
    `*Target 1 (+30%):* ${fmtPrice(c.target1)}`,
    `*Target 2 (+100%):* ${fmtPrice(c.target2)}`,
    `*Stop Loss (-20%):* ${fmtPrice(c.stopLoss)}`,
    ``,
    `*MC:* ${fmt(c.mcap)} · *Liq:* ${fmt(c.liquidityUsd)} · *Vol 24h:* ${fmt(c.volH24)}`,
    `*Liq/MC:* ${(c.liqMcRatio * 100).toFixed(1)}% · *Buys:* ${(c.buyPressure * 100).toFixed(0)}% · *Vol/Liq:* ${c.volLiqRatio.toFixed(1)}x`,
    ``,
    `*Why:* ${c.reasons.join(" · ")}`,
    ``,
    `*CA:* \`${c.tokenAddress}\``,
  ].join("\n");
}

export async function handleCalls(ctx: Context): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply("🎯 scanning all chains for calls… (this takes ~60s)");
  try {
    const calls = await scanForCalls();
    if (calls.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "No strong calls found right now. Market may be quiet. Try again later.");
      return;
    }

    const header = [
      `🎯 *DAILY CALLS — ${calls.length} signals*`,
      `_scanned 80+ tickers · filtered by liq, vol, buy pressure, momentum_`,
      `_risk: 🟢 LOW · 🟡 MEDIUM · 🟠 HIGH_`,
      `_manage risk: never risk more than you can afford to lose_`,
      "",
    ].join("\n");

    // Send first call as the thinking message edit
    const firstCall = formatCall(calls[0], 1);
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, header + firstCall, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });

    // Send remaining calls as separate messages
    for (let i = 1; i < calls.length; i++) {
      const card = formatCall(calls[i], i + 1);
      await ctx.reply(card, {
        parse_mode: "Markdown",
        link_preview_options: { is_disabled: true },
      });
    }

    // Summary
    const summary = [
      `*SUMMARY*`,
      `🟢 LOW: ${calls.filter((c) => c.riskLevel === "LOW").length}`,
      `🟡 MEDIUM: ${calls.filter((c) => c.riskLevel === "MEDIUM").length}`,
      `🟠 HIGH: ${calls.filter((c) => c.riskLevel === "HIGH").length}`,
      "",
      `_DYOR — these are signals, not financial advice._`,
      `_Use /scan <token> for deeper analysis before entry._`,
    ].join("\n");
    await ctx.reply(summary, { parse_mode: "Markdown" });

  } catch (err) {
    const msg = (err as Error).message;
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ calls scan failed: ${msg}`);
    } catch {
      await ctx.reply(`⚠️ calls scan failed: ${msg}`);
    }
  }
}

export function registerCallsCommand(bot: Bot): void {
  bot.command("calls", async (ctx) => {
    if (!ctx.chat) return;
    await handleCalls(ctx);
  });
}
