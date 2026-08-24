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

export async function handleTop(ctx: Context, address: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(` top traders...`, { parse_mode: "Markdown" });

  try {
    const pairs = sortPairsByLiquidity(await searchPairs(address));
    const best = pairs[0];
    if (!best) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No pair found for "${address}".`);
      return;
    }

    const network = toGeckoNetwork(best.chainId);
    if (!network) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `Chain "${best.chainId}" not supported for top traders.`);
      return;
    }

    const trades = await getPoolTrades(network, best.pairAddress);
    if (trades.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No recent trades found for ${best.baseToken.symbol}.`);
      return;
    }

    const walletStats = new Map<string, { buys: number; sells: number; netUsd: number }>();
    for (const t of trades) {
      const existing = walletStats.get(t.wallet) ?? { buys: 0, sells: 0, netUsd: 0 };
      if (t.side === "buy") { existing.buys++; existing.netUsd += t.usd; }
      else { existing.sells++; existing.netUsd -= t.usd; }
      walletStats.set(t.wallet, existing);
    }

    const top = [...walletStats.entries()]
      .map(([wallet, s]) => ({ wallet, ...s, total: Math.abs(s.netUsd) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const lines = top.map((t, i) => {
      const emoji = t.netUsd > 0 ? "🟢" : "🔴";
      return `${emoji} *${i + 1}.* \`${t.wallet.slice(0, 8)}…\` — ${fmtUsd(t.total)} net ${t.netUsd > 0 ? "BUY" : "SELL"} (${t.buys}b/${t.sells}s)`;
    });

    const card = truncate([
      ` top 10 TRADERS — *${best.baseToken.symbol}* (${best.chainId})`,
      "",
      ...lines,
      "",
      `_based on recent trades — not financial advice._`,
    ].join("\n"));

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ top traders failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ top traders failed: ${(err as Error).message}`);
    }
  }
}

export function registerTopCommand(bot: Bot): void {
  bot.command("top", async (ctx) => {
    if (!ctx.chat) return;
    const address = ctx.match?.trim();
    if (!address) {
      setPending(ctx.chat.id, "top" as any);
      await ctx.reply(
        " Send me a *contract address* to see top traders.\n\nWorks on SOL · ETH · BSC · Base",
        { parse_mode: "Markdown" }
      );
      return;
    }
    await handleTop(ctx, address);
  });
}
