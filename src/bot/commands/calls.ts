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

    // Group by chain
    const sol = calls.filter((c) => c.chainId === "solana");
    const eth = calls.filter((c) => c.chainId === "ethereum");
    const bsc = calls.filter((c) => c.chainId === "bsc");
    const base = calls.filter((c) => c.chainId === "base");

    const header = [
      `🎯 *DAILY CALLS — ${calls.length} signals*`,
      `_Sol: ${sol.length} · ETH: ${eth.length} · BSC: ${bsc.length} · Base: ${base.length}_`,
      `_manage risk: never risk more than you can afford to lose_`,
    ].join("\n");

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, header, { parse_mode: "Markdown" });

    // Send calls grouped by chain
    const sections = [
      { name: "SOLANA", emoji: "◎", arr: sol },
      { name: "ETHEREUM", emoji: "⟠", arr: eth },
      { name: "BSC", emoji: "🟡", arr: bsc },
      { name: "BASE", emoji: "🔵", arr: base },
    ];

    for (const sec of sections) {
      if (sec.arr.length === 0) continue;
      const lines = [`*${sec.emoji} ${sec.name}*`];
      for (let i = 0; i < sec.arr.length; i++) {
        const c = sec.arr[i];
        const riskEmoji = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🟠" };
        const pct = c.priceChange24h > 0 ? `+${c.priceChange24h.toFixed(0)}%` : `${c.priceChange24h.toFixed(0)}%`;
        const rugcheck = c.rugcheck ? ` · ${c.rugcheck}` : "";
        lines.push(
          `${riskEmoji[c.riskLevel]} *${c.symbol}* — score ${c.score}/100`,
          `   Entry ${fmtPrice(c.entryPrice)} · TP1 ${fmtPrice(c.target1)} · TP2 ${fmtPrice(c.target2)} · SL ${fmtPrice(c.stopLoss)}`,
          `   MC ${fmt(c.mcap)} · Liq ${fmt(c.liquidityUsd)} · Vol ${fmt(c.volH24)} · ${pct}${rugcheck}`,
          `   \`${c.tokenAddress}\``
        );
      }
      try {
        await ctx.reply(lines.join("\n"), { parse_mode: "Markdown", link_preview_options: { is_disabled: true } });
      } catch {
        await ctx.reply(lines.join("\n"));
      }
      await new Promise((r) => setTimeout(r, 1000));
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
