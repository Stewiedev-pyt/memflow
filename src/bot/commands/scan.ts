import { Bot, Context } from "grammy";
import { searchPairs, sortPairsByLiquidity, DexPair } from "../../sources/dexscreener.js";
import { setPending } from "../pending.js";

function fmtUsd(n?: number): string {
  if (n === undefined) return "?";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function age(createdMs?: number): string {
  if (!createdMs) return "unknown";
  const days = Math.floor((Date.now() - createdMs) / 86_400_000);
  if (days < 1) return "<1d ⚠️";
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function renderPair(p: DexPair): string {
  const vol24 = p.volume?.h24;
  const buys = p.txns?.h24?.buys ?? 0;
  const sells = p.txns?.h24?.sells ?? 0;
  const change = p.priceChange?.h24;
  const changeStr = change === undefined ? "" : ` (${change > 0 ? "+" : ""}${change.toFixed(1)}% 24h)`;
  return [
    `🪙 *${p.baseToken.symbol}* on ${p.chainId} / ${p.dexId}${changeStr}`,
    `   price: ${p.priceUsd ? "$" + p.priceUsd : "?"} · liq: ${fmtUsd(p.liquidity?.usd)} · mcap: ${fmtUsd(p.marketCap)}`,
    `   vol24: ${fmtUsd(vol24)} · txns: ${buys}b/${sells}s · age: ${age(p.pairCreatedAt)}`,
    `   [chart](${p.url})`,
  ].join("\n");
}

export async function handleScan(ctx: Context, query: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(`🔍 scanning *${query}*...`, { parse_mode: "Markdown" });
  try {
    const pairs = sortPairsByLiquidity(await searchPairs(query)).slice(0, 5);
    if (pairs.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No pairs found for "${query}".`);
      return;
    }
    const body = pairs.map(renderPair).join("\n\n");
    const header = `🔍 *${query.toUpperCase()}* — top ${pairs.length} by liquidity:\n\n`;
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, header + body, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      thinking.message_id,
      `⚠️ scan failed: ${(err as Error).message}`
    );
  }
}

export function registerScanCommand(bot: Bot): void {
  bot.command("scan", async (ctx) => {
    const query = ctx.match?.trim();
    if (!query) {
      setPending(ctx.chat.id, "scan");
      await ctx.reply(
        "🔎 Send me a token *name* or *contract address* and I'll scan it.\n\nExample: `pepe` or `0x6982…1933`\n_Tip: `/scan <name|CA>` also works in one message._",
        { parse_mode: "Markdown" }
      );
      return;
    }
    await handleScan(ctx, query);
  });
}
