import { Bot } from "grammy";
import { getRecentScans } from "../../storage/db.js";

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function registerLastCommand(bot: Bot): void {
  bot.command("last", async (ctx) => {
    if (!ctx.chat) return;
    const scans = getRecentScans(10);
    if (scans.length === 0) {
      await ctx.reply("No scans yet. Be the first to scan a token!");
      return;
    }
    const lines = scans.map((s, i) => {
      const username = s.username ? `@${s.username}` : "anonymous";
      return `*${i + 1}.* ${s.symbol} (${s.chainId}) — scanned by ${username} ${timeAgo(s.scannedAt)}`;
    });
    await ctx.reply(` LAST 10 SCANS\n\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  });
}
