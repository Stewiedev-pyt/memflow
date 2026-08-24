import { Bot, Context } from "grammy";
import { searchPairs, sortPairsByLiquidity } from "../../sources/dexscreener.js";
import { getTokenLargestAccounts } from "../../sources/helius.js";
import { getTokenHolders as getEthHolders } from "../../sources/etherscan.js";
import { isEvmAddress } from "../../sources/honeypot.js";
import { setPending } from "../pending.js";

function fmtPct(n: number): string {
  if (n >= 1) return n.toFixed(1) + "%";
  if (n >= 0.01) return n.toFixed(2) + "%";
  return "<0.01%";
}

function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 20) + "\n\n_(truncated)_";
}

export async function handleHolders(ctx: Context, address: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(` whale holder list...`, { parse_mode: "Markdown" });

  try {
    const pairs = sortPairsByLiquidity(await searchPairs(address));
    const best = pairs[0];
    const symbol = best?.baseToken.symbol ?? address.slice(0, 8);
    const chainId = best?.chainId ?? "";

    let holders: Array<{ address: string; pct: number; amount?: number }> = [];

    if (chainId === "solana") {
      const accounts = await getTokenLargestAccounts(address);
      const total = accounts.reduce((s, a) => s + a.uiAmount, 0);
      holders = accounts.slice(0, 20).map((a) => ({
        address: a.address,
        pct: total > 0 ? (a.uiAmount / total) * 100 : 0,
        amount: a.uiAmount,
      }));
    } else if (isEvmAddress(address)) {
      const ethHolders = await getEthHolders(address, 20);
      holders = ethHolders.map((h) => ({ address: h.address, pct: h.pct }));
    }

    if (holders.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No holder data available for this token on ${chainId || "unknown chain"}.`);
      return;
    }

    const lines = holders.map((h, i) => {
      const bar = h.pct >= 10 ? "🟧" : h.pct >= 5 ? "🟨" : h.pct >= 1 ? "⬜" : "▪️";
      return `${bar} *${i + 1}.* \`${h.address.slice(0, 8)}…${h.address.slice(-4)}\` — ${fmtPct(h.pct)}`;
    });

    const card = truncate([
      `🐋 *TOP ${holders.length} HOLDERS — ${symbol}* (${chainId})`,
      "",
      ...lines,
      "",
      `_holders above 5% are concentrated — monitor for exits._`,
    ].join("\n"));

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ holders failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ holders failed: ${(err as Error).message}`);
    }
  }
}

export function registerHoldersCommand(bot: Bot): void {
  bot.command("holders", async (ctx) => {
    if (!ctx.chat) return;
    const address = ctx.match?.trim();
    if (!address) {
      setPending(ctx.chat.id, "holders" as any);
      await ctx.reply(
        " whale Send me a *contract address* to see top holders.\n\nWorks on SOL · ETH · BSC · Base",
        { parse_mode: "Markdown" }
      );
      return;
    }
    await handleHolders(ctx, address);
  });
}
