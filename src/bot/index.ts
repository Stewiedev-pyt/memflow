import { Bot, Context } from "grammy";
import { registerStartCommand } from "./commands/start.js";
import { registerPingCommand } from "./commands/ping.js";
import { registerScanCommand } from "./commands/scan.js";
import { config } from "../config.js";

export function createBot(): Bot {
  const bot = new Bot(config.telegramToken);

  registerStartCommand(bot);
  registerPingCommand(bot);
  registerScanCommand(bot);

  void bot.api.setMyCommands([
    { command: "start", description: "Introduce memflow" },
    { command: "scan", description: "Scan a token by name or contract address" },
    { command: "ping", description: "Check memflow is alive" },
  ]);

  bot.catch((err) => {
    console.error("Bot error:", err.error);
  });

  return bot;
}

export async function startBot(bot: Bot): Promise<void> {
  await bot.init();
  console.log(`🚀 memflow online as @${bot.botInfo.username}`);
  await bot.start();
}

export type { Context };
