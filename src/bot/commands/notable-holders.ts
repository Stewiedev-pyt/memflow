import { Bot, Context } from "grammy";
import { searchPairs, sortPairsByLiquidity } from "../../sources/dexscreener.js";
import { getTokenLargestAccounts } from "../../sources/helius.js";
import { getTokenHolders as getEthHolders } from "../../sources/etherscan.js";
import { isEvmAddress } from "../../sources/honeypot.js";
import { setPending } from "../pending.js";
import { esc, fmtUsd } from "../format.js";

interface HolderCategory {
  label: string;
  emoji: string;
  wallets: Array<{ address: string; balance: string; pct: number; note: string }>;
}

export async function handleNotableHolders(ctx: Context, query: string): Promise<void> {
  if (!ctx.chat) return;
  const thinking = await ctx.reply(`🔍 analyzing holders for *$${esc(query)}*…`, { parse_mode: "Markdown" });
  try {
    const allPairs = sortPairsByLiquidity(await searchPairs(query));
    const best = allPairs.find(
      (p) => p.baseToken.symbol.toLowerCase() === query.toLowerCase()
    ) ?? allPairs[0];
    if (!best) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No token found for "$${query}".`);
      return;
    }

    const chainId = best.chainId;
    let holders: Array<{ address: string; balance: string; uiAmount?: number }> = [];

    if (chainId === "solana") {
      const heliusHolders = await getTokenLargestAccounts(best.baseToken.address);
      holders = heliusHolders.map((h) => ({
        address: h.address,
        balance: h.uiAmount.toLocaleString(),
        uiAmount: h.uiAmount,
      }));
    } else if (["ethereum", "base", "bsc", "arbitrum"].includes(chainId) && isEvmAddress(best.baseToken.address)) {
      const ethHolders = await getEthHolders(best.baseToken.address);
      holders = ethHolders.map((h) => ({
        address: h.address,
        balance: h.balance,
        uiAmount: Number(h.balance),
      }));
    }

    if (holders.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `No holder data available for this token on ${chainId}.`);
      return;
    }

    const totalSupply = holders.reduce((sum, h) => sum + (h.uiAmount ?? 0), 0);
    const categories: HolderCategory[] = [
      { label: "🐋 WHALES (> 5% supply)", emoji: "🐋", wallets: [] },
      { label: "🦈 SHARKS (1–5%)", emoji: "🦈", wallets: [] },
      { label: "🐟 FISH (0.1–1%)", emoji: "🐟", wallets: [] },
      { label: "🦐 SMALL (< 0.1%)", emoji: "🦐", wallets: [] },
    ];

    for (const h of holders) {
      const pct = totalSupply > 0 ? ((h.uiAmount ?? 0) / totalSupply) * 100 : 0;
      const note = `${pct.toFixed(2)}%`;
      if (pct >= 5) categories[0].wallets.push({ address: h.address, balance: h.balance, pct, note });
      else if (pct >= 1) categories[1].wallets.push({ address: h.address, balance: h.balance, pct, note });
      else if (pct >= 0.1) categories[2].wallets.push({ address: h.address, balance: h.balance, pct, note });
      else categories[3].wallets.push({ address: h.address, balance: h.balance, pct, note });
    }

    const lines: string[] = [
      `🔍 *NOTABLE HOLDERS — ${esc(best.baseToken.symbol)}* (${chainId})`,
      `*${holders.length}* top holders analyzed · MC ${fmtUsd(best.marketCap)}`,
      "",
    ];

    for (const cat of categories) {
      if (cat.wallets.length === 0) continue;
      lines.push(`${cat.emoji} *${cat.label}* (${cat.wallets.length})`);
      for (const w of cat.wallets.slice(0, 5)) {
        const short = `${w.address.slice(0, 6)}…${w.address.slice(-4)}`;
        lines.push(`  \`${short}\` — ${w.note}`);
      }
      if (cat.wallets.length > 5) lines.push(`  _…and ${cat.wallets.length - 5} more_`);
      lines.push("");
    }

    const conc = categories[0].wallets.reduce((s, w) => s + w.pct, 0);
    if (conc > 50) lines.push("🔴 *High concentration — whale dump risk!*");
    else if (conc > 30) lines.push("🟡 *Moderate concentration*");
    else lines.push("✅ *Healthy distribution*");

    const card = lines.join("\n").slice(0, 4000);
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card, { parse_mode: "Markdown" });
  } catch (err) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ holder analysis failed: ${(err as Error).message}`);
    } catch {
      await ctx.reply(`⚠️ holder analysis failed: ${(err as Error).message}`);
    }
  }
}

export function registerNotableHoldersCommand(bot: Bot): void {
  bot.command("nh", async (ctx) => {
    if (!ctx.chat) return;
    const query = ctx.match?.trim().replace(/^\$/, "");
    if (!query) {
      setPending(ctx.chat.id, "nh");
      await ctx.reply("🔍 Send a *token name or CA* to categorize its holders.", { parse_mode: "Markdown" });
      return;
    }
    await handleNotableHolders(ctx, query);
  });
}
