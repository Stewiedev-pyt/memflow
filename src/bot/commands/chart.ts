import { Bot } from "grammy";
import { searchPairs } from "../../sources/dexscreener.js";
import { getOhlcv, toGeckoNetwork } from "../../sources/geckoterminal.js";
import { esc, fmtUsd, fmtMcap } from "../format.js";

function buildChartUrl(
  candles: Array<{ ts: number; o: number; h: number; l: number; c: number; v: number }>,
  symbol: string,
): string {
  const labels = candles.map((c) => {
    const d = new Date(c.ts);
    return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  });
  const closes = candles.map((c) => c.c);
  const volumes = candles.map((c) => c.v);

  const config = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "line",
          label: "Price",
          data: closes,
          borderColor: "#00d4aa",
          backgroundColor: "rgba(0,212,170,0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
          yAxisID: "y",
          order: 1,
        },
        {
          type: "bar",
          label: "Volume",
          data: volumes,
          backgroundColor: candles.map((c) => (c.c >= c.o ? "rgba(0,212,170,0.4)" : "rgba(255,71,87,0.4)")),
          yAxisID: "y1",
          order: 2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: `${symbol} Price Chart`, color: "#fff", font: { size: 16 } },
        legend: { display: false },
      },
      scales: {
        x: { ticks: { color: "#888", maxTicksLimit: 10 }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: {
          position: "right",
          ticks: { color: "#00d4aa" },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
        y1: {
          position: "left",
          display: false,
          beginAtZero: true,
        },
      },
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&w=800&h=400&bkg=1a1a2e`;
}

export function registerChartCommand(bot: Bot) {
  bot.command("chart", async (ctx) => {
    if (!ctx.chat) return;
    const input = ctx.match?.trim();
    if (!input) {
      return ctx.reply("Usage: /chart <token name or address>");
    }

    await ctx.reply(`📊 Generating chart for ${input}...`);

    const pairs = await searchPairs(input, 1);
    if (pairs.length === 0) {
      return ctx.reply(`❌ No results for "${input}". Try a different name or address.`);
    }

    const best = pairs[0];
    const symbol = best.baseToken.symbol;
    const name = best.baseToken.name;
    const chainName = best.chainId;
    const network = toGeckoNetwork(chainName);

    if (!network) {
      return ctx.reply(`❌ Unsupported chain: ${chainName}`);
    }

    const candles = await getOhlcv(network, best.pairAddress, "hour", 30);
    if (candles.length < 5) {
      return ctx.reply(`❌ Not enough price data for ${symbol}.`);
    }

    const chartUrl = buildChartUrl(candles, symbol);
    const techNote = candles.length >= 25
      ? (() => {
          const closes = candles.map((c) => c.c);
          const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
          const last = closes[closes.length - 1];
          const trend = last > sma20 ? "📈 Above SMA20 — bullish" : "📉 Below SMA20 — bearish";
          return `\n${trend} (SMA20: ${fmtUsd(sma20)})`;
        })()
      : "";

    const lines = [
      `📊 *${esc(symbol)} — ${esc(name)}*`,
      `*${chainName.toUpperCase()}*\n`,
      `Current: ${fmtUsd(best.priceUsd)} · MC: ${fmtMcap(best.marketCap)}`,
      `Liq: ${fmtUsd(best.liquidity?.usd)} · Vol 24h: ${fmtUsd(best.volume?.h24)}`,
      `${candles.length} candles (1h) · ${new Date(candles[candles.length - 1].ts).toUTCString()}${techNote}`,
    ];

    await ctx.reply(lines.join("\n"), {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });

    try {
      await ctx.replyWithPhoto(chartUrl, {
        caption: `${symbol} ${candles.length}h chart`,
      });
    } catch {
      await ctx.reply(`📊 Chart URL: ${chartUrl}`);
    }
  });
}
