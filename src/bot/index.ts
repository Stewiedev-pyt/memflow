import { Bot, Context } from "grammy";
import { registerStartCommand } from "./commands/start.js";
import { registerPingCommand } from "./commands/ping.js";
import { registerScanCommand } from "./commands/scan.js";
import { registerWatchCommands } from "./commands/watch.js";
import { registerAuditCommand } from "./commands/audit.js";
import { registerFindCommand } from "./commands/find.js";
import { registerBriefCommand } from "./commands/brief.js";
import { registerHoldersCommand } from "./commands/holders.js";
import { registerTopCommand } from "./commands/top.js";
import { registerSnipersCommand } from "./commands/snipers.js";
import { registerFirstCommand } from "./commands/first.js";
import { registerWhaleDiagramCommand } from "./commands/whale-diagram.js";
import { registerAirdropCommand } from "./commands/airdrop.js";
import { registerLastCommand } from "./commands/last.js";
import { registerLeaderboardCommand } from "./commands/leaderboard.js";
import { handleScan } from "./commands/scan.js";
import { handleAudit } from "./commands/audit.js";
import { handleFind } from "./commands/find.js";
import { handleWatch } from "./commands/watch.js";
import { handleHolders } from "./commands/holders.js";
import { handleTop } from "./commands/top.js";
import { handleSnipers } from "./commands/snipers.js";
import { handleFirst } from "./commands/first.js";
import { handleWhaleDiagram } from "./commands/whale-diagram.js";
import { handleAirdrop } from "./commands/airdrop.js";
import { clearPending, takePending } from "./pending.js";
import { config } from "../config.js";

export function createBot(): Bot {
  const bot = new Bot(config.telegramToken);

  registerStartCommand(bot);
  registerPingCommand(bot);
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
  registerLastCommand(bot);
  registerLeaderboardCommand(bot);

  bot.command("cancel", async (ctx) => {
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
    return handleWatch(ctx, text);
  });

  void bot.api.setMyCommands([
    { command: "start", description: "Introduce memflow" },
    { command: "scan", description: "Scan a token (price, liq, chart, creator)" },
    { command: "find", description: "Find the REAL token among clones" },
    { command: "brief", description: "Technicals + news briefing" },
    { command: "audit", description: "Security audit of a contract" },
    { command: "holders", description: "Top 20 holders of a token" },
    { command: "top", description: "Top 10 traders by volume" },
    { command: "snipers", description: "Who sniped at launch" },
    { command: "first", description: "First 20 buyers at launch" },
    { command: "wd", description: "Whale diagram — visual holder map" },
    { command: "ad", description: "Airdrop report — check for dumpers" },
    { command: "watch", description: "Track a token - get flow alerts" },
    { command: "watchlist", description: "Show tracked tokens" },
    { command: "unwatch", description: "Stop tracking a token" },
    { command: "last", description: "Last 10 scanned tokens" },
    { command: "lb", description: "Top scanners leaderboard" },
    { command: "ping", description: "Check memflow is alive" },
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
