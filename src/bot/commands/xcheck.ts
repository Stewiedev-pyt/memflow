import { Bot, Context } from "grammy";

export async function handleXCheck(ctx: Context, input: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(`🔎 checking X/Twitter account…`);
  try {
    const clean = input.replace(/^@/, "").replace(/https?:\/\/(twitter|x)\.com\//, "").replace(/\/.*$/, "").split("/")[0];

    if (!clean) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "Please provide a valid X username or link.");
      return;
    }

    const lines: string[] = [
      `🔎 *X ACCOUNT CHECK — @${esc(clean)}*`,
      "",
      "⚠️ *Manual verification recommended:*",
      "",
      `• Check the account's creation date on their profile`,
      `• Look for previous name changes in the bio or web archives`,
      `• Verify follower count relative to engagement`,
      `• Check if the account was previously used for a different project`,
      "",
      "*Red flags to watch for:*",
      "🔴 Account < 30 days old",
      "🔴 Recently changed name from unrelated project",
      "🔴 Low followers, high engagement (possible bots)",
      "🔴 No profile picture or generic avatar",
      "🔴 Bio mentions multiple unrelated tokens",
      "",
      `*Profile link:* https://x.com/${clean}`,
    ];

    const card = lines.join("\n");
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, { parse_mode: "Markdown" });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ X check failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ X check failed: ${(err as Error).message}`);
    }
  }
}

function esc(s: string): string {
  return s.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

export function registerXCheckCommand(bot: Bot): void {
  bot.command("x", async (ctx) => {
    if (!ctx.chat) return;
    const input = ctx.match?.trim();
    if (!input) {
      await ctx.reply("🔎 Send an *X/Twitter username or link* to check for recycled accounts.\nExample: `/x @someproject`", { parse_mode: "Markdown" });
      return;
    }
    await handleXCheck(ctx, input);
  });
}
