import { Bot, Context } from "grammy";
import { searchPairs, sortPairsByLiquidity } from "../../sources/dexscreener.js";
import { toGeckoNetwork, getPoolTrades } from "../../sources/geckoterminal.js";
import { setPending } from "../pending.js";

function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 20) + "\n\n_(truncated)_";
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export async function handleFirst(ctx: Context, address: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(` first buyers...`, { parse_mode: "Markdown" });

  try {
    const pairs = sortPairsByLiquidity(await searchPairs(address));
    const best = pairs[0];
    if (!best) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No pair found for "${address}".`);
      return;
    }

    const network = toGeckoNetwork(best.chainId);
    if (!network) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `Chain "${best.chainId}" not supported.`);
      return;
    }

    const trades = await getPoolTrades(network, best.pairAddress, 0);
    if (trades.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No trades found for ${best.baseToken.symbol}.`);
      return;
    }

    const buys = trades.filter((t) => t.side === "buy").sort((a, b) => a.ts - b.ts).slice(0, 20);

    const lines = buys.map((t, i) => {
      const timeSinceLaunch = best.pairCreatedAt ? ((t.ts - best.pairCreatedAt) / 1000).toFixed(0) : "?";
      return `*${i + 1}.* \`${t.wallet.slice(0, 8)}…\` — ${fmtUsd(t.usd)} (${timeSinceLaunch}s)`;
    });

    const card = truncate([
      ` FIRST 20 BUYERS — *${best.baseToken.symbol}* (${best.chainId})`,
      "",
      ...lines,
      "",
      `_time shown as seconds since pool creation._`,
    ].join("\n"));

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ first buyers failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ first buyers failed: ${(err as Error).message}`);
    }
  }
}

export function registerFirstCommand(bot: Bot): void {
  bot.command("first", async (ctx) => {
    if (!ctx.chat) return;
    const address = ctx.match?.trim();
    if (!address) {
      setPending(ctx.chat.id, "first" as any);
      await ctx.reply(
        " Send me a *contract address* to see the first buyers.\n\nWorks on SOL · ETH · BSC · Base",
        { parse_mode: "Markdown" }
      );
      return;
    }
    await handleFirst(ctx, address);
  });
}
