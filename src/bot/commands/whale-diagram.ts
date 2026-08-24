import { Bot, Context } from "grammy";
import { searchPairs, sortPairsByLiquidity } from "../../sources/dexscreener.js";
import { getTokenLargestAccounts } from "../../sources/helius.js";
import { getTokenHolders as getEthHolders } from "../../sources/etherscan.js";
import { isEvmAddress } from "../../sources/honeypot.js";
import { setPending } from "../pending.js";

function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 20) + "\n\n_(truncated)_";
}

function getWhaleEmoji(pct: number): string {
  if (pct >= 20) return "🟧";
  if (pct >= 10) return "🟨";
  if (pct >= 5) return "⬜";
  if (pct >= 1) return "▪️";
  return "·";
}

export async function handleWhaleDiagram(ctx: Context, address: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(` generating whale diagram...`, { parse_mode: "Markdown" });

  try {
    const pairs = sortPairsByLiquidity(await searchPairs(address));
    const best = pairs[0];
    const symbol = best?.baseToken.symbol ?? address.slice(0, 8);
    const chainId = best?.chainId ?? "";

    let holders: Array<{ pct: number }> = [];

    if (chainId === "solana") {
      const accounts = await getTokenLargestAccounts(address);
      const total = accounts.reduce((s, a) => s + a.uiAmount, 0);
      holders = accounts.slice(0, 30).map((a) => ({ pct: total > 0 ? (a.uiAmount / total) * 100 : 0 }));
    } else if (isEvmAddress(address)) {
      const ethHolders = await getEthHolders(address, 30);
      holders = ethHolders.map((h) => ({ pct: h.pct }));
    }

    if (holders.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No holder data for this token.`);
      return;
    }

    const diagram = holders.map((h) => getWhaleEmoji(h.pct)).join("");
    const top3 = holders.slice(0, 3).reduce((s, h) => s + h.pct, 0).toFixed(1);
    const top10 = holders.slice(0, 10).reduce((s, h) => s + h.pct, 0).toFixed(1);

    const card = truncate([
      ` WHALE DIAGRAM — *${symbol}* (${chainId})`,
      "",
      diagram,
      "",
      `Top 3: *${top3}%* · Top 10: *${top10}%*`,
      "",
      "🟧 >20% · 🟨 >10% · ⬜ >5% · ▪️ >1% · · <1%",
      "",
      `_each emoji = 1 top holder. tap for details._`,
    ].join("\n"));

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ whale diagram failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ whale diagram failed: ${(err as Error).message}`);
    }
  }
}

export function registerWhaleDiagramCommand(bot: Bot): void {
  bot.command("wd", async (ctx) => {
    if (!ctx.chat) return;
    const address = ctx.match?.trim();
    if (!address) {
      setPending(ctx.chat.id, "wd" as any);
      await ctx.reply(
        " Send me a *contract address* to see the whale diagram.\n\nWorks on SOL · ETH · BSC · Base",
        { parse_mode: "Markdown" }
      );
      return;
    }
    await handleWhaleDiagram(ctx, address);
  });
}
