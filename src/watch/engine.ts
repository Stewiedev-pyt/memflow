import { Bot } from "grammy";
import { listWatched, saveSnapshot, loadSnapshots, replaceWhales, getWhales, updateWhaleBalance } from "../storage/db.js";
import { getPairsByAddresses, toSnapshot } from "../sources/dexscreener.js";
import { getRecentTokenTransfers, rankWhales, getTokenBalance } from "../sources/etherscan.js";
import { evaluateFlow, STATE_EMOJI } from "../core/signals.js";
import { analyzeDistribution, describeDistribution, DistributionSignal } from "../core/distribution.js";
import { FlowState, PairSnapshot } from "../core/types.js";
import { DexPair } from "../sources/dexscreener.js";

const POLL_INTERVAL_MS = 60_000;
const WHALE_CHECK_INTERVAL_TICKS = 5;
const DIST_COOLDOWN_MS = 45 * 60_000;
const WHALE_DROP_PCT = 0.4;

const lastState = new Map<string, FlowState>();
const lastDist = new Map<string, { kind: string; ts: number }>();
const whaleTick = new Map<string, number>();

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
      }

      if (tickCount % WHALE_CHECK_INTERVAL_TICKS === 0) {
        await runWhaleChecks(bot, pairs, watchedByPair);
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

async function runWhaleChecks(
  bot: Bot,
  pairs: DexPair[],
  watchedByPair: Map<string, { pairAddress: string; chainId: string; symbol: string }>
): Promise<void> {
  for (const p of pairs) {
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

const alertChats = new Set<number>();
export function registerAlertChat(chatId: number): void {
  alertChats.add(chatId);
}
