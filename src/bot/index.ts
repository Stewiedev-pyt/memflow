import { Bot, Context } from "grammy";
import { registerScanCommand, handleScan } from "./commands/scan.js";
import { registerWatchCommands, handleWatch } from "./commands/watch.js";
import { registerAuditCommand, handleAudit } from "./commands/audit.js";
import { registerFindCommand, handleFind } from "./commands/find.js";
import { registerBriefCommand, handleBrief } from "./commands/brief.js";
import { registerNotableHoldersCommand, handleNotableHolders } from "./commands/notable-holders.js";
import { registerTopCommand, handleTop } from "./commands/top.js";
import { registerSnipersCommand, handleSnipers } from "./commands/snipers.js";
import { registerRunnersCommand } from "./commands/runners.js";
import { registerVlCommand, handleVl } from "./commands/vl.js";
import { registerGemsCommand } from "./commands/gems.js";
import { registerCallsCommand } from "./commands/calls.js";
import { registerTopCoinsCommand } from "./commands/topcoins.js";
import { registerWalletCommand } from "./commands/wallet.js";
import { registerTrackCommand } from "./commands/track.js";
import { registerTrenchesCommand } from "./commands/trenches.js";
import { registerPortfolioCommand } from "./commands/portfolio.js";
import { clearPending, takePending } from "./pending.js";
import { config } from "../config.js";
import { handleAgentMessage, toggleAutoMode } from "../agent/telegram.js";

export function createBot(): Bot {
  const bot = new Bot(config.telegramToken);

  registerScanCommand(bot);
  registerWatchCommands(bot);
  registerAuditCommand(bot);
  registerFindCommand(bot);
  registerBriefCommand(bot);
  registerNotableHoldersCommand(bot);
  registerTopCommand(bot);
  registerSnipersCommand(bot);
  registerRunnersCommand(bot);
  registerVlCommand(bot);
  registerGemsCommand(bot);
  registerCallsCommand(bot);
  registerTopCoinsCommand(bot);
  registerWalletCommand(bot);
  registerTrackCommand(bot);
  registerTrenchesCommand(bot);
  registerPortfolioCommand(bot);

  bot.command("cancel", async (ctx) => {
    if (!ctx.chat) return;
    clearPending(ctx.chat.id);
    await ctx.reply("👌 cancelled.");
  });

  bot.command("auto", async (ctx) => {
    if (!ctx.chat) return;
    const isOn = toggleAutoMode(ctx.chat.id, bot);
    await ctx.reply(isOn ? "✅ Auto mode ON — you'll receive call signals every 4h" : "⏹️ Auto mode OFF");
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    const kind = takePending(ctx.chat.id);
    if (kind === "scan") return handleScan(ctx, text);
    if (kind === "audit") return handleAudit(ctx, text);
    if (kind === "find") return handleFind(ctx, text);
    if (kind === "watch") return handleWatch(ctx, text);
    if (kind === "holders") return handleNotableHolders(ctx, text);
    if (kind === "top") return handleTop(ctx, text);
    if (kind === "snipers") return handleSnipers(ctx, text);
    if (kind === "brief") return handleBrief(ctx, text);
    if (kind === "vl") return handleVl(ctx, text);

    // No pending state — route through agent for natural language processing
    await handleAgentMessage(ctx, text);
  });

  void bot.api.setMyCommands([
    { command: "scan", description: "Full token scan — price, liq, chart, creator" },
    { command: "find", description: "Find the REAL token among clones" },
    { command: "brief", description: "Technicals + news briefing" },
    { command: "audit", description: "Security audit of a contract" },
    { command: "nh", description: "Notable holders by category" },
    { command: "top", description: "Top 10 traders by volume" },
    { command: "snipers", description: "Who sniped at launch" },
    { command: "watch", description: "Track a token — get flow alerts" },
    { command: "watchlist", description: "Show tracked tokens" },
    { command: "unwatch", description: "Stop tracking a token" },
    { command: "runners", description: "Trending tokens across all chains" },
    { command: "vl", description: "Volume + Liquidity deep analysis" },
    { command: "gems", description: "Find legit low MC gems" },
    { command: "topcoins", description: "List high MC tokens ($1M+) by chain" },
    { command: "calls", description: "Get 6-10 daily calls with entry/exit" },
    { command: "wallet", description: "Analyze any Solana wallet" },
    { command: "track", description: "Track a wallet for activity" },
    { command: "tracklist", description: "Show all tracked wallets" },
    { command: "untrack", description: "Stop tracking a wallet" },
    { command: "trenches", description: "New token discovery — launches" },
    { command: "portfolio", description: "Track your positions and PnL" },
    { command: "auto", description: "Toggle auto mode — get calls every 4h" },
    { command: "cancel", description: "Cancel the current prompt" },
  ]);

  bot.catch((err) => {
    console.error("Bot error:", err.error);
  });

  return bot;
}

export async function initBot(bot: Bot): Promise<string> {
  await bot.init();
  return bot.botInfo.username;
}

export function runPolling(bot: Bot): Promise<void> {
  return bot.start();
}

export type { Context };
