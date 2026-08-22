import { Bot } from "grammy";
import { findRealToken } from "../../core/finder.js";

function fmtUsd(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return "?";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function ageStr(days?: number): string {
  if (days === undefined) return "age ?";
  if (days < 1) return "<1d ⚠️";
  if (days < 60) return `${Math.floor(days)}d`;
  return `${(days / 365).toFixed(1)}yr`;
}

export function registerFindCommand(bot: Bot): void {
  bot.command("find", async (ctx) => {
    const query = ctx.match?.trim().replace(/^\$/, "");
    if (!query || query.length > 20) {
      await ctx.reply("Usage: `/find pepe` — I'll separate the real token from the clones.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const thinking = await ctx.reply(`🎯 hunting the real *$${query}* across chains…`, {
      parse_mode: "Markdown",
    });

    try {
      const result = await findRealToken(query);
      if (result.candidates.length === 0) {
        await edit(thinking, bot, ctx.chat.id, `Nothing with real liquidity found for "$${query}".`);
        return;
      }

      const lines = result.candidates.map((c) => {
        const cg = c.cgRank ? `✅ CoinGecko #${c.cgRank}` : c.hasTwitter ? "✅ twitter linked" : "⚠️ no socials";
        return [
          `${c.verdict} *${c.symbol}* — ${c.chains.join(", ")}`,
          `   liq ${fmtUsd(c.bestLiqUsd)} · mcap ${fmtUsd(c.mcap)} · ${ageStr(c.ageDays)}`,
          `   \`${c.address.slice(0, 14)}…\` · ${cg}`,
        ].join("\n");
      });

      const card = [
        `🎯 *$${query.toUpperCase()}* — who's real?`,
        "",
        lines.join("\n\n"),
        "",
        `_always verify the full CA before buying. clones copy names, not liquidity._`,
      ].join("\n");

      await edit(thinking, bot, ctx.chat.id, card);
    } catch (err) {
      await edit(thinking, bot, ctx.chat.id, `⚠️ find failed: ${(err as Error).message}`);
    }
  });
}

function edit(msg: { message_id: number }, bot: Bot, chatId: number, text: string): Promise<unknown> {
  return bot.api.editMessageText(chatId, msg.message_id, text, {
    parse_mode: "Markdown",
    link_preview_options: { is_disabled: true },
  });
}
