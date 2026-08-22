import { Bot } from "grammy";

export function registerStartCommand(bot: Bot): void {
  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        "🌊 *memflow* — meme token intelligence",
        "",
        "I watch liquidity and volume flows so you don't ape blind.",
        "",
        "Try:",
        "`/scan pepe` — scan a token by name",
        "`/ping` — check I'm alive",
        "",
        "_More modules landing soon: flow radar, audits, smart-money alerts._",
      ].join("\n"),
      { parse_mode: "Markdown" }
    );
  });
}
