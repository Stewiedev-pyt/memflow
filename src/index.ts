import { createBot, startBot } from "./bot/index.js";
import { reportSources } from "./config.js";

async function main(): Promise<void> {
  console.log("🌊 memflow starting...");
  for (const line of reportSources()) console.log(`   ${line}`);
  const bot = createBot();
  await startBot(bot);
}

main().catch((err) => {
  console.error("Fatal startup error:", err.message);
  process.exit(1);
});
