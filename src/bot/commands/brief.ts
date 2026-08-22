import { Bot } from "grammy";
import { searchPairs, sortPairsByLiquidity, DexPair } from "../../sources/dexscreener.js";
import { toGeckoNetwork, getOhlcv } from "../../sources/geckoterminal.js";
import { analyzeCandles } from "../../core/indicators.js";
import { getNews } from "../../sources/cryptopanic.js";
import { listWatched } from "../../storage/db.js";

function fmtUsd(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return "?";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(4)}`;
}

export function registerBriefCommand(bot: Bot): void {
  bot.command("brief", async (ctx) => {
    const query = ctx.match?.trim().replace(/^\$/, "");
    if (!query) {
      await ctx.reply("Usage: `/brief pepe` — technicals + news + flow snapshot.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const thinking = await ctx.reply(`📊 building briefing for *$${query}*…`, { parse_mode: "Markdown" });

    try {
      const pairs = sortPairsByLiquidity(await searchPairs(query)).filter(
        (p) => p.baseToken.symbol.toLowerCase() === query.toLowerCase()
      );
      if (pairs.length === 0) {
        await edit(thinking, bot, ctx.chat.id, `No liquid pair found for "$${query}".`);
        return;
      }
      const best: DexPair = pairs[0];

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
        lines.push("_news feed inactive — CRYPTOPANIC_API_KEY not set in .env_");
      } else {
        lines.push("_no recent headlines found for this ticker_");
      }

      const watched = listWatched().some((w) => w.symbol.toLowerCase() === query.toLowerCase());
      lines.push("", watched ? "🟢 live radar active on this one" : "_not being tracked — /watch " + query + " for live flow alerts_");

      await edit(thinking, bot, ctx.chat.id, lines.filter((l) => l !== "").join("\n"));
    } catch (err) {
      await edit(thinking, bot, ctx.chat.id, `⚠️ brief failed: ${(err as Error).message}`);
    }
  });
}

function edit(msg: { message_id: number }, bot: Bot, chatId: number, text: string): Promise<unknown> {
  return bot.api.editMessageText(chatId, msg.message_id, text, {
    parse_mode: "Markdown",
    link_preview_options: { is_disabled: true },
  });
}
