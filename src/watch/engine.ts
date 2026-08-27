import { Bot } from "grammy";
import { listWatched, saveSnapshot, loadSnapshots, replaceWhales, getWhales, updateWhaleBalance, saveAlertChat, loadAlertChats } from "../storage/db.js";
import { getPairsByAddresses, toSnapshot } from "../sources/dexscreener.js";
import { getRecentTokenTransfers, rankWhales, getTokenBalance } from "../sources/etherscan.js";
import { evaluateFlow, STATE_EMOJI } from "../core/signals.js";
import { analyzeDistribution, describeDistribution, DistributionSignal } from "../core/distribution.js";
import { recordTrades, analyzeTopTraders } from "../core/toptraders.js";
import { getPoolTrades, getPoolBaseToken, toGeckoNetwork } from "../sources/geckoterminal.js";
import { getTokenLargestAccounts } from "../sources/helius.js";
import { config } from "../config.js";
import { FlowState, PairSnapshot } from "../core/types.js";
import { DexPair } from "../sources/dexscreener.js";

const POLL_INTERVAL_MS = 60_000;
const WHALE_CHECK_INTERVAL_TICKS = 5;
const CHART_ALERT_INTERVAL_TICKS = 300; // 5 hours at 1-min polls
const DIST_COOLDOWN_MS = 45 * 60_000;
const WHALE_DROP_PCT = 0.4;
const LIQ_MIN_DELTA_USD = 2_000;
const LIQ_MIN_PCT = 0.08;
const LIQ_ALERT_COOLDOWN_MS = 10 * 60_000;
const TT_TRADE_MIN_USD = 800;
const TT_COOLDOWN_MS = 30 * 60_000;

const lastState = new Map<string, FlowState>();
const lastDist = new Map<string, { kind: string; ts: number }>();
const whaleTick = new Map<string, number>();
const liqAlertAt = new Map<string, number>();
const ttCooldown = new Map<string, Map<string, number>>();
const gtBaseCache = new Map<string, string | null>();

function fmtUsd(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return "?";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function startWatchEngine(bot: Bot): NodeJS.Timeout {
  let tickCount = 0;

  const tick = async () => {
    tickCount++;
    try {
      const watched = listWatched();
      if (watched.length === 0) return;
      const watchedByPair = new Map(watched.map((w) => [w.pairAddress, w]));
      const pairs: DexPair[] = await getPairsByAddresses(watched.map((w) => w.pairAddress));

      for (const p of pairs) {
        const snap = toSnapshot(p);
        saveSnapshot(snap);
        const history: PairSnapshot[] = loadSnapshots(p.pairAddress);
        if (history.length < 4) continue;

        const prevSnap = history[history.length - 2];
        if (prevSnap?.liquidityUsd && snap.liquidityUsd && prevSnap.liquidityUsd > 0) {
          const delta = snap.liquidityUsd - prevSnap.liquidityUsd;
          const pctOfPrev = Math.abs(delta) / prevSnap.liquidityUsd;
          const lastAlert = liqAlertAt.get(p.pairAddress) ?? 0;
          if (
            Math.abs(delta) >= LIQ_MIN_DELTA_USD &&
            pctOfPrev >= LIQ_MIN_PCT &&
            Date.now() - lastAlert > LIQ_ALERT_COOLDOWN_MS
          ) {
            liqAlertAt.set(p.pairAddress, Date.now());
            await sendLiqAlert(bot, snap, delta, pctOfPrev);
          }
        }

        const signal = evaluateFlow(history.slice(0, -1), snap);
        const prev = lastState.get(p.pairAddress);
        lastState.set(p.pairAddress, signal.state);
        if (signal.state !== "IDLE" && signal.state !== prev) {
          await sendFlowAlert(bot, snap, signal);
        }

        const dist = analyzeDistribution(history);
        if (dist && shouldSendDist(p.pairAddress, dist.kind)) {
          await sendDistAlert(bot, snap, dist);
        }

        await trackTopTraders(bot, snap);
      }

      if (tickCount % WHALE_CHECK_INTERVAL_TICKS === 0) {
        await runWhaleChecks(bot, pairs, watchedByPair);
      }

      if (tickCount % CHART_ALERT_INTERVAL_TICKS === 0 && tickCount > 0) {
        await sendChartAlerts(bot, pairs);
      }

      if (tickCount % 2 === 0) {
        checkPriceAlerts(bot).catch((e) => console.error("[alert-check]", (e as Error).message));
      }

      if (tickCount % 5 === 0) {
        const { checkCopyTrades } = await import("../core/copytrade.js");
        checkCopyTrades(bot).catch((e) => console.error("[copytrade]", (e as Error).message));
      }

      if (tickCount % 60 === 0 && tickCount > 0) {
        const { cleanAlerts } = await import("../bot/commands/alert.js");
        const { cleanRecentCopies } = await import("../bot/commands/copy.js");
        const { cleanAgentInstances } = await import("../agent/telegram.js");
        cleanAlerts();
        cleanRecentCopies();
        cleanAgentInstances();
      }
    } catch (err) {
      console.error("[watch-engine]", (err as Error).message);
    }
  };

  void tick();
  return setInterval(() => void tick(), POLL_INTERVAL_MS);
}

function shouldSendDist(pair: string, kind: string): boolean {
  const prev = lastDist.get(pair);
  if (prev && prev.kind === kind && Date.now() - prev.ts < DIST_COOLDOWN_MS) return false;
  lastDist.set(pair, { kind, ts: Date.now() });
  return true;
}

async function trackTopTraders(bot: Bot, snap: PairSnapshot): Promise<void> {
  const network = toGeckoNetwork(snap.chainId);
  // GeckoTerminal's trades feed is sparse with corrupted USD volumes on Solana;
  // Solana smart-money stays gated until a Helius key is configured.
  if (!network || network === "solana") return;
  try {
    let gtBase = gtBaseCache.get(snap.pairAddress);
    if (gtBase === undefined) {
      gtBase = await getPoolBaseToken(network, snap.pairAddress);
      gtBaseCache.set(snap.pairAddress, gtBase);
    }

    const fetched = await getPoolTrades(network, snap.pairAddress);
    const trades = fetched.filter((t) => t.usd >= TT_TRADE_MIN_USD && t.usd < 5_000_000);
    if (trades.length === 0) return;

    const aligned =
      gtBase && snap.baseAddress && gtBase !== snap.baseAddress.toLowerCase()
        ? trades.map((t) => ({ ...t, side: (t.side === "buy" ? "sell" : "buy") as "buy" | "sell" }))
        : trades;
    recordTrades(snap.pairAddress, aligned);

    const c = analyzeTopTraders(snap.pairAddress);
    if (!c.verdict) return;

    let cooldowns = ttCooldown.get(snap.pairAddress);
    if (!cooldowns) {
      cooldowns = new Map();
      ttCooldown.set(snap.pairAddress, cooldowns);
    }
    const last = cooldowns.get(c.verdict) ?? 0;
    if (Date.now() - last < TT_COOLDOWN_MS) return;
    cooldowns.set(c.verdict, Date.now());

    await sendTopTraderAlert(bot, snap, c);
  } catch {
    // top-trader feed is best-effort; never break the polling loop
  }
}

async function sendTopTraderAlert(
  bot: Bot,
  snap: PairSnapshot,
  c: import("../core/toptraders.js").TopTraderConsensus
): Promise<void> {
  if (!c.verdict) return;
  const exiting = c.verdict === "EXIT";
  const head = exiting
    ? `🐋 SMART MONEY EXIT - *${snap.symbol}* (${snap.chainId})`
    : `🟢 SMART MONEY ACCUMULATION - *${snap.symbol}* (${snap.chainId})`;
  const body = [
    `${c.trackedWallets} top traders (≥$1K moves, last ~15m):`,
    `sellers: *${c.sellers}* · buyers: *${c.buyers}* · net flow: ${fmtUsd(Math.abs(c.netUsd))} ${c.netUsd > 0 ? "IN" : "OUT"}`,
    `liq: ${fmtUsd(snap.liquidityUsd)} · price: ${snap.priceUsd ? "$" + snap.priceUsd : "?"}`,
  ];
  const note = exiting
    ? `_Big wallets are leaving together. Retail is usually the exit liquidity here._`
    : `_Big wallets are loading quietly. Watch for follow-through volume before chasing._`;
  await broadcast(bot, [head, "", ...body, "", note].join("\n"));
}

async function sendLiqAlert(  bot: Bot,
  snap: PairSnapshot,
  deltaUsd: number,
  pctOfPrev: number
): Promise<void> {
  const entering = deltaUsd > 0;
  const head = entering
    ? `💧 LIQUIDITY IN - *${snap.symbol}* (${snap.chainId})`
    : `🚰 LIQUIDITY OUT - *${snap.symbol}* (${snap.chainId})`;
  const body = [
    `${entering ? "+" : "-"}${fmtUsd(Math.abs(deltaUsd))} ${entering ? "added to" : "pulled from"} the pool in the last minute (${(pctOfPrev * 100).toFixed(1)}%)`,
    `liq now: ${fmtUsd(snap.liquidityUsd)} · mcap: ${fmtUsd(snap.mcap)}`,
    `price: ${snap.priceUsd ? "$" + snap.priceUsd : "?"} · vol m5: ${fmtUsd(snap.volM5)}`,
  ];
  const note = entering
    ? `_LPs adding - bullish confidence signal. Verify it is not one wallet restocking._`
    : `_LP removal often precedes rugs. Tighten stops or consider exiting._`;
  await broadcast(bot, [head, "", ...body, "", note].join("\n"));
}

async function sendFlowAlert(
  bot: Bot,
  snap: PairSnapshot,
  signal: import("../core/types.js").FlowSignal
): Promise<void> {
  const lines = [
    `${STATE_EMOJI[signal.state]} *${snap.symbol}* (${snap.chainId})`,
    "",
    `price: ${snap.priceUsd ? "$" + snap.priceUsd : "?"} · liq: ${fmtUsd(snap.liquidityUsd)} · mcap: ${fmtUsd(snap.mcap)}`,
    `vol m5: ${fmtUsd(snap.volM5)} · txns: ${snap.buysM5 ?? 0}b/${snap.sellsM5 ?? 0}s (${Math.round(signal.buyRatio * 100)}% buys)`,
    `vol spike: ${signal.zVol > 0 ? "+" : ""}${signal.zVol.toFixed(1)}σ · liq trend: ${signal.liqSlopePct.toFixed(1)}%`,
    "",
    ...signal.reasons.map((r) => `• ${r}`),
    "",
    `🎯 entry score: *${signal.entryScore}/100*`,
  ];
  await broadcast(bot, lines.join("\n"));
}

async function sendDistAlert(bot: Bot, snap: PairSnapshot, sig: DistributionSignal): Promise<void> {
  const header =
    sig.kind === "DISTRIBUTION" ? "🐋 SMART MONEY DISTRIBUTING" :
    sig.kind === "HEAVY_SELLING" ? "🚨 HEAVY SELLING DETECTED" :
    "👀 ACCUMULATION PATTERN";

  const lines = [
    `${header} — *${snap.symbol}* (${snap.chainId})`,
    "",
    ...describeDistribution(sig),
    "",
    `price now: ${snap.priceUsd ? "$" + snap.priceUsd : "?"} · liq: ${fmtUsd(snap.liquidityUsd)}`,
  ];
  await broadcast(bot, lines.join("\n"));
}

async function broadcast(bot: Bot, text: string): Promise<void> {
  for (const chatId of alertChats) {
    try {
      await bot.api.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      console.error("[alert]", (err as Error).message);
    }
  }
}

function sparkline(prices: number[]): string {
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  if (prices.length === 0) return "";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  return prices.map((p) => {
    const idx = Math.min(7, Math.floor(((p - min) / range) * 8));
    return blocks[idx];
  }).join("");
}

async function sendChartAlerts(bot: Bot, pairs: DexPair[]): Promise<void> {
  for (const p of pairs) {
    try {
      const history: PairSnapshot[] = loadSnapshots(p.pairAddress);
      if (history.length < 10) continue;

      // Last 5 hours of snapshots (at 1-min intervals = last 300 points, but we have sparse data)
      const recent = history.slice(-60);
      if (recent.length < 5) continue;

      const prices = recent.map((s) => s.priceUsd ?? 0).filter((p) => p > 0);
      const vols = recent.map((s) => s.volM5 ?? 0);
      const liqs = recent.map((s) => s.liquidityUsd ?? 0);

      if (prices.length < 3) continue;

      const firstPrice = prices[0];
      const lastPrice = prices[prices.length - 1];
      const priceChange = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

      const firstLiq = liqs[0];
      const lastLiq = liqs[liqs.length - 1];
      const liqChange = firstLiq > 0 ? ((lastLiq - firstLiq) / firstLiq) * 100 : 0;

      const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
      const recentVol = vols.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, vols.length);
      const volTrend = avgVol > 0 ? ((recentVol - avgVol) / avgVol) * 100 : 0;

      const chart = sparkline(prices);
      const arrow = priceChange > 0 ? "📈" : priceChange < 0 ? "📉" : "➡️";
      const pct = priceChange > 0 ? `+${priceChange.toFixed(1)}%` : `${priceChange.toFixed(1)}%`;
      const liqPct = liqChange > 0 ? `+${liqChange.toFixed(1)}%` : `${liqChange.toFixed(1)}%`;
      const volPct = volTrend > 0 ? `+${volTrend.toFixed(0)}%` : `${volTrend.toFixed(0)}%`;

      const lines = [
        `${arrow} *5H CHART — ${p.baseToken.symbol}* (${p.chainId})`,
        `\`${chart}\``,
        `price: $${lastPrice.toFixed(lastPrice < 0.001 ? 10 : lastPrice < 1 ? 6 : 4)} (${pct})`,
        `liq: ${fmtUsd(lastLiq)} (${liqPct}) · vol trend: ${volPct}`,
      ];

      // Trend interpretation
      if (priceChange > 10 && liqChange > 5) {
        lines.push("_🟢 Bullish — price + liq both rising_");
      } else if (priceChange > 10 && liqChange < -5) {
        lines.push("_⚠️ Pump but liq leaving — possible rug setup_");
      } else if (priceChange < -10 && liqChange > 5) {
        lines.push("_🟡 Price dropping but liq holding — accumulation?_");
      } else if (priceChange < -10 && liqChange < -10) {
        lines.push("_🔴 Price + liq both falling — consider exiting_");
      } else if (Math.abs(priceChange) < 3) {
        lines.push("_➡️ Consolidating — watch for breakout_");
      }

      await broadcast(bot, lines.join("\n"));
    } catch (err) {
      console.error("[chart-alert]", p.baseToken.symbol, (err as Error).message);
    }
  }
}

async function runWhaleChecks(
  bot: Bot,
  pairs: DexPair[],
  watchedByPair: Map<string, { pairAddress: string; chainId: string; symbol: string }>
): Promise<void> {
  for (const p of pairs) {
    if (p.chainId === "solana") {
      if (config.heliusKey) await runSolanaWhaleCheck(bot, p);
      continue;
    }
    if (p.chainId !== "ethereum") continue;
    const token = p.baseToken.address.toLowerCase();
    const pair = p.pairAddress;
    const exclude = new Set([pair.toLowerCase(), "0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
    const ticks = whaleTick.get(pair) ?? 0;
    whaleTick.set(pair, ticks + 1);

    try {
      let whales = getWhales(pair);
      if (whales.length === 0) {
        const transfers = await getRecentTokenTransfers(token);
        const ranked = rankWhales(transfers, exclude);
        replaceWhales(
          pair,
          token,
          await Promise.all(ranked.map(async (w) => ({
            wallet: w.wallet,
            balance: String(w.received),
            priceAtTrack: toSnapshot(p).priceUsd,
          })))
        );
        whales = getWhales(pair);
        if (whales.length > 0) {
          await broadcast(bot, `🐋 tracking ${whales.length} largest recent accumulators of *${p.baseToken.symbol}* — will flag when they dump.`);
        }
        continue;
      }

      for (const w of whales.slice(0, 6)) {
        const balance = await getTokenBalance(w.wallet, token);
        const tracked = Number(BigInt(w.balance || "0"));
        if (tracked <= 0) continue;
        const dropped = 1 - balance / tracked;
        const priceThen = w.priceAtTrack;
        const priceNow = toSnapshot(p).priceUsd;
        const priceUp = priceThen && priceNow ? priceNow >= priceThen * 1.02 : true;
        if (dropped >= WHALE_DROP_PCT && priceUp) {
          await broadcast(bot, [
            `🐋 WHALE EXITED — *${p.baseToken.symbol}* (ETH)`,
            "",
            `tracked wallet \`${w.wallet.slice(0, 10)}…\` sold ~${Math.round(dropped * 100)}% of its stack`,
            priceUp ? "while price held or rose — retail is the exit liquidity" : "",
            "",
            "consider your position.",
          ].filter(Boolean).join("\n"));
          updateWhaleBalance(pair, w.wallet, String(balance));
        } else if (dropped >= 0.05) {
          updateWhaleBalance(pair, w.wallet, String(balance));
        }
      }
    } catch (err) {
      console.error("[whales]", p.baseToken.symbol, (err as Error).message);
    }
  }
}

const SOL_BURN = "1nc1nerator11111111111111111111111111111111";

async function runSolanaWhaleCheck(bot: Bot, p: DexPair): Promise<void> {
  const mint = p.baseToken.address;
  const pair = p.pairAddress;
  whaleTick.set(pair, (whaleTick.get(pair) ?? 0) + 1);
  try {
    const accounts = await getTokenLargestAccounts(mint);
    if (accounts.length === 0) return;
    const holders = accounts.filter((a) => a.address !== SOL_BURN);
    const byAddr = new Map(holders.map((h) => [h.address, h.uiAmount]));
    const priceNow = toSnapshot(p).priceUsd;

    let whales = getWhales(pair);
    if (whales.length === 0) {
      replaceWhales(
        pair,
        mint,
        holders.slice(0, 8).map((h) => ({
          wallet: h.address,
          balance: String(Math.round(h.uiAmount)),
          priceAtTrack: priceNow,
        }))
      );
      whales = getWhales(pair);
      if (whales.length > 0) {
        await broadcast(bot, `🐋 tracking ${whales.length} largest SOL holders of *${p.baseToken.symbol}* — will flag when they dump.`);
      }
      return;
    }

    for (const w of whales.slice(0, 8)) {
      const now = byAddr.get(w.wallet);
      if (now === undefined) continue;
      const tracked = Number(w.balance || "0");
      if (!tracked || tracked <= 0) continue;
      const dropped = 1 - now / tracked;
      const priceUp = w.priceAtTrack && priceNow ? priceNow >= (w.priceAtTrack as number) * 1.02 : true;
      if (dropped >= WHALE_DROP_PCT && priceUp) {
        await broadcast(bot, [
          `🐋 WHALE EXITED - *${p.baseToken.symbol}* (SOL)`,
          "",
          `tracked holder \`${w.wallet.slice(0, 10)}…\` sold ~${Math.round(dropped * 100)}% of its stack`,
          priceUp ? "while price held or rose - retail is the exit liquidity" : "",
          "",
          "consider your position.",
        ].filter(Boolean).join("\n"));
        updateWhaleBalance(pair, w.wallet, String(Math.round(now)));
      } else if (dropped >= 0.05) {
        updateWhaleBalance(pair, w.wallet, String(Math.round(now)));
      }
    }
  } catch (err) {
    console.error("[sol-whales]", p.baseToken.symbol, (err as Error).message);
  }
}

const alertChats = new Set<number>(loadAlertChats());
export function registerAlertChat(chatId: number): void {
  if (!alertChats.has(chatId)) {
    alertChats.add(chatId);
    saveAlertChat(chatId);
  }
}

async function checkPriceAlerts(bot: Bot): Promise<void> {
  try {
    const { getActiveAlerts, markAlertTriggered } = await import("../bot/commands/alert.js");
    const { getPairsByAddresses } = await import("../sources/dexscreener.js");

    const alerts = getActiveAlerts();
    if (alerts.length === 0) return;

    const pairAddresses = [...new Set(alerts.map((a) => a.pairAddress))];
    const pairs = await getPairsByAddresses(pairAddresses);
    const pairMap = new Map(pairs.map((p) => [p.pairAddress, p]));

    for (const alert of alerts) {
      const pair = pairMap.get(alert.pairAddress);
      if (!pair) continue;

      const price = parseFloat(pair.priceUsd ?? "0");
      const mc = pair.marketCap ?? 0;
      let triggered = false;

      switch (alert.type) {
        case "price_above":
          triggered = price >= alert.target;
          break;
        case "price_below":
          triggered = price <= alert.target;
          break;
        case "mc_above":
          triggered = mc >= alert.target;
          break;
        case "mc_below":
          triggered = mc <= alert.target;
          break;
      }

      if (triggered) {
        markAlertTriggered(alert.id);
        const emoji = alert.type.includes("above") ? "📈" : "📉";
        const msg = [
          `${emoji} *ALERT TRIGGERED!*`,
          "",
          `Token: *${alert.symbol}* (${alert.chainId})`,
          `Rule: ${alert.type.replace("_", " ")} ${alert.target}`,
          `Current: $${price} · MC: $${mc.toLocaleString()}`,
          `ID: \`${alert.id}\``,
        ].join("\n");

        await bot.api.sendMessage(alert.chatId, msg, { parse_mode: "Markdown" });
      }
    }
  } catch (err) {
    console.error("[alert-check]", (err as Error).message);
  }
}
