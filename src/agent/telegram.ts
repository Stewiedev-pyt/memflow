import { Bot } from "grammy";
import { MemflowAgent, AgentResponse } from "./index.js";
import { escHtml, truncate, fmtMcap, fmtUsd } from "../bot/format.js";

// ─── CHAT SUBSCRIPTIONS ────────────────────────────────────
const chatSubscriptions = new Map<number, boolean>();

export function registerAlertChat(chatId: number, bot: Bot): void {
  if (chatSubscriptions.has(chatId)) return;
  chatSubscriptions.set(chatId, true);
}

// ─── TELEGRAM RESPONSE FORMATTERS ──────────────────────────
function formatScan(d: any): string {
  if (!d) return "❌ No data";
  const trend =
    d.tech?.trend === "bullish" ? "🟢 bullish" :
    d.tech?.trend === "bearish" ? "🔴 bearish" :
    "⚪ sideways";

  return [
    `🔍 <b>${escHtml(d.symbol)}</b> (${escHtml(d.chain)})`,
    "",
    `Price: ${escHtml(d.price ?? "?")}`,
    `MC: ${fmtMcap(d.mcap)} | Liq: ${fmtUsd(d.liquidity)}`,
    `Vol 24h: ${fmtUsd(d.volume24h)} | 1h: ${d.priceChange1h != null ? `${d.priceChange1h > 0 ? "+" : ""}${d.priceChange1h.toFixed(1)}%` : "?"}`,
    `Buys/Sells: ${d.buys24h ?? "?"}/${d.sells24h ?? "?"} | Age: ${d.ageHours?.toFixed(1) ?? "?"}h`,
    "",
    `Trend: ${trend} | RSI: ${d.tech?.rsiValue?.toFixed(0) ?? "?"}`,
    "",
    `Contract: <code>${escHtml(d.tokenAddress)}</code>`,
  ].join("\n");
}

function formatCalls(calls: any[]): string {
  if (!calls || calls.length === 0) return "❌ No calls found";
  return calls.map((c) => {
    const risk = c.riskLevel === "LOW" ? "🟢" : c.riskLevel === "MEDIUM" ? "🟡" : "🟠";
    return [
      `${risk} <b>${escHtml(c.symbol)}</b> (${escHtml(c.chainId)}) — score ${c.score}`,
      `Entry: ${escHtml(c.entryPrice)} → TP1: ${escHtml(c.target1)} → TP2: ${escHtml(c.target2)} | SL: ${escHtml(c.stopLoss)}`,
      `MC ${fmtMcap(c.mcap)} | Liq ${fmtUsd(c.liquidityUsd)} | Vol ${fmtUsd(c.volH24)} | Buys ${((c.buyPressure ?? 0) * 100).toFixed(0)}%`,
      `Why: ${c.reasons?.join(" · ") ?? "?"}`,
      `CA: <code>${escHtml(c.tokenAddress)}</code>`,
    ].join("\n");
  }).join("\n\n");
}

function formatAudit(d: any): string {
  if (!d) return "❌ No data";
  const lines = [`🔒 <b>AUDIT — ${escHtml(d.symbol)}</b> (${escHtml(d.chain)})`];
  lines.push(`Risk: ${d.riskScore}`);
  if (d.honeypot) {
    lines.push(`Honeypot: ${d.honeypot.isHoneypot ? "YES" : "No"} | Buy tax: ${d.honeypot.buyTax}% | Sell tax: ${d.honeypot.sellTax}%`);
  }
  if (d.rugcheck) {
    lines.push(`RugCheck score: ${d.rugcheck.score}`);
    if (d.rugcheck.risks?.length) {
      lines.push(`Risks: ${d.rugcheck.risks.map((r: any) => r.description || r.name).join(", ")}`);
    }
  }
  return lines.join("\n");
}

function formatHolders(d: any): string {
  if (!d) return "❌ No data";
  const c = d.categories;
  return [
    `🐋 <b>HOLDERS — ${escHtml(d.symbol)}</b> (${escHtml(d.chain)})`,
    "",
    `Whales (5%+): ${c.whales.count} wallets (${c.whales.pct.toFixed(1)}%)`,
    `Sharks (1-5%): ${c.sharks.count} wallets (${c.sharks.pct.toFixed(1)}%)`,
    `Fish (0.1-1%): ${c.fish.count} wallets (${c.fish.pct.toFixed(1)}%)`,
    `Small (&lt;0.1%): ${c.small.count} wallets (${c.small.pct.toFixed(1)}%)`,
  ].join("\n");
}

function formatTopTraders(d: any): string {
  if (!d) return "❌ No data";
  if (!d.consensus || d.consensus.direction === "none") {
    return `📊 <b>TOP TRADERS — ${escHtml(d.symbol)}</b> (${escHtml(d.chain)})\nNo clear consensus. ${d.note ?? ""}`;
  }
  return [
    `📊 <b>TOP TRADERS — ${escHtml(d.symbol)}</b> (${escHtml(d.chain)})`,
    "",
    `Direction: ${d.consensus.direction} (${d.consensus.score}/5)`,
    `Buy volume: ${fmtUsd(d.consensus.buyVolume)}`,
    `Sell volume: ${fmtUsd(d.consensus.sellVolume)}`,
  ].join("\n");
}

function formatGems(gems: any[]): string {
  if (!gems || gems.length === 0) return "❌ No gems found";
  const lines = ["💎 <b>LOW MC GEMS</b>"];
  for (const g of gems.slice(0, 8)) {
    lines.push(
      `<b>${escHtml(g.symbol)}</b> (${escHtml(g.chain)}) — MC ${fmtMcap(g.mcap)} | Liq ${fmtUsd(g.liquidity)} | Vol ${fmtUsd(g.volume)} | 24h ${g.priceChange24h > 0 ? "+" : ""}${g.priceChange24h?.toFixed(1) ?? "?"}%`
    );
  }
  return lines.join("\n");
}

function formatMarket(d: any): string {
  if (!d) return "❌ No data";
  const lines: string[] = [];
  if (d.market) {
    const m = d.market;
    lines.push("📊 <b>GLOBAL MARKET</b>");
    lines.push(`MC: $${((m.totalMarketCapUsd ?? 0) / 1e12).toFixed(2)}T | Vol: $${((m.totalVolumeUsd ?? 0) / 1e9).toFixed(2)}B`);
    lines.push(`BTC Dom: ${(m.btcDominance ?? 0).toFixed(1)}% | ETH Dom: ${(m.ethDominance ?? 0).toFixed(1)}%`);
    for (const c of (m.topCoins ?? []).slice(0, 5)) {
      lines.push(`${escHtml(c.symbol)}: $${(c.priceUsd ?? 0).toLocaleString()} (${c.priceChange24h > 0 ? "+" : ""}${(c.priceChange24h ?? 0).toFixed(1)}%)`);
    }
  }
  if (d.fearGreed) {
    lines.push("");
    lines.push(`Fear & Greed: ${d.fearGreed.value}/100 — ${d.fearGreed.classification}`);
  }
  return lines.join("\n");
}

function formatNews(d: any): string {
  if (!d) return "❌ No data";
  if (!d.articles || d.articles.length === 0) return `📰 No news found for ${escHtml(d.ticker)}`;
  const lines = [`📰 <b>NEWS — ${escHtml(d.ticker)}</b>`];
  for (const a of d.articles.slice(0, 5)) {
    lines.push(`• <a href="${a.url ?? "#"}">${escHtml(a.title)}</a>`);
  }
  return lines.join("\n\n");
}

function formatHelp(): string {
  return [
    "🤖 MEMFLOW AGENT — just type naturally:",
    "",
    "Scan — scan PEPE, scan WIF, DOGE",
    "Audit — audit TRUMP, check SAFU",
    "Calls — calls, signals, trade ideas",
    "Holders — holders of FARTCOIN",
    "Top traders — smart money in BONK",
    "Top tokens — list high MC tokens by chain",
    "Top tokens on solana — chain-specific",
    "Gems — gems, low cap",
    "Market — market, overview",
    "Fear — fear and greed",
    "News — news about BTC",
    "",
    "Or use slash commands: /scan /find /brief /audit /nh /top /snipers /watch /runners /vl /gems /calls",
  ].join("\n");
}

// ─── TOP TOKENS FORMATTER ──────────────────────────────────
function formatTopTokens(d: any): string {
  if (!d || !d.tokens || d.tokens.length === 0) return "❌ No tokens found";
  const lines = [`🏆 <b>TOP TOKENS — ${d.chain.toUpperCase()}</b> (${d.total} found)`];
  for (const t of d.tokens.slice(0, 15)) {
    const change = t.priceChange24h > 0 ? `+${(t.priceChange24h ?? 0).toFixed(1)}%` : `${(t.priceChange24h ?? 0).toFixed(1)}%`;
    lines.push(
      `<b>${escHtml(t.symbol)}</b> (${escHtml(t.chain)}) — $${fmtMcap(t.mcap)} | Liq $${fmtUsd(t.liquidity)} | Vol $${fmtUsd(t.volume24h)} | 24h ${change}`
    );
  }
  return lines.join("\n");
}

// ─── RESPONSE ROUTER ──────────────────────────────────────
function formatResponse(response: AgentResponse): string {
  if (!response.success) return `❌ ${response.error ?? "Unknown error"}`;

  switch (response.action) {
    case "scan": return formatScan(response.data);
    case "calls": return formatCalls(response.data);
    case "audit": return formatAudit(response.data);
    case "holders": return formatHolders(response.data);
    case "topTraders": return formatTopTraders(response.data);
    case "gems": return formatGems(response.data);
    case "topTokens": return formatTopTokens(response.data);
    case "wallet": return formatWallet(response.data);
    case "trenches": return formatTrenches(response.data);
    case "portfolio": return formatPortfolio(response.data);
    case "market":
    case "fearGreed": return formatMarket(response.data);
    case "news": return formatNews(response.data);
    case "help": return formatHelp();
    default: return truncate(JSON.stringify(response.data, null, 2));
  }
}

// ─── WALLET FORMATTER ──────────────────────────────────────
function formatWallet(d: any): string {
  if (!d) return "❌ No wallet data";
  const lines = [
    `🔍 <b>WALLET ANALYZER</b>`,
    `<code>${d.wallet}</code>\n`,
    `💰 SOL: ${d.solBalance?.toFixed(4)} | 💎 Total: $${fmtUsd(d.totalValueUsd)}`,
    `🪙 Holdings: ${d.holdingsCount} tokens\n`,
  ];
  for (const h of (d.holdings ?? []).slice(0, 8)) {
    const change = h.change24h > 0 ? `+${h.change24h.toFixed(1)}%` : `${(h.change24h ?? 0).toFixed(1)}%`;
    lines.push(`• ${escHtml(h.symbol)} — $${fmtUsd(h.value)} | 24h ${change}`);
  }
  if (d.stats) {
    lines.push(`\n📊 Age: ${d.stats.ageDays}d | TXs: ${d.stats.totalTransactions} | ${d.stats.txFrequency}/day`);
  }
  return lines.join("\n");
}

// ─── TRENCHES FORMATTER ──────────────────────────────────────
function formatTrenches(d: any): string {
  if (!d?.tokens || d.tokens.length === 0) return "❌ No new tokens found";
  const lines = [`🚨 <b>TRENCHES — NEW TOKENS</b> (${d.total})\n`];
  for (const t of d.tokens.slice(0, 12)) {
    const src = t.source === "pump.fun" ? "🚀" : "📊";
    const mc = t.mcap > 0 ? `$${fmtMcap(t.mcap)}` : "No MC";
    const liq = t.liq > 0 ? `$${fmtUsd(t.liq)}` : "No liq";
    lines.push(`${src} <b>${escHtml(t.symbol)}</b> — MC: ${mc} | Liq: ${liq}`);
  }
  return lines.join("\n");
}

// ─── PORTFOLIO FORMATTER ──────────────────────────────────────
function formatPortfolio(d: any): string {
  if (!d?.positions || d.positions.length === 0) return "📊 No positions. Use /portfolio add <SYM> <price> <amount>";
  const lines = [
    `📊 <b>PORTFOLIO</b>\n`,
    `💰 Invested: $${fmtUsd(d.totalInvested)} | Current: $${fmtUsd(d.totalCurrent)}`,
    `📈 PnL: $${fmtUsd(d.totalPnl)} (${d.totalPnlPct > 0 ? "+" : ""}${d.totalPnlPct?.toFixed(2)}%)\n`,
    `🎯 Win Rate: ${d.winRate?.toFixed(0)}% | 🟢 ${d.winners}W / 🔴 ${d.losers}L / ⚪ ${d.breakeven}BE`,
    `📊 Avg Win: ${d.avgWin > 0 ? "+" : ""}${d.avgWin?.toFixed(1)}% | Avg Loss: ${d.avgLoss?.toFixed(1)}%\n`,
  ];
  for (const p of d.positions) {
    const e = p.pnl >= 0 ? "🟢" : "🔴";
    const s = p.pnl >= 0 ? "+" : "";
    lines.push(`${e} <b>${escHtml(p.symbol)}</b> — Entry $${p.entryPrice?.toFixed(6)} → $${p.currentPrice?.toFixed(6)} | PnL ${s}$${fmtUsd(Math.abs(p.pnl))} (${s}${p.pnlPct?.toFixed(2)}%)`);
  }
  return lines.join("\n");
}

// ─── INSTANCES ──────────────────────────────────────────────
const agentInstances = new Map<number, MemflowAgent>();

export function getAgent(chatId: number, bot: Bot): MemflowAgent {
  if (agentInstances.has(chatId)) return agentInstances.get(chatId)!;

  const agent = new MemflowAgent({
    autoRun: false,
    callIntervalHours: 4,
    onCall: (calls: any[]) => {
      // Send calls to all subscribed chats
      const msg = formatCalls(calls);
      for (const [chatId] of chatSubscriptions) {
        bot.api.sendMessage(chatId, `🎯 <b>DAILY CALLS</b>\n\n${msg}`, { parse_mode: "HTML" })
          .catch((e) => console.error(`[agent] send to ${chatId} failed:`, (e as Error).message));
      }
    },
  });

  agentInstances.set(chatId, agent);
  return agent;
}

export async function handleAgentMessage(ctx: any, text: string): Promise<boolean> {
  const chatId = ctx.chat?.id;
  if (!chatId) return false;

  const agent = getAgent(chatId, ctx.api.bot);

  // Auto-subscribe chats that interact with agent
  registerAlertChat(chatId, ctx.api.bot);

  const response = await agent.process(text);
  const msg = formatResponse(response);

  try {
    await ctx.reply(truncate(msg), { parse_mode: "HTML" });
  } catch {
    await ctx.reply(truncate(msg.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] ?? c))));
  }

  return true;
}

export function toggleAutoMode(chatId: number, bot: Bot): boolean {
  const instance = agentInstances.get(chatId);
  if (!instance) return false;

  if (instance.isRunning()) {
    instance.stopAuto();
    return false;
  } else {
    instance.startAuto();
    return true;
  }
}
