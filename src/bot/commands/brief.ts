import { Bot, Context } from "grammy";
import { searchPairs, sortPairsByLiquidity } from "../../sources/dexscreener.js";
import { toGeckoNetwork, getOhlcv } from "../../sources/geckoterminal.js";
import { analyzeCandles } from "../../core/indicators.js";
import { getNews } from "../../sources/cryptopanic.js";
import { listWatched } from "../../storage/db.js";
import { setPending } from "../pending.js";

function fmtUsd(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return "?";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(4)}`;
}

function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 20) + "\n\n_(truncated)_";
}

export async function handleBrief(ctx: Context, query: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(`📊 building briefing for *$${query}*…`, { parse_mode: "Markdown" });

  try {
    const allPairs = sortPairsByLiquidity(await searchPairs(query));
    const best = allPairs.find(
      (p) => p.baseToken.symbol.toLowerCase() === query.toLowerCase()
    ) ?? allPairs[0];
    if (!best) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No liquid pair found for "$${query}".`);
      return;
    }

    const network = toGeckoNetwork(best.chainId);
    const candles = network ? await getOhlcv(network, best.pairAddress, "hour", 72) : [];
    const tech = analyzeCandles(candles);

    const change24 = best.priceChange?.h24;
    const buys = best.txns?.h24?.buys ?? 0;
    const sells = best.txns?.h24?.sells ?? 0;

    const lines: string[] = [
      `📊 *BRIEFING — ${best.baseToken.symbol}* (${best.chainId})`,
      "",
      `price ${best.priceUsd ? "$" + best.priceUsd : "?"} · liq ${fmtUsd(best.liquidity?.usd)} · mcap ${fmtUsd(best.marketCap)}`,
      `24h: ${change24 !== undefined ? (change24 > 0 ? "+" : "") + change24.toFixed(1) + "%" : "?"} · txns ${buys}b/${sells}s · vol ${fmtUsd(best.volume?.h24)}`,
      "",
      "*Technicals (1h):*",
    ];

    if (tech) {
      lines.push(
        `• trend: ${tech.trend}`,
        `• RSI: ${tech.rsiValue !== null ? tech.rsiValue.toFixed(0) : "?"} — ${tech.rsiNote}`,
        tech.support && tech.resistance
          ? `• range: support ${tech.support.toPrecision(3)} / resistance ${tech.resistance.toPrecision(3)}`
          : "",
        `• ${tech.volumeNote}`
      );
    } else {
      lines.push("• not enough candle history — too new or illiquid");
    }

    const news = await getNews(best.baseToken.symbol);
    lines.push("", "*News:*");
    if (news.length > 0) {
      for (const n of news) lines.push(`📰 [${n.title.slice(0, 80)}](${n.url})`);
    } else if (!process.env.CRYPTOPANIC_API_KEY) {
      lines.push("_news feed inactive — CRYPTOPANIC_API_KEY not set_");
    } else {
      lines.push("_no recent headlines found for this ticker_");
    }

    const watched = listWatched().some((w) => w.symbol.toLowerCase() === query.toLowerCase());
    lines.push("", watched ? "🟢 live radar active on this one" : "_not being tracked — /watch " + query + " for live flow alerts_");

    const card = truncate(lines.filter((l) => l !== "").join("\n"));
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ brief failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ brief failed: ${(err as Error).message}`);
    }
  }
}

export function registerBriefCommand(bot: Bot): void {
  bot.command("brief", async (ctx) => {
    if (!ctx.chat) return;
    const query = ctx.match?.trim().replace(/^\$/, "");
    if (!query) {
      setPending(ctx.chat.id, "brief");
      await ctx.reply("Usage: `/brief pepe` — technicals + news + flow snapshot.", {
        parse_mode: "Markdown",
      });
      return;
    }
    await handleBrief(ctx, query);
  });
}
