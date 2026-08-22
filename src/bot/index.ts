import { Bot, Context } from "grammy";
import { registerStartCommand } from "./commands/start.js";
import { registerPingCommand } from "./commands/ping.js";
import { registerScanCommand } from "./commands/scan.js";
import { registerWatchCommands } from "./commands/watch.js";
import { registerAuditCommand } from "./commands/audit.js";
import { registerFindCommand } from "./commands/find.js";
import { registerBriefCommand } from "./commands/brief.js";
import { handleScan } from "./commands/scan.js";
import { handleAudit } from "./commands/audit.js";
import { handleFind } from "./commands/find.js";
import { handleWatch } from "./commands/watch.js";
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

  bot.command("cancel", async (ctx) => {
    clearPending(ctx.chat.id);
    await ctx.reply("👌 cancelled.");
  });

  // Fallback: consume plain-text replies to commands that asked for input.
  // Must stay registered AFTER every command handler.
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;
    const kind = takePending(ctx.chat.id);
    if (!kind) return;
    if (kind === "scan") return handleScan(ctx, text);
    if (kind === "audit") return handleAudit(ctx, text);
    if (kind === "find") return handleFind(ctx, text);
    return handleWatch(ctx, text);
  });

  void bot.api.setMyCommands([
    { command: "start", description: "Introduce memflow" },
    { command: "scan", description: "Scan a token by name or contract address" },
    { command: "find", description: "Find the REAL token among clones" },
    { command: "brief", description: "Technicals + news briefing" },
    { command: "audit", description: "Security audit of a contract" },
    { command: "watch", description: "Track a token - get flow alerts" },
    { command: "watchlist", description: "Show tracked tokens" },
    { command: "unwatch", description: "Stop tracking a token" },
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
