import { Bot, Context } from "grammy";
import { searchPairs, sortPairsByLiquidity } from "../../sources/dexscreener.js";
import { setPending } from "../pending.js";
import { esc, fmtUsd } from "../format.js";

export async function handleDexUpdate(ctx: Context, query: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(`📋 checking DexScreener updates for *$${esc(query)}*…`, { parse_mode: "Markdown" });
  try {
    const allPairs = sortPairsByLiquidity(await searchPairs(query));
    const best = allPairs.find(
      (p) => p.baseToken.symbol.toLowerCase() === query.toLowerCase()
    ) ?? allPairs[0];
    if (!best) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No token found for "$${query}".`);
      return;
    }

    const lines: string[] = [
      `📋 *DEXSCREENER PROFILE — ${esc(best.baseToken.symbol)}* (${best.chainId})`,
      "",
      `*Pair:* \`${best.pairAddress.slice(0, 16)}…\``,
      `*DEX:* ${best.dexId}`,
      `*MC:* ${fmtUsd(best.marketCap)} · *Liq:* ${fmtUsd(best.liquidity?.usd)}`,
      `*24h Vol:* ${fmtUsd(best.volume?.h24)}`,
      "",
    ];

    const socials = best.info?.socials ?? [];
    const websites = best.info?.websites ?? [];

    if (socials.length > 0 || websites.length > 0) {
      lines.push("*Links & Socials:*");
      for (const s of socials) {
        lines.push(`• ${s.type}: ${s.url}`);
      }
      for (const w of websites) {
        lines.push(`• ${w.label ?? "website"}: ${w.url}`);
      }
      lines.push("");
    }

    const age = best.pairCreatedAt
      ? `${((Date.now() - best.pairCreatedAt) / 86_400_000).toFixed(1)} days`
      : "unknown";
    lines.push(`*Token age:* ${age}`);

    if (best.pairCreatedAt) {
      const createdDate = new Date(best.pairCreatedAt).toISOString().split("T")[0];
      lines.push(`*Created:* ${createdDate}`);
    }

    const card = lines.join("\n");
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, { parse_mode: "Markdown" });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ DexScreener check failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ DexScreener check failed: ${(err as Error).message}`);
    }
  }
}

export function registerDexUpdateCommand(bot: Bot): void {
  bot.command("dp", async (ctx) => {
    if (!ctx.chat) return;
    const query = ctx.match?.trim().replace(/^\$/, "");
    if (!query) {
      setPending(ctx.chat.id, "dp");
      await ctx.reply("📋 Send a *token name or CA* to check its DexScreener profile.", { parse_mode: "Markdown" });
      return;
    }
    await handleDexUpdate(ctx, query);
  });
}
