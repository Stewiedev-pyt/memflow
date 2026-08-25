import { Bot, Context } from "grammy";
import { scanForCalls, CallSignal } from "../../core/calls.js";
import { addCall } from "../../storage/db.js";

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
    `${riskEmoji[c.riskLevel]} *CALL #${idx} — ${c.symbol}* (${c.chainId})`,
    `${arrow} *${c.name}*`,
    `score: *${c.score}/100* · ${pct} 24h · ${h1} 1h · age ${age}`,
    `*Entry:* ${fmtPrice(c.entryPrice)} · *TP1:* ${fmtPrice(c.target1)} · *TP2:* ${fmtPrice(c.target2)} · *SL:* ${fmtPrice(c.stopLoss)}`,
    `MC ${fmt(c.mcap)} · liq ${fmt(c.liquidityUsd)} · vol ${fmt(c.volH24)} · buys ${(c.buyPressure * 100).toFixed(0)}%`,
    `*Why:* ${c.reasons.join(" · ")}`,
    `\`${c.tokenAddress}\``,
  ].join("\n");
}

export async function handleCalls(ctx: Context): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply("🎯 scanning all chains for calls… (~60s)");
  try {
    const calls = await scanForCalls();
    if (calls.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "No strong calls found right now. Try again later.");
      return;
    }

    // Header
    const low = calls.filter((c) => c.riskLevel === "LOW").length;
    const med = calls.filter((c) => c.riskLevel === "MEDIUM").length;
    const high = calls.filter((c) => c.riskLevel === "HIGH").length;

    const header = [
      `🎯 *DAILY CALLS — ${calls.length} signals*`,
      `_scanned ${["sol", "eth", "base", "bsc"].join("/")} · ${low}🟢 ${med}🟡 ${high}🟠_`,
      `_manage risk: never risk more than you can afford to lose_`,
    ].join("\n");

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, header, { parse_mode: "Markdown" });

    // Send calls in batches of 3 to avoid rate limits
    for (let i = 0; i < calls.length; i += 3) {
      const batch = calls.slice(i, i + 3);
      const text = batch.map((c, j) => formatCall(c, i + j + 1)).join("\n\n");
      try {
        await ctx.reply(text, {
          parse_mode: "Markdown",
          link_preview_options: { is_disabled: true },
        });
      } catch {
        // If Markdown fails, try plain text
        const plain = batch.map((c, j) => formatCall(c, i + j + 1)).join("\n\n");
        await ctx.reply(plain);
      }
      // Store each call in the database
      for (const c of batch) {
        try {
          addCall({
            chatId: ctx.chat.id,
            symbol: c.symbol,
            tokenAddress: c.tokenAddress,
            pairAddress: c.pairAddress,
            chainId: c.chainId,
            entryPrice: c.entryPrice,
            entryMcap: c.mcap,
            score: c.score,
            reasoning: c.reasons.join(" · "),
          });
        } catch { /* continue */ }
      }
      // Delay between batches
      if (i + 3 < calls.length) await new Promise((r) => setTimeout(r, 1000));
    }

    // Footer
    await ctx.reply(
      `_DYOR — signals not financial advice._\n_Use /scan <token> for deeper analysis._`,
      { parse_mode: "Markdown" }
    );

  } catch (err) {
    const msg = (err as Error).message;
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ calls failed: ${msg}`);
    } catch {
      await ctx.reply(`⚠️ calls failed: ${msg}`);
    }
  }
}

export function registerCallsCommand(bot: Bot): void {
  bot.command("calls", async (ctx) => {
    if (!ctx.chat) return;
    await handleCalls(ctx);
  });
}
