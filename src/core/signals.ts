import { PairSnapshot, FlowSignal, FlowState } from "./types.js";
import { rollingStats, zScore } from "./baseline.js";

const VOL_SPIKE_Z = 2.5;
const VOL_WARM_Z = 1.5;
const LIQ_DROP_PCT = -35;
const EXIT_LIQ_SLOPE = -8;

export function evaluateFlow(history: PairSnapshot[], current: PairSnapshot): FlowSignal {
  const reasons: string[] = [];
  let state: FlowState = "IDLE";

  const volHistory = history.map((s) => s.volM5 ?? NaN);
  const stats = rollingStats(volHistory.slice(0, -1));
  const zVol = current.volM5 !== undefined ? zScore(current.volM5, stats) : 0;

  const liqSeries = [...history.map((s) => s.liquidityUsd ?? NaN), current.liquidityUsd ?? NaN];
  const liqSlopePct = pctChange(liqSeries);

  const buys = current.buysM5 ?? 0;
  const sells = current.sellsM5 ?? 0;
  const totalTx = buys + sells;
  const buyRatio = totalTx > 0 ? buys / totalTx : 0.5;

  const liqDropPct = worstShortTermDrop(liqSeries);
  if (liqDropPct <= LIQ_DROP_PCT) {
    reasons.push(`liquidity collapsed ${liqDropPct.toFixed(1)}% in short window`);
    return finalize("RUG_ALERT", reasons, { zVol, liqSlopePct, buyRatio });
  }

  const spiking = zVol >= VOL_SPIKE_Z;
  const warming = zVol >= VOL_WARM_Z;
  const liqRising = liqSlopePct > 2;
  const liqFalling = liqSlopePct < EXIT_LIQ_SLOPE;
  const buyersLeading = buyRatio >= 0.55;
  const sellersLeading = buyRatio <= 0.42;

  if (spiking && liqRising && buyersLeading) {
    state = "HOP";
    reasons.push(`volume spike ${zVol.toFixed(1)}σ above baseline`, "liquidity growing alongside", `buyers leading (${pct(buyRatio)} of txns)`);
  } else if (spiking && !liqRising) {
    state = "TRAP";
    reasons.push(`volume spike ${zVol.toFixed(1)}σ`, liqFalling ? "but liquidity draining" : "but liquidity not following");
    if (sellersLeading) reasons.push(`sellers dominate (${pct(1 - buyRatio)} of txns)`);
  } else if (warming && liqFalling && sellersLeading) {
    state = "EXIT_NOW";
    reasons.push("volume momentum dying", `liquidity bleeding ${liqSlopePct.toFixed(1)}%/window`, "sellers in control");
  } else if (liqFalling) {
    state = "EXIT_NOW";
    reasons.push(`liquidity bleeding ${liqSlopePct.toFixed(1)}%/window`);
  } else if (spiking || warming) {
    state = "WATCH";
    reasons.push(`elevated volume ${zVol.toFixed(1)}σ`);
  } else if (warming === false && zVol < 0.5 && liqRising) {
    state = "WATCH";
    reasons.push("quiet accumulation — liquidity building on low volume");
  }

  return finalize(state, reasons, { zVol, liqSlopePct, buyRatio });
}

function entryScore(state: FlowState, ctx: { zVol: number; liqSlopePct: number; buyRatio: number }): number {
  let score = 40;
  if (state === "HOP") score += 30;
  if (state === "TRAP") score -= 15;
  if (state === "EXIT_NOW") score -= 35;
  if (state === "RUG_ALERT") score -= 60;
  score += Math.min(ctx.zVol * 4, 15);
  score += (ctx.buyRatio - 0.5) * 40;
  if (ctx.liqSlopePct > 0) score += Math.min(ctx.liqSlopePct / 2, 10);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function finalize(
  state: FlowState,
  reasons: string[],
  ctx: { zVol: number; liqSlopePct: number; buyRatio: number }
): FlowSignal {
  return { state, reasons, ...ctx, entryScore: entryScore(state, ctx) };
}

function pctChange(series: number[]): number {
  const clean = series.filter((v) => Number.isFinite(v)) as number[];
  if (clean.length < 2 || !clean[0]) return 0;
  return ((clean[clean.length - 1] - clean[0]) / Math.abs(clean[0])) * 100;
}

function worstShortTermDrop(series: number[]): number {
  const clean = series.filter((v) => Number.isFinite(v)) as number[];
  if (clean.length < 3) return 0;
  const window = clean.slice(-6);
  let worst = 0;
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1];
    const cur = window[i];
    if (prev > 0) worst = Math.min(worst, ((cur - prev) / prev) * 100);
  }
  return worst;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export const STATE_EMOJI: Record<FlowState, string> = {
  HOP: "🟢 HOP",
  TRAP: "🟡 TRAP",
  WATCH: "👀 WATCH",
  EXIT_NOW: "🔴 EXIT NOW",
  RUG_ALERT: "🚨 RUG ALERT",
  IDLE: "💤 IDLE",
};
