import { Bot, Context } from "grammy";
import { searchPairs, sortPairsByLiquidity } from "../../sources/dexscreener.js";
import { toGeckoNetwork, getOhlcv } from "../../sources/geckoterminal.js";
import { getContractCreator as getEthCreator } from "../../sources/etherscan.js";
import { isEvmAddress } from "../../sources/honeypot.js";
import { addRecentScan, updateLeaderboard } from "../../storage/db.js";
import { setPending } from "../pending.js";
import { esc } from "../format.js";

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

function sparkline(candles: Array<{ c: number }>): string {
  if (candles.length === 0) return "";
  const closes = candles.map((c) => c.c);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  return closes.map((c) => {
    const idx = Math.min(7, Math.floor(((c - min) / range) * 8));
    return blocks[idx];
  }).join("");
}

function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 20) + "\n\n_(truncated)_";
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
    const best = pairs[0];

    const network = toGeckoNetwork(best.chainId);
    const candles = network ? await getOhlcv(network, best.pairAddress, "hour", 24) : [];
    const chart = sparkline(candles);

    let creator: string | null = null;
    try {
      if (isEvmAddress(best.baseToken.address)) {
        creator = await getEthCreator(best.baseToken.address);
      }
    } catch {}

    const change24 = best.priceChange?.h24;
    const changeStr = change24 !== undefined ? ` (${change24 > 0 ? "+" : ""}${change24.toFixed(1)}%)` : "";
    const buys = best.txns?.h24?.buys ?? 0;
    const sells = best.txns?.h24?.sells ?? 0;

    const lines: string[] = [
      `🔍 *${esc(best.baseToken.symbol)}* on ${best.chainId} / ${best.dexId}${changeStr}`,
      "",
      `price: ${best.priceUsd ? "$" + best.priceUsd : "?"} · liq: ${fmtUsd(best.liquidity?.usd)} · mcap: ${fmtUsd(best.marketCap)}`,
      `vol24: ${fmtUsd(best.volume?.h24)} · txns: ${buys}b/${sells}s · age: ${age(best.pairCreatedAt)}`,
    ];

    if (chart) lines.push(`chart: ${chart}`);

    if (creator) lines.push(`creator: \`${creator.slice(0, 10)}…${creator.slice(-4)}\``);

    lines.push(`[dexscreener](${best.url})`);

    if (pairs.length > 1) {
      lines.push("", "*Other pairs:*");
      for (const p of pairs.slice(1, 5)) {
        lines.push(`• ${esc(p.baseToken.symbol)} — liq ${fmtUsd(p.liquidity?.usd)} · mcap ${fmtUsd(p.marketCap)}`);
      }
    }

    const card = truncate(lines.join("\n"));
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });

    if (ctx.from) {
      try {
        addRecentScan({
          chatId: ctx.chat.id,
          userId: ctx.from.id,
          username: ctx.from.username ?? ctx.from.first_name,
          symbol: best.baseToken.symbol,
          pairAddress: best.pairAddress,
          chainId: best.chainId,
          mcap: best.marketCap,
        });
        updateLeaderboard({ userId: ctx.from.id, username: ctx.from.username ?? ctx.from.first_name, mcap: best.marketCap });
      } catch { /* non-critical */ }
    }
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ scan failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ scan failed: ${(err as Error).message}`);
    }
  }
}

export function registerScanCommand(bot: Bot): void {
  bot.command("scan", async (ctx) => {
    if (!ctx.chat) return;
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
