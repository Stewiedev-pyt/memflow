import { Bot } from "grammy";
import { getLeaderboard } from "../../storage/db.js";

function fmtMcap(n: number | null): string {
  if (n === null || n === undefined) return "?";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function registerLeaderboardCommand(bot: Bot): void {
  bot.command("lb", async (ctx) => {
    if (!ctx.chat) return;
    const entries = getLeaderboard(10);
    if (entries.length === 0) {
      await ctx.reply("No scans yet. Be the first to scan a token!");
      return;
    }
    const medals = ["🥇", "🥈", "🥉"];
    const lines = entries.map((e, i) => {
      const medal = medals[i] ?? `*${i + 1}.*`;
      return `${medal} @${e.username} — *${e.scan_count}* scans · best mcap: ${fmtMcap(e.best_mcap)}`;
    });
    await ctx.reply(` LEADERBOARD\n\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  });
}
