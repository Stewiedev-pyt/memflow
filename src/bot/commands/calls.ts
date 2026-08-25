import { Bot, Context } from "grammy";
import { scanForCalls, CallSignal } from "../../core/calls.js";
import { addCall } from "../../storage/db.js";

// Cache calls so button clicks don't rescan
const callsCache = new Map<string, { calls: CallSignal[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

function fmt(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(10)}`;
}

function fmtPrice(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(10)}`;
}

function formatCallsList(calls: CallSignal[], chainLabel: string): string {
  if (calls.length === 0) return `No calls found for ${chainLabel}`;

  const lines = [`🎯 *${chainLabel} — ${calls.length} calls*\n`];

  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const riskEmoji = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🟠" };
    const pct = c.priceChange24h > 0 ? `+${c.priceChange24h.toFixed(0)}%` : `${c.priceChange24h.toFixed(0)}%`;
    const rugcheck = c.rugcheck ? ` · ${c.rugcheck}` : "";
    lines.push(
      `${riskEmoji[c.riskLevel]} *${c.symbol}* — score ${c.score}/100`,
      `   Entry ${fmtPrice(c.entryPrice)} · TP1 ${fmtPrice(c.target1)} · TP2 ${fmtPrice(c.target2)} · SL ${fmtPrice(c.stopLoss)}`,
      `   MC ${fmt(c.mcap)} · Liq ${fmt(c.liquidityUsd)} · Vol ${fmt(c.volH24)} · ${pct}${rugcheck}`,
      `   \`${c.tokenAddress}\`\n`
    );
  }

  lines.push(`_DYOR — signals not financial advice._`);
  return lines.join("\n");
}

async function scanAndShowButtons(ctx: Context) {
  if (!ctx.chat) return;
  const thinking = await ctx.reply("🎯 scanning all chains… (~60s)");

  try {
    const calls = await scanForCalls();

    // Cache the calls
    callsCache.set(String(ctx.chat.id), { calls, timestamp: Date.now() });

    // Store in DB
    for (const c of calls) {
      try {
        addCall({
          chatId: ctx.chat.id,
          symbol: c.symbol,
          tokenAddress: c.tokenAddress,
          pairAddress: c.pairAddress,
          chainId: c.chainId,
          entryPrice: c.entryPrice,
          entryMcap: c.mcap,
          score: c.score,
          reasoning: c.reasons.join(" · "),
        });
      } catch { /* continue */ }
    }

    const sol = calls.filter((c) => c.chainId === "solana").length;
    const eth = calls.filter((c) => c.chainId === "ethereum").length;
    const bsc = calls.filter((c) => c.chainId === "bsc").length;
    const base = calls.filter((c) => c.chainId === "base").length;

    const header = [
      `🎯 *DAILY CALLS — ${calls.length} signals*`,
      `_Sol: ${sol} · ETH: ${eth} · BSC: ${bsc} · Base: ${base}_\n`,
      `_Pick a chain:_`,
    ].join("\n");

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, header, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: `◎ Solana (${sol})`, callback_data: "calls_solana" },
            { text: `⟠ ETH (${eth})`, callback_data: "calls_ethereum" },
          ],
          [
            { text: `🟡 BSC (${bsc})`, callback_data: "calls_bsc" },
            { text: `🔵 Base (${base})`, callback_data: "calls_base" },
          ],
          [
            { text: `📋 All (${calls.length})`, callback_data: "calls_all" },
          ],
        ],
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ calls failed: ${msg}`);
    } catch {
      await ctx.reply(`⚠️ calls failed: ${msg}`);
    }
  }
}

function showChainCalls(ctx: Context, chainId: string, label: string) {
  const cacheKey = String(ctx.chat?.id ?? "");
  const cached = callsCache.get(cacheKey);

  if (!cached || Date.now() - cached.timestamp > CACHE_TTL) {
    return ctx.reply("⚠️ Calls expired. Use /calls to scan again.");
  }

  let filtered: CallSignal[];
  if (chainId === "all") {
    filtered = cached.calls;
  } else {
    filtered = cached.calls.filter((c) => c.chainId === chainId);
  }

  const msg = formatCallsList(filtered, label);
  return ctx.reply(msg, { parse_mode: "Markdown", link_preview_options: { is_disabled: true } });
}

export function registerCallsCommand(bot: Bot): void {
  bot.command("calls", async (ctx) => {
    if (!ctx.chat) return;
    await scanAndShowButtons(ctx);
  });

  bot.callbackQuery(/^calls_(\w+)$/, async (ctx) => {
    const chain = ctx.match[1];
    await ctx.answerCallbackQuery();

    const labels: Record<string, string> = {
      solana: "◎ SOLANA",
      ethereum: "⟠ ETHEREUM",
      bsc: "🟡 BSC",
      base: "🔵 BASE",
      all: "📋 ALL CHAINS",
    };

    await showChainCalls(ctx, chain, labels[chain] ?? chain);
  });
}
