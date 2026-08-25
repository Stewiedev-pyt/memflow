import { Bot, Context } from "grammy";
import { getCalls, CallRow } from "../../storage/db.js";
import { esc } from "../format.js";

async function getCurrentPrice(tokenAddress: string, chainId: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/${chainId}/${tokenAddress}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any[];
    if (data.length > 0 && data[0].priceUsd) return Number(data[0].priceUsd);
    return null;
  } catch {
    return null;
  }
}

async function showStats(ctx: Context, days: number) {
  if (!ctx.chat) return;

  const msg = await ctx.reply(`📊 Loading ${days}D stats...`);

  const calls = getCalls(ctx.chat.id, days);
  if (calls.length === 0) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `📊 No calls tracked in the last ${days} days.\nUse /calls to generate signals first.`);
    } catch {
      await ctx.reply(`📊 No calls tracked in the last ${days} days.`);
    }
    return;
  }

  const results: Array<{ call: CallRow; currentPrice: number | null; multiplier: number | null }> = [];
  for (const c of calls) {
    const price = await getCurrentPrice(c.tokenAddress, c.chainId);
    const multiplier = price && c.entryPrice > 0 ? price / c.entryPrice : null;
    results.push({ call: c, currentPrice: price, multiplier });
  }

  const withMultiplier = results.filter((r) => r.multiplier !== null) as Array<{ call: CallRow; currentPrice: number; multiplier: number }>;
  const winners = withMultiplier.filter((r) => r.multiplier >= 2);
  const losers = withMultiplier.filter((r) => r.multiplier < 1);
  const breakeven = withMultiplier.filter((r) => r.multiplier >= 1 && r.multiplier < 2);

  const hitRate = withMultiplier.length > 0 ? (winners.length / withMultiplier.length * 100) : 0;
  const multipliers = withMultiplier.map((r) => r.multiplier).sort((a, b) => a - b);
  const median = multipliers.length > 0 ? multipliers[Math.floor(multipliers.length / 2)] : 0;
  const avgReturn = multipliers.length > 0 ? multipliers.reduce((a, b) => a + b, 0) / multipliers.length : 0;
  const totalReturn = multipliers.reduce((a, b) => a * b, 1);

  const sorted = [...withMultiplier].sort((a, b) => b.multiplier - a.multiplier);

  const lines = [
    `📊 *Stewie Stats — ${days}D*\n`,
    `├ Calls:         ${calls.length}`,
    `├ Tracked:       ${withMultiplier.length}`,
    `├ Hit Rate:      ${hitRate.toFixed(0)}%`,
    `├ Winners:       ${winners.length} 🟢`,
    `├ Losers:        ${losers.length} 🔴`,
    `├ Breakeven:     ${breakeven.length} ⚪`,
    `├ Median:        ${median.toFixed(1)}x`,
    `├ Total Return:  ${totalReturn.toFixed(1)}x`,
    `└ Avg Return:    ${avgReturn.toFixed(1)}x\n`,
    `*Top Calls:*`,
  ];

  for (let i = 0; i < sorted.length && i < 10; i++) {
    const r = sorted[i];
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
    const pct = (r.multiplier - 1) * 100;
    const display = r.multiplier >= 1 ? `${r.multiplier.toFixed(1)}x` : `${pct.toFixed(0)}%`;
    lines.push(`${medal} $${esc(r.call.symbol)} [${display}]`);
  }

  if (losers.length > 0) {
    const worstLosers = [...losers].sort((a, b) => a.multiplier - b.multiplier).slice(0, 3);
    lines.push(`\n*Worst Losers:*`);
    for (const r of worstLosers) {
      const pct = (r.multiplier - 1) * 100;
      lines.push(`🔴 $${esc(r.call.symbol)} [${pct.toFixed(0)}%]`);
    }
  }

  try {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, lines.join("\n"), { parse_mode: "Markdown" });
  } catch {
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  }
}

export function registerStatsCommand(bot: Bot) {
  // /stats — shows timeframe picker
  bot.command("stats", async (ctx) => {
    if (!ctx.chat) return;
    const args = ctx.match?.trim();

    // If user provided a number, show stats directly
    const days = parseInt(args ?? "0");
    if (days > 0) {
      return showStats(ctx, days);
    }

    // Show timeframe picker
    await ctx.reply("📊 Choose timeframe:", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "1D", callback_data: "stats_1" },
            { text: "3D", callback_data: "stats_3" },
            { text: "7D", callback_data: "stats_7" },
          ],
          [
            { text: "14D", callback_data: "stats_14" },
            { text: "30D", callback_data: "stats_30" },
            { text: "All", callback_data: "stats_999" },
          ],
        ],
      },
    });
  });

  // Handle button clicks
  bot.callbackQuery(/^stats_(\d+)$/, async (ctx) => {
    const days = parseInt(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await showStats(ctx, days);
  });
}
