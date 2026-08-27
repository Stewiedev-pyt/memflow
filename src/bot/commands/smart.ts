import { Bot } from "grammy";
import { getSmartMoneySignals, SmartMoneySignal } from "../../sources/smartmoney.js";
import { esc } from "../format.js";

function formatSignal(s: SmartMoneySignal, idx: number): string {
  const gain = parseFloat(s.maxGain);
  const gainStr = gain > 0 ? `+${gain.toFixed(1)}%` : `${gain.toFixed(1)}%`;
  const emoji = gain > 0 ? "🟢" : gain < 0 ? "🔴" : "⚪";
  const status = s.status === "active" ? "ACTIVE" : s.status === "timeout" ? "EXPIRED" : "DONE";
  const timeAgo = Date.now() - s.signalTriggerTime;
  const ago = timeAgo < 3600000 ? `${Math.round(timeAgo / 60000)}m ago` : `${Math.round(timeAgo / 3600000)}h ago`;

  return [
    `${emoji} *#${idx} $${esc(s.ticker)}* — ${s.direction.toUpperCase()}`,
    `   SM: ${s.smartMoneyCount} wallets · $${parseFloat(s.totalTokenValue).toFixed(0)} volume`,
    `   Entry: ${s.alertPrice} → Now: ${s.currentPrice} (${gainStr})`,
    `   Max: ${s.highestPrice} · Exit: ${s.exitRate}% · ${status} · ${ago}`,
    `   ${s.launchPlatform ?? "unknown"} · \`${s.contractAddress}\``,
  ].join("\n");
}

export function registerSmartCommand(bot: Bot) {
  bot.command("smart", async (ctx) => {
    if (!ctx.chat) return;
    const args = ctx.match?.trim();
    const chain = args?.toLowerCase() || "solana";

    const validChains = ["solana", "bsc", "all"];
    if (!validChains.includes(chain)) {
      return ctx.reply("Usage: /smart [solana|bsc|all]");
    }

    await ctx.reply(`🧠 Loading smart money signals for ${chain}...`);

    const signals = chain === "all"
      ? (await Promise.all([
          getSmartMoneySignals("solana", 10),
          getSmartMoneySignals("bsc", 10),
        ])).flat()
      : await getSmartMoneySignals(chain, 20);

    if (signals.length === 0) {
      return ctx.reply(`❌ No smart money signals found for ${chain}`);
    }

    const sorted = signals.sort((a, b) => b.signalTriggerTime - a.signalTriggerTime);

    const header = [
      `🧠 *SMART MONEY SIGNALS — ${chain.toUpperCase()}*`,
      `_${sorted.length} signals from tracked wallets_\n`,
    ].join("\n");

    const lines = [header];
    for (let i = 0; i < sorted.length && i < 15; i++) {
      lines.push(formatSignal(sorted[i], i + 1));
    }

    lines.push(`\n_Source: Binance Web3 Smart Money tracking_`);
    lines.push(`_DYOR — not financial advice._`);

    await ctx.reply(lines.join("\n"), {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  });
}
