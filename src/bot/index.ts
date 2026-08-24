import { Bot, Context } from "grammy";
import { registerScanCommand, handleScan } from "./commands/scan.js";
import { registerWatchCommands, handleWatch } from "./commands/watch.js";
import { registerAuditCommand, handleAudit } from "./commands/audit.js";
import { registerFindCommand, handleFind } from "./commands/find.js";
import { registerBriefCommand, handleBrief } from "./commands/brief.js";
import { registerHoldersCommand, handleHolders } from "./commands/holders.js";
import { registerTopCommand, handleTop } from "./commands/top.js";
import { registerSnipersCommand, handleSnipers } from "./commands/snipers.js";
import { registerFirstCommand, handleFirst } from "./commands/first.js";
import { registerWhaleDiagramCommand, handleWhaleDiagram } from "./commands/whale-diagram.js";
import { registerAirdropCommand, handleAirdrop } from "./commands/airdrop.js";
import { registerDevCommand, handleDev } from "./commands/dev.js";
import { registerTickerCheckCommand, handleTickerCheck } from "./commands/ticker-check.js";
import { registerNotableHoldersCommand, handleNotableHolders } from "./commands/notable-holders.js";
import { registerMarketCommand } from "./commands/market-overview.js";
import { registerFearCommand } from "./commands/fear.js";
import { registerRunnersCommand } from "./commands/runners.js";
import { registerPnlCommand } from "./commands/pnl.js";
import { registerVlCommand, handleVl } from "./commands/vl.js";
import { registerGemsCommand } from "./commands/gems.js";
import { clearPending, takePending } from "./pending.js";
import { config } from "../config.js";

export function createBot(): Bot {
  const bot = new Bot(config.telegramToken);

  registerScanCommand(bot);
  registerWatchCommands(bot);
  registerAuditCommand(bot);
  registerFindCommand(bot);
  registerBriefCommand(bot);
  registerHoldersCommand(bot);
  registerTopCommand(bot);
  registerSnipersCommand(bot);
  registerFirstCommand(bot);
  registerWhaleDiagramCommand(bot);
  registerAirdropCommand(bot);
  registerDevCommand(bot);
  registerTickerCheckCommand(bot);
  registerNotableHoldersCommand(bot);
  registerMarketCommand(bot);
  registerFearCommand(bot);
  registerRunnersCommand(bot);
  registerPnlCommand(bot);
  registerVlCommand(bot);
  registerGemsCommand(bot);

  bot.command("cancel", async (ctx) => {
    if (!ctx.chat) return;
    clearPending(ctx.chat.id);
    await ctx.reply("👌 cancelled.");
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;
    const kind = takePending(ctx.chat.id);
    if (!kind) return;
    if (kind === "scan") return handleScan(ctx, text);
    if (kind === "audit") return handleAudit(ctx, text);
    if (kind === "find") return handleFind(ctx, text);
    if (kind === "watch") return handleWatch(ctx, text);
    if (kind === "holders") return handleHolders(ctx, text);
    if (kind === "top") return handleTop(ctx, text);
    if (kind === "snipers") return handleSnipers(ctx, text);
    if (kind === "first") return handleFirst(ctx, text);
    if (kind === "wd") return handleWhaleDiagram(ctx, text);
    if (kind === "ad") return handleAirdrop(ctx, text);
    if (kind === "brief") return handleBrief(ctx, text);
    if (kind === "dev") return handleDev(ctx, text);
    if (kind === "tc") return handleTickerCheck(ctx, text);
    if (kind === "nh") return handleNotableHolders(ctx, text);
    if (kind === "vl") return handleVl(ctx, text);
    await ctx.reply("Something went wrong. Try /cancel and start again.");
  });

  void bot.api.setMyCommands([
    { command: "scan", description: "Scan a token — price, liq, chart, creator" },
    { command: "find", description: "Find the REAL token among clones" },
    { command: "brief", description: "Technicals + news briefing" },
    { command: "audit", description: "Security audit of a contract" },
    { command: "dev", description: "Check deployer history & rugs" },
    { command: "tc", description: "Ticker check — find copycats" },
    { command: "nh", description: "Notable holders by category" },
    { command: "holders", description: "Top 20 holders of a token" },
    { command: "top", description: "Top 10 traders by volume" },
    { command: "snipers", description: "Who sniped at launch" },
    { command: "first", description: "First 20 buyers at launch" },
    { command: "wd", description: "Whale diagram — visual holder map" },
    { command: "ad", description: "Airdrop report — check for dumpers" },
    { command: "watch", description: "Track a token — get flow alerts" },
    { command: "watchlist", description: "Show tracked tokens" },
    { command: "unwatch", description: "Stop tracking a token" },
    { command: "i", description: "Global market overview" },
    { command: "fear", description: "Fear & Greed Index" },
    { command: "runners", description: "Tokens that crossed $100K MC" },
    { command: "pnl", description: "PNL card for a token" },
    { command: "vl", description: "Volume + Liquidity analysis" },
    { command: "gems", description: "Find low MC gems to buy early" },
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
