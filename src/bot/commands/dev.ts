import { Bot, Context } from "grammy";
import { searchPairs, sortPairsByLiquidity } from "../../sources/dexscreener.js";
import { getTokenCreator, getDeployerTokens } from "../../sources/pumpfun.js";
import { setPending } from "../pending.js";
import { esc, fmtUsd } from "../format.js";

export async function handleDev(ctx: Context, query: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(`🔍 scanning deployer for *$${esc(query)}*…`, { parse_mode: "Markdown" });
  try {
    const allPairs = sortPairsByLiquidity(await searchPairs(query));
    const best = allPairs.find(
      (p) => p.baseToken.symbol.toLowerCase() === query.toLowerCase()
    ) ?? allPairs[0];
    if (!best) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No token found for "$${query}".`);
      return;
    }

    const creator = await getTokenCreator(best.baseToken.address);
    if (!creator) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `Could not find deployer for ${esc(best.baseToken.symbol)}.`);
      return;
    }

    const deployerTokens = await getDeployerTokens(creator);
    const bonded = deployerTokens.filter((t) => t.mcap && t.mcap > 1000);
    const rugged = deployerTokens.filter((t) => t.mcap && t.mcap < 100 && t.volH24 === 0);
    const active = deployerTokens.filter((t) => t.mcap && t.mcap > 10_000);

    const ageDays = best.pairCreatedAt
      ? ((Date.now() - best.pairCreatedAt) / 86_400_000).toFixed(1)
      : "?";

    const lines: string[] = [
      `👤 *DEPLOYER REPORT — ${esc(best.baseToken.symbol)}*`,
      "",
      `\`${creator.slice(0, 8)}…${creator.slice(-6)}\``,
      "",
      `*Launch history:*`,
      `• total tokens launched: *${deployerTokens.length}*`,
      `• bonded / graduated: *${bonded.length}*`,
      `• rugged / dead (< $100 MC, 0 vol): *${rugged.length}*`,
      `• still alive (> $10K MC): *${active.length}*`,
      "",
      `*Current token:* age ${ageDays}d · MC ${fmtUsd(best.marketCap)} · liq ${fmtUsd(best.liquidity?.usd)}`,
    ];

    if (deployerTokens.length > 1) {
      lines.push("", "*Recent launches:*");
      for (const t of deployerTokens.slice(0, 5)) {
        const tag = t.mcap && t.mcap > 10_000 ? "🟢" : t.mcap && t.mcap < 100 ? "🔴" : "⚪";
        lines.push(`${tag} ${esc(t.symbol)} — MC ${fmtUsd(t.mcap ?? undefined)}`);
      }
    }

    const riskTag = rugged.length > 3 ? "⚠️ *HIGH RISK — serial deployer*" : rugged.length > 0 ? "🟡 *caution — some rugs*" : "✅ *clean deployer history*";
    lines.push("", riskTag);

    const card = lines.join("\n");
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, { parse_mode: "Markdown" });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ dev scan failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ dev scan failed: ${(err as Error).message}`);
    }
  }
}

export function registerDevCommand(bot: Bot): void {
  bot.command("dev", async (ctx) => {
    if (!ctx.chat) return;
    const query = ctx.match?.trim().replace(/^\$/, "");
    if (!query) {
      setPending(ctx.chat.id, "dev");
      await ctx.reply("👤 Send a *token name or CA* to check the deployer's history.", { parse_mode: "Markdown" });
      return;
    }
    await handleDev(ctx, query);
  });
}
