import { Bot } from "grammy";

export function registerPingCommand(bot: Bot): void {
  bot.command("ping", async (ctx) => {
    const started = Date.now();
    const msg = await ctx.reply("🏓 pong");
    const latency = Date.now() - started;
    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `🏓 pong — ${latency}ms\n🚀 memflow is alive and watching.`
    );
  });
}
