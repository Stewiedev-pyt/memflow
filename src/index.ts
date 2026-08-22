import { createBot, initBot, runPolling } from "./bot/index.js";
import { reportSources } from "./config.js";
import { startWatchEngine } from "./watch/engine.js";

async function main(): Promise<void> {
  console.log("🌊 memflow starting...");
  for (const line of reportSources()) console.log(`   ${line}`);
  const bot = createBot();
  const username = await initBot(bot);
  console.log(`🚀 memflow online as @${username}`);
  startWatchEngine(bot);
  console.log("📡 watch engine running (60s polling)");
  runPolling(bot).catch((err) => {
    console.error("Polling crashed:", err.message);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err.message);
  process.exit(1);
});
