import { Bot, Context } from "grammy";
import { getFearGreedIndex } from "../../sources/market.js";

export async function handleFearGreed(ctx: Context): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply("😱 fetching Fear & Greed Index…");
  try {
    const data = await getFearGreedIndex();
    if (!data) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "⚠️ Could not fetch Fear & Greed data.");
      return;
    }

    const bar = "█".repeat(Math.round(data.value / 10)) + "░".repeat(10 - Math.round(data.value / 10));

    const lines: string[] = [
      "😱 *FEAR & GREED INDEX*",
      "",
      `*${data.value} / 100* — *${data.classification}*`,
      `\`${bar}\``,
      "",
      "*Last 7 days:*",
    ];

    for (let i = 0; i < data.history.length; i++) {
      const h = data.history[i];
      const emoji = h.value >= 60 ? "🟢" : h.value >= 40 ? "🟡" : "🔴";
      const dayLabel = i === 0 ? "today" : i === 1 ? "yesterday" : `${i}d ago`;
      lines.push(`${emoji} ${dayLabel}: *${h.value}* — ${h.classification}`);
    }

    const sentiment = data.value >= 75 ? "🔥 *Extreme Greed — be careful, market may be overheated*"
      : data.value >= 60 ? "📈 *Greed — bullish sentiment*"
      : data.value >= 40 ? "😐 *Neutral — mixed signals*"
      : data.value >= 25 ? "📉 *Fear — potential buying opportunity*"
      : "😱 *Extreme Fear — maximum opportunity, but DYOR*";

    lines.push("", sentiment);

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ fear & greed failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ fear & greed failed: ${(err as Error).message}`);
    }
  }
}

export function registerFearCommand(bot: Bot): void {
  bot.command("fear", async (ctx) => {
    if (!ctx.chat) return;
    await handleFearGreed(ctx);
  });
}
