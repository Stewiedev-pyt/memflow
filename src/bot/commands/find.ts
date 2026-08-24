import { Bot, Context } from "grammy";
import { findRealToken } from "../../core/finder.js";
import { setPending } from "../pending.js";
import { esc } from "../format.js";

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

export async function handleFind(ctx: Context, rawQuery: string): Promise<void> {
  if (!ctx.chat) return;
  const query = rawQuery.replace(/^\$/, "");
  const edit = (msg: { message_id: number }, chatId: number, text: string) =>
    ctx.api.editMessageText(chatId, msg.message_id, text, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });

  const thinking = await ctx.reply(`🎯 hunting the real *$${query}* across chains…`, {
    parse_mode: "Markdown",
  });

  try {
    const result = await findRealToken(query);
    if (result.candidates.length === 0) {
      await edit(thinking, ctx.chat.id, `Nothing with real liquidity found for "$${query}".`);
      return;
    }

    const lines = result.candidates.map((c) => {
      const cg = c.cgRank ? `✅ CoinGecko #${c.cgRank}` : c.hasTwitter ? "✅ twitter linked" : "⚠️ no socials";
      return [
        `${c.verdict} *${esc(c.symbol)}* — ${c.chains.join(", ")}`,
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

    await edit(thinking, ctx.chat.id, card);
  } catch (err) {
    await edit(thinking, ctx.chat.id, `⚠️ find failed: ${(err as Error).message}`);
  }
}

export function registerFindCommand(bot: Bot): void {
  bot.command("find", async (ctx) => {
    if (!ctx.chat) return;
    const query = ctx.match?.trim().replace(/^\$/, "");
    if (!query || query.length > 20) {
      setPending(ctx.chat.id, "find");
      await ctx.reply(
        "🎯 Send me a *ticker* and I'll separate the real token from the clones.\n\nExample: `pepe`\n_Tip: `/find <ticker>` also works in one message._",
        { parse_mode: "Markdown" }
      );
      return;
    }
    await handleFind(ctx, query);
  });
}
