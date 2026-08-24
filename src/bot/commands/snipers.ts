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

export async function handleSnipers(ctx: Context, address: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(` sniper report...`, { parse_mode: "Markdown" });

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

    const sorted = trades.sort((a, b) => a.ts - b.ts);
    const poolCreatedAt = best.pairCreatedAt ?? sorted[0]?.ts ?? 0;
    const snipeWindow = 30_000;
    const snipers = sorted.filter((t) => t.ts > 0 && t.ts - poolCreatedAt < snipeWindow && t.side === "buy");

    const totalSnipedUsd = snipers.reduce((s, t) => s + t.usd, 0);
    const uniqueSnipers = new Set(snipers.map((t) => t.wallet)).size;

    const lines = snipers.slice(0, 10).map((t, i) => {
      const delay = t.ts - poolCreatedAt;
      return `⚡ *${i + 1}.* \`${t.wallet.slice(0, 8)}…\` — ${fmtUsd(t.usd)} (${(delay / 1000).toFixed(1)}s after open)`;
    });

    const card = truncate([
      ` SNIPER REPORT — *${best.baseToken.symbol}* (${best.chainId})`,
      "",
      `*${uniqueSnipers}* snipers bought in first 3 seconds`,
      `total sniped: *${fmtUsd(totalSnipedUsd)}*`,
      "",
      ...lines,
      "",
      `_snipers are auto-bots that buy the moment liquidity is added._`,
    ].join("\n"));

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ sniper report failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ sniper report failed: ${(err as Error).message}`);
    }
  }
}

export function registerSnipersCommand(bot: Bot): void {
  bot.command("snipers", async (ctx) => {
    if (!ctx.chat) return;
    const address = ctx.match?.trim();
    if (!address) {
      setPending(ctx.chat.id, "snipers" as any);
      await ctx.reply(
        " Send me a *contract address* to see sniper activity.\n\nWorks on SOL · ETH · BSC · Base",
        { parse_mode: "Markdown" }
      );
      return;
    }
    await handleSnipers(ctx, address);
  });
}
