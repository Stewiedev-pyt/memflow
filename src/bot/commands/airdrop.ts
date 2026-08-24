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

export async function handleAirdrop(ctx: Context, address: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(` airdrop report...`, { parse_mode: "Markdown" });

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
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No data found for ${best.baseToken.symbol}.`);
      return;
    }

    const walletStats = new Map<string, { buys: number; sells: number; netUsd: number; totalUsd: number }>();
    for (const t of trades) {
      const existing = walletStats.get(t.wallet) ?? { buys: 0, sells: 0, netUsd: 0, totalUsd: 0 };
      if (t.side === "buy") { existing.buys++; existing.netUsd += t.usd; }
      else { existing.sells++; existing.netUsd -= t.usd; }
      existing.totalUsd += t.usd;
      walletStats.set(t.wallet, existing);
    }

    const airdrops = [...walletStats.entries()]
      .filter(([, s]) => s.sells > 0 && s.buys === 0 && s.totalUsd > 100)
      .map(([wallet, s]) => ({ wallet, ...s }))
      .sort((a, b) => b.totalUsd - a.totalUsd)
      .slice(0, 10);

    const lines = airdrops.map((a, i) => {
      return `*${i + 1}.* \`${a.wallet.slice(0, 8)}…\` — ${fmtUsd(a.totalUsd)} sold (${a.sells} sells, 0 buys)`;
    });

    const card = truncate([
      ` AIRDROP REPORT — *${best.baseToken.symbol}* (${best.chainId})`,
      "",
      lines.length > 0 ? lines.join("\n") : "_no obvious airdrop sellers detected_",
      "",
      `_wallets that only sell (0 buys) are likely airdrop recipients._`,
    ].join("\n"));

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ airdrop report failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ airdrop report failed: ${(err as Error).message}`);
    }
  }
}

export function registerAirdropCommand(bot: Bot): void {
  bot.command("ad", async (ctx) => {
    if (!ctx.chat) return;
    const address = ctx.match?.trim();
    if (!address) {
      setPending(ctx.chat.id, "ad" as any);
      await ctx.reply(
        " Send me a *contract address* to check for airdrop activity.\n\nWorks on SOL · ETH · BSC · Base",
        { parse_mode: "Markdown" }
      );
      return;
    }
    await handleAirdrop(ctx, address);
  });
}
