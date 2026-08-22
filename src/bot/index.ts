import { Bot, Context } from "grammy";
import { registerStartCommand } from "./commands/start.js";
import { registerPingCommand } from "./commands/ping.js";
import { registerScanCommand } from "./commands/scan.js";
import { registerWatchCommands } from "./commands/watch.js";
import { registerAuditCommand } from "./commands/audit.js";
import { registerFindCommand } from "./commands/find.js";
import { config } from "../config.js";

export function createBot(): Bot {
  const bot = new Bot(config.telegramToken);

  registerStartCommand(bot);
  registerPingCommand(bot);
  registerScanCommand(bot);
  registerWatchCommands(bot);
  registerAuditCommand(bot);
  registerFindCommand(bot);

  void bot.api.setMyCommands([
    { command: "start", description: "Introduce memflow" },
    { command: "scan", description: "Scan a token by name or contract address" },
    { command: "find", description: "Find the REAL token among clones" },
    { command: "audit", description: "Security audit of a contract" },
    { command: "watch", description: "Track a token - get flow alerts" },
    { command: "watchlist", description: "Show tracked tokens" },
    { command: "unwatch", description: "Stop tracking a token" },
    { command: "ping", description: "Check memflow is alive" },
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
