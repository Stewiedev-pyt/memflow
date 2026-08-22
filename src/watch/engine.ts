import { Bot } from "grammy";
import { listWatched, saveSnapshot, loadSnapshots } from "../storage/db.js";
import { getPairsByAddresses, toSnapshot } from "../sources/dexscreener.js";
import { evaluateFlow, STATE_EMOJI } from "../core/signals.js";
import { FlowState, PairSnapshot } from "../core/types.js";

const POLL_INTERVAL_MS = 60_000;

const lastState = new Map<string, FlowState>();

function fmtUsd(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return "?";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function startWatchEngine(bot: Bot): NodeJS.Timeout {
  const tick = async () => {
    try {
      const watched = listWatched();
      if (watched.length === 0) return;
      const pairs = await getPairsByAddresses(watched.map((w) => w.pairAddress));
      for (const p of pairs) {
        const snap = toSnapshot(p);
        saveSnapshot(snap);
        const history: PairSnapshot[] = loadSnapshots(p.pairAddress);
        if (history.length < 4) continue;
        const signal = evaluateFlow(history.slice(0, -1), snap);
        const prev = lastState.get(p.pairAddress);
        lastState.set(p.pairAddress, signal.state);
        if (signal.state === "IDLE" || signal.state === prev) continue;
        await sendAlert(bot, snap, signal);
      }
    } catch (err) {
      console.error("[watch-engine]", (err as Error).message);
    }
  };

  void tick();
  return setInterval(() => void tick(), POLL_INTERVAL_MS);
}

async function sendAlert(
  bot: Bot,
  snap: PairSnapshot,
  signal: import("../core/types.js").FlowSignal
): Promise<void> {
  const watched = listWatched().find((w) => w.pairAddress === snap.pairAddress);
  const chatIds = getAlertChatIds();
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
    `_tracked as ${watched?.symbol ?? snap.symbol} — /unwatch ${snap.pairAddress.slice(0, 8)}… to stop_`,
  ];
  for (const chatId of chatIds) {
    await bot.api.sendMessage(chatId, lines.join("\n"), {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  }
}

const alertChats = new Set<number>();
export function registerAlertChat(chatId: number): void {
  alertChats.add(chatId);
}
function getAlertChatIds(): number[] {
  return alertChats.size > 0 ? [...alertChats] : [];
}
